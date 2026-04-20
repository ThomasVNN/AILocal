# LocalAgent M1 Deploy Hardening CR

Date: 2026-04-14
Workspace: `/Users/thont/Local/POC/LocalAgent-Dev-01`
Target: local Apple Silicon deployment via `bash ops/agent.sh deploy local`

## Scope

This change set hardens LocalAgent deployment on Apple Silicon and fixes the last blocking issues found during full-stack local deployment verification:

- OpenWebUI stale schema drift in reused local data volumes
- OpenWebUI image builds exceeding Docker Desktop memory on M1
- Build fallback paths missing `BUILDPLATFORM`
- Smoke verification failing on provider quota errors or SSE responses

## Root Causes

### 1. OpenWebUI schema drift

The local Postgres `openwebui` database contained an Alembic revision no longer present in current source migrations and was also missing `tool.access_control`. This caused OpenWebUI startup failures and unhealthy containers.

### 2. OpenWebUI build memory pressure on M1

The build pipeline defaulted to `--max-old-space-size=8192`, which exceeded the effective Docker Desktop memory budget on the target M1 machine. The frontend build was being killed with `SIGKILL` / `cannot allocate memory`.

### 3. Build fallback portability gap

The Docker build wrappers passed `TARGETARCH` but not `BUILDPLATFORM`. Some Dockerfiles rely on `FROM --platform=$BUILDPLATFORM`, so fallback build paths could fail.

### 4. Smoke test false negatives

The smoke test selected a single preferred model and failed immediately on:

- ChatGPT quota / 429 resets
- Perplexity SSE chunked responses
- Provider-specific prompt fragility (`Reply with OK only.` caused Perplexity processing errors)

These were verification issues, not core stack bring-up issues.

## Changes

### Deployment guards

- Added `deploy/scripts/openwebui_schema_guard.sh`
- Added `deploy/scripts/tests/openwebui_schema_guard_test.sh`
- Integrated the guard into `deploy/scripts/bootstrap_app_clients.sh`

Behavior:

- Detect stale OpenWebUI schema before runtime config sync
- Backup current `public` schema to `LA_DATA_ROOT/platform/backups/postgres`
- Reset schema only when drift is confirmed
- Reinitialize OpenWebUI schema from current source when required

### Apple Silicon image build hardening

- Updated `deploy/scripts/build_app_images.sh`

Behavior:

- Pass `BUILDPLATFORM` in buildx, daemon BuildKit, and legacy builder paths
- Lower default OpenWebUI build heap from `8192` to `4096`

### Smoke verification hardening

- Updated `deploy/scripts/smoke_stack.sh`
- Added `deploy/scripts/tests/smoke_stack_test.sh`

Behavior:

- Try multiple central-provider models instead of failing on the first candidate
- Treat provider quota / rate-limit responses as retryable model failures
- Parse both standard JSON completions and SSE chunked responses
- Use a more stable verification prompt: `What is 1+1? Answer with 2 only.`

## Files Changed

- `deploy/scripts/build_app_images.sh`
- `deploy/scripts/bootstrap_app_clients.sh`
- `deploy/scripts/openwebui_schema_guard.sh`
- `deploy/scripts/smoke_stack.sh`
- `deploy/scripts/tests/openwebui_schema_guard_test.sh`
- `deploy/scripts/tests/smoke_stack_test.sh`

## Verification Evidence

### Workspace + stack audit

- `bash ops/audit_workspace.sh` -> pass

### Targeted tests

- `bash deploy/scripts/tests/openwebui_schema_guard_test.sh` -> pass
- `bash deploy/scripts/tests/smoke_stack_test.sh` -> pass

### Health + smoke

- `ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/healthcheck.sh local` -> pass
- `ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/smoke_stack.sh local` -> pass

Smoke result highlights:

- OmniRoute catalog exposed `47` models
- OmniRoute had `2` configured central provider connections
- OpenWebUI runtime pointed to OmniRoute correctly
- OpenClaw runtime pointed to OmniRoute correctly
- Central chat path succeeded via `perplexity-web2api/sonar-pro`

### Full deploy entrypoint

- `bash ops/agent.sh deploy local` -> pass

Observed result:

- Layer 1 platform came up healthy
- Layer 2 apps came up healthy
- Final healthcheck passed
- Final smoke test passed

## Deployment Result

The LocalAgent stack is running successfully on the target M1 machine with Docker, using the documented 2-layer architecture.

Healthy services after deployment:

- `localagent-apps-omniroute-1`
- `localagent-apps-open-webui-1`
- `localagent-apps-openclaw-gateway-1`
- `localagent-platform-postgres-primary-1`
- `localagent-platform-redis-1`
- `localagent-platform-traefik-1`
- `localagent-platform-minio-1`

## Operational Notes

- A stale OpenWebUI schema backup was written before repair under:
  - `.localagent-data/platform/backups/postgres/`
- ChatGPT provider accounts were rate-limited during verification, but smoke correctly failed over to a working Perplexity-backed model.
- If all configured external providers are simultaneously unavailable, smoke will still fail, which is the intended behavior.

## Rollback

- Revert the touched deploy scripts and remove the schema guard if needed.
- Restore the backed-up OpenWebUI schema dump from `.localagent-data/platform/backups/postgres/` if a manual database rollback is required.

## Reviewer Checklist

- Confirm schema guard reset conditions are appropriately narrow
- Confirm `BUILDPLATFORM` propagation is safe across current Dockerfiles
- Confirm reduced OpenWebUI Node heap is sufficient for the current source tree
- Confirm smoke fallback behavior is strict enough and does not hide real runtime failures
