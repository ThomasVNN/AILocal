# Antigravity Direct Routing

Last reviewed from local source: 2026-04-21

LocalAgent does not use MITM interception for Antigravity. Antigravity should call OmniRoute directly as an OpenAI-compatible provider.

## Architecture

```text
User
  -> Antigravity IDE
  -> https://router.localagent.local:8443
  -> Traefik websecure entrypoint, host router.localagent.local
  -> OmniRoute API bridge on omniroute:20129 for /v1, /models, /responses, /chat/completions, /codex
  -> OmniRoute routing, quota, fallback, privacy, usage, model catalog
  -> active provider connection:
       chatgpt-web2api account(s)
       or perplexity-web2api account(s)
       or a configured combo using those providers
```

Removed path:

```text
Antigravity -> daily-cloudcode-pa.googleapis.com -> host-file redirect -> local MITM -> root CA -> OmniRoute
```

Do not use that path. Do not add Google API host mappings, install MITM certificates, or run a local port-443 interception service.

## Antigravity Config

Use an OpenAI-compatible/custom provider in Antigravity:

```text
Base URL: https://router.localagent.local:8443
Auth: Bearer <OmniRoute API key>
Model: one model from GET /v1/models, for example chatgpt-web2api/gpt-5.2
```

If the Antigravity provider form expects a full OpenAI API base URL instead of an origin, use:

```text
https://router.localagent.local:8443/v1
```

Use an OmniRoute app/user API key from the dashboard or from `deploy/env/stack.local.env`.

## Source Changes

- `deploy/scripts/render_traefik_dynamic.sh`
  - Adds a high-priority `omniroute-direct-api` router on `OMNIROUTE_HOST`.
  - Routes OpenAI-compatible paths on `router.localagent.local` to the OmniRoute API bridge.
- `deploy/scripts/smoke_stack.sh`
  - Verifies `https://router.localagent.local:8443/v1/models`.
  - Requires at least one active `chatgpt-web2api` or `perplexity-web2api` connection.
  - Uses direct provider model candidates only for the central chat smoke.
- `OmniRoute/src/shared/constants/cliTools.ts`
  - Converts Antigravity and Kiro dashboard cards from MITM mode to direct guide mode.
  - Removes Antigravity internal MITM-only model aliases from the setup surface.
- `OmniRoute/src/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.tsx`
  - Removes the Antigravity MITM card special case.
- `OmniRoute/src/app/api/cli-tools/antigravity-mitm/route.ts`
  - Returns `410 Gone` with direct-routing guidance.
- `OmniRoute/src/app/api/cli-tools/antigravity-mitm/alias/route.ts`
  - Returns `410 Gone`; MITM aliasing is no longer a LocalAgent runtime path.
- `deploy/scripts/tests/render_traefik_dynamic_test.sh`
  - Guards router-host `/v1` Traefik routing.
- `deploy/scripts/tests/smoke_stack_test.sh`
  - Guards direct provider model selection and provider readiness.
- `deploy/scripts/tests/antigravity_direct_contract_test.sh`
  - Guards against re-exposing MITM in the CLI-tool registry.

## Docker And Traefik

Expected local Docker shape:

```text
host 8443 -> localagent-platform-traefik-1:443
Traefik edge network -> localagent-apps-omniroute-1
router.localagent.local /v1* -> omniroute-api -> http://omniroute:20129
router.localagent.local /dashboard* and UI paths -> omniroute-dashboard -> http://omniroute:20128
```

Regenerate the dynamic config after source changes:

```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/render_traefik_dynamic.sh
```

Traefik watches the generated dynamic file mounted at:

```text
.localagent-data/platform/proxy/traefik/dynamic.yml
```

## Working Requests

Model catalog:

```bash
curl -sk \
  --resolve router.localagent.local:8443:127.0.0.1 \
  -H "Authorization: Bearer $OMNIROUTE_API_KEY" \
  https://router.localagent.local:8443/v1/models
```

Chat completion:

```bash
curl -sk \
  --resolve router.localagent.local:8443:127.0.0.1 \
  -H "Authorization: Bearer $OMNIROUTE_API_KEY" \
  -H "Content-Type: application/json" \
  https://router.localagent.local:8443/v1/chat/completions \
  -d '{
    "model": "chatgpt-web2api/gpt-5.2",
    "messages": [
      {"role": "user", "content": "Reply with OK only."}
    ]
  }'
```

`--resolve` is for local curl verification only. Production clients should use normal DNS for `router.localagent.local` or the server hostname.

## Debug Checklist

1. Confirm no MITM is in use:
   - No `daily-cloudcode-pa.googleapis.com` host-file mapping.
   - No root CA or certificate injection workflow for Antigravity.
   - No process listening on host port `443` for interception.
   - `/api/cli-tools/antigravity-mitm` returns `410`.
2. Confirm Docker exposure:
   - `docker ps` shows Traefik publishing `0.0.0.0:8443->443/tcp`.
   - `localagent-apps-omniroute-1` is healthy.
3. Confirm Traefik routing:
   - Generated dynamic config contains `omniroute-direct-api`.
   - `curl -sk --resolve router.localagent.local:8443:127.0.0.1 https://router.localagent.local:8443/v1/models` returns JSON with `data`.
4. Confirm provider readiness:
   - OmniRoute has at least one active `chatgpt-web2api` or `perplexity-web2api` connection.
   - Prefer two or more accounts/providers for fallback during 429s.
5. Confirm fallback behavior:
   - A 429 on the first account should mark that connection temporarily unavailable.
   - Logs should show the next account/provider being tried.
   - If all direct providers 429, use an OmniRoute combo with multiple provider/model entries.
6. Confirm Antigravity:
   - Provider base URL is `https://router.localagent.local:8443` or `https://router.localagent.local:8443/v1`, depending on the form.
   - Auth is `Bearer <OmniRoute API key>`.
   - Model is selected from OmniRoute `/v1/models`.
