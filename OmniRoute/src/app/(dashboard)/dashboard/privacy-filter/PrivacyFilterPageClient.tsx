"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import type { PrivacyBundleRecord, PrivacyConfig } from "@/lib/privacy/types";

type EditorSection = "entityTypes" | "rules" | "profiles" | "documentSets";

type PrivacyStats = {
  scannedRequests: number;
  decisionCounts: {
    allow: number;
    transformed: number;
    blocked: number;
  };
  sourceApps: Record<string, number>;
  topEntityTypes: Record<string, number>;
  activeBundle?: PrivacyBundleRecord;
};

type EditorState = Record<EditorSection, string>;

const EMPTY_EDITORS: EditorState = {
  entityTypes: "[]",
  rules: "[]",
  profiles: "[]",
  documentSets: "[]",
};

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatDate(value?: string | null) {
  if (!value) return "n/a";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function formatApiError(detail: unknown) {
  if (!detail) return "Request failed";
  if (typeof detail === "string") return detail;

  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return "Request failed";
  }
}

function buildEditors(config: PrivacyConfig): EditorState {
  return {
    entityTypes: prettyJson(config.entityTypes),
    rules: prettyJson(config.rules),
    profiles: prettyJson(config.profiles),
    documentSets: prettyJson(config.documentSets),
  };
}

function SummaryCard({
  title,
  value,
  icon,
  tone = "text-primary",
}: {
  title: string;
  value: string | number;
  icon: string;
  tone?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3 mb-3">
        <div
          className={`flex size-10 items-center justify-center rounded-xl bg-black/5 dark:bg-white/5 ${tone}`}
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            {icon}
          </span>
        </div>
        <span className="text-sm text-text-muted">{title}</span>
      </div>
      <p className="text-2xl font-semibold text-text-main">{value}</p>
    </Card>
  );
}

function JsonEditorCard({
  section,
  title,
  description,
  value,
  saving,
  onChange,
  onSave,
}: {
  section: EditorSection;
  title: string;
  description: string;
  value: string;
  saving: boolean;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onSave: () => void;
}) {
  return (
    <Card
      title={title}
      subtitle={description}
      icon="edit_note"
      action={
        <Button size="sm" icon="publish" loading={saving} onClick={onSave}>
          {saving ? "Publishing" : `Save ${title}`}
        </Button>
      }
    >
      <textarea
        aria-label={`${title} JSON`}
        data-testid={`privacy-editor-${section}`}
        value={value}
        onChange={onChange}
        spellCheck={false}
        className="min-h-[280px] w-full rounded-xl border border-border bg-bg px-4 py-3 font-mono text-xs text-text-main outline-none transition-colors focus:border-primary"
      />
    </Card>
  );
}

