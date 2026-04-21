import { createHash, randomUUID } from "crypto";
import { getDbInstance } from "@/lib/db/core";
import {
  detectSensitiveEntities,
  resolvePrivacyProfile,
  type DetectedPrivacyEntity,
} from "./detectors";
import {
  compilePrivacyBundleRecord,
  compilePrivacyConfig,
  getCompiledPrivacyBundle,
  invalidatePrivacyBundleCache,
} from "./bundle";
import {
  activatePrivacyBundle,
  getActivePrivacyBundle,
  getPrivacyBundle,
  getPrivacyConfig,
  getPrivacyRuntimeStats,
  listPrivacyBundles,
  updatePrivacyConfig,
} from "./store";
import type {
  PrivacyConfig,
  PrivacyLevel,
  PrivacyRule,
  PrivacyTransformMode,
} from "./types";
import type {
  PrivacyBundleVersionSummary,
  PrivacyControlPlanePatch,
  PrivacyControlPlaneWorkspace,
  PrivacyDetectedEntity,
  PrivacyIncident,
  PrivacyPipelineStep,
  PrivacyRestoreTokenPreview,
  PrivacySettings,
  PrivacySourceApp,
  PrivacyTestInput,
  PrivacyTestResult,
} from "./controlPlaneTypes";

const SETTINGS_NAMESPACE = "privacy";
const SETTINGS_KEY = "controlPlaneSettings";

const DEFAULT_SOURCE_APPS: PrivacySourceApp[] = [
  { id: "src-openwebui", key: "openwebui", name: "OpenWebUI", environment: "local", active: true },
  {
    id: "src-openclaw-gw",
    key: "openclaw-gw",
    name: "OpenClaw Gateway",
    environment: "local",
    active: true,
  },
  {
    id: "src-openclaw-cli",
    key: "openclaw-cli",
    name: "OpenClaw CLI",
    environment: "local",
    active: true,
  },
  { id: "src-direct-api", key: "direct-api", name: "Direct API", environment: "local", active: true },
];

const DEFAULT_SETTINGS: PrivacySettings = {
  vaultEnabled: true,
  tokenTtlSeconds: 3600,
  autoExpireRestoreTokens: true,
  encryptionRequired: true,
  keyRotationDays: 30,
  validatorMode: "strict",
  fallbackToLocalLlm: false,
  auditRetentionDays: 30,
  publishRestrictedToAdmins: true,
};

const LEVEL_RANK: Record<PrivacyLevel, number> = {
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

function getJson<T>(namespace: string, key: string): T | null {
  const row = getDbInstance()
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get(namespace, key) as { value?: unknown } | undefined;

  if (!row || typeof row.value !== "string") {
    return null;
  }

  return JSON.parse(row.value) as T;
}

function putJson(namespace: string, key: string, value: unknown) {
  getDbInstance()
    .prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)")
    .run(namespace, key, JSON.stringify(value));
}

