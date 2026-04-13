import { getActivePrivacyBundle } from "./store";
import type {
  PrivacyBundleRecord,
  PrivacyConfig,
  PrivacyEntityType,
  PrivacyPolicyProfile,
  PrivacyRule,
} from "./types";

export interface CompiledPrivacyRule extends PrivacyRule {
  regex: RegExp;
  source: "rule" | "document";
}

export interface CompiledPrivacyBundle {
  version: string;
  compiledAt: string;
  entityTypesById: Map<string, PrivacyEntityType>;
  profiles: PrivacyPolicyProfile[];
  compiledRules: CompiledPrivacyRule[];
  config: PrivacyConfig;
}

let cachedBundle: CompiledPrivacyBundle | null = null;
let cachedVersion: string | null = null;

function ensureGlobalFlag(flags = "") {
  return flags.includes("g") ? flags : `${flags}g`;
}

function escapeRegex(term: string) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileRule(rule: PrivacyRule, source: "rule" | "document"): CompiledPrivacyRule | null {
  const pattern = rule.patternConfig.regex;
  if (!pattern) {
    return null;
  }

  return {
    ...rule,
    regex: new RegExp(pattern, ensureGlobalFlag(rule.patternConfig.flags)),
    source,
  };
}

function compileDocumentRules(config: PrivacyConfig): PrivacyRule[] {
  return config.documentSets
    .filter((set) => set.status === "published")
    .flatMap((set) =>
      set.entries.map((entry, index) => ({
        id: `doc-${set.id}-${entry.id || index}`,
        name: `${set.name}:${entry.term}`,
        type: "dictionary" as const,
        entityTypeId: entry.entityTypeId,
        severityLevel:
          entry.level ||
          config.entityTypes.find((entityType) => entityType.id === entry.entityTypeId)
            ?.defaultLevel ||
          "L4",
        priority: 70,
        confidence: 0.95,
        enabled: true,
        patternConfig: {
          regex: `\\b${escapeRegex(entry.term)}\\b`,
          flags: "gi",
        },
      }))
    );
}

function compileBundleRecord(record: PrivacyBundleRecord): CompiledPrivacyBundle {
  const config = record.compiledBundle;
  const entityTypesById = new Map<string, PrivacyEntityType>(
    config.entityTypes.map((entityType) => [entityType.id, entityType])
  );
  const compiledRules = [...config.rules, ...compileDocumentRules(config)]
    .filter((rule) => rule.enabled)
    .map((rule) => compileRule(rule, config.rules.includes(rule) ? "rule" : "document"))
    .filter(Boolean) as CompiledPrivacyRule[];

  return {
    version: record.version,
    compiledAt: record.compiledAt,
    entityTypesById,
    profiles: config.profiles.filter((profile) => profile.enabled),
    compiledRules,
    config,
  };
}

export function invalidatePrivacyBundleCache() {
  cachedBundle = null;
  cachedVersion = null;
}

export async function getCompiledPrivacyBundle() {
  const active = await getActivePrivacyBundle();

  if (cachedBundle && cachedVersion === active.version) {
    return cachedBundle;
  }

  cachedBundle = compileBundleRecord(active);
  cachedVersion = active.version;
  return cachedBundle;
}