function TopList({
  title,
  icon,
  emptyMessage,
  entries,
}: {
  title: string;
  icon: string;
  emptyMessage: string;
  entries: Array<[string, number]>;
}) {
  return (
    <Card title={title} icon={icon}>
      {entries.length === 0 ? (
        <p className="text-sm text-text-muted">{emptyMessage}</p>
      ) : (
        <div className="space-y-3">
          {entries.map(([label, count]) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-lg border border-border/70 bg-bg/60 px-3 py-2"
            >
              <span className="text-sm font-medium text-text-main">{label}</span>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                {count}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function PrivacyFilterPageClient() {
  const [config, setConfig] = useState<PrivacyConfig | null>(null);
  const [stats, setStats] = useState<PrivacyStats | null>(null);
  const [activeBundle, setActiveBundle] = useState<PrivacyBundleRecord | null>(null);
  const [editors, setEditors] = useState<EditorState>(EMPTY_EDITORS);
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState<EditorSection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);

    try {
      const [configResponse, statsResponse] = await Promise.all([
        fetch("/api/privacy/config"),
        fetch("/api/privacy/stats"),
      ]);

      const [configJson, statsJson] = await Promise.all([
        configResponse.json().catch(() => null),
        statsResponse.json().catch(() => null),
      ]);

      if (!configResponse.ok) {
        throw new Error(formatApiError(configJson?.error));
      }

      if (!statsResponse.ok) {
        throw new Error(formatApiError(statsJson?.error));
      }

      setConfig(configJson.config);
      setStats(statsJson);
      setActiveBundle(statsJson.activeBundle || configJson.activeBundle || null);
      setEditors(buildEditors(configJson.config));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load privacy board");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  function updateEditor(section: EditorSection, value: string) {
    setEditors((current) => ({
      ...current,
      [section]: value,
    }));
  }

  async function saveSection(section: EditorSection) {
    setSavingSection(section);
    setError(null);
    setNotice(null);

    try {
      const parsed = JSON.parse(editors[section]);
      const response = await fetch("/api/privacy/config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          [section]: parsed,
        }),
      });
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(formatApiError(json?.error));
      }

      setConfig(json.config);
      setActiveBundle(json.activeBundle || null);
      setEditors(buildEditors(json.config));
      setNotice(`Published ${section} to bundle ${json.activeBundle?.version || "unknown"}`);
      await loadData();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : `Failed to publish ${section} changes`
      );
    } finally {
      setSavingSection(null);
    }
  }

  const sourceAppEntries = Object.entries(stats?.sourceApps || {}).sort(
    (left, right) => right[1] - left[1]
  );
  const entityTypeEntries = Object.entries(stats?.topEntityTypes || {}).sort(
    (left, right) => right[1] - left[1]
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6" data-testid="privacy-filter-page">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-text-main">Privacy Filter</h1>
          <p className="mt-2 max-w-3xl text-sm text-text-muted">
            Review runtime privacy telemetry, update detection rules, publish policy bundles, and
            manage internal document dictionaries from one control surface in OmniRoute.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            icon="refresh"
            loading={loading}
            onClick={() => void loadData()}
          >
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Scanned requests"
          value={stats?.scannedRequests || 0}
          icon="shield_scan"
        />
        <SummaryCard
          title="Blocked requests"
          value={stats?.decisionCounts?.blocked || 0}
          icon="block"
          tone="text-red-500"
        />
        <SummaryCard
          title="Transformed requests"
          value={stats?.decisionCounts?.transformed || 0}
          icon="switch_access_shortcut"
          tone="text-amber-500"
        />
        <SummaryCard
          title="Managed rules"
          value={config?.rules.length || 0}
          icon="rule"
          tone="text-blue-500"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          title="Active bundle"
          subtitle="Current runtime bundle loaded by the privacy engine"
          icon="deployed_code"
        >
          <dl className="grid grid-cols-1 gap-3 text-sm">
            <div className="rounded-lg border border-border/70 bg-bg/60 px-3 py-2">
              <dt className="text-text-muted">Version</dt>
              <dd className="mt-1 font-medium text-text-main">
                {activeBundle?.version || "privacy-default-v1"}
              </dd>
            </div>
            <div className="rounded-lg border border-border/70 bg-bg/60 px-3 py-2">
              <dt className="text-text-muted">Compiled at</dt>
              <dd className="mt-1 font-medium text-text-main">
                {formatDate(activeBundle?.compiledAt)}
              </dd>
            </div>
            <div className="rounded-lg border border-border/70 bg-bg/60 px-3 py-2">
              <dt className="text-text-muted">Last config update</dt>
              <dd className="mt-1 font-medium text-text-main">{formatDate(config?.updatedAt)}</dd>
            </div>
          </dl>
        </Card>

        <TopList
          title="Source apps"
          icon="hub"
          emptyMessage="No privacy events have been recorded yet."
          entries={sourceAppEntries}
        />

        <TopList
          title="Detected entity types"
          icon="find_in_page"
          emptyMessage="No entity detections have been aggregated yet."
          entries={entityTypeEntries}
        />
      </div>

      <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-text-main">
        Phase 1 board publishes JSON-backed rule bundles directly into OmniRoute. Use the editors
        below to update entity mapping, filters, policy profiles, and internal document
        dictionaries.
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <JsonEditorCard
          section="entityTypes"
          title="Entity Types"
          description="Control level mapping, default transforms, restore mode, and placeholder prefixes."
          value={editors.entityTypes}
          saving={savingSection === "entityTypes"}
          onChange={(event) => updateEditor("entityTypes", event.target.value)}
          onSave={() => void saveSection("entityTypes")}
        />

        <JsonEditorCard
          section="rules"
          title="Rules"
          description="Maintain regex, pattern, and dictionary filters that drive outbound privacy detection."
          value={editors.rules}
          saving={savingSection === "rules"}
          onChange={(event) => updateEditor("rules", event.target.value)}
          onSave={() => void saveSection("rules")}
        />

        <JsonEditorCard
          section="profiles"
          title="Profiles"
          description="Override transforms and fallback behaviour per source app, API key, or workspace."
          value={editors.profiles}
          saving={savingSection === "profiles"}
          onChange={(event) => updateEditor("profiles", event.target.value)}
          onSave={() => void saveSection("profiles")}
        />

        <JsonEditorCard
          section="documentSets"
          title="Internal Documents"
          description="Publish internal document dictionaries, project codes, and reversible token mappings."
          value={editors.documentSets}
          saving={savingSection === "documentSets"}
          onChange={(event) => updateEditor("documentSets", event.target.value)}
          onSave={() => void saveSection("documentSets")}
        />
      </div>
    </div>
  );
}
