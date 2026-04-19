# LocalAgent Implementation Continuation Guide

Last reviewed from local source: 2026-04-20

This document is the handoff guide for humans and AI agents that continue implementing LocalAgent in this workspace. Treat the local source tree and deploy scripts as the source of truth. The three main applications were cloned from public projects originally, but they have been customized enough that upstream assumptions are no longer safe.

## Project Identity

LocalAgent is a local/self-hosted AI application stack with three source-built application components:

1. `OmniRoute`
   Central control plane and OpenAI-compatible API gateway. It owns provider credentials, model catalog, routing, fallback, API-key policy, privacy filtering, usage/accounting, and the dashboard.

2. `open-webui`
   Chat UI and FastAPI backend. In LocalAgent it is a consumer of OmniRoute, not the owner of external provider credentials. Its OpenAI-compatible backend must point at OmniRoute.

3. `openclaw`
   Agent gateway, CLI, and control UI. In LocalAgent it is also a consumer of OmniRoute. Its model provider named `omniroute` points to OmniRoute's OpenAI-compatible API.

The runtime stack is organized as:

- Layer 1 platform: Postgres, Redis, MinIO, Traefik.
- Layer 2 apps: OmniRoute, OpenWebUI, OpenClaw.

The current app layer compose file builds all three apps from local source:

- `deploy/layer2-apps/docker-compose.yml`
- `OmniRoute/Dockerfile`
- `open-webui/Dockerfile`
- `openclaw/Dockerfile`

Do not assume OpenWebUI or OpenClaw are still plain upstream images. Verify against the local compose file before changing deploy behavior.

## Software Architect Stance

LocalAgent should be treated as a product architecture built from open-source foundations, not as three upstream projects casually stitched together.

The Software Architect role for this project is:

- Own the target architecture first, then adapt upstream code to serve it.
- Keep OmniRoute as the system boundary for provider credentials, policy, routing, privacy, usage, and model catalog.
- Keep OpenWebUI and OpenClaw as product clients of OmniRoute unless there is an explicit architecture decision to change that.
- Make source-level customization repeatable through code, Dockerfiles, bootstrap scripts, migrations, and tests.
- Avoid one-off runtime fixes that cannot be reproduced on a new machine or server.
- Record intentional divergence from upstream so future updates are conscious merges, not blind pulls.

### Open-Source Rebuild Policy

When taking code from open-source projects to build LocalAgent:

- Treat upstream as an input supplier, not as the product owner.
- Check license obligations before copying, modifying, distributing, or rebranding code.
- Keep local product contracts stable even when upstream changes their internal APIs.
- Prefer small, isolated adaptation layers around upstream code instead of scattering LocalAgent-specific behavior everywhere.
- When a deep fork is necessary, document why the divergence exists and which LocalAgent runtime behavior depends on it.
- Never update from upstream without first identifying which LocalAgent customizations could be overwritten.

### Architecture Ownership Model

Use this ownership model when deciding where to implement new behavior:

- Product orchestration, deploy, image build, bootstrap, health, backup, and smoke checks belong under `ops/` and `deploy/`.
- Provider integration, model policy, API-key security, privacy, usage, and cross-app API compatibility belong in `OmniRoute/`.
- Human chat UX and OpenWebUI-specific backend behavior belong in `open-webui/`.
- Agent gateway, CLI, control UI, agent ingress, and OpenClaw-specific model selection belong in `openclaw/`.
- Cross-component contracts belong in docs and tests, not in someone's memory.

### Upstream Intake Process

Before importing or rebasing from a public upstream repository:

1. Identify the upstream commit/tag and the local base it will be compared against.
2. List LocalAgent custom files that overlap with the upstream diff.
3. Classify incoming changes as security fix, dependency fix, feature, refactor, or incompatible architecture change.
4. Merge in a branch and run component-level tests before stack smoke.
5. Re-check the three LocalAgent contracts: OmniRoute owns providers, OpenWebUI consumes OmniRoute, OpenClaw consumes OmniRoute.
6. Update this document when the source-of-truth paths, ownership boundaries, or bootstrap behavior change.

## Runtime Flow

```text
Browser / user
  -> Traefik HTTPS entrypoints
  -> OmniRoute dashboard and API bridge
  -> provider routing, policies, privacy, usage, fallback
  -> external model providers

OpenWebUI backend
  -> http://omniroute:${OMNIROUTE_API_PORT:-20129}/v1
  -> OmniRoute

OpenClaw gateway / CLI
  -> http://omniroute:${OMNIROUTE_API_PORT:-20129}/v1
  -> OmniRoute
```

