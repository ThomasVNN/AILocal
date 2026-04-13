CREATE TABLE IF NOT EXISTS privacy_runtime_events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  request_id TEXT,
  source_app TEXT,
  policy_profile_id TEXT,
  decision TEXT NOT NULL,
  blocked_count INTEGER DEFAULT 0,
  masked_count INTEGER DEFAULT 0,
  tokenized_count INTEGER DEFAULT 0,
  allow_count INTEGER DEFAULT 0,
  bundle_version TEXT,
  entity_summary TEXT,
  validator TEXT
);

CREATE INDEX IF NOT EXISTS idx_privacy_runtime_events_timestamp
  ON privacy_runtime_events(timestamp);

CREATE INDEX IF NOT EXISTS idx_privacy_runtime_events_decision
  ON privacy_runtime_events(decision);

CREATE TABLE IF NOT EXISTS privacy_restore_sessions (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  source_app TEXT NOT NULL,
  policy_profile_id TEXT NOT NULL,
  bundle_version TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  stream INTEGER NOT NULL DEFAULT 0,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_privacy_restore_sessions_expires_at
  ON privacy_restore_sessions(expires_at);

CREATE TABLE IF NOT EXISTS privacy_restore_entities (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  placeholder TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  level TEXT NOT NULL,
  transform_mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_privacy_restore_entities_session
  ON privacy_restore_entities(session_id);

CREATE INDEX IF NOT EXISTS idx_privacy_restore_entities_expires_at
  ON privacy_restore_entities(expires_at);
