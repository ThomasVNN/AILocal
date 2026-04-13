# OmniRoute Privacy Filter Phase 1 CR Document

## 1. Change Summary

- Project: `OmniRoute`
- Implementation branch: `codex/privacy-filter-phase1`
- Implementation commit: `e51330f6`
- Implementation worktree: `/Users/thont/.config/superpowers/worktrees/OmniRoute/codex-privacy-filter-phase1`
- Review date: `2026-04-12`

This CR introduces the first production-ready privacy filter slice for OmniRoute. The scope covers:

- outbound request sanitization before external model calls
- reversible placeholder restore for non-streaming responses
- management APIs for privacy configuration and runtime stats
- a dashboard management board for rules, profiles, and internal document sets
- runtime persistence for privacy events and restore sessions
- test coverage for runtime logic, API routes, dashboard wiring, and UI behavior

This phase is intentionally constrained to a safe first increment:

- regex, pattern, and dictionary detection only
- non-streaming restore only
- internal service-token auth for privacy internal routes
- JSON-backed management board, not a fully bespoke admin workflow yet

## 2. Business / Architecture Context

The target problem is outbound data leakage from requests originating from `OpenWebUI`, `OpenClaw`, or direct API clients that currently transit OmniRoute before being sent to external providers.

The approved architecture direction for phase 1 is:

- `OmniRoute` remains the control plane and public gateway
- privacy enforcement executes inside OmniRoute runtime for now
- dashboard and management stay centralized in OmniRoute
- internal policy bundles, restore sessions, and runtime metrics are stored locally

This gives a usable first release without waiting for a full standalone privacy microservice rollout.

## 3. What Was Implemented

### 3.1 Runtime Privacy Pipeline

New privacy runtime modules were added under `src/lib/privacy/`:

- `types.ts`
- `defaultConfig.ts`
- `store.ts`
- `bundle.ts`
- `detectors.ts`
- `payload.ts`
- `runtime.ts`
- `internalAuth.ts`
- `http.ts`

The runtime supports:

- policy/config seed data
- bundle compilation and active bundle resolution
- detection across supported request fields
- level-to-transform execution:
  - `BLOCK`
  - `MASK`
  - `TOKENIZE`
  - `ALLOW`
- restore session creation with encrypted entity storage
- non-streaming response restoration
- runtime event recording and top-level stats aggregation

### 3.2 Data Persistence

New migration:

- `src/lib/db/migrations/018_privacy_filter_runtime.sql`

New persistence model includes:

- `privacy_runtime_events`
- `privacy_restore_sessions`
- `privacy_restore_entities`

Use cases covered:

- request decision audit
- entity summary aggregation
- reversible placeholder restore
- active bundle lifecycle

### 3.3 Public Management API

New authenticated routes:

- `src/app/api/privacy/config/route.ts`
- `src/app/api/privacy/stats/route.ts`

Capabilities:

- fetch active privacy config and active bundle
- patch entity types, rules, profiles, and document sets
- publish a new active bundle on config update
- fetch runtime stats for dashboard reporting

### 3.4 Internal Privacy API

New internal routes:

- `src/app/api/internal/privacy/sanitize/route.ts`
- `src/app/api/internal/privacy/restore/route.ts`
- `src/app/api/internal/privacy/bundles/activate/route.ts`
- `src/app/api/internal/privacy/healthz/route.ts`
- `src/app/api/internal/privacy/stats/route.ts`

Capabilities:

- internal sanitize contract
- internal restore contract
- health/stats visibility
- bundle activation path
- optional token-based internal auth via `PRIVACY_FILTER_INTERNAL_TOKEN`

### 3.5 Chat Pipeline Integration

Modified files:

- `src/app/api/v1/chat/completions/route.ts`
- `src/sse/handlers/chat.ts`

Key changes:

- request body is parsed once in `/v1/chat/completions`
- parsed body is forwarded into `handleChat`
- privacy sanitize runs before outbound provider call
- logging path uses sanitized payload instead of raw request clone
- non-streaming JSON responses are restored before returning to client
- source app resolution is derived for policy routing

### 3.6 Dashboard / Management Board

New dashboard route:

- `src/app/(dashboard)/dashboard/privacy-filter/page.tsx`
- `src/app/(dashboard)/dashboard/privacy-filter/PrivacyFilterPageClient.tsx`

Board capabilities:

- overview cards for scanned, blocked, transformed, and rule counts
- active bundle summary
- source-app report
- detected entity type report
- JSON editors for:
  - entity types
  - rules
  - profiles
  - internal document sets
- publish/save actions through `/api/privacy/config`

Sidebar integration was added in:

- `src/shared/constants/sidebarVisibility.ts`
- `src/shared/components/Sidebar.tsx`
- `src/app/(dashboard)/dashboard/settings/components/AppearanceTab.tsx`

Localization entries were added in:

- `src/i18n/messages/en.json`
- `src/i18n/messages/vi.json`

## 4. Request / Response Flow After This Change

### 4.1 Non-Streaming Chat Request

1. Client sends `/api/v1/chat/completions`
2. Route parses JSON once
3. `handleChat` receives parsed body
4. OmniRoute resolves source app and policy context
5. Privacy runtime scans request payload
6. If `BLOCK`, request fails before outbound provider call
7. If `MASK` or `TOKENIZE`, sanitized payload is forwarded upstream
8. Provider returns JSON response
9. OmniRoute restores placeholders for reversible transformed entities
10. Final response returns to client

