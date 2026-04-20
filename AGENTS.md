# LocalAgent Agent Collaboration Guide

This is the first file an AI coding agent should read when working in this repo.

LocalAgent is a product fork built from open-source foundations. Do not treat `OmniRoute/`, `open-webui/`, or `openclaw/` as plain upstream checkouts. The local source, compose files, bootstrap scripts, and LocalAgent architecture contract are the source of truth.

## Required Reading Before Code

Read these before planning or editing:

1. `docs/LOCALAGENT_IMPLEMENTATION_CONTINUATION.md`
2. `deploy/layer2-apps/docker-compose.yml`
3. `README.md`
4. The component-specific files relevant to the task

If these files disagree with public upstream repositories, trust this repo first.

## Pre-Code Gate

Before writing code, answer these questions in your working notes or user-facing plan:

1. What is LocalAgent in this repo?
2. Which component owns this task?
3. Why should the other components not be changed, or how are they affected?
4. Which files did you read?
5. Which files do you intend to edit?
6. What verification will prove the change works?
7. Are there existing dirty files from the user that must not be overwritten?

Do not start implementation until the owner, files, and verification path are clear.

## Architecture Invariants

- `OmniRoute` is the central control plane and OpenAI-compatible API plane.
- OmniRoute owns external provider credentials, provider policy, routing, fallback, privacy filtering, usage/accounting, model catalog, and app API keys.
- `open-webui` is a LocalAgent client of OmniRoute. Its OpenAI-compatible backend must point to OmniRoute.
- `openclaw` is a LocalAgent client of OmniRoute. Its default provider should remain `omniroute` unless an explicit architecture decision changes that.
- `deploy/` and `ops/` own repeatable runtime convergence: compose, bootstrap, health, smoke, backup, and deploy flows.
- Runtime data is not source code. Manual runtime fixes must become source or bootstrap changes.

## Source Of Truth Order

When behavior is unclear, resolve it in this order:

1. `deploy/layer2-apps/docker-compose.yml`
2. `deploy/scripts/*.sh`
3. `ops/agent.sh`
4. Runtime env files under `deploy/env/`
5. Local source under `OmniRoute/`, `open-webui/`, and `openclaw/`
6. Local docs
7. Public upstream repositories

## Component Ownership

Use this routing before editing:

- Provider integration, model routing, model catalog, API keys, quotas, privacy, usage, OpenAI-compatible `/v1`: `OmniRoute/`
- Human chat UI, OpenWebUI FastAPI behavior, OpenWebUI persistent config, OpenWebUI frontend: `open-webui/`
- Agent gateway, CLI, control UI, OpenClaw auth/origin rules, agent ingress, OpenClaw model selection: `openclaw/`
- Docker images, env, service wiring, bootstrap, schema guard, health, smoke, deploy: `deploy/` and `ops/`
- Cross-component contracts and onboarding: `docs/`, `AGENTS.md`, and relevant tests

## Anti-Garbage Rules

- Do not blindly copy code or assumptions from upstream public repos.
- Do not bypass OmniRoute by adding direct provider credentials to OpenWebUI or OpenClaw.
- Do not fix LocalAgent by only hand-editing generated runtime data.
- Do not hardcode local secrets, app keys, personal paths, or machine-specific values.
- Do not refactor broad areas unless the task explicitly requires it.
- Do not overwrite unrelated dirty worktree changes.
- Do not change OpenWebUI provider config without checking Postgres/Redis persistence and bootstrap.
- Do not change OpenClaw auth, origins, trusted proxy, or model provider shape without checking bootstrap and smoke tests.
- Do not change OmniRoute `/v1/models`, `/v1/chat/completions`, or `/v1/responses` without considering OpenWebUI and OpenClaw clients.

## Verification Expectations

Use the narrowest relevant verification first, then expand if the change crosses component boundaries.

Common checks:

- Workspace audit: `bash ops/audit_workspace.sh`
- Deploy script tests: `bash deploy/scripts/tests/smoke_stack_test.sh`
- OpenWebUI schema guard tests: `bash deploy/scripts/tests/openwebui_schema_guard_test.sh`
- Registry image tests: `bash deploy/scripts/tests/image_registry_test.sh`
- App image build: `bash deploy/scripts/build_app_images.sh all`
- Full-stack multi-arch publish dry-run: `bash deploy/scripts/publish_multiarch_images.sh --dry-run all`
- Stack health: `ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/healthcheck.sh local`
- Stack smoke: `ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/smoke_stack.sh local`

Component checks:

- OmniRoute: `cd OmniRoute && npm run lint`, `npm run test:vitest`, `npm run typecheck:core`, `npm run build`
- OpenWebUI: `cd open-webui && npm run check`, `npm run test:frontend`, `npm run build`
- OpenClaw: `cd openclaw && pnpm test:fast`, `pnpm test:gateway`, `pnpm check`, `pnpm build:docker`

Report any verification that could not be run and why.

## Required Final Summary

When finished, summarize:

- What changed
- Which component owned the change
- Which LocalAgent contract was preserved or updated
- Which verification was run
- Any remaining risk or follow-up needed