The central integration contract is simple: OpenWebUI and OpenClaw talk to OmniRoute only. OmniRoute talks to external AI providers.

## Source Of Truth Order

When code, docs, and old upstream behavior disagree, use this order:

1. `deploy/layer2-apps/docker-compose.yml`
2. `deploy/scripts/*.sh`
3. `ops/agent.sh`
4. Runtime env files under `deploy/env/`
5. Local source code under `OmniRoute/`, `open-webui/`, and `openclaw/`
6. Markdown docs
7. Public upstream repositories

Public upstream repositories are useful for background only. They are not authoritative for this workspace.

## Component 1: OmniRoute

### Responsibility

OmniRoute is the central API and control plane. Its LocalAgent responsibilities include:

- OpenAI-compatible `/v1` API surface.
- Chat completion routing and streaming.
- Unified model catalog.
- Provider connections and provider health.
- API-key issuance, hashing, policy enforcement, and app-specific keys.
- Prompt-injection and privacy filtering before provider calls.
- Usage, quota, caching, fallback, and request logging.
- Dashboard routes for configuration and operations.
- OpenClaw settings bridge used by the dashboard.

### Key Source Files

- `OmniRoute/src/app/api/v1/chat/completions/route.ts`
  API route entrypoint for OpenAI-compatible chat completions. It initializes translators, applies request-level security checks, and delegates into chat handling.

- `OmniRoute/src/sse/handlers/chat.ts`
  Main request pipeline for auth, API-key policy, privacy source detection, request sanitization, session limits, routing setup, and streaming negotiation.

- `OmniRoute/open-sse/handlers/chatCore.ts`
  Provider execution core. This is where translation, fallback, token refresh, request logging, usage, cost, caching, idempotency, memory injection, and provider error classification converge.

- `OmniRoute/src/app/api/v1/models/route.ts`
  OpenAI-compatible model catalog endpoint.

- `OmniRoute/src/app/api/v1/registered-keys/route.ts`
  App-facing key registration/listing endpoint.

- `OmniRoute/src/lib/db/registeredKeys.ts`
  Raw key issuance, SHA-256 key hashing, `ork_` prefix behavior, idempotency, provider/account limits, and active-key quotas.

- `OmniRoute/src/shared/utils/apiKeyPolicy.ts`
  Per-key policy checks: allowed models, budget ceilings, request-count limits, and access schedules.

- `OmniRoute/src/lib/privacy/runtime.ts`
  Compiled privacy policy runtime for masking/blocking/restoring request content.

- `OmniRoute/src/lib/privacy/http.ts`
  Source-app detection from headers, API key name, or user-agent. LocalAgent depends on source labels such as `openwebui`, `openclaw-gw`, and `direct-api`.

- `OmniRoute/src/lib/apiBridgeServer.ts`
  Separate API bridge that forwards OpenAI-compatible routes to the dashboard server.

- `OmniRoute/src/app/api/cli-tools/openclaw-settings/route.ts`
  Dashboard API that reads/writes OpenClaw config and can map OmniRoute key IDs to OpenClaw provider settings.

- `OmniRoute/src/server-init.ts`
  Startup initialization for migrations, secrets enforcement, audit logging, and optional sync tasks.

- `OmniRoute/next.config.mjs`
  Next standalone build config and rewrites for `/v1`, `/models`, `/responses`, `/chat/completions`, and `/codex`.

- `OmniRoute/Dockerfile`
  Local source build/runtime image. It includes Node 22, Next standalone output, architecture-specific build hardening, and runner targets.

### Implementation Rules

- Put external provider credentials, quota, model policy, and routing behavior in OmniRoute, not OpenWebUI or OpenClaw.
- Preserve OpenAI-compatible semantics on `/v1/models`, `/v1/chat/completions`, and `/v1/responses` because OpenWebUI and OpenClaw depend on them.
- Treat API-key behavior as security-sensitive. If the registered-key format, hashing, or policy semantics change, update bootstrap scripts and smoke tests in the same change.
- Treat privacy filtering as a cross-app boundary. Any new source app or client must be labeled so `src/lib/privacy/http.ts` can classify it.
- For dashboard changes that write OpenClaw settings, check `src/app/api/cli-tools/openclaw-settings/route.ts` and the OpenClaw config schema together.

### Suggested Verification

- `cd OmniRoute && npm run lint`
- `cd OmniRoute && npm run test:vitest`
- `cd OmniRoute && npm run typecheck:core`
- `cd OmniRoute && npm run build`

Use targeted tests first when changing the provider execution path, then run stack smoke after image rebuild.

