// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PrivacyFilterPageClient from "../PrivacyFilterPageClient";

const workspacePayload = {
  overview: {
    scannedRequests: 24,
    blockedRequests: 3,
    transformedRequests: 11,
    managedRules: 2,
    activeBundleVersion: "privacy-active-v4",
    activeBundleStatus: "active",
    publishState: "Draft has 2 pending changes",
    topSourceApps: [
      { key: "openwebui", name: "OpenWebUI", requests: 16, blocked: 2, transformed: 7 },
      { key: "openclaw-gw", name: "OpenClaw Gateway", requests: 8, blocked: 1, transformed: 4 },
    ],
    latestIncidents: [
      {
        id: "evt-001",
        timestamp: "2026-04-20T09:15:00.000Z",
        sourceApp: "openwebui",
        highestLevel: "L1",
        finalDecision: "blocked",
        finalStatus: "open",
        bundleVersion: "privacy-active-v4",
        matchedRuleIds: ["rule-bank"],
        requestSnippet: "Bank account **** redacted",
        sanitizedSnippet: "Request blocked before provider call",
        validatorResult: { passed: false, reasons: ["L1 BLOCK"], remainingFindings: 1 },
      },
    ],
    bundleHealth: {
      activeVersion: "privacy-active-v4",
      draftVersion: "privacy-draft-v5",
      changedEntities: 1,
      changedRules: 1,
      warnings: ["1 disabled L1 rule"],
    },
  },
  config: {
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
        usageCount: 4,
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
        usageCount: 7,
      },
    ],
    rules: [
      {
        id: "rule-bank",
        name: "Bank account detector",
        type: "regex",
        entityTypeId: "bank_account",
        severityLevel: "L1",
        priority: 100,
        confidence: 0.99,
        enabled: true,
        patternConfig: { regex: "\\b\\d{10,16}\\b", flags: "g" },
        scope: { sourceApps: ["openwebui"], profileIds: ["default-external"] },
      },
      {
        id: "rule-project",
        name: "Project code detector",
        type: "pattern",
        entityTypeId: "project_code",
        severityLevel: "L3",
        priority: 80,
        confidence: 0.92,
        enabled: true,
        patternConfig: { regex: "\\bOCB-PRJ-[0-9]+\\b", flags: "g" },
      },
    ],
    profiles: [
      {
        id: "default-external",
        name: "Default External",
        enabled: true,
        appliesTo: { sourceApps: ["openwebui", "openclaw-gw"] },
        levelOverrides: {},
        transformOverrides: {},
        fallbackMode: "block",
        restorePolicy: {
          allowRestore: true,
          requireFullRestore: true,
          allowStreamingPlaceholderPassthrough: false,
        },
      },
    ],
    documentSets: [
      {
        id: "internal-terms",
        name: "Internal Terms",
        documentClass: "internal",
        businessDomain: "banking",
        sourceType: "manual",
        version: 2,
        status: "published",
        entries: [{ id: "term-1", term: "OCB-PRJ-123", entityTypeId: "project_code" }],
        termCount: 1,
      },
    ],
    updatedAt: "2026-04-20T09:00:00.000Z",
  },
  sourceApps: [
    {
      id: "src-openwebui",
      key: "openwebui",
      name: "OpenWebUI",
      environment: "local",
      active: true,
    },
    {
      id: "src-openclaw",
      key: "openclaw-gw",
      name: "OpenClaw Gateway",
      environment: "local",
      active: true,
    },
  ],
  incidents: [
    {
      id: "evt-001",
      timestamp: "2026-04-20T09:15:00.000Z",
      sourceApp: "openwebui",
      requestSnippet: "Bank account **** redacted",
      sanitizedSnippet: "Request blocked before provider call",
      highestLevel: "L1",
      matchedRuleIds: ["rule-bank"],
      validatorResult: { passed: false, reasons: ["L1 BLOCK"], remainingFindings: 1 },
      finalDecision: "blocked",
      finalStatus: "open",
      bundleVersion: "privacy-active-v4",
      timeline: [
        { step: "Detect", status: "matched", detail: "Bank Account matched rule-bank" },
        { step: "Transform", status: "blocked", detail: "L1 policy blocked the request" },
      ],
    },
  ],
  bundles: [
    {
      id: "privacy-active-v4",
      version: "privacy-active-v4",
      status: "active",
      createdAt: "2026-04-20T09:00:00.000Z",
      publishedAt: "2026-04-20T09:05:00.000Z",
      notes: "Active policy",
      changedEntities: 0,
      changedRules: 0,
    },
    {
      id: "privacy-draft-v5",
      version: "privacy-draft-v5",
      status: "draft",
      createdAt: "2026-04-20T10:00:00.000Z",
      notes: "Tighten project code handling",
      changedEntities: 1,
      changedRules: 1,
    },
  ],
  settings: {
    vaultEnabled: true,
    tokenTtlSeconds: 3600,
    autoExpireRestoreTokens: true,
    encryptionRequired: true,
    keyRotationDays: 30,
    validatorMode: "strict",
    fallbackToLocalLlm: false,
    auditRetentionDays: 30,
    publishRestrictedToAdmins: true,
  },
};

