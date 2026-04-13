import type { PrivacyConfig, PrivacyBundleRecord } from "./types";

const DEFAULT_BUNDLE_VERSION = "privacy-default-v1";
const DEFAULT_COMPILED_AT = "2026-04-12T00:00:00.000Z";

export function createDefaultPrivacyConfig(): PrivacyConfig {
  return {
    entityTypes: [
      {
        id: "bank_account",
        name: "Bank Account",
        category: "financial",
        defaultLevel: "L1",
        defaultTransform: "BLOCK",
        restoreMode: "never",
        placeholderPrefix: "ACCOUNT",
        enabled: true,
      },
      {
        id: "customer_name",
        name: "Customer Name",
        category: "customer",
        defaultLevel: "L2",
        defaultTransform: "MASK",
        restoreMode: "never",
        placeholderPrefix: "PERSON",
        enabled: true,
      },
      {
        id: "customer_email",
        name: "Customer Email",
        category: "customer",
        defaultLevel: "L2",
        defaultTransform: "MASK",
        restoreMode: "never",
        placeholderPrefix: "EMAIL",
        enabled: true,
      },
      {
        id: "project_code",
        name: "Project Code",
        category: "internal",
        defaultLevel: "L3",
        defaultTransform: "TOKENIZE",
        restoreMode: "session",
        placeholderPrefix: "PROJECT",
        enabled: true,
      },
      {
        id: "api_key",
        name: "API Key",
        category: "secret",
        defaultLevel: "L1",
        defaultTransform: "BLOCK",
        restoreMode: "never",
        placeholderPrefix: "SECRET",
        enabled: true,
      },
    ],
    rules: [
      {
        id: "rule-bank-account",
        name: "Bank account sequence",
        type: "regex",
        entityTypeId: "bank_account",
        severityLevel: "L1",
        priority: 100,
        confidence: 0.99,
        enabled: true,
        patternConfig: {
          regex: "\\b\\d{10,16}\\b",
          flags: "g",
        },
      },
      {
        id: "rule-customer-email",
        name: "Customer email",
        type: "regex",
        entityTypeId: "customer_email",
        severityLevel: "L2",
        priority: 90,
        confidence: 0.98,
        enabled: true,
        patternConfig: {
          regex: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b",
          flags: "gi",
        },
      },
      {
        id: "rule-customer-name",
        name: "Capitalized customer name",
        type: "pattern",
        entityTypeId: "customer_name",
        severityLevel: "L2",
        priority: 75,
        confidence: 0.7,
        enabled: true,
        patternConfig: {
          regex: "\\b[A-ZÀ-Ỹ][\\p{L}]{1,}(?:\\s+[A-ZÀ-Ỹ][\\p{L}]{0,}){1,3}\\b",
          flags: "gu",
        },
      },
      {
        id: "rule-project-code",
        name: "OCB project code",
        type: "pattern",
        entityTypeId: "project_code",
        severityLevel: "L3",
        priority: 80,
        confidence: 0.96,
        enabled: true,
        patternConfig: {
          regex: "\\bOCB-PRJ-[A-Z0-9-]+\\b",
          flags: "g",
        },
      },
      {
        id: "rule-api-key",
        name: "Generic API key",
        type: "regex",
        entityTypeId: "api_key",
        severityLevel: "L1",
        priority: 110,
        confidence: 0.99,
        enabled: true,
        patternConfig: {
          regex: "\\b(?:sk|pk|api|token)[_-][A-Za-z0-9]{16,}\\b",
          flags: "gi",
        },
      },
    ],
    profiles: [
      {
        id: "default-external",
        name: "Default External",
        description: "Default protection profile for outbound external AI calls.",
        enabled: false,
        appliesTo: {
          sourceApps: ["direct-api", "openwebui", "openclaw-gw", "openclaw-cli"],
        },
        levelOverrides: {},
        transformOverrides: {},
        fallbackMode: "block",
        restorePolicy: {
          allowRestore: true,
          requireFullRestore: true,
          allowStreamingPlaceholderPassthrough: true,
        },
      },
    ],
    documentSets: [
      {
        id: "ocb-internal-terms",
        name: "OCB Internal Terms",
        documentClass: "internal",
        businessDomain: "banking",
        sourceType: "manual",
        version: 1,
        status: "published",
        entries: [
          {
            id: "ocb-project-seed",
            term: "OCB-PRJ-123",
            entityTypeId: "project_code",
            level: "L3",
            transformMode: "TOKENIZE",
          },
        ],
      },
    ],
    updatedAt: DEFAULT_COMPILED_AT,
  };
}

export function createDefaultPrivacyBundle(
  compiledBundle: PrivacyConfig = createDefaultPrivacyConfig()
): PrivacyBundleRecord {
  return {
    version: DEFAULT_BUNDLE_VERSION,
    status: "active",
    checksum: "seed",
    compiledAt: DEFAULT_COMPILED_AT,
    compiledBy: "system",
    changeSummary: "Seeded default privacy bundle",
    compiledBundle,
  };
}
