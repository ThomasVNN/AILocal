import { randomUUID } from "crypto";
import { getCompiledPrivacyBundle } from "./bundle";
import {
  detectSensitiveEntities,
  resolvePrivacyProfile,
  type DetectedPrivacyEntity,
} from "./detectors";
import { rewriteSupportedRequestPayload, rewriteSupportedResponsePayload } from "./payload";
import {
  createPrivacyRestoreSession,
  getPrivacyRestoreSessionValues,
  recordPrivacyRuntimeEvent,
} from "./store";
import type {
  PrivacyEntitySummary,
  PrivacyLevel,
  PrivacyRestoreResult,
  PrivacyRuntimeRestoreInput,
  PrivacyRuntimeSanitizeInput,
  PrivacySanitizeResult,
  PrivacyTransformMode,
} from "./types";

const TTL_MS = 60 * 60 * 1000;
const NO_ACTIVE_PROFILE_ID = "no-active-profile";

const LEVEL_RANK: Record<PrivacyLevel, number> = {
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

class PrivacyBlockedError extends Error {
  constructor(public detection: DetectedPrivacyEntity) {
    super(`Blocked by privacy rule ${detection.rule.id}`);
  }
}

function maskToken(prefix: string) {
  return `[${prefix}_MASKED]`;
}

function buildEntitySummary(detections: DetectedPrivacyEntity[]): PrivacyEntitySummary {
  const counts = new Map<string, number>();

  for (const detection of detections) {
    counts.set(detection.entityType.id, (counts.get(detection.entityType.id) || 0) + 1);
  }

  return {
    found: detections.length,
    blockedCount: detections.filter((item) => item.transformMode === "BLOCK").length,
    maskedCount: detections.filter((item) => item.transformMode === "MASK").length,
    tokenizedCount: detections.filter((item) => item.transformMode === "TOKENIZE").length,
    allowedCount: detections.filter((item) => item.transformMode === "ALLOW").length,
    topEntityTypes: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([entityType]) => entityType),
  };
}

function replaceDetections(
  text: string,
  detections: DetectedPrivacyEntity[],
  tokenState: {
    counts: Map<string, number>;
    placeholders: Map<string, string>;
    restoreValues: Array<{
      placeholder: string;
      originalValue: string;
      entityType: string;
      level: PrivacyLevel;
      transformMode: PrivacyTransformMode;
    }>;
  }
) {
  let rewritten = text;

  for (const detection of [...detections].sort((a, b) => b.start - a.start)) {
    if (detection.transformMode === "BLOCK") {
      throw new PrivacyBlockedError(detection);
    }

    let replacement = detection.text;
    if (detection.transformMode === "MASK") {
      replacement = maskToken(detection.entityType.placeholderPrefix);
    } else if (detection.transformMode === "TOKENIZE") {
      const key = `${detection.entityType.id}:${detection.text}`;
      replacement = tokenState.placeholders.get(key) || "";
      if (!replacement) {
        const current = (tokenState.counts.get(detection.entityType.id) || 0) + 1;
        tokenState.counts.set(detection.entityType.id, current);
        replacement = `[${detection.entityType.placeholderPrefix}_${String(current).padStart(3, "0")}]`;
        tokenState.placeholders.set(key, replacement);
        tokenState.restoreValues.push({
          placeholder: replacement,
          originalValue: detection.text,
          entityType: detection.entityType.id,
          level: detection.level,
          transformMode: detection.transformMode,
        });
      }
    }

    rewritten = rewritten.slice(0, detection.start) + replacement + rewritten.slice(detection.end);
  }

  return rewritten;
}

function summarizePolicyTrace(
  detections: DetectedPrivacyEntity[],
  profileId: string,
  bundleVersion: string
) {
  return {
    profileId,
    bundleVersion,
    ruleIds: [...new Set(detections.map((detection) => detection.rule.id))],
  };
}

function extractResidualRisk(detections: DetectedPrivacyEntity[]) {
  if (detections.length === 0) {
    return 0;
  }

  return Math.max(...detections.map((detection) => 5 - LEVEL_RANK[detection.level]));
}

