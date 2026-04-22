import type { PrivacyConfig, PrivacyLevel, PrivacyRule, PrivacyTransformMode } from "./types";

export type PrivacyFilterView =
  | "overview"
  | "policy"
  | "test"
  | "incidents"
  | "releases"
  | "settings";

export interface PrivacySourceApp {
  id: string;
  key: string;
  name: string;
  environment: string;
  active: boolean;
}

export interface PrivacySettings {
  vaultEnabled: boolean;
  tokenTtlSeconds: number;
  autoExpireRestoreTokens: boolean;
  encryptionRequired: boolean;
  keyRotationDays: number;
  validatorMode: "strict" | "balanced" | "observe";
  fallbackToLocalLlm: boolean;
  auditRetentionDays: number;
  publishRestrictedToAdmins: boolean;
}

export interface PrivacyControlPlaneOverview {
  scannedRequests: number;
  blockedRequests: number;
  transformedRequests: number;
  managedRules: number;
  activeBundleVersion: string;
  activeBundleStatus: "active" | "draft";
  publishState: string;
  topSourceApps: Array<{
    key: string;
    name: string;
    requests: number;
    blocked: number;
    transformed: number;
  }>;
  latestIncidents: PrivacyIncident[];
  bundleHealth: {
    activeVersion: string;
    draftVersion: string;
    changedEntities: number;
    changedRules: number;
    warnings: string[];
  };
}

export interface PrivacyBundleVersionSummary {
  id: string;
  version: string;
  status: "active" | "draft" | "archived";
  createdAt: string;
  publishedAt?: string;
  notes: string;
  changedEntities: number;
  changedRules: number;
}

export interface PrivacyValidationResult {
  passed: boolean;
  reasons: string[];
  remainingFindings: number | PrivacyDetectedEntity[];
  confidenceScore?: number;
}

export interface PrivacyIncident {
  id: string;
  timestamp: string;
  sourceApp: string;
  requestSnippet: string;
  sanitizedSnippet: string;
  highestLevel: PrivacyLevel;
  matchedRuleIds: string[];
  validatorResult: PrivacyValidationResult;
  finalDecision: "allow" | "transformed" | "blocked";
  finalStatus: "open" | "reviewed" | "resolved";
  bundleVersion: string;
  timeline: PrivacyPipelineStep[];
}

export interface PrivacyPipelineStep {
  step: "Detect" | "Classify" | "Transform" | "Validate" | "Restore";
  status: "idle" | "matched" | "completed" | "passed" | "blocked" | "prepared";
  detail: string;
  ruleIds?: string[];
}

export interface PrivacyDetectedEntity {
  text: string;
  entityKey: string;
  entityLabel: string;
  level: PrivacyLevel;
  action: PrivacyTransformMode;
  ruleId: string;
  confidence: number;
  start: number;
  end: number;
  rationale: string;
}

export interface PrivacyMatchedRuleSummary {
  id: string;
  name: string;
  action: PrivacyTransformMode;
  level: PrivacyLevel;
}

export interface PrivacyRestoreTokenPreview {
  token: string;
  originalValue: string;
  ttlSeconds: number;
  createdAt: string;
  expiresAt: string;
}

export interface PrivacyRouteDecision {
  providerRoute: "external-provider" | "fallback-local-llm" | "blocked-before-provider";
  fallback: boolean;
  reason: string;
}

export interface PrivacyEffectivePolicyPreview {
  sourceApp: string;
  sourceName: string;
  profileId: string;
  profileName: string;
  entityKey: string;
  entityLabel: string;
  level: PrivacyLevel;
  action: PrivacyTransformMode;
  levelSource: "entity default" | "profile override";
  actionSource: "entity default" | "profile override";
  restoreMode: PrivacyConfig["entityTypes"][number]["restoreMode"];
  placeholderPrefix: string;
  ruleIds: string[];
  dictionarySetIds: string[];
  warnings: string[];
  summary: string;
}

export interface PrivacyTestInput {
  inputMode: "plain-text" | "json";
  rawInput: string;
  sourceApp: string;
  profileId?: string;
  bundleVersion?: string;
}

export interface PrivacyTestResult {
  requestId: string;
  sourceApp: string;
  bundleVersion: string;
  decision: "allow" | "transformed" | "blocked";
  rawInput: string;
  sanitizedOutput: string;
  detectedEntities: PrivacyDetectedEntity[];
  matchedRules: PrivacyMatchedRuleSummary[];
  validator: PrivacyValidationResult;
  restoreTokens: PrivacyRestoreTokenPreview[];
  pipeline: PrivacyPipelineStep[];
  routeDecision: PrivacyRouteDecision;
}

export interface PrivacyControlPlaneWorkspace {
  overview: PrivacyControlPlaneOverview;
  config: PrivacyConfig;
  sourceApps: PrivacySourceApp[];
  effectivePolicies: PrivacyEffectivePolicyPreview[];
  incidents: PrivacyIncident[];
  bundles: PrivacyBundleVersionSummary[];
  settings: PrivacySettings;
}

export interface PrivacyControlPlanePatch {
  entityTypes?: PrivacyConfig["entityTypes"];
  rules?: PrivacyRule[];
  profiles?: PrivacyConfig["profiles"];
  documentSets?: PrivacyConfig["documentSets"];
  settings?: Partial<PrivacySettings>;
}