## Component 2: OpenWebUI

### Responsibility

OpenWebUI provides the user chat interface and backend application services. In LocalAgent it must be configured as an OpenAI-compatible client of OmniRoute:

- `ENABLE_OLLAMA_API=False`
- `ENABLE_OPENAI_API=True`
- `OPENAI_API_BASE_URL=http://omniroute:${OMNIROUTE_API_PORT:-20129}/v1`
- `OPENAI_API_KEY=<app key issued by OmniRoute>`

OpenWebUI stores persistent runtime state in Postgres, Redis, MinIO/S3, and its mounted runtime directory. Environment variables alone are not always enough after first boot because OpenWebUI persists config values into its database and mirrors them into Redis.

### Key Source Files

- `open-webui/backend/open_webui/main.py`
  FastAPI app creation, lifespan boot, admin/env initialization, Redis setup, task listeners, model cache prewarm, router registration, and app-state config.

- `open-webui/backend/open_webui/config.py`
  Persistent configuration system. `PersistentConfig` reads/writes DB values and mirrors config to Redis with `REDIS_KEY_PREFIX`.

- `open-webui/backend/open_webui/env.py`
  Runtime environment parsing, data paths, `DATABASE_URL`, `REDIS_KEY_PREFIX`, websocket manager settings, and app-level env defaults.

- `open-webui/backend/open_webui/internal/db.py`
  Database setup, migrations, connection pooling, Postgres schema support, and SQLAlchemy/Peewee integration.

- `open-webui/backend/open_webui/routers/openai.py`
  Active OpenAI-compatible provider integration. It reads `OPENAI_API_BASE_URLS`, `OPENAI_API_KEYS`, and provider configs from app state, calls `/models`, verifies connections, and proxies model operations.

- `open-webui/src/`
  Svelte frontend. Use this for UI behavior, user workflows, and client-side API calls.

- `open-webui/Dockerfile`
  Local source build image used by LocalAgent compose.

### LocalAgent-Specific Config Behavior

`deploy/scripts/bootstrap_app_clients.sh` is the key integration script. It:

- Resolves or creates OmniRoute app keys for OpenWebUI and OpenClaw.
- Ensures OpenWebUI's Postgres config row points to OmniRoute.
- Ensures Redis config keys under `open-webui:config:*` point to OmniRoute.
- Clears stale OpenWebUI model cache.
- Restarts OpenWebUI after config correction.

`deploy/scripts/openwebui_schema_guard.sh` protects against stale local OpenWebUI database schemas. If the DB schema is from an incompatible previous build, it backs up the schema and recreates it so the current local source can initialize correctly.

### Implementation Rules

- Do not add direct provider credentials to OpenWebUI as the normal LocalAgent path. Keep provider ownership in OmniRoute.
- If you change OpenWebUI provider config behavior, update `bootstrap_app_clients.sh` and smoke checks at the same time.
- If you change DB migrations or persistent config names, check both Postgres config rows and Redis mirror keys.
- If you change model listing behavior, verify that `routers/openai.py` still consumes OmniRoute `/models` correctly.
- Treat OpenWebUI runtime data under the data root as generated state, not source code.

### Suggested Verification

- `cd open-webui && npm run check`
- `cd open-webui && npm run test:frontend`
- `cd open-webui && npm run build`
- Backend verification requires the Python dependency environment for this repo. If unavailable, use stack-level smoke tests after image rebuild.

## Component 3: OpenClaw

### Responsibility

OpenClaw provides the agent gateway, CLI, and control UI. In LocalAgent it should use OmniRoute as its default model provider:

- `OPENAI_BASE_URL=http://omniroute:${OMNIROUTE_API_PORT:-20129}/v1`
- `OPENAI_API_BASE_URL=http://omniroute:${OMNIROUTE_API_PORT:-20129}/v1`
- `OPENAI_API_KEY=<app key issued by OmniRoute>`
- `models.providers.omniroute.baseUrl=http://omniroute:${OMNIROUTE_API_PORT:-20129}/v1`
- `agents.defaults.model.primary=omniroute/<model-id>`

OpenClaw state lives in the mounted config directory, normally `/home/node/.openclaw` in the container.

### Key Source Files

- `openclaw/src/gateway/server.impl.ts`
  Main gateway startup path. It resolves config, auth, plugins, channel integrations, control UI assets, heartbeat, discovery, reload behavior, sidecars, secrets, model catalog, node registry, and websocket handlers.

- `openclaw/src/gateway/auth.ts`
  Gateway auth modes: `none`, `token`, `password`, and `trusted-proxy`. It resolves token/password from config, env, or secrets and enforces trusted proxy behavior.