### 4.2 Streaming

Phase 1 limitation:

- sanitize is applied before outbound call
- response restore is intentionally left out for streaming
- streaming reversible restore is deferred to a later phase

## 5. Detection / Classification / Transform Model

Default seeded examples currently cover:

- bank account -> `L1` -> `BLOCK`
- customer email -> `L2` -> `MASK`
- customer-like full name pattern -> `L2` -> `MASK`
- OCB project code -> `L3` -> `TOKENIZE`
- generic API key pattern -> `L1` -> `BLOCK`

Phase 1 supported detector types:

- `regex`
- `pattern`
- `dictionary`

Not yet included:

- NER
- BERT / spaCy model execution
- document ingestion pipeline from object storage or DMS

## 6. Restore / Vault Model

Restore session model:

- encrypted original values are stored in SQLite restore tables
- placeholders are mapped to original values using a session-scoped ID
- restore is available only for reversible transforms like `TOKENIZE`
- masked and blocked values are not restorable

Current tradeoff:

- phase 1 uses local encrypted DB persistence instead of Redis vault
- this keeps rollout smaller, but is not the long-term target vault design

## 7. Files Added / Modified

### Added

- `src/lib/db/migrations/018_privacy_filter_runtime.sql`
- `src/lib/privacy/*`
- `src/app/api/privacy/*`
- `src/app/api/internal/privacy/*`
- `src/app/(dashboard)/dashboard/privacy-filter/*`
- `tests/unit/privacy-*.test.mjs`
- `tests/integration/privacy-chat-wiring.test.mjs`
- `tests/integration/privacy-dashboard-wiring.test.mjs`
- `vitest.privacy.config.ts`

### Modified

- `src/app/api/v1/chat/completions/route.ts`
- `src/sse/handlers/chat.ts`
- `src/shared/constants/sidebarVisibility.ts`
- `src/shared/components/Sidebar.tsx`
- `src/app/(dashboard)/dashboard/settings/components/AppearanceTab.tsx`
- `src/i18n/messages/en.json`
- `src/i18n/messages/vi.json`
- `open-sse/translator/helpers/geminiHelper.ts`
- `open-sse/services/autoCombo/__tests__/providerDiversity.test.ts`
- `vitest.config.ts`

## 8. Verification Evidence

The implementation branch was verified with the following commands:

- `npm run lint`
- `npm run typecheck:core`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:vitest`
- `npx vitest run --config vitest.privacy.config.ts`

Observed results:

- lint: pass
- typecheck: pass
- unit tests: `1495/1495 pass`
- integration tests: `124/124 pass`
- vitest repo suite: `76/76 pass`
- privacy dashboard vitest suite: `2/2 pass`

## 9. Reviewer Focus Areas

Priority review points for this CR:

1. Request/response mutation safety in `src/lib/privacy/payload.ts`
2. Detection overlap precedence and policy override logic in `src/lib/privacy/detectors.ts`
3. Restore session integrity and encryption handling in `src/lib/privacy/store.ts`
4. Chat-path integration order inside `src/sse/handlers/chat.ts`
5. Management board safety when publishing malformed JSON config
6. Migration correctness and runtime event write amplification

## 10. Known Limitations

- streaming restore is not implemented yet
- policy editing is JSON-editor based, not a structured form workflow
- seeded rules are examples and need compliance validation before production rollout
- restore/session storage currently uses SQLite rather than Redis vault
- event storage may need throttling or async batching under very high volume
- there is still noisy test logging from backup hooks in some DB-reset tests

## 11. Operational Notes

Recommended rollout:

1. enable in shadow mode in a lower environment
2. review block/mask/tokenize decision ratios
3. validate OCB-specific dictionaries and profile overrides
4. test `OpenWebUI` and `OpenClaw` non-streaming flows first
5. monitor DB growth from runtime events and restore entities
6. only then enable production enforcement on selected profiles

Recommended environment controls:

- set `PRIVACY_FILTER_INTERNAL_TOKEN` for internal route protection
- review backup behavior if runtime event volume is high
- establish retention rules for runtime events and restore sessions

## 12. Rollback Plan

If the feature must be rolled back:

1. disable dashboard-driven config updates
2. remove privacy sanitize/restore invocation from chat pipeline
3. keep migration in place if safe, or roll back by deployment image/version
4. clear restore/runtime tables if operationally required

Fast rollback path:

- deploy previous OmniRoute image or revert commit `e51330f6`

## 13. Merge / Remote Status

Current state:

- implementation is committed locally on `codex/privacy-filter-phase1`
- commit hash: `e51330f6`

Remote limitation encountered:

- push to `origin` failed with permission error:
  - `Permission to diegosouzapw/OmniRoute.git denied to ThomasVNN`

Because of that, PR creation into `main` is blocked until repo push access or a writable fork remote is available.

## 14. Suggested PR Title / Description

Suggested title:

- `Add privacy filter runtime and dashboard`

Suggested short description:

- Introduce phase 1 privacy filtering for OmniRoute with request sanitization, non-streaming restore, management APIs, dashboard reporting, and full verification coverage.
