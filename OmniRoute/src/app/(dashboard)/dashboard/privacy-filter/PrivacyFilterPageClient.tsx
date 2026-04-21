"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import Badge from "@/shared/components/Badge";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import Modal from "@/shared/components/Modal";
import { cn } from "@/shared/utils/cn";
import type {
  PrivacyControlPlaneWorkspace,
  PrivacyControlPlanePatch,
  PrivacyFilterView,
  PrivacyIncident,
  PrivacySettings,
  PrivacyTestInput,
  PrivacyTestResult,
} from "@/lib/privacy/controlPlaneTypes";
import type {
  PrivacyConfig,
  PrivacyEntityType,
  PrivacyLevel,
  PrivacyRule,
  PrivacyRuleType,
  PrivacyTransformMode,
} from "@/lib/privacy/types";
import { privacyFilterService } from "./privacyFilterService";

type RuleEditorState = PrivacyRule & {
  transformMode: PrivacyTransformMode;
  placeholderPrefix: string;
  restoreMode: PrivacyEntityType["restoreMode"];
};

type IncidentFiltersState = {
  query: string;
  sourceApp: string;
  level: string;
  action: string;
  bundleVersion: string;
  status: string;
};

const VIEWS: Array<{ value: PrivacyFilterView; label: string; icon: string }> = [
  { value: "overview", label: "Overview", icon: "monitoring" },
  { value: "policy", label: "Policy Studio", icon: "rule_settings" },
  { value: "test", label: "Test Lab", icon: "science" },
  { value: "incidents", label: "Incidents", icon: "policy_alert" },
  { value: "releases", label: "Releases", icon: "deployed_code_update" },
  { value: "settings", label: "Settings", icon: "tune" },
];

const LEVEL_META: Record<PrivacyLevel, { label: string; variant: "error" | "warning" | "info" | "success" }> = {
  L1: { label: "L1 Critical", variant: "error" },
  L2: { label: "L2 High", variant: "warning" },
  L3: { label: "L3 Medium", variant: "info" },
  L4: { label: "L4 Low", variant: "success" },
};

const METHODS: PrivacyRuleType[] = ["regex", "ner", "pattern", "dictionary"];
const ACTIONS: PrivacyTransformMode[] = ["BLOCK", "MASK", "TOKENIZE", "ALLOW"];
const LEVELS: PrivacyLevel[] = ["L1", "L2", "L3", "L4"];