- `openclaw/src/gateway/origin-check.ts`
  Browser origin validation for the control UI.

- `openclaw/src/config/gateway-control-ui-origins.ts`
  Startup seeding for allowed control UI origins when binding to LAN, tailnet, custom, or auto addresses.

- `openclaw/src/config/paths.ts`
  Config and state path resolution, including `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`, and default gateway port `18789`.

- `openclaw/src/gateway/models-http.ts`
  OpenAI-compatible `/v1/models` endpoint exposed by OpenClaw's gateway.

- `openclaw/src/gateway/openai-http.ts`
  OpenAI-compatible chat completions ingress for agent commands.

- `openclaw/src/gateway/openresponses-http.ts`
  OpenAI Responses-compatible ingress, including session continuity and external content wrapping.

- `openclaw/src/agents/models-config.merge.ts`
  Provider/model config merge logic. Important when bootstrap writes the `omniroute` provider.

- `openclaw/src/agents/model-selection.ts`
  Model selection, fallback, provider normalization, and allowlist behavior.

- `openclaw/Dockerfile`
  Local source build image. It pins a Node runtime, uses pnpm/Bun build steps, builds UI assets, prunes dependencies, and runs as non-root `node`.

### LocalAgent-Specific Config Behavior

`deploy/scripts/bootstrap_app_clients.sh` writes `openclaw.json` under the mounted OpenClaw config directory. It creates or updates:

- `gateway.auth.token`
- `models.mode=merge`
- `models.providers.omniroute`
- `models.providers.omniroute.api=openai-completions`
- `models.providers.omniroute.auth=api-key`
- `models.providers.omniroute.apiKey` as an env secret reference
- `models.providers.omniroute.baseUrl`
- `models.providers.omniroute.models`
- `agents.defaults.model.primary`
- `agents.defaults.model.fallbacks`

`deploy/scripts/bootstrap_openclaw.sh` configures control UI ingress behavior after the gateway is running:

- allowed browser origins
- trusted Traefik proxy CIDR
- optional device-auth disable flag for controlled local deployments

### Implementation Rules

- Keep OpenClaw's default provider as `omniroute` unless the user explicitly asks for a different architecture.
- If you change gateway auth, origin, trusted proxy, or control UI behavior, update `bootstrap_openclaw.sh` and stack smoke in the same change.
- If you change provider/model config shape, update `bootstrap_app_clients.sh`, model selection tests, and this guide.
- If you change `/v1/chat/completions` or `/v1/responses` ingress, check compatibility with external agents that call OpenClaw as an OpenAI-compatible endpoint.
- Do not hand-edit mounted runtime config as the only fix. Encode repeatable behavior in bootstrap or source.

### Suggested Verification

- `cd openclaw && pnpm test:fast`
- `cd openclaw && pnpm test:gateway`
- `cd openclaw && pnpm check`
- `cd openclaw && pnpm build:docker`

Use narrower scripts when changing only config parsing or gateway auth.

## Cross-Component Integration Contract

The current contract is:

- OmniRoute is the only app that should know real external provider credentials by default.
- OpenWebUI and OpenClaw receive app-specific OmniRoute API keys.
- Internal app-to-app traffic uses Docker DNS: `http://omniroute:${OMNIROUTE_API_PORT:-20129}/v1`.
- Public browser traffic uses Traefik hostnames and TLS settings from env.
- OmniRoute's model catalog must be consumable by both OpenWebUI and OpenClaw.
- Bootstrap must be idempotent. Running it repeatedly should converge app config, not create duplicate or conflicting runtime state.
- Deploy validation should check source-built images, not public upstream image assumptions.

## Data And State Map

Source-controlled implementation:

- `OmniRoute/`
- `open-webui/`
- `openclaw/`
- `deploy/`
- `ops/`
- `docs/`

Generated runtime state:

- OmniRoute SQLite data mounted at app runtime data path.
- OpenWebUI Postgres tables.
- OpenWebUI Redis config/cache keys, especially prefix `open-webui`.
- OpenWebUI MinIO/S3 objects.
- OpenClaw config and state under its mounted `.openclaw` directory.
- Logs and backups under the configured LocalAgent data root.

Do not treat generated runtime state as implementation source. If a manual runtime edit fixes a problem, convert it into a source or bootstrap change.

## Recommended Implementation Sequence

### Step 1: Keep Architecture Docs Fresh

Update docs that still imply OpenWebUI uses an upstream runtime image. The current compose file builds OpenWebUI and OpenClaw from local source. Architecture docs should say that clearly.

