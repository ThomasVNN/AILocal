export type PrivacyLevel = "L1" | "L2" | "L3" | "L4";

export type PrivacyTransformMode = "BLOCK" | "MASK" | "TOKENIZE" | "ALLOW";

export type PrivacyRuleType = "regex" | "pattern" | "dictionary";

export interface PrivacyEntityType {
  id: string;
  name: string;
  category: string;
  defaultLevel: PrivacyLevel;
  defaultTransform: PrivacyTransformMode;
  restoreMode: "never" | "session";
  placeholderPrefix: string;
  enabled: boolean;
}

export interface PrivacyRuleScope {
  sourceApps?: string[];
  profileIds?: string[];
  documentClasses?: string[];
}

export interface PrivacyRulePatternConfig {
  regex?: string;
  flags?: string;
  terms?: string[];
}

export interface PrivacyRule {
  id: string;
  name: string;
  type: PrivacyRuleType;
  entityTypeId: string;
  severityLevel: PrivacyLevel;
  priority: number;
  confidence: number;
  enabled: boolean;
  patternConfig: PrivacyRulePatternConfig;
  scope?: PrivacyRuleScope;
}

export interface PrivacyRestorePolicy {
  allowRestore: boolean;
  requireFullRestore: boolean;
  allowStreamingPlaceholderPassthrough: boolean;
}

export interface PrivacyPolicyProfile {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  appliesTo: {
    sourceApps?: string[];
    apiKeyIds?: string[];
    workspaceIds?: string[];
  };
  levelOverrides: Record<string, PrivacyLevel>;
  transformOverrides: Record<string, PrivacyTransformMode>;
  fallbackMode: "block" | "use-local-llm" | "allow-with-warning";
  restorePolicy: PrivacyRestorePolicy;
}

export interface PrivacyDocumentEntry {
  id: string;
  term: string;
  entityTypeId: string;
  level?: PrivacyLevel;
  transformMode?: PrivacyTransformMode;
}

export interface PrivacyDocumentSet {
  id: string;
  name: string;
  documentClass: string;
  businessDomain: string;
  sourceType: "manual" | "upload" | "sync";
  version: number;
  status: "draft" | "published" | "archived";
  entries: PrivacyDocumentEntry[];
}

export interface PrivacyConfig {
  entityTypes: PrivacyEntityType[];
  rules: PrivacyRule[];
  profiles: PrivacyPolicyProfile[];
  documentSets: PrivacyDocumentSet[];
  updatedAt: string;
}

export interface PrivacyBundleRecord {
  version: string;
  status: "draft" | "active";
  checksum: string;
  compiledAt: string;
  compiledBy: string;
  changeSummary: string;
  compiledBundle: PrivacyConfig;
}

export interface PrivacyRuntimeSanitizeInput {
  requestId: string;
  payload: Record<string, unknown>;
  sourceApp: string;
  stream: boolean;
  apiKeyId?: string | null;
  endpointType?: string;
}

export interface PrivacyEntitySummary {
  found: number;
  blockedCount: number;
  maskedCount: number;
  tokenizedCount: number;
  allowedCount: number;
  topEntityTypes: string[];
}

export interface PrivacySanitizeResult {
  decision: "allow" | "transformed" | "blocked";
  sanitizedPayload: Record<string, unknown>;
  restoreSessionId: string | null;
  entitySummary: PrivacyEntitySummary;
  validator: {
    passed: boolean;
    residualRisk: number;
    reasons: string[];
  };
  policyTrace: {
    profileId: string;
    bundleVersion: string;
    ruleIds: string[];
  };
  blockResponse: {
    message: string;
    code: string;
  } | null;
}

export interface PrivacyRuntimeRestoreInput {
  requestId: string;
  restoreSessionId: string | null;
  sourceApp: string;
  endpointType: string;
  stream: boolean;
  payload: Record<string, unknown>;
}

export interface PrivacyRestoreResult {
  restoredPayload: Record<string, unknown>;
  restoreSummary: {
    restoredCount: number;
    unresolvedPlaceholders: string[];
  };
}

export interface PrivacyRuntimeEvent {
  id: string;
  timestamp: string;
  requestId: string;
  sourceApp: string;
  policyProfileId: string;
  decision: "allow" | "transformed" | "blocked";
  blockedCount: number;
  maskedCount: number;
  tokenizedCount: number;
  allowCount: number;
  bundleVersion: string;
  entitySummary: string;
  validator: string;
}

export interface PrivacyRestoreEntityValue {
  placeholder: string;
  originalValue: string;
  entityType: string;
  level: PrivacyLevel;
  transformMode: PrivacyTransformMode;
}