function formatSourceName(sourceKey: string) {
  const known = DEFAULT_SOURCE_APPS.find((source) => source.key === sourceKey);
  if (known) return known.name;

  return sourceKey
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function countChangedById<T extends { id: string }>(activeItems: T[], draftItems: T[]) {
  const activeById = new Map(activeItems.map((item) => [item.id, stableHash(item)]));
  const draftById = new Map(draftItems.map((item) => [item.id, stableHash(item)]));
  let changed = 0;

  for (const [id, hash] of draftById.entries()) {
    if (activeById.get(id) !== hash) changed += 1;
  }

  for (const id of activeById.keys()) {
    if (!draftById.has(id)) changed += 1;
  }

  return changed;
}

function highestLevelFromCounts(decision: string, entitySummary: Record<string, unknown>): PrivacyLevel {
  if (decision === "blocked") return "L1";
  const topEntityTypes = Array.isArray(entitySummary.topEntityTypes)
    ? entitySummary.topEntityTypes
    : [];
  if (topEntityTypes.length > 0) return "L2";
  return "L4";
}

function parseJsonObject(value: unknown) {
  if (typeof value !== "string" || !value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function listRuntimeIncidents(limit = 50): PrivacyIncident[] {
  const rows = getDbInstance()
    .prepare(
      `SELECT id, timestamp, request_id, source_app, policy_profile_id, decision,
              blocked_count, masked_count, tokenized_count, allow_count, bundle_version,
              entity_summary, validator
         FROM privacy_runtime_events
        ORDER BY timestamp DESC
        LIMIT ?`
    )
    .all(limit) as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const decision = String(row.decision || "allow") as PrivacyIncident["finalDecision"];
    const entitySummary = parseJsonObject(row.entity_summary);
    const validatorRaw = parseJsonObject(row.validator);
    const validator = {
      passed: Boolean(validatorRaw.passed),
      reasons: Array.isArray(validatorRaw.reasons) ? validatorRaw.reasons.map(String) : [],
      remainingFindings: Number(validatorRaw.residualRisk || 0),
      confidenceScore:
        typeof validatorRaw.residualRisk === "number"
          ? Math.max(0, 1 - Number(validatorRaw.residualRisk) / 4)
          : undefined,
    };
    const sourceApp = String(row.source_app || "unknown");
    const bundleVersion = String(row.bundle_version || "unknown");
    const matchedRuleIds = validator.reasons.length > 0 ? validator.reasons : ["runtime-event"];

    return {
      id: String(row.id || row.request_id || randomUUID()),
      timestamp: String(row.timestamp || new Date().toISOString()),
      sourceApp,
      requestSnippet: "Raw request content redacted by privacy event storage.",
      sanitizedSnippet:
        decision === "blocked"
          ? "Request blocked before provider call"
          : "Sanitized payload was sent through the configured provider route.",
      highestLevel: highestLevelFromCounts(decision, entitySummary),
      matchedRuleIds,
      validatorResult: validator,
      finalDecision: decision,
      finalStatus: decision === "allow" ? "resolved" : "open",
      bundleVersion,
      timeline: [
        {
          step: "Detect",
          status: Number(entitySummary.found || 0) > 0 ? "matched" : "completed",
          detail: `${Number(entitySummary.found || 0)} sensitive entity match(es) recorded`,
          ruleIds: matchedRuleIds,
        },
        {
          step: "Transform",
          status: decision === "blocked" ? "blocked" : "completed",
          detail:
            decision === "blocked"
              ? "Policy blocked the request before the provider call."
              : "Policy allowed or transformed the request before provider routing.",
        },
        {
          step: "Validate",
          status: validator.passed ? "passed" : "blocked",
          detail: validator.passed
            ? "Validator found no blocking residual findings."
            : "Validator reported residual privacy risk.",
        },
      ],
    };
  });
}

function withUsageCounts(config: PrivacyConfig, incidents: PrivacyIncident[]): PrivacyConfig {
  const usageByEntity = new Map<string, number>();
  for (const incident of incidents) {
    for (const ruleId of incident.matchedRuleIds) {
      const rule = config.rules.find((candidate) => candidate.id === ruleId);
      if (rule) {
        usageByEntity.set(rule.entityTypeId, (usageByEntity.get(rule.entityTypeId) || 0) + 1);
      }
    }
  }

  return {
    ...config,
    entityTypes: config.entityTypes.map((entityType) => ({
      ...entityType,
      usageCount: usageByEntity.get(entityType.id) || 0,
    })),
    documentSets: config.documentSets.map((documentSet) => ({
      ...documentSet,
      termCount: documentSet.entries.length,
    })),
  } as PrivacyConfig;
}

export async function getPrivacyControlPlaneSettings(): Promise<PrivacySettings> {
  return {
    ...DEFAULT_SETTINGS,
    ...(getJson<Partial<PrivacySettings>>(SETTINGS_NAMESPACE, SETTINGS_KEY) || {}),
  };
}

export async function savePrivacyControlPlaneSettings(
  updates: Partial<PrivacySettings>
): Promise<PrivacySettings> {
  const next = {
    ...(await getPrivacyControlPlaneSettings()),
    ...updates,
  };
  putJson(SETTINGS_NAMESPACE, SETTINGS_KEY, next);
  return next;
}

function buildBundleSummaries(
  bundles: Awaited<ReturnType<typeof listPrivacyBundles>>,
  activeVersion: string,
  config: PrivacyConfig,
  activeConfig: PrivacyConfig
): PrivacyBundleVersionSummary[] {
  const changedEntities = countChangedById(activeConfig.entityTypes, config.entityTypes);
  const changedRules = countChangedById(activeConfig.rules, config.rules);
  const summaries: PrivacyBundleVersionSummary[] = bundles.map((bundle) => ({
    id: bundle.version,
    version: bundle.version,
    status: bundle.version === activeVersion ? ("active" as const) : ("archived" as const),
    createdAt: bundle.compiledAt,
    publishedAt: bundle.version === activeVersion ? bundle.compiledAt : undefined,
    notes: bundle.changeSummary,
    changedEntities: 0,
    changedRules: 0,
  }));

  if (changedEntities > 0 || changedRules > 0) {
    summaries.unshift({
      id: `draft-${config.updatedAt}`,
      version: `privacy-draft-${Date.parse(config.updatedAt) || Date.now()}`,
      status: "draft",
      createdAt: config.updatedAt,
      notes: "Unpublished draft policy changes",
      changedEntities,
      changedRules,
    });
  }

  return summaries;
}

export async function getPrivacyControlPlaneWorkspace(): Promise<PrivacyControlPlaneWorkspace> {
  const [configRaw, activeBundle, stats, bundles, settings] = await Promise.all([
    getPrivacyConfig(),
    getActivePrivacyBundle(),
    getPrivacyRuntimeStats(),
    listPrivacyBundles(),
    getPrivacyControlPlaneSettings(),
  ]);
  const incidents = listRuntimeIncidents();
  const config = withUsageCounts(configRaw, incidents);
  const activeConfig = activeBundle.compiledBundle || config;
  const changedEntities = countChangedById(activeConfig.entityTypes, config.entityTypes);
  const changedRules = countChangedById(activeConfig.rules, config.rules);
  const sourceApps = mergeSourceApps(Object.keys(stats.sourceApps || {}));
  const latestIncidents = incidents.filter((incident) => incident.finalDecision !== "allow").slice(0, 5);
  const bundleSummaries = buildBundleSummaries(bundles, activeBundle.version, config, activeConfig);
  const effectivePolicies = buildEffectivePolicyPreviews(config, sourceApps);

  return {
    overview: {
      scannedRequests: stats.scannedRequests,
      blockedRequests: stats.decisionCounts.blocked,
      transformedRequests: stats.decisionCounts.transformed,
      managedRules: config.rules.length,
      activeBundleVersion: activeBundle.version,
      activeBundleStatus: "active",
      publishState:
        changedEntities > 0 || changedRules > 0
          ? `Draft has ${changedEntities + changedRules} pending change(s)`
          : "Active bundle matches draft",
      topSourceApps: sourceApps.map((source) => ({
        key: source.key,
        name: source.name,
        requests: stats.sourceApps[source.key] || 0,
        blocked: incidents.filter(
          (incident) => incident.sourceApp === source.key && incident.finalDecision === "blocked"
        ).length,
        transformed: incidents.filter(
          (incident) =>
            incident.sourceApp === source.key && incident.finalDecision === "transformed"
        ).length,
      })),
      latestIncidents,
      bundleHealth: {
        activeVersion: activeBundle.version,
        draftVersion:
          bundleSummaries.find((bundle) => bundle.status === "draft")?.version ||
          activeBundle.version,
        changedEntities,
        changedRules,
        warnings: buildPolicyWarnings(config),
      },
    },
    config,
    sourceApps,
    effectivePolicies,
    incidents,
    bundles: bundleSummaries,
    settings,
  };
}

function mergeSourceApps(keys: string[]) {
  const byKey = new Map(DEFAULT_SOURCE_APPS.map((source) => [source.key, source]));
  for (const key of keys) {
    if (!byKey.has(key)) {
      byKey.set(key, {
        id: `src-${key}`,
        key,
        name: formatSourceName(key),
        environment: "runtime",
        active: true,
      });
    }
  }
  return [...byKey.values()];
}

function buildPolicyWarnings(config: PrivacyConfig) {
  const warnings: string[] = [];
  const disabledCritical = config.entityTypes.filter(
    (entityType) => entityType.defaultLevel === "L1" && !entityType.enabled
  );
  if (disabledCritical.length > 0) {
    warnings.push(`${disabledCritical.length} L1 entity type(s) disabled`);
  }

  const enabledProfiles = config.profiles.filter((profile) => profile.enabled);
  if (enabledProfiles.length === 0) {
    warnings.push("No enabled privacy profile; runtime requests will be allowed.");
  }

  const invalidRules = config.rules.filter((rule) => rule.enabled && !rule.patternConfig.regex);
  if (invalidRules.length > 0) {
    warnings.push(`${invalidRules.length} enabled rule(s) have no matcher pattern`);
  }

  return warnings;
}

function scopeIncludes(values: string[] | undefined, value: string) {
  return !values || values.length === 0 || values.includes(value);
}

function ruleAppliesTo(rule: PrivacyRule, sourceApp: string, profileId: string) {
  return (
    scopeIncludes(rule.scope?.sourceApps, sourceApp) &&
    scopeIncludes(rule.scope?.profileIds, profileId)
  );
}

function buildEffectivePolicyPreviews(config: PrivacyConfig, sourceApps: PrivacySourceApp[]) {
  const previews: PrivacyControlPlaneWorkspace["effectivePolicies"] = [];
  const enabledProfiles = config.profiles.filter((profile) => profile.enabled);

  for (const source of sourceApps.filter((candidate) => candidate.active)) {
    const matchingProfiles = enabledProfiles.filter((profile) =>
      scopeIncludes(profile.appliesTo.sourceApps, source.key)
    );

    for (const profile of matchingProfiles) {
      for (const entity of config.entityTypes.filter((candidate) => candidate.enabled)) {
        const level = profile.levelOverrides[entity.id] || entity.defaultLevel;
        const action = profile.transformOverrides[entity.id] || entity.defaultTransform;
        const ruleIds = config.rules
          .filter(
            (rule) =>
              rule.enabled &&
              rule.entityTypeId === entity.id &&
              ruleAppliesTo(rule, source.key, profile.id)
          )
          .map((rule) => rule.id);
        const dictionarySetIds = config.documentSets
          .filter(
            (set) =>
              set.status !== "archived" &&
              set.entries.some((entry) => entry.entityTypeId === entity.id)
          )
          .map((set) => set.id);
        const warnings: string[] = [];

        if (level === "L1" && action !== "BLOCK") {
          warnings.push("L1 entity is not configured to block for this scope.");
        }

        if (ruleIds.length === 0 && dictionarySetIds.length === 0) {
          warnings.push("No enabled rule or dictionary set currently detects this entity.");
        }

        previews.push({
          sourceApp: source.key,
          sourceName: source.name,
          profileId: profile.id,
          profileName: profile.name,
          entityKey: entity.id,
          entityLabel: entity.name,
          level,
          action,
          levelSource: profile.levelOverrides[entity.id] ? "profile override" : "entity default",
          actionSource: profile.transformOverrides[entity.id]
            ? "profile override"
            : "entity default",
          restoreMode: entity.restoreMode,
          placeholderPrefix: entity.placeholderPrefix,
          ruleIds,
          dictionarySetIds,
          warnings,
          summary: `${source.name} via ${profile.name} applies ${level} / ${action} to ${entity.name}.`,
        });
      }
    }
  }

  return previews;
}

export async function patchPrivacyControlPlane(
  patch: PrivacyControlPlanePatch
): Promise<PrivacyControlPlaneWorkspace> {
  const { settings, ...configPatch } = patch;

  if (Object.keys(configPatch).length > 0) {
    await updatePrivacyConfig(configPatch);
    invalidatePrivacyBundleCache();
  }

  if (settings) {
    await savePrivacyControlPlaneSettings(settings);
  }

  return getPrivacyControlPlaneWorkspace();
}

export async function publishPrivacyDraftBundle(input: { notes?: string; actor?: string } = {}) {
  const config = await getPrivacyConfig();
  const bundle = await activatePrivacyBundle({
    version: `privacy-release-${Date.now()}`,
    compiledBundle: config,
    changeSummary: input.notes || "Published Privacy Filter draft",
    compiledBy: input.actor || "dashboard",
  });
  invalidatePrivacyBundleCache();
  return bundle;
}

export async function rollbackPrivacyBundle(input: { version: string; actor?: string }) {
  const target = await getPrivacyBundle(input.version);
  if (!target) {
    throw new Error(`Privacy bundle ${input.version} was not found`);
  }

  await updatePrivacyConfig(target.compiledBundle);
  const bundle = await activatePrivacyBundle({
    version: target.version,
    compiledBundle: target.compiledBundle,
    changeSummary: `Rolled back to ${target.version}`,
    compiledBy: input.actor || "dashboard",
  });
  invalidatePrivacyBundleCache();
  return bundle;
}

function extractTextFromJsonPayload(payload: Record<string, unknown>) {
  const messages = payload.messages;
  if (Array.isArray(messages)) {
    return messages
      .map((message) =>
        message && typeof message === "object" && "content" in message
          ? String((message as { content?: unknown }).content || "")
          : ""
      )
      .filter(Boolean)
      .join("\n");
  }
  return JSON.stringify(payload, null, 2);
}

function parseTestInput(input: PrivacyTestInput) {
  if (input.inputMode === "json") {
    const payload = JSON.parse(input.rawInput || "{}") as Record<string, unknown>;
    return {
      rawText: extractTextFromJsonPayload(payload),
      rawDisplay: JSON.stringify(payload, null, 2),
    };
  }

  return {
    rawText: input.rawInput || "",
    rawDisplay: input.rawInput || "",
  };
}

async function getCompiledBundleForTest(bundleVersion?: string) {
  const activeBundle = await getActivePrivacyBundle();
  if (!bundleVersion || bundleVersion === activeBundle.version) {
    return getCompiledPrivacyBundle();
  }

  const savedBundle = await getPrivacyBundle(bundleVersion);
  if (savedBundle) {
    return compilePrivacyBundleRecord(savedBundle);
  }

  if (bundleVersion.startsWith("privacy-draft-")) {
    const draftConfig = await getPrivacyConfig();
    return compilePrivacyConfig(draftConfig, bundleVersion, draftConfig.updatedAt);
  }

  return getCompiledPrivacyBundle();
}

function actionForDetection(detection: DetectedPrivacyEntity) {
  return detection.transformMode;
}

function maskToken(prefix: string) {
  return `[${prefix}_MASKED]`;
}

function transformDetections(
  rawText: string,
  detections: DetectedPrivacyEntity[],
  ttlSeconds: number
) {
  const restoreTokens: PrivacyRestoreTokenPreview[] = [];
  const counts = new Map<string, number>();
  const tokenByValue = new Map<string, string>();
  let sanitized = rawText;

  for (const detection of [...detections].sort((a, b) => b.start - a.start)) {
    if (detection.transformMode === "BLOCK") {
      return {
        blocked: true,
        sanitizedOutput: "Request blocked before provider call",
        restoreTokens,
      };
    }

    let replacement = detection.text;
    if (detection.transformMode === "MASK") {
      replacement = maskToken(detection.entityType.placeholderPrefix);
    } else if (detection.transformMode === "TOKENIZE") {
      const key = `${detection.entityType.id}:${detection.text}`;
      replacement = tokenByValue.get(key) || "";
      if (!replacement) {
        const nextCount = (counts.get(detection.entityType.id) || 0) + 1;
        counts.set(detection.entityType.id, nextCount);
        replacement = `[${detection.entityType.placeholderPrefix}_${String(nextCount).padStart(
          3,
          "0"
        )}]`;
        tokenByValue.set(key, replacement);
        const createdAt = new Date().toISOString();
        restoreTokens.push({
          token: replacement,
          originalValue: detection.text,
          ttlSeconds,
          createdAt,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        });
      }
    }

    sanitized = sanitized.slice(0, detection.start) + replacement + sanitized.slice(detection.end);
  }

  return {
    blocked: false,
    sanitizedOutput: sanitized,
    restoreTokens,
  };
}

function toDetectedEntity(detection: DetectedPrivacyEntity): PrivacyDetectedEntity {
  return {
    text: detection.text,
    entityKey: detection.entityType.id,
    entityLabel: detection.entityType.name,
    level: detection.level,
    action: detection.transformMode,
    ruleId: detection.rule.id,
    confidence: detection.rule.confidence,
    start: detection.start,
    end: detection.end,
    rationale: `${detection.rule.type.toUpperCase()} matched ${detection.entityType.name}`,
  };
}

function summarizePipeline(input: {
  detections: DetectedPrivacyEntity[];
  decision: PrivacyTestResult["decision"];
  validatorPassed: boolean;
  restoreTokens: PrivacyRestoreTokenPreview[];
}): PrivacyPipelineStep[] {
  const ruleIds = [...new Set(input.detections.map((detection) => detection.rule.id))];
  const highestLevel = input.detections
    .map((detection) => detection.level)
    .sort((a, b) => LEVEL_RANK[a] - LEVEL_RANK[b])[0];

  return [
    {
      step: "Detect",
      status: input.detections.length > 0 ? "matched" : "completed",
      detail: `${input.detections.length} entit${input.detections.length === 1 ? "y" : "ies"} detected`,
      ruleIds,
    },
    {
      step: "Classify",
      status: "completed",
      detail: highestLevel ? `Highest level ${highestLevel}` : "No sensitive entity classified",
    },
    {
      step: "Transform",
      status: input.decision === "blocked" ? "blocked" : "completed",
      detail:
        input.decision === "blocked"
          ? "Blocking policy stopped the request before provider routing"
          : input.decision === "transformed"
            ? "Mask/tokenize actions were applied to the request"
            : "No transform was required",
      ruleIds,
    },
    {
      step: "Validate",
      status: input.validatorPassed ? "passed" : "blocked",
      detail: input.validatorPassed
        ? "Sanitized output passed validation"
        : "Sanitized output still contains blocking findings",
    },
    {
      step: "Restore",
      status: input.restoreTokens.length > 0 ? "prepared" : "completed",
      detail:
        input.restoreTokens.length > 0
          ? `${input.restoreTokens.length} restore token(s) prepared`
          : "No restore token was required",
    },
  ];
}

export async function runPrivacyControlPlaneTest(input: PrivacyTestInput): Promise<PrivacyTestResult> {
  const settings = await getPrivacyControlPlaneSettings();
  const bundle = await getCompiledBundleForTest(input.bundleVersion);
  const profile =
    (input.profileId && bundle.profiles.find((candidate) => candidate.id === input.profileId)) ||
    resolvePrivacyProfile(bundle, input.sourceApp);
  const { rawText, rawDisplay } = parseTestInput(input);

  if (!profile) {
    return {
      requestId: `pft_${randomUUID()}`,
      sourceApp: input.sourceApp,
      bundleVersion: bundle.version,
      decision: "allow",
      rawInput: rawDisplay,
      sanitizedOutput: rawText,
      detectedEntities: [],
      matchedRules: [],
      validator: {
        passed: true,
        reasons: ["No enabled privacy profile matched this source app."],
        remainingFindings: [],
        confidenceScore: 1,
      },
      restoreTokens: [],
      pipeline: summarizePipeline({
        detections: [],
        decision: "allow",
        validatorPassed: true,
        restoreTokens: [],
      }),
      routeDecision: {
        providerRoute: "external-provider",
        fallback: false,
        reason: "No enabled profile matched; request remains unchanged.",
      },
    };
  }

  const detections = detectSensitiveEntities(rawText, bundle, profile);
  const transformed = transformDetections(rawText, detections, settings.tokenTtlSeconds);
  const decision: PrivacyTestResult["decision"] = transformed.blocked
    ? "blocked"
    : detections.some((detection) => actionForDetection(detection) !== "ALLOW")
      ? "transformed"
      : "allow";
  const residualDetections =
    decision === "blocked"
      ? detections.filter((detection) => detection.level === "L1")
      : detectSensitiveEntities(transformed.sanitizedOutput, bundle, profile).filter(
          (detection) => detection.level === "L1"
        );
  const validatorPassed = decision !== "blocked" && residualDetections.length === 0;
  const matchedRules = [...new Map(detections.map((detection) => [detection.rule.id, detection]))]
    .map(([id, detection]) => ({
      id,
      name: detection.rule.name,
      action: detection.transformMode,
      level: detection.level,
    }))
    .sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);

  return {
    requestId: `pft_${randomUUID()}`,
    sourceApp: input.sourceApp,
    bundleVersion: bundle.version,
    decision,
    rawInput: rawDisplay,
    sanitizedOutput: transformed.sanitizedOutput,
    detectedEntities: detections.map(toDetectedEntity),
    matchedRules,
    validator: {
      passed: validatorPassed,
      reasons: validatorPassed
        ? ["No L1 residual findings"]
        : residualDetections.map((detection) => `${detection.rule.id} residual ${detection.level}`),
      remainingFindings: residualDetections.map(toDetectedEntity),
      confidenceScore: validatorPassed ? 0.96 : 0.4,
    },
    restoreTokens: transformed.restoreTokens,
    pipeline: summarizePipeline({
      detections,
      decision,
      validatorPassed,
      restoreTokens: transformed.restoreTokens,
    }),
    routeDecision:
      decision === "blocked"
        ? {
            providerRoute: settings.fallbackToLocalLlm ? "fallback-local-llm" : "blocked-before-provider",
            fallback: settings.fallbackToLocalLlm,
            reason: settings.fallbackToLocalLlm
              ? "Blocking policy requires local fallback instead of an external provider."
              : "Blocking policy stopped the request before any provider call.",
          }
        : {
            providerRoute: "external-provider",
            fallback: false,
            reason: "Sanitized request is safe for configured provider routing.",
          },
  };
}