### Step 2: Add A Read-Only LocalAgent Doctor

Create a read-only diagnostic command before adding more mutating deploy behavior. It should report:

- Detected app layer compose services.
- Whether each app image is source-built.
- OmniRoute dashboard/API ports.
- OmniRoute active provider connections.
- OpenWebUI Postgres and Redis OpenAI config.
- OpenClaw `omniroute` provider config.
- Traefik hostnames and reachable endpoints.
- Versions/toolchains for Node, pnpm, npm, Python, Docker, and Compose.

The doctor should not fix anything at first. It should explain exactly which source file or bootstrap script owns each failed check.

### Step 3: Wrap Build And Test Commands

Add thin wrappers for repeatable local verification:

- OmniRoute lint/typecheck/unit/build.
- OpenWebUI frontend/backend checks.
- OpenClaw fast/gateway/check/build.
- App image builds through `deploy/scripts/build_app_images.sh`.

The wrapper should preserve the native component commands so contributors can still run them directly.

### Step 4: Strengthen Preflight Before Deploy

Before `ops/agent.sh deploy local/server` mutates anything, preflight should verify:

- Required env files exist.
- Docker and Compose are available.
- Data root is writable.
- Layer 1 services are healthy.
- OmniRoute can open or initialize its database.
- OpenWebUI schema state is compatible or will be safely backed up/reset.
- OpenClaw config directory is writable.
- Traefik hostnames and ports are coherent.

### Step 5: Harden App Bootstrap

Make app-client bootstrap fully repeatable:

- App keys are created or reused deterministically.
- OpenWebUI DB and Redis are updated together.
- OpenWebUI stale model cache is cleared.
- OpenClaw provider config is merged without discarding unrelated user config.
- Fallback model IDs come from OmniRoute catalog where possible.
- Any destructive schema action requires backup first.

### Step 6: Add Cross-Component Contract Tests

Contract tests should verify:

- OpenWebUI's configured `/models` endpoint reaches OmniRoute.
- OpenClaw's configured provider reaches OmniRoute.
- OmniRoute rejects invalid app keys.
- OmniRoute accepts valid OpenWebUI/OpenClaw app keys.
- At least one preferred model can complete a chat request through OmniRoute.
- Privacy/source-app labels are applied for OpenWebUI and OpenClaw requests.

### Step 7: Add Backup And Restore Manifests

For safe future implementation, define a manifest of what must be backed up before deploy or migration:

- OmniRoute SQLite DB.
- OpenWebUI Postgres schema/database.
- OpenWebUI Redis config keys.
- MinIO bucket data.
- OpenClaw config directory.
- Env files.

Backups should be discoverable by timestamp and associated with the deploy action that created them.

## Common Pitfalls

- Editing OpenWebUI env only and forgetting persisted DB/Redis config.
- Updating OpenClaw provider schema without updating bootstrap merge logic.
- Assuming `/v1/models` returns public upstream provider shape instead of OmniRoute's unified catalog.
- Adding provider credentials to OpenWebUI or OpenClaw instead of OmniRoute.
- Treating stale docs as source of truth over compose and scripts.
- Changing gateway auth/origin rules without testing Traefik browser access.
- Rebuilding only OmniRoute when a change also requires OpenWebUI or OpenClaw image rebuild.
- Manually patching runtime data and not encoding the fix in source/bootstrap.

## Useful Existing Verification

Deploy/script-level checks currently available or expected in this workspace:

- `bash deploy/scripts/tests/smoke_stack_test.sh`
- `bash deploy/scripts/tests/openwebui_schema_guard_test.sh`
- `bash deploy/scripts/build_app_images.sh all`
- `bash deploy/scripts/bootstrap_app_clients.sh`
- `bash deploy/scripts/bootstrap_openclaw.sh`
- `bash deploy/scripts/smoke_stack.sh`

Use the script tests for quick shell logic verification. Use the full smoke only when the stack is running and env is prepared.

## Handoff Summary For Future AI Agents

If you are the next AI agent working on LocalAgent:

1. Start by reading this document and `deploy/layer2-apps/docker-compose.yml`.
2. Run `git status --short` and do not overwrite unrelated dirty work.
3. Identify which component owns the requested behavior.
4. Read the component key files listed above before editing.
5. Keep OpenWebUI and OpenClaw as OmniRoute consumers unless the user asks for a different architecture.
6. Update bootstrap scripts when runtime config must converge automatically.
7. Add or run targeted tests first, then stack-level smoke for integration changes.
8. Summarize what changed in terms of the three-component contract.
