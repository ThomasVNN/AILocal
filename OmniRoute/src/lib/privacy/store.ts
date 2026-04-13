import { createHash } from "crypto";
import { backupDbFile } from "@/lib/db/backup";
import { getDbInstance } from "@/lib/db/core";
import { decrypt, encrypt } from "@/lib/db/encryption";
import { createDefaultPrivacyBundle, createDefaultPrivacyConfig } from "./defaultConfig";
import type {
  PrivacyBundleRecord,
  PrivacyConfig,
  PrivacyRestoreEntityValue,
  PrivacyRuntimeEvent,
} from "./types";

const CONFIG_NAMESPACE = "privacy";
const CONFIG_KEY = "config";
const ACTIVE_BUNDLE_KEY = "activeBundleVersion";
const BUNDLE_NAMESPACE = "privacyBundles";

type KeyValueRow = {
  value?: unknown;
};

function getJson<T>(namespace: string, key: string): T | null {
  const db = getDbInstance();
  const row = db
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get(namespace, key) as KeyValueRow | undefined;

  if (!row || typeof row.value !== "string") {
    return null;
  }

  return JSON.parse(row.value) as T;
}

function putJson(namespace: string, key: string, value: unknown) {
  const db = getDbInstance();
  db.prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
    namespace,
    key,
    JSON.stringify(value)
  );
}

function checksumFor(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function ensurePrivacySeedData() {
  const db = getDbInstance();
  const existingConfig = getJson<PrivacyConfig>(CONFIG_NAMESPACE, CONFIG_KEY);
  if (existingConfig) {
    return existingConfig;
  }

  const config = createDefaultPrivacyConfig();
  const bundle = createDefaultPrivacyBundle(config);
  bundle.checksum = checksumFor(bundle.compiledBundle);

  const tx = db.transaction(() => {
    putJson(CONFIG_NAMESPACE, CONFIG_KEY, config);
    putJson(BUNDLE_NAMESPACE, bundle.version, bundle);
    putJson(CONFIG_NAMESPACE, ACTIVE_BUNDLE_KEY, bundle.version);
  });
  tx();
  backupDbFile("pre-write");

  return config;
}

export async function getPrivacyConfig(): Promise<PrivacyConfig> {
  const seeded = ensurePrivacySeedData();
  return seeded;
}

export async function updatePrivacyConfig(updates: Partial<PrivacyConfig>): Promise<PrivacyConfig> {
  const db = getDbInstance();
  const current = await getPrivacyConfig();
  const next: PrivacyConfig = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  const tx = db.transaction(() => {
    putJson(CONFIG_NAMESPACE, CONFIG_KEY, next);
  });
  tx();
  backupDbFile("pre-write");

  return next;
}

export async function getPrivacyBundle(version: string): Promise<PrivacyBundleRecord | null> {
  ensurePrivacySeedData();
  return getJson<PrivacyBundleRecord>(BUNDLE_NAMESPACE, version);
}

export async function listPrivacyBundles(): Promise<PrivacyBundleRecord[]> {
  ensurePrivacySeedData();
  const db = getDbInstance();
  const rows = db
    .prepare("SELECT value FROM key_value WHERE namespace = ? ORDER BY key DESC")
    .all(BUNDLE_NAMESPACE) as KeyValueRow[];

  return rows
    .filter((row) => typeof row.value === "string")
    .map((row) => JSON.parse(String(row.value)) as PrivacyBundleRecord);
}

export async function getActivePrivacyBundle(): Promise<PrivacyBundleRecord> {
  ensurePrivacySeedData();
  const activeVersion = getJson<string>(CONFIG_NAMESPACE, ACTIVE_BUNDLE_KEY);

  if (!activeVersion) {
    const seededBundle = createDefaultPrivacyBundle(await getPrivacyConfig());
    seededBundle.checksum = checksumFor(seededBundle.compiledBundle);
    return seededBundle;
  }

  const bundle = await getPrivacyBundle(activeVersion);
  if (bundle) {
    return bundle;
  }

  const fallbackBundle = createDefaultPrivacyBundle(await getPrivacyConfig());
  fallbackBundle.checksum = checksumFor(fallbackBundle.compiledBundle);
  return fallbackBundle;
}

export async function activatePrivacyBundle(input: {
  version: string;
  changeSummary?: string;
  compiledBundle?: PrivacyConfig;
  compiledBy?: string;
}): Promise<PrivacyBundleRecord> {
  const db = getDbInstance();
  const compiledBundle = input.compiledBundle || (await getPrivacyConfig());
  const bundle: PrivacyBundleRecord = {
    version: input.version,
    status: "active",
    checksum: checksumFor(compiledBundle),
    compiledAt: new Date().toISOString(),
    compiledBy: input.compiledBy || "system",
    changeSummary: input.changeSummary || "Manual activation",
    compiledBundle,
  };

  const tx = db.transaction(() => {
    putJson(BUNDLE_NAMESPACE, bundle.version, bundle);
    putJson(CONFIG_NAMESPACE, ACTIVE_BUNDLE_KEY, bundle.version);
  });
  tx();
  backupDbFile("pre-write");

  return bundle;
}

export async function recordPrivacyRuntimeEvent(event: PrivacyRuntimeEvent) {
  const db = getDbInstance();
  db.prepare(
    `INSERT OR REPLACE INTO privacy_runtime_events (
      id, timestamp, request_id, source_app, policy_profile_id, decision,
      blocked_count, masked_count, tokenized_count, allow_count, bundle_version,
      entity_summary, validator
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    event.timestamp,
    event.requestId,
    event.sourceApp,
    event.policyProfileId,
    event.decision,
    event.blockedCount,
    event.maskedCount,
    event.tokenizedCount,
    event.allowCount,
    event.bundleVersion,
    event.entitySummary,
    event.validator
  );
}

export async function createPrivacyRestoreSession(input: {
  requestId: string;
  sourceApp: string;
  policyProfileId: string;
  bundleVersion: string;
  stream: boolean;
  expiresAt: string;
  values: PrivacyRestoreEntityValue[];
}) {
  const db = getDbInstance();
  const sessionId = `prs_${createHash("sha1")
    .update(`${input.requestId}:${input.bundleVersion}:${Date.now()}`)
    .digest("hex")
    .slice(0, 16)}`;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO privacy_restore_sessions (
        id, request_id, source_app, policy_profile_id, bundle_version, expires_at, stream, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      input.requestId,
      input.sourceApp,
      input.policyProfileId,
      input.bundleVersion,
      input.expiresAt,
      input.stream ? 1 : 0,
      JSON.stringify({ entityCount: input.values.length })
    );

    const insertEntity = db.prepare(
      `INSERT INTO privacy_restore_entities (
        id, session_id, placeholder, encrypted_value, entity_type, level, transform_mode, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const value of input.values) {
      insertEntity.run(
        randomId("pre"),
        sessionId,
        value.placeholder,
        encrypt(value.originalValue),
        value.entityType,
        value.level,
        value.transformMode,
        now,
        input.expiresAt
      );
    }
  });

  tx();
  return sessionId;
}