function inputClass(className = "") {
  return cn(
    "min-h-10 rounded-lg border border-border bg-bg px-3 text-sm text-text-main outline-none transition-colors focus:border-primary",
    className
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatTime(value?: string) {
  if (!value) return "n/a";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function createId(label: string, prefix: string) {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}-${slug || Date.now()}`;
}

function getEntity(config: PrivacyConfig, entityId: string) {
  return config.entityTypes.find((entity) => entity.id === entityId) || config.entityTypes[0];
}

function createRuleEditor(rule: PrivacyRule, config: PrivacyConfig): RuleEditorState {
  const entity = getEntity(config, rule.entityTypeId);
  return {
    ...rule,
    patternConfig: { ...rule.patternConfig },
    scope: rule.scope ? { ...rule.scope } : undefined,
    transformMode: entity?.defaultTransform || "MASK",
    placeholderPrefix: entity?.placeholderPrefix || "ENTITY",
    restoreMode: entity?.restoreMode || "never",
  };
}

function createDefaultRule(config: PrivacyConfig): RuleEditorState {
  const entity = config.entityTypes[0];
  return {
    id: createId("new-rule", "rule"),
    name: "New detection rule",
    type: "regex",
    entityTypeId: entity?.id || "custom_entity",
    severityLevel: entity?.defaultLevel || "L3",
    priority: 80,
    confidence: 0.9,
    enabled: true,
    patternConfig: { regex: "", flags: "g" },
    scope: { sourceApps: [], profileIds: [] },
    transformMode: entity?.defaultTransform || "MASK",
    placeholderPrefix: entity?.placeholderPrefix || "ENTITY",
    restoreMode: entity?.restoreMode || "never",
  };
}

function toRule(editor: RuleEditorState): PrivacyRule {
  const { transformMode, placeholderPrefix, restoreMode, ...rule } = editor;
  return rule;
}

function LevelBadge({ level }: { level: PrivacyLevel }) {
  const meta = LEVEL_META[level] || LEVEL_META.L4;
  return (
    <Badge variant={meta.variant} size="sm">
      {meta.label}
    </Badge>
  );
}

function ActionBadge({ action }: { action: PrivacyTransformMode | string }) {
  const variant =
    action === "BLOCK" || action === "blocked"
      ? "error"
      : action === "MASK" || action === "transformed"
        ? "warning"
        : action === "TOKENIZE"
          ? "info"
          : "success";
  return (
    <Badge variant={variant} size="sm">
      {action}
    </Badge>
  );
}

function SourceAppBadge({ source }: { source: string }) {
  return (
    <Badge variant="default" size="sm" className="font-mono">
      {source}
    </Badge>
  );
}

function EmptyBlock({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-bg/50 p-6 text-center">
      <p className="font-medium text-text-main">{title}</p>
      <p className="mt-1 text-sm text-text-muted">{description}</p>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  tone,
}: {
  title: string;
  value: string | number;
  icon: string;
  tone: string;
}) {
  return (
    <Card padding="sm">
      <div className="flex items-center gap-3">
        <div className={cn("flex size-10 items-center justify-center rounded-lg bg-bg", tone)}>
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            {icon}
          </span>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{title}</p>
          <p className="mt-1 text-2xl font-semibold text-text-main">{value}</p>
        </div>
      </div>
    </Card>
  );
}

function PrivacyFilterTabs({
  activeView,
  onChange,
}: {
  activeView: PrivacyFilterView;
  onChange: (view: PrivacyFilterView) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Privacy Filter sections"
      className="flex w-full gap-1 overflow-x-auto rounded-lg bg-black/5 p-1 dark:bg-white/5"
    >
      {VIEWS.map((view) => (
        <button
          key={view.value}
          role="tab"
          aria-selected={activeView === view.value}
          onClick={() => onChange(view.value)}
          className={cn(
            "flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
            activeView === view.value
              ? "bg-white text-text-main shadow-sm dark:bg-white/10"
              : "text-text-muted hover:text-text-main"
          )}
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
            {view.icon}
          </span>
          {view.label}
        </button>
      ))}
    </div>
  );
}

function HeaderActions({
  setView,
  startCreateRule,
  onPublish,
  onRollback,
}: {
  setView: (view: PrivacyFilterView) => void;
  startCreateRule: () => void;
  onPublish: () => void;
  onRollback: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" icon="science" onClick={() => setView("test")}>
        Open Test Lab
      </Button>
      <Button variant="secondary" icon="add" onClick={startCreateRule}>
        Create Rule
      </Button>
      <Button variant="secondary" icon="difference" onClick={() => setView("releases")}>
        Review Draft
      </Button>
      <Button variant="outline" icon="history" onClick={onRollback}>
        Rollback
      </Button>
      <Button icon="publish" onClick={onPublish}>
        Publish Draft
      </Button>
    </div>
  );
}

function OverviewView({
  workspace,
  setView,
  startCreateRule,
  inspectIncident,
  onPublish,
  onRollback,
}: {
  workspace: PrivacyControlPlaneWorkspace;
  setView: (view: PrivacyFilterView) => void;
  startCreateRule: () => void;
  inspectIncident: (incident: PrivacyIncident) => void;
  onPublish: () => void;
  onRollback: () => void;
}) {
  const { overview } = workspace;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Scanned requests" value={formatNumber(overview.scannedRequests)} icon="shield_scan" tone="text-primary" />
        <StatCard title="Blocked requests" value={formatNumber(overview.blockedRequests)} icon="block" tone="text-red-500" />
        <StatCard title="Transformed requests" value={formatNumber(overview.transformedRequests)} icon="switch_access_shortcut" tone="text-amber-500" />
        <StatCard title="Managed rules" value={formatNumber(overview.managedRules)} icon="rule" tone="text-blue-500" />
        <StatCard title="Active bundle" value={overview.activeBundleVersion} icon="verified" tone="text-green-500" />
      </div>

      <Card padding="sm" className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-text-main">Operational quick actions</p>
          <p className="text-sm text-text-muted">
            Move from runtime visibility into testing, authoring, release review, or rollback.
          </p>
        </div>
        <HeaderActions
          setView={setView}
          startCreateRule={startCreateRule}
          onPublish={onPublish}
          onRollback={onRollback}
        />
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Top source apps" icon="apps">
          {overview.topSourceApps.length === 0 ? (
            <EmptyBlock title="No source traffic yet" description="Runtime events will appear here after clients call the gateway." />
          ) : (
            <div className="space-y-3">
              {overview.topSourceApps.map((source) => (
                <div key={source.key} className="rounded-lg border border-border bg-bg/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-text-main">{source.name}</p>
                      <p className="font-mono text-xs text-text-muted">{source.key}</p>
                    </div>
                    <Badge variant="primary">{formatNumber(source.requests)} requests</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-text-muted">
                    <span>{source.blocked} blocked</span>
                    <span>{source.transformed} transformed</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Latest incidents" icon="policy_alert">
          {overview.latestIncidents.length === 0 ? (
            <EmptyBlock title="No incidents" description="Blocked or unsafe events will be shown with rule and bundle context." />
          ) : (
            <div className="space-y-2">
              {overview.latestIncidents.map((incident) => (
                <button
                  key={incident.id}
                  onClick={() => inspectIncident(incident)}
                  className="w-full rounded-lg border border-border bg-bg/60 p-3 text-left transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-text-main">{incident.id}</span>
                    <ActionBadge action={incident.finalDecision} />
                  </div>
                  <p className="mt-2 text-sm text-text-muted">{incident.sanitizedSnippet}</p>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card title="Bundle health" icon="deployed_code">
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-bg/60 p-3">
              <p className="text-xs uppercase tracking-wide text-text-muted">Publish state</p>
              <p className="mt-1 font-medium text-text-main">{overview.publishState}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-bg p-3">
                <p className="text-xs text-text-muted">Changed entities</p>
                <p className="text-xl font-semibold text-text-main">
                  {overview.bundleHealth.changedEntities}
                </p>
              </div>
              <div className="rounded-lg bg-bg p-3">
                <p className="text-xs text-text-muted">Changed rules</p>
                <p className="text-xl font-semibold text-text-main">
                  {overview.bundleHealth.changedRules}
                </p>
              </div>
            </div>
            {overview.bundleHealth.warnings.length > 0 ? (
              <div className="space-y-2">
                {overview.bundleHealth.warnings.map((warning) => (
                  <div key={warning} className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-300">
                    {warning}
                  </div>
                ))}
              </div>
            ) : (
              <Badge variant="success" dot>
                No blocking policy warnings
              </Badge>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function PolicyStudioView({
  workspace,
  editor,
  selectedRuleId,
  entitySearch,
  setEntitySearch,
  selectRule,
  setEditor,
  saveRule,
  createEntity,
  archiveEntity,
  addDictionarySet,
  testRule,
  setView,
}: {
  workspace: PrivacyControlPlaneWorkspace;
  editor: RuleEditorState | null;
  selectedRuleId: string | null;
  entitySearch: string;
  setEntitySearch: (value: string) => void;
  selectRule: (rule: PrivacyRule) => void;
  setEditor: (editor: RuleEditorState) => void;
  saveRule: () => void;
  createEntity: () => void;
  archiveEntity: (entity: PrivacyEntityType) => void;
  addDictionarySet: () => void;
  testRule: () => void;
  setView: (view: PrivacyFilterView) => void;
}) {
  const config = workspace.config;
  const filteredEntities = config.entityTypes.filter((entity) =>
    `${entity.name} ${entity.id} ${entity.category}`.toLowerCase().includes(entitySearch.toLowerCase())
  );
  const selectedEntity = editor ? getEntity(config, editor.entityTypeId) : null;
  const selectedEffectivePolicies =
    editor && selectedEntity
      ? (workspace.effectivePolicies || []).filter(
          (policy) => policy.entityKey === selectedEntity.id
        )
      : [];
  const impactedSourceApps = [
    ...new Set(selectedEffectivePolicies.map((policy) => policy.sourceName)),
  ];
  const policyWarnings = [
    ...new Set(selectedEffectivePolicies.flatMap((policy) => policy.warnings)),
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
      <Card
        title="Entity Catalog"
        subtitle="Search, group, and archive sensitivity definitions."
        icon="category"
        action={
          <Button size="sm" variant="secondary" icon="add" onClick={createEntity}>
            Add
          </Button>
        }
      >
        <input
          aria-label="Search entities"
          className={inputClass("mb-4 w-full")}
          placeholder="Search entities"
          value={entitySearch}
          onChange={(event) => setEntitySearch(event.target.value)}
        />
        <div className="space-y-2">
          {filteredEntities.map((entity) => (
            <div key={entity.id} className="rounded-lg border border-border bg-bg/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-text-main">{entity.name}</p>
                  <p className="font-mono text-xs text-text-muted">{entity.id}</p>
                </div>
                <LevelBadge level={entity.defaultLevel} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-text-muted">
                <span>{Number((entity as any).usageCount || 0)} uses</span>
                <ActionBadge action={entity.defaultTransform} />
              </div>
              <Button
                className="mt-3"
                size="sm"
                variant="ghost"
                icon="archive"
                onClick={() => archiveEntity(entity)}
              >
                Archive Entity
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Rule Builder" subtitle="Form-first authoring with scoped overrides and matcher preview." icon="rule_settings">
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          {config.rules.map((rule) => (
            <button
              key={rule.id}
              onClick={() => selectRule(rule)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                selectedRuleId === rule.id
                  ? "border-primary bg-primary/10"
                  : "border-border bg-bg/60 hover:border-primary/40"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-text-main">{rule.name}</p>
                  <p className="font-mono text-xs text-text-muted">{rule.id}</p>
                </div>
                <Badge variant={rule.enabled ? "success" : "default"} size="sm">
                  {rule.enabled ? "enabled" : "off"}
                </Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <LevelBadge level={rule.severityLevel} />
                <Badge variant="info" size="sm">
                  {rule.type.toUpperCase()}
                </Badge>
              </div>
            </button>
          ))}
        </div>

        {editor ? (
          <div className="rounded-lg border border-border bg-bg/60 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Rule name">
                <input
                  aria-label="Rule name"
                  className={inputClass()}
                  value={editor.name}
                  onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                />
              </Field>
              <Field label="Rule ID">
                <input
                  aria-label="Rule ID"
                  className={inputClass()}
                  value={editor.id}
                  onChange={(event) => setEditor({ ...editor, id: event.target.value })}
                />
              </Field>
          <Field label="Entity type">
            <select
              aria-label="Entity type"
              className={inputClass()}
                  value={editor.entityTypeId}
                  onChange={(event) => {
                    const entity = getEntity(config, event.target.value);
                    setEditor({
                      ...editor,
                      entityTypeId: event.target.value,
                      severityLevel: entity?.defaultLevel || editor.severityLevel,
                      transformMode: entity?.defaultTransform || editor.transformMode,
                      placeholderPrefix: entity?.placeholderPrefix || editor.placeholderPrefix,
                      restoreMode: entity?.restoreMode || editor.restoreMode,
                    });
                  }}
                >
                {config.entityTypes.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name} ({entity.id})
                  </option>
                ))}
              </select>
            </Field>
              <Field label="Detection method">
                <select
                  aria-label="Detection method"
                  className={inputClass()}
                  value={editor.type}
                  onChange={(event) =>
                    setEditor({ ...editor, type: event.target.value as PrivacyRuleType })
                  }
                >
                  {METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method.toUpperCase()}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sensitivity level">
                <select
                  aria-label="Sensitivity level"
                  className={inputClass()}
                  value={editor.severityLevel}
                  onChange={(event) =>
                    setEditor({ ...editor, severityLevel: event.target.value as PrivacyLevel })
                  }
                >
                  {LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {LEVEL_META[level].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Action">
                <select
                  aria-label="Action"
                  className={inputClass()}
                  value={editor.transformMode}
                  onChange={(event) =>
                    setEditor({ ...editor, transformMode: event.target.value as PrivacyTransformMode })
                  }
                >
                  {ACTIONS.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Matcher pattern">
                <input
                  aria-label="Matcher pattern"
                  className={inputClass()}
                  value={editor.patternConfig.regex || ""}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      patternConfig: { ...editor.patternConfig, regex: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Regex flags">
                <input
                  aria-label="Regex flags"
                  className={inputClass()}
                  value={editor.patternConfig.flags || ""}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      patternConfig: { ...editor.patternConfig, flags: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Confidence threshold">
                <input
                  aria-label="Confidence threshold"
                  className={inputClass()}
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={editor.confidence}
                  onChange={(event) => setEditor({ ...editor, confidence: Number(event.target.value) })}
                />
              </Field>
              <Field label="Priority">
                <input
                  aria-label="Priority"
                  className={inputClass()}
                  type="number"
                  value={editor.priority}
                  onChange={(event) => setEditor({ ...editor, priority: Number(event.target.value) })}
                />
              </Field>
              <Field label="Placeholder prefix">
                <input
                  aria-label="Placeholder prefix"
                  className={inputClass()}
                  value={editor.placeholderPrefix}
                  onChange={(event) => setEditor({ ...editor, placeholderPrefix: event.target.value })}
                />
              </Field>
              <Field label="Restore mode">
                <select
                  aria-label="Restore mode"
                  className={inputClass()}
                  value={editor.restoreMode}
                  onChange={(event) =>
                    setEditor({ ...editor, restoreMode: event.target.value as PrivacyEntityType["restoreMode"] })
                  }
                >
                  <option value="never">Never</option>
                  <option value="session">Session</option>
                </select>
              </Field>
              <Field label="Source scope">
                <input
                  aria-label="Source scope"
                  className={inputClass()}
                  value={editor.scope?.sourceApps?.join(", ") || ""}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      scope: {
                        ...editor.scope,
                        sourceApps: event.target.value
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              </Field>
              <Field label="Profile override scope">
                <input
                  aria-label="Profile override scope"
                  className={inputClass()}
                  value={editor.scope?.profileIds?.join(", ") || ""}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      scope: {
                        ...editor.scope,
                        profileIds: event.target.value
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              </Field>
              <label className="flex items-center gap-2 text-sm font-medium text-text-main">
                <input
                  type="checkbox"
                  checked={editor.enabled}
                  onChange={(event) => setEditor({ ...editor, enabled: event.target.checked })}
                />
                Enabled
              </label>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" icon="science" onClick={testRule}>
                Test this rule
              </Button>
              <Button variant="secondary" icon="account_tree">
                See where used
              </Button>
              <Button icon="save" onClick={saveRule}>
                Save Rule
              </Button>
            </div>
          </div>
        ) : (
          <EmptyBlock title="No rule selected" description="Create or select a rule to begin authoring." />
        )}
      </Card>

      <Card title="Policy Impact" subtitle="Effective behavior summary and warnings." icon="preview">
        {selectedEntity && editor ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-bg/60 p-3">
              <p className="text-xs uppercase tracking-wide text-text-muted">Effective behavior</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <LevelBadge level={editor.severityLevel} />
                <ActionBadge action={editor.transformMode} />
                <Badge variant="default" className="font-mono">
                  {editor.placeholderPrefix}
                </Badge>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-bg/60 p-3">
              <p className="text-xs uppercase tracking-wide text-text-muted">Sample transformation preview</p>
              <p className="mt-2 font-mono text-sm text-text-main">
                {editor.transformMode === "BLOCK"
                  ? "Request blocked before provider call"
                  : editor.transformMode === "MASK"
                    ? `${selectedEntity.name}: [${editor.placeholderPrefix}_MASKED]`
                    : editor.transformMode === "TOKENIZE"
                      ? `${selectedEntity.name}: [${editor.placeholderPrefix}_001]`
                      : `${selectedEntity.name}: unchanged`}
              </p>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-text-main">Effective scoped behavior</p>
                {impactedSourceApps.length > 0 && (
                  <Badge variant="primary" size="sm">
                    {impactedSourceApps.length} source app{impactedSourceApps.length === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
              <div className="space-y-2">
                {selectedEffectivePolicies.length > 0 ? (
                  selectedEffectivePolicies.slice(0, 5).map((policy) => (
                    <div key={`${policy.sourceApp}-${policy.profileId}-${policy.entityKey}`} className="rounded-lg bg-bg px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-text-main">{policy.sourceName}</span>
                      <ActionBadge action={policy.action} />
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      {policy.summary} Level from {policy.levelSource}; action from{" "}
                      {policy.actionSource}.
                    </p>
                  </div>
                  ))
                ) : (
                  <div className="rounded-lg bg-bg px-3 py-2 text-sm text-text-muted">
                    No enabled profile currently applies this entity to an active source app.
                  </div>
                )}
              </div>
              {policyWarnings.length > 0 && (
                <div className="mt-3 space-y-2">
                  {policyWarnings.map((warning) => (
                    <div key={warning} className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300">
                      {warning}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold text-text-main">Profiles and overrides</p>
              <div className="space-y-2">
                {workspace.config.profiles.map((profile) => (
                  <div key={profile.id} className="rounded-lg bg-bg px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-text-main">{profile.name}</span>
                      <Badge variant={profile.enabled ? "success" : "default"} size="sm">
                        {profile.enabled ? "active" : "off"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      {profile.appliesTo.sourceApps?.join(", ") || "all source apps"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-text-main">Dictionary sets</p>
                <Button size="sm" variant="ghost" icon="add" onClick={addDictionarySet}>
                  Add
                </Button>
              </div>
              <div className="space-y-2">
                {workspace.config.documentSets.map((set) => (
                  <div key={set.id} className="rounded-lg bg-bg px-3 py-2">
                    <p className="text-sm font-medium text-text-main">{set.name}</p>
                    <p className="text-xs text-text-muted">
                      {(set as any).termCount ?? set.entries.length} terms · {set.status}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <EmptyBlock title="Select a rule" description="Impact preview updates as you edit the selected rule." />
        )}
      </Card>
    </div>
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

function extractTokens(text: string) {
  return [...new Set(text.match(/\[[A-Z0-9_]+\]/g) || [])];
}

function TestLabView({
  workspace,
  testInput,
  setTestInput,
  testResult,
  runTest,
  testing,
}: {
  workspace: PrivacyControlPlaneWorkspace;
  testInput: PrivacyTestInput;
  setTestInput: (next: PrivacyTestInput) => void;
  testResult: PrivacyTestResult | null;
  runTest: () => void;
  testing: boolean;
}) {
  return (
    <div className="space-y-4">
      <Card title="Test Lab" subtitle="Simulate Detect → Classify → Transform → Validate → Restore before policy release." icon="science">
        <div className="grid gap-3 lg:grid-cols-5">
          <Field label="Input mode">
            <select
              aria-label="Input mode"
              className={inputClass()}
              value={testInput.inputMode}
              onChange={(event) =>
                setTestInput({ ...testInput, inputMode: event.target.value as PrivacyTestInput["inputMode"] })
              }
            >
              <option value="plain-text">Plain text</option>
              <option value="json">JSON request</option>
            </select>
          </Field>
          <Field label="Source app">
            <select
              aria-label="Source app"
              className={inputClass()}
              value={testInput.sourceApp}
              onChange={(event) => setTestInput({ ...testInput, sourceApp: event.target.value })}
            >
              {workspace.sourceApps.map((source) => (
                <option key={source.key} value={source.key}>
                  {source.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Profile">
            <select
              aria-label="Profile"
              className={inputClass()}
              value={testInput.profileId || ""}
              onChange={(event) => setTestInput({ ...testInput, profileId: event.target.value })}
            >
              {workspace.config.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bundle">
            <select
              aria-label="Bundle"
              className={inputClass()}
              value={testInput.bundleVersion || workspace.overview.activeBundleVersion}
              onChange={(event) => setTestInput({ ...testInput, bundleVersion: event.target.value })}
            >
              {workspace.bundles.map((bundle) => (
                <option key={bundle.id} value={bundle.version}>
                  {bundle.version}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <Button fullWidth icon="play_arrow" loading={testing} onClick={runTest}>
              Run Test
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Raw input" icon="input">
          <textarea
            aria-label="Raw request input"
            className={inputClass("min-h-72 w-full resize-y p-3 font-mono")}
            value={testInput.rawInput}
            onChange={(event) => setTestInput({ ...testInput, rawInput: event.target.value })}
          />
        </Card>
        <Card title="Sanitized output" icon="output">
          <pre className="min-h-72 whitespace-pre-wrap rounded-lg border border-border bg-bg p-3 font-mono text-sm text-text-main">
            {testResult?.sanitizedOutput || "Run a test to preview sanitized output."}
          </pre>
          {testResult && extractTokens(testResult.sanitizedOutput).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {extractTokens(testResult.sanitizedOutput).map((token) => (
                <Badge key={token} variant="info" className="font-mono">
                  {token}
                </Badge>
              ))}
            </div>
          )}
        </Card>
      </div>

      {testResult ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <Card title="Explainability timeline" icon="timeline">
            <div className="grid gap-3 md:grid-cols-5">
              {testResult.pipeline.map((step) => (
                <div key={step.step} className="rounded-lg border border-border bg-bg/60 p-3">
                  <p className="font-semibold text-text-main">{step.step}</p>
                  <Badge className="mt-2" variant={step.status === "blocked" ? "error" : step.status === "passed" ? "success" : "info"} size="sm">
                    {step.status}
                  </Badge>
                  <p className="mt-2 text-xs text-text-muted">{step.detail}</p>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Final decision" icon="route">
            <div className="space-y-3">
              <ActionBadge action={testResult.decision} />
              <p className="text-sm text-text-muted">{testResult.routeDecision.reason}</p>
              <div className="rounded-lg bg-bg p-3">
                <p className="text-xs uppercase tracking-wide text-text-muted">Validator result</p>
                <p className="mt-1 font-medium text-text-main">
                  {testResult.validator.passed ? "Passed" : "Failed"} · confidence{" "}
                  {Math.round((testResult.validator.confidenceScore || 0) * 100)}%
                </p>
              </div>
            </div>
          </Card>
          <Card title="Detected entities" icon="find_in_page">
            <div className="space-y-2">
              {testResult.detectedEntities.map((entity, index) => (
                <div key={`${entity.ruleId}-${entity.start}-${index}`} className="rounded-lg border border-border bg-bg/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <LevelBadge level={entity.level} />
                    <ActionBadge action={entity.action} />
                    <span className="font-medium text-text-main">{entity.entityLabel}</span>
                  </div>
                  <p className="mt-2 font-mono text-sm text-text-main">{entity.text}</p>
                  <p className="mt-1 text-xs text-text-muted">{entity.rationale}</p>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Matched rules and restore tokens" icon="vpn_key">
            <div className="space-y-3">
              {testResult.matchedRules.map((rule) => (
                <div key={rule.id} className="flex items-center justify-between rounded-lg bg-bg px-3 py-2">
                  <div>
                    <p className="font-medium text-text-main">{rule.name}</p>
                    <p className="font-mono text-xs text-text-muted">{rule.id}</p>
                  </div>
                  <ActionBadge action={rule.action} />
                </div>
              ))}
              {testResult.restoreTokens.length > 0 && (
                <div className="rounded-lg border border-border bg-bg/60 p-3">
                  <p className="text-sm font-semibold text-text-main">Restore token metadata</p>
                  {testResult.restoreTokens.map((token) => (
                    <div key={token.token} className="mt-2 text-xs text-text-muted">
                      <span className="font-mono text-text-main">Token {token.token}</span>{" "}
                      expires {formatTime(token.expiresAt)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      ) : (
        <EmptyBlock title="No test run yet" description="Use a blocked, allowed, masked, or tokenized example to explain every decision in the pipeline." />
      )}
    </div>
  );
}

function IncidentsView({
  workspace,
  filters,
  setFilters,
  inspectIncident,
}: {
  workspace: PrivacyControlPlaneWorkspace;
  filters: IncidentFiltersState;
  setFilters: (filters: IncidentFiltersState) => void;
  inspectIncident: (incident: PrivacyIncident) => void;
}) {
  const sourceOptions = [...new Set(workspace.incidents.map((incident) => incident.sourceApp))];
  const bundleOptions = [...new Set(workspace.incidents.map((incident) => incident.bundleVersion))];
  const incidents = workspace.incidents.filter((incident) => {
    const queryMatches =
      !filters.query ||
      `${incident.id} ${incident.sourceApp} ${incident.finalDecision} ${incident.bundleVersion} ${incident.matchedRuleIds.join(" ")}`
        .toLowerCase()
        .includes(filters.query.toLowerCase());
    const sourceMatches = !filters.sourceApp || incident.sourceApp === filters.sourceApp;
    const levelMatches = !filters.level || incident.highestLevel === filters.level;
    const actionMatches = !filters.action || incident.finalDecision === filters.action;
    const bundleMatches = !filters.bundleVersion || incident.bundleVersion === filters.bundleVersion;
    const statusMatches = !filters.status || incident.finalStatus === filters.status;

    return (
      queryMatches &&
      sourceMatches &&
      levelMatches &&
      actionMatches &&
      bundleMatches &&
      statusMatches
    );
  });

  return (
    <Card title="Incidents" subtitle="Investigate blocked, transformed, and unsafe events." icon="policy_alert">
      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_repeat(5,150px)]">
        <input
          aria-label="Search incidents"
          className={inputClass()}
          placeholder="Search source app, entity, level, action, rule, bundle"
          value={filters.query}
          onChange={(event) => setFilters({ ...filters, query: event.target.value })}
        />
        <select
          aria-label="Filter source app"
          className={inputClass()}
          value={filters.sourceApp}
          onChange={(event) => setFilters({ ...filters, sourceApp: event.target.value })}
        >
          <option value="">All apps</option>
          {sourceOptions.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter level"
          className={inputClass()}
          value={filters.level}
          onChange={(event) => setFilters({ ...filters, level: event.target.value })}
        >
          <option value="">All levels</option>
          {LEVELS.map((level) => (
            <option key={level} value={level}>{level}</option>
          ))}
        </select>
        <select
          aria-label="Filter action"
          className={inputClass()}
          value={filters.action}
          onChange={(event) => setFilters({ ...filters, action: event.target.value })}
        >
          <option value="">All actions</option>
          <option value="blocked">blocked</option>
          <option value="transformed">transformed</option>
          <option value="allow">allow</option>
        </select>
        <select
          aria-label="Filter bundle"
          className={inputClass()}
          value={filters.bundleVersion}
          onChange={(event) => setFilters({ ...filters, bundleVersion: event.target.value })}
        >
          <option value="">All bundles</option>
          {bundleOptions.map((bundle) => (
            <option key={bundle} value={bundle}>
              {bundle}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter status"
          className={inputClass()}
          value={filters.status}
          onChange={(event) => setFilters({ ...filters, status: event.target.value })}
        >
          <option value="">All status</option>
          <option value="open">open</option>
          <option value="reviewed">reviewed</option>
          <option value="resolved">resolved</option>
        </select>
      </div>

      {incidents.length === 0 ? (
        <EmptyBlock title="No matching incidents" description="Change filters or run the Test Lab to inspect policy behavior." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-4">Incident</th>
                <th className="py-2 pr-4">Source app</th>
                <th className="py-2 pr-4">Level</th>
                <th className="py-2 pr-4">Decision</th>
                <th className="py-2 pr-4">Bundle</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Time</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
                <tr key={incident.id} className="border-b border-border/70">
                  <td className="py-3 pr-4 font-mono text-text-main">{incident.id}</td>
                  <td className="py-3 pr-4"><SourceAppBadge source={incident.sourceApp} /></td>
                  <td className="py-3 pr-4"><LevelBadge level={incident.highestLevel} /></td>
                  <td className="py-3 pr-4"><ActionBadge action={incident.finalDecision} /></td>
                  <td className="py-3 pr-4 font-mono text-xs text-text-muted">{incident.bundleVersion}</td>
                  <td className="py-3 pr-4">
                    <Badge variant={incident.finalStatus === "open" ? "warning" : "success"} size="sm">
                      {incident.finalStatus}
                    </Badge>
                  </td>
                  <td className="py-3 pr-4 text-text-muted">{formatTime(incident.timestamp)}</td>
                  <td className="py-3 pr-4 text-right">
                    <Button size="sm" variant="secondary" onClick={() => inspectIncident(incident)}>
                      Inspect {incident.id}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function IncidentDetailPanel({
  incident,
  setView,
  openIncidentInTest,
  inspectRule,
}: {
  incident: PrivacyIncident | null;
  setView: (view: PrivacyFilterView) => void;
  openIncidentInTest: (incident: PrivacyIncident) => void;
  inspectRule: (ruleId: string) => void;
}) {
  if (!incident) return null;

  return (
    <Card className="mt-4" title={`Incident ${incident.id}`} icon="manage_search">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">Secure raw snippet</p>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-bg p-3 text-sm text-text-main">
            {incident.requestSnippet}
          </pre>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">Sanitized snippet</p>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-bg p-3 text-sm text-text-main">
            {incident.sanitizedSnippet}
          </pre>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg bg-bg p-3">
          <p className="text-xs text-text-muted">Validator</p>
          <p className="mt-1 font-medium text-text-main">
            {incident.validatorResult.passed ? "Passed" : "Needs review"}
          </p>
        </div>
        <div className="rounded-lg bg-bg p-3">
          <p className="text-xs text-text-muted">Matched rules</p>
          <p className="mt-1 font-mono text-sm text-text-main">{incident.matchedRuleIds.join(", ")}</p>
        </div>
        <div className="rounded-lg bg-bg p-3">
          <p className="text-xs text-text-muted">Provider route</p>
          <p className="mt-1 font-medium text-text-main">
            {incident.finalDecision === "blocked" ? "No provider call" : "Provider route continued"}
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {incident.timeline.map((step) => (
          <div key={`${incident.id}-${step.step}`} className="rounded-lg border border-border bg-bg/60 p-3">
            <p className="font-semibold text-text-main">{step.step}</p>
            <p className="text-sm text-text-muted">{step.detail}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" icon="science" onClick={() => openIncidentInTest(incident)}>
          Open in Test Lab
        </Button>
        <Button
          variant="secondary"
          icon="rule"
          onClick={() => inspectRule(incident.matchedRuleIds[0] || "")}
          disabled={incident.matchedRuleIds.length === 0}
        >
          Inspect Rule
        </Button>
        <Button variant="secondary" icon="difference" onClick={() => setView("releases")}>
          Compare Bundle
        </Button>
      </div>
    </Card>
  );
}

function ReleasesView({
  workspace,
  onPublish,
  onRollback,
}: {
  workspace: PrivacyControlPlaneWorkspace;
  onPublish: () => void;
  onRollback: () => void;
}) {
  const active = workspace.bundles.find((bundle) => bundle.status === "active");
  const draft = workspace.bundles.find((bundle) => bundle.status === "draft");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Active bundle" icon="verified">
          <p className="font-mono text-lg font-semibold text-text-main">
            {active?.version || workspace.overview.activeBundleVersion}
          </p>
          <p className="mt-2 text-sm text-text-muted">{active?.notes || "Currently active policy."}</p>
          <p className="mt-3 text-xs text-text-muted">Published {formatTime(active?.publishedAt)}</p>
        </Card>
        <Card title="Draft bundle" icon="edit_document">
          <p className="font-mono text-lg font-semibold text-text-main">
            {draft?.version || workspace.overview.bundleHealth.draftVersion}
          </p>
          <p className="mt-2 text-sm text-text-muted">{draft?.notes || "No unpublished draft changes."}</p>
          <div className="mt-3 flex gap-2">
            <Badge variant={workspace.overview.bundleHealth.changedEntities > 0 ? "warning" : "success"}>
              {workspace.overview.bundleHealth.changedEntities} entities
            </Badge>
            <Badge variant={workspace.overview.bundleHealth.changedRules > 0 ? "warning" : "success"}>
              {workspace.overview.bundleHealth.changedRules} rules
            </Badge>
          </div>
        </Card>
      </div>

      <Card title="Draft vs Active" subtitle="Review impact before publishing live policy." icon="difference">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-bg/60 p-4">
            <p className="text-sm font-semibold text-text-main">Active</p>
            <ul className="mt-3 space-y-2 text-sm text-text-muted">
              <li>Active reference: {workspace.overview.activeBundleVersion}</li>
              <li>{workspace.config.entityTypes.length - workspace.overview.bundleHealth.changedEntities} unchanged entity references</li>
              <li>{workspace.config.rules.length - workspace.overview.bundleHealth.changedRules} unchanged rule references</li>
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-bg/60 p-4">
            <p className="text-sm font-semibold text-text-main">Draft impact</p>
            <ul className="mt-3 space-y-2 text-sm text-text-muted">
              <li>{workspace.overview.bundleHealth.changedEntities} changed entity definitions</li>
              <li>{workspace.overview.bundleHealth.changedRules} changed detection rules</li>
              <li>{workspace.sourceApps.length} source apps potentially affected</li>
            </ul>
          </div>
        </div>
        {workspace.overview.bundleHealth.warnings.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-300">
            {workspace.overview.bundleHealth.warnings.join(" · ")}
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" icon="history" onClick={onRollback}>
            Rollback Active Bundle
          </Button>
          <Button icon="publish" onClick={onPublish}>
            Publish Draft
          </Button>
        </div>
      </Card>

      <Card title="Version history" icon="history">
        <div className="space-y-2">
          {workspace.bundles.map((bundle) => (
            <div key={bundle.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg/60 px-3 py-2">
              <div>
                <p className="font-mono text-sm text-text-main">Version {bundle.version}</p>
                <p className="text-xs text-text-muted">{bundle.notes}</p>
              </div>
              <Badge variant={bundle.status === "active" ? "success" : bundle.status === "draft" ? "warning" : "default"}>
                {bundle.status}
              </Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function SettingsView({
  settings,
  setSettings,
  saveSettings,
}: {
  settings: PrivacySettings;
  setSettings: (settings: PrivacySettings) => void;
  saveSettings: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-text-main">Privacy Filter Settings</h2>
        <p className="mt-1 text-sm text-text-muted">
          Global controls for vault, restore, validation, fallback, retention, and release access.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsSection title="Entity Vault" icon="database">
          <label className="flex items-center justify-between gap-3 text-sm text-text-main">
            Vault enabled
            <input
              type="checkbox"
              checked={settings.vaultEnabled}
              onChange={(event) => setSettings({ ...settings, vaultEnabled: event.target.checked })}
            />
          </label>
          <Field label="Token TTL seconds">
            <input
              aria-label="Token TTL seconds"
              className={inputClass()}
              type="number"
              value={settings.tokenTtlSeconds}
              onChange={(event) => setSettings({ ...settings, tokenTtlSeconds: Number(event.target.value) })}
            />
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm text-text-main">
            Auto-expire restore tokens
            <input
              type="checkbox"
              checked={settings.autoExpireRestoreTokens}
              onChange={(event) =>
                setSettings({ ...settings, autoExpireRestoreTokens: event.target.checked })
              }
            />
          </label>
        </SettingsSection>
        <SettingsSection title="Key Rotation" icon="key">
          <label className="flex items-center justify-between gap-3 text-sm text-text-main">
            Encryption required
            <input
              type="checkbox"
              checked={settings.encryptionRequired}
              onChange={(event) =>
                setSettings({ ...settings, encryptionRequired: event.target.checked })
              }
            />
          </label>
          <Field label="Rotation interval days">
            <input
              aria-label="Rotation interval days"
              className={inputClass()}
              type="number"
              value={settings.keyRotationDays}
              onChange={(event) => setSettings({ ...settings, keyRotationDays: Number(event.target.value) })}
            />
          </Field>
        </SettingsSection>
        <SettingsSection title="Validator Defaults" icon="fact_check">
          <Field label="Validator mode">
            <select
              aria-label="Validator mode"
              className={inputClass()}
              value={settings.validatorMode}
              onChange={(event) =>
                setSettings({ ...settings, validatorMode: event.target.value as PrivacySettings["validatorMode"] })
              }
            >
              <option value="strict">Strict</option>
              <option value="balanced">Balanced</option>
              <option value="observe">Observe</option>
            </select>
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm text-text-main">
            Fallback to local LLM when unsafe
            <input
              type="checkbox"
              checked={settings.fallbackToLocalLlm}
              onChange={(event) =>
                setSettings({ ...settings, fallbackToLocalLlm: event.target.checked })
              }
            />
          </label>
        </SettingsSection>
        <SettingsSection title="Audit Retention" icon="inventory">
          <Field label="Audit retention days">
            <input
              aria-label="Audit retention days"
              className={inputClass()}
              type="number"
              value={settings.auditRetentionDays}
              onChange={(event) =>
                setSettings({ ...settings, auditRetentionDays: Number(event.target.value) })
              }
            />
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm text-text-main">
            Publish restricted to admins
            <input
              type="checkbox"
              checked={settings.publishRestrictedToAdmins}
              onChange={(event) =>
                setSettings({ ...settings, publishRestrictedToAdmins: event.target.checked })
              }
            />
          </label>
        </SettingsSection>
      </div>
      <div className="flex justify-end">
        <Button icon="save" onClick={saveSettings}>
          Save Settings
        </Button>
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <Card title={title} icon={icon}>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

export default function PrivacyFilterPageClient({
  initialView = "overview",
}: {
  initialView?: PrivacyFilterView;
}) {
  const [workspace, setWorkspace] = useState<PrivacyControlPlaneWorkspace | null>(null);
  const [activeView, setActiveView] = useState<PrivacyFilterView>(initialView);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [ruleEditor, setRuleEditor] = useState<RuleEditorState | null>(null);
  const [entitySearch, setEntitySearch] = useState("");
  const [incidentFilters, setIncidentFilters] = useState<IncidentFiltersState>({
    query: "",
    sourceApp: "",
    level: "",
    action: "",
    bundleVersion: "",
    status: "",
  });
  const [selectedIncident, setSelectedIncident] = useState<PrivacyIncident | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<PrivacySettings | null>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showRollbackModal, setShowRollbackModal] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState("");
  const [testInput, setTestInput] = useState<PrivacyTestInput>({
    inputMode: "plain-text",
    rawInput: "Please review OCB-PRJ-123 with ana@example.com before sending to the model.",
    sourceApp: "openwebui",
    profileId: "default-external",
  });
  const [testResult, setTestResult] = useState<PrivacyTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  async function loadWorkspace() {
    setLoading(true);
    setError(null);
    try {
      const json = await privacyFilterService.getPrivacyControlPlaneWorkspace();
      setWorkspace(json);
      setSettingsDraft(json.settings);
      const firstRule = json.config.rules[0];
      if (firstRule) {
        setSelectedRuleId(firstRule.id);
        setRuleEditor(createRuleEditor(firstRule, json.config));
      }
      setTestInput((current) => ({
        ...current,
        sourceApp: current.sourceApp || json.sourceApps[0]?.key || "direct-api",
        profileId: current.profileId || json.config.profiles[0]?.id,
        bundleVersion: current.bundleVersion || json.overview.activeBundleVersion,
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Privacy Filter");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

  function changeView(view: PrivacyFilterView) {
    setActiveView(view);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `/dashboard/privacy-filter/${view}`);
    }
  }

  function startCreateRule() {
    if (!workspace) return;
    const next = createDefaultRule(workspace.config);
    setSelectedRuleId(next.id);
    setRuleEditor(next);
    changeView("policy");
  }

  function selectRule(rule: PrivacyRule) {
    if (!workspace) return;
    setSelectedRuleId(rule.id);
    setRuleEditor(createRuleEditor(rule, workspace.config));
  }

  function selectRuleById(ruleId: string) {
    if (!workspace || !ruleId) return;
    const rule = workspace.config.rules.find((candidate) => candidate.id === ruleId);
    if (!rule) return;
    selectRule(rule);
    changeView("policy");
  }

  function openIncidentInTest(incident: PrivacyIncident) {
    setSelectedIncident(incident);
    setTestInput((current) => ({
      ...current,
      inputMode: "plain-text",
      rawInput: incident.requestSnippet,
      sourceApp: incident.sourceApp,
      bundleVersion: incident.bundleVersion,
    }));
    setTestResult(null);
    changeView("test");
  }

  function testCurrentRule() {
    if (!workspace || !ruleEditor) {
      changeView("test");
      return;
    }
    const entity = getEntity(workspace.config, ruleEditor.entityTypeId);
    const sample =
      ruleEditor.patternConfig.regex?.includes("@")
        ? "Please review ana@example.com before provider routing."
        : entity?.defaultTransform === "BLOCK"
          ? "Please process 1234567890123 before the provider call."
          : entity?.defaultTransform === "TOKENIZE"
            ? "Please summarize OCB-PRJ-123 for the project team."
            : `Please inspect ${entity?.name || "this value"} before sending.`;

    setTestInput((current) => ({
      ...current,
      inputMode: "plain-text",
      rawInput: sample,
      bundleVersion: current.bundleVersion || workspace.overview.activeBundleVersion,
      sourceApp: ruleEditor.scope?.sourceApps?.[0] || current.sourceApp,
      profileId: ruleEditor.scope?.profileIds?.[0] || current.profileId,
    }));
    setTestResult(null);
    changeView("test");
  }

  async function patchWorkspace(body: PrivacyControlPlanePatch, successMessage: string) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const json = await privacyFilterService.patchPrivacyControlPlaneWorkspace(body);
      setWorkspace(json);
      setSettingsDraft(json.settings);
      setNotice(successMessage);
      return json as PrivacyControlPlaneWorkspace;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save Privacy Filter changes");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveRule() {
    if (!workspace || !ruleEditor) return;
    const nextRule = toRule(ruleEditor);
    const existing = workspace.config.rules.some((rule) => rule.id === selectedRuleId);
    const rules = existing
      ? workspace.config.rules.map((rule) => (rule.id === selectedRuleId ? nextRule : rule))
      : [...workspace.config.rules, nextRule];
    const entityTypes = workspace.config.entityTypes.map((entity) =>
      entity.id === ruleEditor.entityTypeId
        ? {
            ...entity,
            defaultLevel: ruleEditor.severityLevel,
            defaultTransform: ruleEditor.transformMode,
            placeholderPrefix: ruleEditor.placeholderPrefix,
            restoreMode: ruleEditor.restoreMode,
          }
        : entity
    );
    const updated = await patchWorkspace({ rules, entityTypes }, "Rule saved to draft policy");
    const savedRule = updated?.config.rules.find((rule) => rule.id === nextRule.id);
    if (updated && savedRule) {
      setSelectedRuleId(savedRule.id);
      setRuleEditor(createRuleEditor(savedRule, updated.config));
    }
  }

  async function createEntity() {
    if (!workspace) return;
    const entity: PrivacyEntityType = {
      id: createId("custom-entity", "entity"),
      name: "Custom Entity",
      category: "custom",
      defaultLevel: "L3",
      defaultTransform: "MASK",
      restoreMode: "never",
      placeholderPrefix: "CUSTOM",
      enabled: true,
    };
    await patchWorkspace(
      { entityTypes: [...workspace.config.entityTypes, entity] },
      "Entity added to draft policy"
    );
  }

  async function archiveEntity(entity: PrivacyEntityType) {
    if (!workspace) return;
    await patchWorkspace(
      {
        entityTypes: workspace.config.entityTypes.map((item) =>
          item.id === entity.id ? { ...item, enabled: false } : item
        ),
      },
      "Entity archived in draft policy"
    );
  }

  async function addDictionarySet() {
    if (!workspace) return;
    await patchWorkspace(
      {
        documentSets: [
          ...workspace.config.documentSets,
          {
            id: createId("dictionary-set", "dict"),
            name: "New Dictionary Set",
            documentClass: "internal",
            businessDomain: "general",
            sourceType: "manual",
            version: 1,
            status: "draft",
            entries: [],
          },
        ],
      },
      "Dictionary set added to draft policy"
    );
  }

  async function runTest() {
    setTesting(true);
    setError(null);
    try {
      const result = await privacyFilterService.runPrivacyFilterTest(testInput);
      setTestResult(result);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Failed to run privacy test");
    } finally {
      setTesting(false);
    }
  }

  async function publishDraft() {
    setSaving(true);
    setError(null);
    try {
      const json = await privacyFilterService.publishPrivacyBundle(releaseNotes);
      setWorkspace(json.workspace || workspace);
      setNotice(`Published ${json.activeBundle?.version || "privacy bundle"}`);
      setShowPublishModal(false);
      setReleaseNotes("");
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "Failed to publish bundle");
    } finally {
      setSaving(false);
    }
  }

  async function rollbackActive() {
    if (!workspace) return;
    const target =
      workspace.bundles.find((bundle) => bundle.status === "archived") ||
      workspace.bundles.find((bundle) => bundle.status === "active");
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      const json = await privacyFilterService.rollbackPrivacyBundle(target.version);
      setWorkspace(json.workspace || workspace);
      setNotice(`Rolled back to ${json.activeBundle?.version || target.version}`);
      setShowRollbackModal(false);
    } catch (rollbackError) {
      setError(rollbackError instanceof Error ? rollbackError.message : "Failed to rollback bundle");
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings() {
    if (!settingsDraft) return;
    await patchWorkspace({ settings: settingsDraft }, "Privacy Filter settings saved");
  }

  let body: React.ReactNode = null;
  if (workspace && settingsDraft) {
    if (activeView === "overview") {
      body = (
        <OverviewView
          workspace={workspace}
          setView={changeView}
          startCreateRule={startCreateRule}
          inspectIncident={(incident) => {
            setSelectedIncident(incident);
            changeView("incidents");
          }}
          onPublish={() => setShowPublishModal(true)}
          onRollback={() => setShowRollbackModal(true)}
        />
      );
    } else if (activeView === "policy") {
      body = (
        <PolicyStudioView
          workspace={workspace}
          editor={ruleEditor}
          selectedRuleId={selectedRuleId}
          entitySearch={entitySearch}
          setEntitySearch={setEntitySearch}
          selectRule={selectRule}
          setEditor={setRuleEditor}
          saveRule={saveRule}
          createEntity={createEntity}
          archiveEntity={archiveEntity}
          addDictionarySet={addDictionarySet}
          setView={changeView}
        />
      );
    } else if (activeView === "test") {
      body = (
        <TestLabView
          workspace={workspace}
          testInput={testInput}
          setTestInput={setTestInput}
          testResult={testResult}
          runTest={runTest}
          testing={testing}
        />
      );
    } else if (activeView === "incidents") {
      body = (
        <>
          <IncidentsView
            workspace={workspace}
            filter={incidentFilter}
            setFilter={setIncidentFilter}
            inspectIncident={setSelectedIncident}
          />
          <IncidentDetailPanel incident={selectedIncident} setView={changeView} />
        </>
      );
    } else if (activeView === "releases") {
      body = (
        <ReleasesView
          workspace={workspace}
          onPublish={() => setShowPublishModal(true)}
          onRollback={() => setShowRollbackModal(true)}
        />
      );
    } else {
      body = (
        <SettingsView
          settings={settingsDraft}
          setSettings={setSettingsDraft}
          saveSettings={saveSettings}
        />
      );
    }
  }

  return (
    <div data-testid="privacy-filter-page" className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-text-main">Privacy Filter</h1>
          <p className="mt-2 max-w-3xl text-sm text-text-muted">
            Operate outbound AI privacy controls with runtime visibility, policy authoring,
            explainable tests, incident investigation, releases, and safety settings.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="refresh" onClick={loadWorkspace} loading={loading}>
            Refresh
          </Button>
          <Button icon="add" onClick={startCreateRule} disabled={!workspace}>
            New Rule
          </Button>
        </div>
      </div>

      <PrivacyFilterTabs activeView={activeView} onChange={changeView} />

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-600 dark:text-green-300">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="h-36 animate-pulse" />
          ))}
        </div>
      ) : (
        body
      )}

      <Modal
        isOpen={showPublishModal}
        onClose={() => setShowPublishModal(false)}
        title="Publish privacy bundle"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowPublishModal(false)} disabled={saving}>
              Cancel
            </Button>
            <Button icon="publish" loading={saving} onClick={publishDraft}>
              Publish Bundle
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            This publishes draft policy changes to the live outbound AI path.
          </p>
          <Field label="Release notes">
            <textarea
              aria-label="Release notes"
              className={inputClass("min-h-28 p-3")}
              value={releaseNotes}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setReleaseNotes(event.target.value)}
              placeholder="Explain why this policy is safe to publish."
            />
          </Field>
        </div>
      </Modal>

      <Modal
        isOpen={showRollbackModal}
        onClose={() => setShowRollbackModal(false)}
        title="Rollback privacy bundle"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowRollbackModal(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="danger" icon="history" loading={saving} onClick={rollbackActive}>
              Rollback Bundle
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-muted">
          Rollback activates the previous available bundle and restores its compiled policy for
          outbound AI requests.
        </p>
      </Modal>
    </div>
  );
}
