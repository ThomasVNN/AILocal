// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PrivacyFilterPageClient from "../PrivacyFilterPageClient";

const configPayload = {
  config: {
    entityTypes: [
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
    ],
    rules: [
      {
        id: "rule-project",
        name: "Project Code Rule",
        type: "regex",
        entityTypeId: "project_code",
        severityLevel: "L3",
        priority: 80,
        confidence: 0.9,
        enabled: true,
        patternConfig: { regex: "OCB-PRJ-[0-9]+" },
      },
    ],
    profiles: [
      {
        id: "default-external",
        name: "Default External",
        enabled: true,
        appliesTo: { sourceApps: ["openwebui"] },
        levelOverrides: {},
        transformOverrides: {},
        fallbackMode: "block",
        restorePolicy: {
          allowRestore: true,
          requireFullRestore: false,
          allowStreamingPlaceholderPassthrough: false,
        },
      },
    ],
    documentSets: [
      {
        id: "doc-set-1",
        name: "Retail Banking",
        documentClass: "internal",
        businessDomain: "retail",
        sourceType: "manual",
        version: 1,
        status: "published",
        entries: [{ id: "entry-1", term: "OCB-PRJ-123", entityTypeId: "project_code" }],
      },
    ],
    updatedAt: "2026-04-12T10:00:00.000Z",
  },
  activeBundle: {
    version: "privacy-default-v1",
    status: "active",
    checksum: "abc123",
    compiledAt: "2026-04-12T10:00:00.000Z",
    compiledBy: "test",
    changeSummary: "Initial bundle",
    compiledBundle: {},
  },
};

const statsPayload = {
  scannedRequests: 14,
  decisionCounts: {
    allow: 7,
    transformed: 5,
    blocked: 2,
  },
  sourceApps: {
    openwebui: 9,
    "openclaw-gw": 5,
  },
  topEntityTypes: {
    project_code: 6,
    customer_email: 4,
  },
  activeBundle: configPayload.activeBundle,
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

    if (url === "/api/privacy/config" && method === "GET") {
      return jsonResponse(configPayload);
    }

    if (url === "/api/privacy/stats" && method === "GET") {
      return jsonResponse(statsPayload);
    }

    if (url === "/api/privacy/config" && method === "PATCH") {
      return jsonResponse({
        config: {
          ...configPayload.config,
          rules: [],
        },
        activeBundle: {
          ...configPayload.activeBundle,
          version: "privacy-v2",
        },
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

  it("renders telemetry cards and concrete configuration dashboard", async () => {
    render(<PrivacyFilterPageClient />);

    expect(await screen.findByRole("heading", { name: "Privacy Filter" })).toBeInTheDocument();
    expect(await screen.findByText("privacy-default-v1")).toBeInTheDocument();
    expect(screen.getByText("Scanned requests")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("Project Code Rule")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Rule" })).toBeInTheDocument();
    expect(screen.getByText("Saved in SQLite")).toBeInTheDocument();
  });

  it("adds a rule through the privacy dashboard and persists it through the config API", async () => {
    render(<PrivacyFilterPageClient />);

    fireEvent.click(await screen.findByRole("button", { name: "Add Rule" }));
    fireEvent.change(screen.getByLabelText("Rule name"), {
      target: { value: "New Customer Email Rule" },
    });
    fireEvent.change(screen.getByLabelText("Rule ID"), {
      target: { value: "rule-new-email" },
    });
    fireEvent.change(screen.getByLabelText("Regex pattern"), {
      target: { value: "customer-[0-9]+" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Rule" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === "/api/privacy/config" && init?.method === "PATCH"
        )
      ).toBe(true);
    });

    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/privacy/config" && init?.method === "PATCH"
    );

    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      rules: [
        expect.objectContaining({ id: "rule-project" }),
        expect.objectContaining({
          id: "rule-new-email",
          name: "New Customer Email Rule",
          patternConfig: { regex: "customer-[0-9]+", flags: "g" },
        }),
      ],
    });
    expect(await screen.findByText("Published rules to bundle privacy-v2")).toBeInTheDocument();
  });

  it("edits and removes a rule through the privacy dashboard", async () => {
    render(<PrivacyFilterPageClient />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit Project Code Rule" }));
    fireEvent.change(screen.getByLabelText("Rule name"), {
      target: { value: "Edited Project Rule" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Rule" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url === "/api/privacy/config" &&
            init?.method === "PATCH" &&
            String(init?.body).includes("Edited Project Rule")
        )
      ).toBe(true);
    });

    fetchMock.mockClear();
    fireEvent.click(await screen.findByRole("button", { name: "Remove Project Code Rule" }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/privacy/config" && init?.method === "PATCH"
      );
      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ rules: [] });
    });
  });
});