export async function getPrivacyRestoreSessionValues(sessionId: string) {
  const db = getDbInstance();
  const rows = db
    .prepare(
      `SELECT placeholder, encrypted_value, entity_type, level, transform_mode
       FROM privacy_restore_entities
       WHERE session_id = ? AND expires_at >= datetime('now')`
    )
    .all(sessionId) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    placeholder: String(row.placeholder || ""),
    originalValue: String(decrypt(String(row.encrypted_value || "")) || ""),
    entityType: String(row.entity_type || ""),
    level: String(row.level || "L4"),
    transformMode: String(row.transform_mode || "ALLOW"),
  }));
}

export async function getPrivacyRuntimeStats() {
  const db = getDbInstance();
  const rows = db
    .prepare(
      `SELECT decision, source_app, entity_summary, COUNT(*) as total
       FROM privacy_runtime_events
       GROUP BY decision, source_app, entity_summary`
    )
    .all() as Array<Record<string, unknown>>;

  const summary = {
    scannedRequests: 0,
    decisionCounts: {
      allow: 0,
      transformed: 0,
      blocked: 0,
    },
    sourceApps: {} as Record<string, number>,
    topEntityTypes: {} as Record<string, number>,
  };

  for (const row of rows) {
    const total = Number(row.total || 0);
    const decision = String(row.decision || "allow");
    const sourceApp = String(row.source_app || "unknown");
    summary.scannedRequests += total;
    if (decision in summary.decisionCounts) {
      summary.decisionCounts[decision as keyof typeof summary.decisionCounts] += total;
    }
    summary.sourceApps[sourceApp] = (summary.sourceApps[sourceApp] || 0) + total;

    try {
      const entitySummary = JSON.parse(String(row.entity_summary || "{}")) as {
        topEntityTypes?: string[];
      };
      for (const entityType of entitySummary.topEntityTypes || []) {
        summary.topEntityTypes[entityType] = (summary.topEntityTypes[entityType] || 0) + total;
      }
    } catch {}
  }

  return summary;
}

function randomId(prefix: string) {
  return `${prefix}_${createHash("sha1")
    .update(`${prefix}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 16)}`;
}
