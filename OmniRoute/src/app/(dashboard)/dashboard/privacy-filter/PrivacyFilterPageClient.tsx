"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import type {
  PrivacyBundleRecord,
  PrivacyConfig,
  PrivacyDocumentSet,
  PrivacyEntityType,
  PrivacyLevel,
  PrivacyPolicyProfile,
  PrivacyRule,
  PrivacyRuleType,
  PrivacyTransformMode,
} from "@/lib/privacy/types";

type PrivacySection = "entityTypes" | "rules" | "profiles" | "documentSets";
type JsonEditableSection = Exclude<PrivacySection, "rules">;
type JsonEditableItem = PrivacyEntityType | PrivacyPolicyProfile | PrivacyDocumentSet;

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

type RuleDraft = {
  mode: "add" | "edit";
  originalId?: string;
  value: PrivacyRule;
};

type JsonDraft = {
  section: JsonEditableSection;
  itemLabel: string;
  mode: "add" | "edit";
  originalId?: string;
  value: string;
};

const SECTION_LABELS: Record<PrivacySection, string> = {
  entityTypes: "entity types",
  rules: "rules",
  profiles: "profiles",
  documentSets: "document sets",
};

const LEVELS: PrivacyLevel[] = ["L1", "L2", "L3", "L4"];
const TRANSFORMS: PrivacyTransformMode[] = ["BLOCK", "MASK", "TOKENIZE", "ALLOW"];
const RULE_TYPES: PrivacyRuleType[] = ["regex", "pattern", "dictionary"];

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

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueId(base: string, existingIds: string[]) {
  const cleanBase = slugify(base) || "custom";
  let candidate = cleanBase;
  let suffix = 2;

  while (existingIds.includes(candidate)) {
    candidate = `${cleanBase}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function itemTitle(item: JsonEditableItem) {
  return item.name || item.id;
}

function itemMeta(item: JsonEditableItem) {
  if ("defaultTransform" in item) {
    return [
      item.category,
      item.defaultLevel,
      item.defaultTransform,
      item.enabled ? "enabled" : "off",
    ];
  }

  if ("fallbackMode" in item) {
    const sourceApps = item.appliesTo?.sourceApps?.length
      ? item.appliesTo.sourceApps.join(", ")
      : "all sources";
    return [item.fallbackMode, sourceApps, item.enabled ? "enabled" : "off"];
  }

  return [
    item.status,
    item.businessDomain,
    `${item.entries?.length || 0} entries`,
    `v${item.version}`,
  ];
}

function createDefaultJsonItem(
  section: JsonEditableSection,
  config: PrivacyConfig
): JsonEditableItem {
  if (section === "entityTypes") {
    const id = uniqueId(
      "custom-entity",
      config.entityTypes.map((item) => item.id)
    );

    return {
      id,
      name: "Custom Entity",
      category: "custom",
      defaultLevel: "L3",
      defaultTransform: "MASK",
      restoreMode: "never",
      placeholderPrefix: "CUSTOM",
      enabled: true,
    };
  }

  if (section === "profiles") {
    const id = uniqueId(
      "custom-profile",
      config.profiles.map((item) => item.id)
    );

    return {
      id,
      name: "Custom Profile",
      description: "Dashboard-managed privacy profile.",
      enabled: true,
      appliesTo: {
        sourceApps: ["direct-api"],
      },
      levelOverrides: {},
      transformOverrides: {},
      fallbackMode: "block",
      restorePolicy: {
        allowRestore: true,
        requireFullRestore: true,
        allowStreamingPlaceholderPassthrough: false,
      },
    };
  }

  const id = uniqueId(
    "custom-documents",
    config.documentSets.map((item) => item.id)
  );

  return {
    id,
    name: "Custom Documents",
    documentClass: "internal",
    businessDomain: "general",
    sourceType: "manual",
    version: 1,
    status: "draft",
    entries: [],
  };
}

function createDefaultRule(config: PrivacyConfig): PrivacyRule {
  const id = uniqueId(
    "rule-custom",
    config.rules.map((rule) => rule.id)
  );
  const entityType = config.entityTypes[0];

  return {
    id,
    name: "Custom Rule",
    type: "regex",
    entityTypeId: entityType?.id || "custom_entity",
    severityLevel: entityType?.defaultLevel || "L3",
    priority: 80,
    confidence: 0.9,
    enabled: true,
    patternConfig: {
      regex: "",
      flags: "g",
    },
  };
}

function updateRuleDraftField<K extends keyof PrivacyRule>(
  rule: PrivacyRule,
  key: K,
  value: PrivacyRule[K]
) {
  return {
    ...rule,
    [key]: value,
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
          className={`flex size-10 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5 ${tone}`}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-text-main">
      {label}
      {children}
    </label>
  );
}

function textInputClass() {
  return "h-10 rounded-lg border border-border bg-bg px-3 text-sm text-text-main outline-none transition-colors focus:border-primary";
}

function selectClass() {
  return "h-10 rounded-lg border border-border bg-bg px-3 text-sm text-text-main outline-none transition-colors focus:border-primary";
}

function RuleForm({
  draft,
  config,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  draft: RuleDraft;
  config: PrivacyConfig;
  saving: boolean;
  onChange: (rule: PrivacyRule) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const rule = draft.value;

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold text-text-main">
            {draft.mode === "add" ? "Add Rule" : `Edit ${rule.name || rule.id}`}
          </h4>
          <p className="text-sm text-text-muted">
            Saved rules are written to SQLite and published as the active privacy bundle.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon="close"
          onClick={onCancel}
          aria-label="Cancel rule edit"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Rule name">
          <input
            aria-label="Rule name"
            className={textInputClass()}
            value={rule.name}
            onChange={(event) => onChange(updateRuleDraftField(rule, "name", event.target.value))}
          />
        </Field>
        <Field label="Rule ID">
          <input
            aria-label="Rule ID"
            className={textInputClass()}
            value={rule.id}
            onChange={(event) => onChange(updateRuleDraftField(rule, "id", event.target.value))}
          />
        </Field>
        <Field label="Entity Type">
          <select
            aria-label="Entity Type"
            className={selectClass()}
            value={rule.entityTypeId}
            onChange={(event) =>
              onChange(updateRuleDraftField(rule, "entityTypeId", event.target.value))
            }
          >
            {config.entityTypes.map((entityType) => (
              <option key={entityType.id} value={entityType.id}>
                {entityType.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rule type">
          <select
            aria-label="Rule type"
            className={selectClass()}
            value={rule.type}
            onChange={(event) =>
              onChange(updateRuleDraftField(rule, "type", event.target.value as PrivacyRuleType))
            }
          >
            {RULE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Severity">
          <select
            aria-label="Severity"
            className={selectClass()}
            value={rule.severityLevel}
            onChange={(event) =>
              onChange(
                updateRuleDraftField(rule, "severityLevel", event.target.value as PrivacyLevel)
              )
            }
          >
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Regex flags">
          <input
            aria-label="Regex flags"
            className={textInputClass()}
            value={rule.patternConfig.flags || ""}
            onChange={(event) =>
              onChange({
                ...rule,
                patternConfig: {
                  ...rule.patternConfig,
                  flags: event.target.value,
                },
              })
            }
          />
        </Field>
        <Field label="Priority">
          <input
            aria-label="Priority"
            className={textInputClass()}
            type="number"
            value={rule.priority}
            onChange={(event) =>
              onChange(updateRuleDraftField(rule, "priority", Number(event.target.value)))
            }
          />
        </Field>
        <Field label="Confidence">
          <input
            aria-label="Confidence"
            className={textInputClass()}
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={rule.confidence}
            onChange={(event) =>
              onChange(updateRuleDraftField(rule, "confidence", Number(event.target.value)))
            }
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Regex pattern">
            <input
              aria-label="Regex pattern"
              className={textInputClass()}
              value={rule.patternConfig.regex || ""}
              onChange={(event) =>
                onChange({
                  ...rule,
                  patternConfig: {
                    ...rule.patternConfig,
                    regex: event.target.value,
                  },
                })
              }
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-text-main">
          <input
            aria-label="Rule enabled"
            type="checkbox"
            checked={rule.enabled}
            onChange={(event) =>
              onChange(updateRuleDraftField(rule, "enabled", event.target.checked))
            }
          />
          Enabled
        </label>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button icon="save" loading={saving} onClick={onSave}>
          Save Rule
        </Button>
      </div>
    </div>
  );
}

function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-bg px-2.5 py-1 text-xs font-medium text-text-muted">
      {children}
    </span>
  );
}

export default function PrivacyFilterPageClient() {
  const [config, setConfig] = useState<PrivacyConfig | null>(null);
  const [stats, setStats] = useState<PrivacyStats | null>(null);
  const [activeBundle, setActiveBundle] = useState<PrivacyBundleRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState<PrivacySection | null>(null);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [jsonDraft, setJsonDraft] = useState<JsonDraft | null>(null);
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
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load privacy board");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function publishSection<T extends PrivacySection>(section: T, nextItems: PrivacyConfig[T]) {
    setSavingSection(section);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/privacy/config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          [section]: nextItems,
        }),
      });
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(formatApiError(json?.error));
      }

      setConfig(json.config);
      setActiveBundle(json.activeBundle || null);
      setNotice(
        `Published ${SECTION_LABELS[section]} to bundle ${json.activeBundle?.version || "unknown"}`
      );
      await loadData();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : `Failed to publish ${SECTION_LABELS[section]} changes`
      );
    } finally {
      setSavingSection(null);
    }
  }

  function startAddRule() {
    if (!config) return;

    setRuleDraft({
      mode: "add",
      value: createDefaultRule(config),
    });
    setJsonDraft(null);
  }

  function startEditRule(rule: PrivacyRule) {
    setRuleDraft({
      mode: "edit",
      originalId: rule.id,
      value: {
        ...rule,
        patternConfig: {
          ...rule.patternConfig,
        },
        scope: rule.scope
          ? {
              ...rule.scope,
            }
          : undefined,
      },
    });
    setJsonDraft(null);
  }

  async function saveRuleDraft() {
    if (!config || !ruleDraft) return;

    const rule = {
      ...ruleDraft.value,
      id: ruleDraft.value.id.trim(),
      name: ruleDraft.value.name.trim() || ruleDraft.value.id.trim(),
      patternConfig: {
        ...ruleDraft.value.patternConfig,
        regex: ruleDraft.value.patternConfig.regex?.trim() || "",
        flags: ruleDraft.value.patternConfig.flags?.trim() || "g",
      },
    };

    if (!rule.id) {
      setError("Rule ID is required.");
      return;
    }

    if (!rule.patternConfig.regex) {
      setError("Regex pattern is required.");
      return;
    }

    const duplicate = config.rules.some(
      (existing) => existing.id === rule.id && existing.id !== ruleDraft.originalId
    );
    if (duplicate) {
      setError(`Rule ID already exists: ${rule.id}`);
      return;
    }

    const nextRules =
      ruleDraft.mode === "edit"
        ? config.rules.map((existing) => (existing.id === ruleDraft.originalId ? rule : existing))
        : [...config.rules, rule];

    await publishSection("rules", nextRules);
    setRuleDraft(null);
  }

  async function removeRule(rule: PrivacyRule) {
    if (!config) return;
    await publishSection(
      "rules",
      config.rules.filter((existing) => existing.id !== rule.id)
    );
  }

  function startJsonAdd(section: JsonEditableSection, itemLabel: string) {
    if (!config) return;

    setJsonDraft({
      section,
      itemLabel,
      mode: "add",
      value: prettyJson(createDefaultJsonItem(section, config)),
    });
    setRuleDraft(null);
  }

  function startJsonEdit(section: JsonEditableSection, itemLabel: string, item: JsonEditableItem) {
    setJsonDraft({
      section,
      itemLabel,
      mode: "edit",
      originalId: item.id,
      value: prettyJson(item),
    });
    setRuleDraft(null);
  }

  async function saveJsonDraft() {
    if (!config || !jsonDraft) return;

    let parsed: JsonEditableItem;
    try {
      parsed = JSON.parse(jsonDraft.value) as JsonEditableItem;
    } catch (jsonError) {
      setError(jsonError instanceof Error ? jsonError.message : "Invalid JSON");
      return;
    }

    if (!parsed.id || typeof parsed.id !== "string") {
      setError(`${jsonDraft.itemLabel} ID is required.`);
      return;
    }

    const currentItems = config[jsonDraft.section] as JsonEditableItem[];
    const duplicate = currentItems.some(
      (existing) => existing.id === parsed.id && existing.id !== jsonDraft.originalId
    );
    if (duplicate) {
      setError(`${jsonDraft.itemLabel} ID already exists: ${parsed.id}`);
      return;
    }

    const nextItems =
      jsonDraft.mode === "edit"
        ? currentItems.map((existing) => (existing.id === jsonDraft.originalId ? parsed : existing))
        : [...currentItems, parsed];

    await publishSection(jsonDraft.section, nextItems as never);
    setJsonDraft(null);
  }

  async function removeJsonItem(section: JsonEditableSection, item: JsonEditableItem) {
    if (!config) return;
    const currentItems = config[section] as JsonEditableItem[];
    await publishSection(
      section,
      currentItems.filter((existing) => existing.id !== item.id) as never
    );
  }

  function renderJsonSection({
    section,
    title,
    itemLabel,
    description,
    icon,
  }: {
    section: JsonEditableSection;
    title: string;
    itemLabel: string;
    description: string;
    icon: string;
  }) {
    const items = config ? (config[section] as JsonEditableItem[]) : [];
    const draftOpen = jsonDraft?.section === section;

    return (
      <Card
        title={title}
        subtitle={description}
        icon={icon}
        action={
          <Button
            size="sm"
            icon="add"
            onClick={() => startJsonAdd(section, itemLabel)}
            disabled={!config}
          >
            Add {itemLabel}
          </Button>
        }
      >
        <div className="space-y-3">
          {items.length === 0 ? (
            <p className="rounded-lg border border-border/70 bg-bg/60 px-3 py-3 text-sm text-text-muted">
              No {SECTION_LABELS[section]} configured yet.
            </p>
          ) : (
            items.map((item) => (
              <div key={item.id} className="rounded-lg border border-border/70 bg-bg/60 p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-text-main">{itemTitle(item)}</p>
                    <p className="mt-1 font-mono text-xs text-text-muted">{item.id}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {itemMeta(item).map((meta) => (
                        <StatusPill key={String(meta)}>{meta}</StatusPill>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="edit"
                      aria-label={`Edit ${itemTitle(item)}`}
                      title={`Edit ${itemTitle(item)}`}
                      onClick={() => startJsonEdit(section, itemLabel, item)}
                    />
                    <Button
                      variant="danger"
                      size="sm"
                      icon="delete"
                      aria-label={`Remove ${itemTitle(item)}`}
                      title={`Remove ${itemTitle(item)}`}
                      loading={savingSection === section}
                      onClick={() => void removeJsonItem(section, item)}
                    />
                  </div>
                </div>
              </div>
            ))
          )}

          {draftOpen && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-text-main">
                    {jsonDraft.mode === "add" ? `Add ${itemLabel}` : `Edit ${itemLabel}`}
                  </h4>
                  <p className="text-sm text-text-muted">
                    Edit the stored record. Saving publishes a new active privacy bundle.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="close"
                  aria-label={`Cancel ${itemLabel} edit`}
                  onClick={() => setJsonDraft(null)}
                />
              </div>
              <textarea
                aria-label={`${itemLabel} JSON`}
                value={jsonDraft.value}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  setJsonDraft((current) =>
                    current
                      ? {
                          ...current,
                          value: event.target.value,
                        }
                      : current
                  )
                }
                spellCheck={false}
                className="min-h-[220px] w-full rounded-lg border border-border bg-bg px-4 py-3 font-mono text-xs text-text-main outline-none transition-colors focus:border-primary"
              />
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setJsonDraft(null)}>
                  Cancel
                </Button>
                <Button
                  icon="save"
                  loading={savingSection === section}
                  onClick={() => void saveJsonDraft()}
                >
                  Save {itemLabel}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    );
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
            Review runtime privacy telemetry, add/edit/remove detection policy records, and publish
            database-backed bundles from one AIAgentGateway control surface.
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
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
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
              <dt className="text-text-muted">Storage</dt>
              <dd className="mt-1 font-medium text-text-main">Saved in SQLite</dd>
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

      <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-text-main">
        Privacy records are stored in the OmniRoute SQLite database under the privacy namespace.
        Saving any section publishes a new active runtime bundle and invalidates the privacy cache.
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {renderJsonSection({
          section: "entityTypes",
          title: "Entity Types",
          itemLabel: "Entity Type",
          description:
            "Control level mapping, default transforms, restore mode, and placeholder prefixes.",
          icon: "category",
        })}

        <Card
          title="Rules"
          subtitle="Maintain regex, pattern, and dictionary filters that drive outbound privacy detection."
          icon="rule"
          action={
            <Button size="sm" icon="add" onClick={startAddRule} disabled={!config}>
              Add Rule
            </Button>
          }
        >
          <div className="space-y-3">
            {!config || config.rules.length === 0 ? (
              <p className="rounded-lg border border-border/70 bg-bg/60 px-3 py-3 text-sm text-text-muted">
                No privacy rules configured yet.
              </p>
            ) : (
              config.rules.map((rule) => (
                <div key={rule.id} className="rounded-lg border border-border/70 bg-bg/60 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-text-main">{rule.name}</p>
                      <p className="mt-1 font-mono text-xs text-text-muted">{rule.id}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <StatusPill>{rule.type}</StatusPill>
                        <StatusPill>{rule.entityTypeId}</StatusPill>
                        <StatusPill>{rule.severityLevel}</StatusPill>
                        <StatusPill>priority {rule.priority}</StatusPill>
                        <StatusPill>{rule.enabled ? "enabled" : "off"}</StatusPill>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="edit"
                        aria-label={`Edit ${rule.name}`}
                        title={`Edit ${rule.name}`}
                        onClick={() => startEditRule(rule)}
                      />
                      <Button
                        variant="danger"
                        size="sm"
                        icon="delete"
                        aria-label={`Remove ${rule.name}`}
                        title={`Remove ${rule.name}`}
                        loading={savingSection === "rules"}
                        onClick={() => void removeRule(rule)}
                      />
                    </div>
                  </div>
                </div>
              ))
            )}

            {ruleDraft && config && (
              <RuleForm
                draft={ruleDraft}
                config={config}
                saving={savingSection === "rules"}
                onChange={(value) =>
                  setRuleDraft((current) =>
                    current
                      ? {
                          ...current,
                          value,
                        }
                      : current
                  )
                }
                onCancel={() => setRuleDraft(null)}
                onSave={() => void saveRuleDraft()}
              />
            )}
          </div>
        </Card>

        {renderJsonSection({
          section: "profiles",
          title: "Profiles",
          itemLabel: "Profile",
          description:
            "Override transforms and fallback behaviour by source app, key, or workspace.",
          icon: "policy",
        })}

        {renderJsonSection({
          section: "documentSets",
          title: "Internal Documents",
          itemLabel: "Document Set",
          description:
            "Publish internal document dictionaries, project codes, and reversible tokens.",
          icon: "library_books",
        })}
      </div>
    </div>
  );
}