const testResultPayload = {
  result: {
    requestId: "test-req-1",
    sourceApp: "openwebui",
    bundleVersion: "privacy-active-v4",
    decision: "transformed",
    rawInput: "Email ana@example.com about OCB-PRJ-123",
    sanitizedOutput: "Email [EMAIL_MASKED] about [PROJECT_001]",
    detectedEntities: [
      {
        text: "ana@example.com",
        entityKey: "customer_email",
        entityLabel: "Customer Email",
        level: "L2",
        action: "MASK",
        ruleId: "rule-email",
        confidence: 0.98,
        start: 6,
        end: 21,
        rationale: "Regex matched personal email",
      },
      {
        text: "OCB-PRJ-123",
        entityKey: "project_code",
        entityLabel: "Project Code",
        level: "L3",
        action: "TOKENIZE",
        ruleId: "rule-project",
        confidence: 0.92,
        start: 28,
        end: 39,
        rationale: "Pattern matched internal project code",
      },
    ],
    matchedRules: [
      { id: "rule-email", name: "Customer email", action: "MASK", level: "L2" },
      { id: "rule-project", name: "Project code detector", action: "TOKENIZE", level: "L3" },
    ],
    validator: {
      passed: true,
      reasons: ["No L1 residual findings"],
      remainingFindings: [],
      confidenceScore: 0.96,
    },
    restoreTokens: [
      {
        token: "[PROJECT_001]",
        originalValue: "OCB-PRJ-123",
        ttlSeconds: 3600,
        createdAt: "2026-04-20T10:00:00.000Z",
        expiresAt: "2026-04-20T11:00:00.000Z",
      },
    ],
    pipeline: [
      {
        step: "Detect",
        status: "matched",
        detail: "2 entities detected",
        ruleIds: ["rule-email", "rule-project"],
      },
      { step: "Classify", status: "completed", detail: "Highest level L2" },
      { step: "Transform", status: "completed", detail: "Mask and tokenize applied" },
      { step: "Validate", status: "passed", detail: "Sanitized output passed validation" },
      { step: "Restore", status: "prepared", detail: "1 restore token prepared" },
    ],
    routeDecision: {
      providerRoute: "external-provider",
      fallback: false,
      reason: "Sanitized request is safe for configured provider routing.",
    },
  },
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("PrivacyFilterPageClient", () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method || "GET";

    if (url === "/api/privacy/control-plane" && method === "GET") {
      return jsonResponse(workspacePayload);
    }

    if (url === "/api/privacy/control-plane" && method === "PATCH") {
      return jsonResponse({
        ...workspacePayload,
        overview: {
          ...workspacePayload.overview,
          activeBundleVersion: "privacy-published-v6",
        },
      });
    }

    if (url === "/api/privacy/control-plane/test" && method === "POST") {
      return jsonResponse(testResultPayload);
    }

    if (url === "/api/privacy/control-plane/bundles/publish" && method === "POST") {
      return jsonResponse({
        activeBundle: { version: "privacy-published-v6" },
        workspace: workspacePayload,
      });
    }

    if (url === "/api/privacy/control-plane/bundles/rollback" && method === "POST") {
      return jsonResponse({
        activeBundle: { version: "privacy-active-v4" },
        workspace: workspacePayload,
      });
    }

    return jsonResponse({ error: "Not found" }, 404);
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockClear();
  });

  it("renders the task-first Privacy Filter IA with overview operations instead of raw config", async () => {
    render(<PrivacyFilterPageClient />);

    expect(await screen.findByRole("heading", { name: "Privacy Filter" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Policy Studio" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Test Lab" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Incidents" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Releases" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();

    expect(screen.getByText("Scanned requests")).toBeInTheDocument();
    expect(screen.getByText("Blocked requests")).toBeInTheDocument();
    expect(screen.getByText("Transformed requests")).toBeInTheDocument();
    expect(screen.getByText("Active bundle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Test Lab" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Rule" })).toBeInTheDocument();
    expect(screen.queryByText("Save Entity Types")).not.toBeInTheDocument();
  });

  it("uses Policy Studio as a three-column authoring workspace and persists rule edits", async () => {
    render(<PrivacyFilterPageClient />);

    fireEvent.click(await screen.findByRole("tab", { name: "Policy Studio" }));

    expect(screen.getByRole("heading", { name: "Entity Catalog" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rule Builder" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Policy Impact" })).toBeInTheDocument();
    expect(screen.getByText("Bank Account")).toBeInTheDocument();
    expect(screen.getByText("Bank account detector")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Rule name"), {
      target: { value: "Updated bank account detector" },
    });
    fireEvent.change(screen.getByLabelText("Detection method"), {
      target: { value: "dictionary" },
    });
    fireEvent.change(screen.getByLabelText("Confidence threshold"), {
      target: { value: "0.88" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Rule" }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/privacy/control-plane" && init?.method === "PATCH"
      );
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
        rules: [
          expect.objectContaining({
            id: "rule-bank",
            name: "Updated bank account detector",
            type: "dictionary",
            confidence: 0.88,
          }),
          expect.objectContaining({ id: "rule-project" }),
        ],
      });
    });
  });

  it("runs the Test Lab pipeline and explains detect/classify/transform/validate/restore decisions", async () => {
    render(<PrivacyFilterPageClient initialView="test" />);

    expect(await screen.findByRole("heading", { name: "Test Lab" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Raw request input"), {
      target: { value: "Email ana@example.com about OCB-PRJ-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run Test" }));

    expect(await screen.findByText("[EMAIL_MASKED]")).toBeInTheDocument();
    expect(screen.getByText("[PROJECT_001]")).toBeInTheDocument();
    expect(screen.getByText("Detect")).toBeInTheDocument();
    expect(screen.getByText("Classify")).toBeInTheDocument();
    expect(screen.getByText("Transform")).toBeInTheDocument();
    expect(screen.getByText("Validate")).toBeInTheDocument();
    expect(screen.getByText("Restore")).toBeInTheDocument();
    expect(screen.getByText("Regex matched personal email")).toBeInTheDocument();
    expect(
      screen.getByText("Sanitized request is safe for configured provider routing.")
    ).toBeInTheDocument();
  });

  it("shows incident details with investigation actions and release publish/rollback safety", async () => {
    render(<PrivacyFilterPageClient />);

    fireEvent.click(await screen.findByRole("tab", { name: "Incidents" }));
    fireEvent.click(screen.getByRole("button", { name: "Inspect evt-001" }));
    expect(screen.getByRole("heading", { name: "Incident evt-001" })).toBeInTheDocument();
    expect(screen.getByText("Request blocked before provider call")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open in Test Lab" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inspect Rule" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Releases" }));
    expect(screen.getByRole("heading", { name: "Draft vs Active" })).toBeInTheDocument();
    expect(screen.getByText("privacy-active-v4")).toBeInTheDocument();
    expect(screen.getByText("privacy-draft-v5")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Publish Draft" }));
    const publishDialog = screen.getByRole("dialog", { name: "Publish privacy bundle" });
    expect(
      within(publishDialog).getByText(
        "This publishes draft policy changes to the live outbound AI path."
      )
    ).toBeInTheDocument();
    fireEvent.click(within(publishDialog).getByRole("button", { name: "Publish Bundle" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url === "/api/privacy/control-plane/bundles/publish" && init?.method === "POST"
        )
      ).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Rollback Active Bundle" }));
    const rollbackDialog = screen.getByRole("dialog", { name: "Rollback privacy bundle" });
    fireEvent.click(within(rollbackDialog).getByRole("button", { name: "Rollback Bundle" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url === "/api/privacy/control-plane/bundles/rollback" && init?.method === "POST"
        )
      ).toBe(true);
    });
  });

  it("keeps Privacy Filter settings separate and saves privacy-specific controls", async () => {
    render(<PrivacyFilterPageClient initialView="settings" />);

    expect(
      await screen.findByRole("heading", { name: "Privacy Filter Settings" })
    ).toBeInTheDocument();
    expect(screen.getByText("Entity Vault")).toBeInTheDocument();
    expect(screen.getByText("Validator Defaults")).toBeInTheDocument();
    expect(screen.getByText("Audit Retention")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Token TTL seconds"), {
      target: { value: "7200" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/privacy/control-plane" && init?.method === "PATCH"
      );
      expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
        settings: {
          tokenTtlSeconds: 7200,
        },
      });
    });
  });
});