export async function sanitizePrivacyPayload(
  input: PrivacyRuntimeSanitizeInput
): Promise<PrivacySanitizeResult> {
  const bundle = await getCompiledPrivacyBundle();
  const profile = resolvePrivacyProfile(bundle, input.sourceApp);
  const allDetections: DetectedPrivacyEntity[] = [];

  if (!profile) {
    const result: PrivacySanitizeResult = {
      decision: "allow",
      sanitizedPayload: input.payload,
      restoreSessionId: null,
      entitySummary: {
        found: 0,
        blockedCount: 0,
        maskedCount: 0,
        tokenizedCount: 0,
        allowedCount: 0,
        topEntityTypes: [],
      },
      validator: {
        passed: true,
        residualRisk: 0,
        reasons: [],
      },
      policyTrace: {
        profileId: NO_ACTIVE_PROFILE_ID,
        bundleVersion: bundle.version,
        ruleIds: [],
      },
      blockResponse: null,
    };

    await recordPrivacyRuntimeEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      requestId: input.requestId,
      sourceApp: input.sourceApp,
      policyProfileId: NO_ACTIVE_PROFILE_ID,
      decision: "allow",
      blockedCount: 0,
      maskedCount: 0,
      tokenizedCount: 0,
      allowCount: 0,
      bundleVersion: bundle.version,
      entitySummary: JSON.stringify(result.entitySummary),
      validator: JSON.stringify(result.validator),
    });

    return result;
  }
  const tokenState = {
    counts: new Map<string, number>(),
    placeholders: new Map<string, string>(),
    restoreValues: [] as Array<{
      placeholder: string;
      originalValue: string;
      entityType: string;
      level: PrivacyLevel;
      transformMode: PrivacyTransformMode;
    }>,
  };

  let sanitizedPayload = input.payload;
  let blockResponse: PrivacySanitizeResult["blockResponse"] = null;
  let decision: PrivacySanitizeResult["decision"] = "allow";

  try {
    sanitizedPayload = rewriteSupportedRequestPayload(input.payload, (text) => {
      const detections = detectSensitiveEntities(text, bundle, profile);
      allDetections.push(...detections);
      if (detections.length === 0) {
        return text;
      }
      return replaceDetections(text, detections, tokenState);
    });
  } catch (error) {
    if (!(error instanceof PrivacyBlockedError)) {
      throw error;
    }

    decision = "blocked";
    blockResponse = {
      message: `Request blocked by privacy policy for ${error.detection.entityType.name}`,
      code: "PRIVACY_BLOCKED",
    };
  }

  if (
    decision !== "blocked" &&
    allDetections.some((detection) => detection.transformMode !== "ALLOW")
  ) {
    decision = "transformed";
  }

  let restoreSessionId: string | null = null;
  if (decision !== "blocked" && tokenState.restoreValues.length > 0) {
    restoreSessionId = await createPrivacyRestoreSession({
      requestId: input.requestId,
      sourceApp: input.sourceApp,
      policyProfileId: profile.id,
      bundleVersion: bundle.version,
      stream: input.stream,
      expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
      values: tokenState.restoreValues,
    });
  }

  const validatorDetections =
    decision === "blocked"
      ? allDetections.filter((detection) => detection.level === "L1")
      : collectResidualDetections(sanitizedPayload, bundle, profile);

  const validator = {
    passed: decision !== "blocked" && validatorDetections.length === 0,
    residualRisk: extractResidualRisk(validatorDetections),
    reasons: validatorDetections.map((detection) => detection.rule.id),
  };

  const result: PrivacySanitizeResult = {
    decision,
    sanitizedPayload,
    restoreSessionId,
    entitySummary: buildEntitySummary(allDetections),
    validator,
    policyTrace: summarizePolicyTrace(allDetections, profile.id, bundle.version),
    blockResponse,
  };

  await recordPrivacyRuntimeEvent({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: input.requestId,
    sourceApp: input.sourceApp,
    policyProfileId: profile.id,
    decision,
    blockedCount: result.entitySummary.blockedCount,
    maskedCount: result.entitySummary.maskedCount,
    tokenizedCount: result.entitySummary.tokenizedCount,
    allowCount: result.entitySummary.allowedCount,
    bundleVersion: bundle.version,
    entitySummary: JSON.stringify(result.entitySummary),
    validator: JSON.stringify(result.validator),
  });

  return result;
}

function collectResidualDetections(
  payload: Record<string, unknown>,
  bundle: Awaited<ReturnType<typeof getCompiledPrivacyBundle>>,
  profile: ReturnType<typeof resolvePrivacyProfile>
) {
  const detections: DetectedPrivacyEntity[] = [];
  rewriteSupportedRequestPayload(payload, (text) => {
    detections.push(...detectSensitiveEntities(text, bundle, profile));
    return text;
  });
  return detections.filter((detection) => detection.level === "L1");
}

export async function restorePrivacyPayload(
  input: PrivacyRuntimeRestoreInput
): Promise<PrivacyRestoreResult> {
  const values = input.restoreSessionId
    ? await getPrivacyRestoreSessionValues(input.restoreSessionId)
    : [];
  const placeholderMap = new Map(values.map((value) => [value.placeholder, value.originalValue]));
  const restoredPlaceholders = new Set<string>();

  const restoredPayload = rewriteSupportedResponsePayload(input.payload, (text) => {
    let next = text;
    for (const [placeholder, originalValue] of placeholderMap.entries()) {
      if (next.includes(placeholder)) {
        next = next.split(placeholder).join(originalValue);
        restoredPlaceholders.add(placeholder);
      }
    }
    return next;
  });

  const unresolvedPlaceholders = values
    .map((value) => value.placeholder)
    .filter((placeholder) => !restoredPlaceholders.has(placeholder));

  return {
    restoredPayload,
    restoreSummary: {
      restoredCount: restoredPlaceholders.size,
      unresolvedPlaceholders,
    },
  };
}
