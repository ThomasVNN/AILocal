# Privacy Filter Design

## Goal

Add a full privacy-filter pipeline for OmniRoute that detects, classifies, transforms, validates, and optionally restores sensitive data before and after external AI calls, while keeping management, RBAC, and reporting centralized in OmniRoute.

## Scope

This design covers:

- privacy filtering for outbound requests sent through OmniRoute to external providers
- response restoration for reversible transforms
- a dedicated `privacy-filter` runtime service
- a management board inside OmniRoute for policies, rules, reports, and internal document rule packs
- RBAC for privacy governance and operations
- rollout phases and testing strategy

This design does not cover:

- a standalone external dashboard for the privacy service
- full document search or knowledge management
- mandatory NER model integration in phase 1

## Decision Summary

The chosen architecture is:

- OmniRoute remains the control plane and request gateway.
- A new `privacy-filter` service becomes the execution plane for sanitize and restore operations.
- OpenWebUI and OpenClaw keep calling OmniRoute only.
- RBAC, management board, policy source-of-truth, and reporting remain inside OmniRoute.
- Runtime entity vault data lives in Redis with encryption and TTL.
- Internal document handling in phase 1 is rule-pack and dictionary management, not full raw document storage in the vault.

## Current vs Target Architecture

### Current

- OpenWebUI, OpenClaw Gateway, and OpenClaw CLI call OmniRoute `/v1`.
- OmniRoute performs request validation, routing, translation, logging, and provider calls.
- No dedicated privacy execution plane exists.

### Target

- OpenWebUI, OpenClaw Gateway, and OpenClaw CLI still call OmniRoute `/v1`.
- OmniRoute calls `privacy-filter` before external egress.
- OmniRoute calls `privacy-filter` again to restore reversible placeholders in responses.
- OmniRoute hosts the management board, policy CRUD, audit views, and reporting.
- `privacy-filter` is an internal service only, not directly exposed to end users.

## High-Level Architecture

### OmniRoute Control Plane

Responsibilities:

- expose the privacy management board in the dashboard
- own RBAC and permission checks
- store privacy policies, entity catalog, rule definitions, internal document rule packs, bundle versions, and audit history
- determine which privacy profile applies to each request
- orchestrate sanitize and restore calls to `privacy-filter`
- decide fail-closed or local fallback behavior when sanitize fails

### Privacy-Filter Execution Plane

Responsibilities:

- pre-process request payloads
- detect sensitive entities
- classify entities into privacy levels
- transform content according to policy
- validate sanitized payloads
- manage reversible placeholder sessions
- restore reversible placeholders in downstream responses
- expose internal health and runtime metrics APIs

### Redis Runtime Vault

Responsibilities:

- store encrypted placeholder mappings
- store sanitize and restore session metadata
- enforce short TTL for reversible mappings
- support streaming restore sessions

## Request and Response Flow

### Request Flow

1. OpenWebUI or OpenClaw sends a request to OmniRoute `/v1`.
2. OmniRoute authenticates the request and resolves the applicable `policyProfile`.
3. OmniRoute sends the raw request to `privacy-filter /internal/privacy/sanitize`.
4. `privacy-filter` runs:
   - preprocess
   - detect
   - classify
   - transform
   - validate
5. If the decision is `blocked`, OmniRoute does not send the payload to the external provider.
6. If the decision is `allow` or `transformed`, OmniRoute sends the sanitized payload to the external provider.

### Response Flow

1. OmniRoute receives the upstream provider response.
2. If the sanitize step created a reversible restore session, OmniRoute calls `privacy-filter /internal/privacy/restore`.
3. `privacy-filter` restores only placeholders allowed by policy.
4. OmniRoute returns the restored response to the client.

### Streaming Flow

1. OmniRoute performs `sanitize` once before opening the upstream stream.
2. `privacy-filter` returns a `restoreSessionId` if reversible placeholders exist.
3. OmniRoute forwards provider chunks through `privacy-filter /restore`.
4. `privacy-filter` restores placeholders incrementally per chunk or chunk window.
5. The restore session is closed when the stream ends or expires by TTL.

## Privacy Levels and Actions

The baseline classification model follows four levels:

- `L1 Critical`: block request, never send externally
- `L2 High`: mask sensitive values
- `L3 Medium`: pseudonymize or replace with placeholders and store reversible mapping
- `L4 Low`: allow pass-through

### Baseline OCB Mapping

Examples:

- `BANK_ACCOUNT`, `CARD_PAN`, `PIN`, `OTP`, `CMND_CCCD`, `PASSPORT`, `PRIVATE_KEY`, `SECRET_KEY`: `L1`
- `CUSTOMER_NAME`, `PHONE`, `EMAIL`, `ADDRESS`, `DOB`: `L2`
- `OCB_INTERNAL_ID`, `PROJECT_CODE`, `TRANSACTION_REF`, `BUSINESS_LOGIC_INTERNAL`: `L3`
- `PUBLIC_DOC`, `GENERIC_TECHNICAL_CONTENT`, `SAFE_CODE_SNIPPET`: `L4`

Profiles can override these defaults.

## Detection Pipeline

Phase 1 detection stack:

- regex engine
- custom pattern matcher
- dictionary matcher

Phase 2 or later:

- NER adapter
- language-aware normalization improvements
- confidence-based detector fusion

### Pre-Processor

Responsibilities:

- normalize whitespace and common delimiters
- preserve positional mapping where needed for replace operations
- identify payload sections to scan, such as message content, system text, tool arguments, and selected metadata fields
- detect language only for rule selection and later NER adapters

### Detection Engines

#### Regex Engine

Used for:

- account numbers
- card numbers
- phone numbers
- emails
- ID card formats
- API keys and generic secrets

#### Pattern Matcher

Used for:

- OCB internal identifier formats
- project code formats
- transaction reference formats
- known internal naming conventions

#### Dictionary Matcher

Used for:

- internal document term packs
- restricted project names
- protected business terms
- curated internal references

## Classification Engine

The classification engine maps a detection to:

- `entityType`
- `level`
- `transformMode`
- `restoreMode`
- `confidence`
- `matchedRule`

Priority order:

1. profile-specific rule override
2. source-app-specific override
3. internal-document rule-pack override
4. entity type default

If multiple detections overlap, the more restrictive result wins.

## Transform Engine

Supported modes:

- `BLOCK`
- `MASK`
- `TOKENIZE`
- `ALLOW`

### Behavior

- `BLOCK`: reject the request and return a policy-safe error
- `MASK`: redact or partially hide the original value and do not restore it later
- `TOKENIZE`: replace the original value with a deterministic session placeholder such as `[PERSON_001]` and store an encrypted reversible mapping
- `ALLOW`: no content transformation

### Placeholder Rules

Placeholders should:

- be stable within a single request or restore session
- be unique per entity type and ordinal
- avoid exposing original text structure
- remain human-readable enough for the downstream model to preserve coherence

## Validator

The validator re-scans transformed content before external egress.

Responsibilities:

- verify no `L1` data remains
- verify masked or tokenized values were applied correctly
- reject content when residual sensitive data remains above the configured threshold

If validation fails:

- the request is blocked by default
- or routed to a local trusted fallback if the active policy profile explicitly allows it

## Restore Engine

Restore is applied only to reversible transformations.

Rules:

- `BLOCK` items are never restored
- `MASK` items are never restored
- `TOKENIZE` items can be restored if the policy allows it
- unresolved placeholders must be tracked and reported

For phase 1:

- restore operates on structured JSON payloads only
- streaming restore is added in phase 2
- restore is best-effort only when policy says placeholders can remain visible
- for profiles that require full fidelity, unresolved placeholders cause an error

## Control Plane Data Model

### EntityType

Fields:

- `id`
- `name`
- `category`
- `defaultLevel`
- `defaultTransform`
- `restoreMode`
- `enabled`

### PrivacyRule

Fields:

- `id`
- `name`
- `type`: `regex | pattern | dictionary | ner`
- `entityTypeId`
- `severityLevel`
- `priority`
- `confidence`
- `patternConfig`
- `scope`
- `enabled`

### PolicyProfile

Fields:

- `id`
- `name`
- `description`
- `appliesTo`
- `levelOverrides`
- `transformOverrides`
- `fallbackMode`
- `restorePolicy`
- `activeBundleVersion`

### InternalDocumentSet

Purpose:

- manage rule-pack inputs used for internal sensitive term detection

Fields:

- `id`
- `name`
- `documentClass`
- `businessDomain`
- `sourceType`
- `entries`
- `version`
- `status`

The control plane stores metadata and compiled dictionaries, not whole raw documents in the vault.

### BundleVersion

Fields:

- `version`
- `checksum`
- `compiledAt`
- `compiledBy`
- `status`
- `changeSummary`

## Runtime Vault Model in Redis

Key namespaces:

- `privacy:session:{restoreSessionId}`
- `privacy:entity:{restoreSessionId}:{placeholderId}`
- `privacy:bundle:active`
- `privacy:bundle:{version}`

### Session Record

Fields:

- `requestId`
- `sourceApp`
- `policyProfileId`
- `bundleVersion`
- `createdAt`
- `expiresAt`
- `stream`
- `entityCount`

### Entity Record

Fields:

- `placeholder`
- `originalValue`
- `entityType`
- `level`
- `transformMode`
- `hash`
- `expiresAt`

All vault values must be encrypted before writing to Redis.

## Internal API Contract

### `POST /internal/privacy/sanitize`

Input:

- `requestId`
- `sessionId`
- `sourceApp`
- `policyProfileId`
- `bundleVersion`
- `endpointType`
- `stream`
- `actorContext`
- `documentContext`
- `payload`

Output:

- `decision`
- `sanitizedPayload`
- `restoreSessionId`
- `entitySummary`
- `validator`
- `policyTrace`
- `blockResponse`

### `POST /internal/privacy/restore`

Input:

- `requestId`
- `restoreSessionId`
- `sourceApp`
- `endpointType`
- `stream`
- `payload`

Output:

- `restoredPayload`
- `restoreSummary`

### `POST /internal/privacy/bundles/activate`

Input:

- `bundleVersion`
- `checksum`
- `compiledBundle`

Output:

- `accepted`
- `activeBundleVersion`
- `loadedAt`

### `GET /internal/privacy/healthz`

Returns:

- service status
- Redis connectivity status
- active bundle version

### `GET /internal/privacy/stats`

Returns:

- scan counts
- decision counts
- restore success and failure counts
- vault metrics
- active bundle version

## Management Board

The privacy management board lives in OmniRoute.

### Overview

Shows:

- requests scanned
- counts by decision type
- top entity types
- top source apps
- active bundle version
- vault and restore metrics

### Policies

Functions:

- create and edit policy profiles
- map profiles to source apps, API keys, and workspaces

### Rules

Functions:

- CRUD for regex, pattern, and dictionary rules
- priority and confidence tuning
- dry-run testing before publish

### Entity Catalog

Functions:

- manage entity types
- set default level and transform strategy
- define restore rules

### Internal Documents

Functions:

- manage internal document sets and dictionaries
- import, version, publish, archive, and rollback rule packs
- map document classes to policy behavior

### Reports and Audit

Functions:

- trend reports
- block reports
- restore reports
- configuration change history
- sensitive access audit

## RBAC

RBAC stays in OmniRoute.

Roles:

- `privacy_admin`
- `compliance_auditor`
- `ops_admin`
- `app_owner`
- `viewer`
- `break_glass_admin`

Principles:

- `privacy-filter` trusts OmniRoute service identity, not end-user identity
- break-glass actions are rare, explicit, and fully audited
- normal dashboards never expose original values from the vault

## Failure Model

The default external egress behavior is fail-closed.

### Sanitize Failure

If sanitize fails because of timeout, version mismatch, internal error, or validation failure:

- raw payload must not be sent to external providers
- OmniRoute blocks the request by default
- or uses a local trusted fallback only if the active policy profile explicitly allows it

### Restore Failure

If restore fails:

- profiles that require full fidelity return an error
- profiles that allow degraded restore may return sanitized placeholders

### Circuit Breaker and Timeouts

OmniRoute should use:

- a short timeout budget for sanitize
- a short timeout budget for restore
- a circuit breaker for the privacy service internal dependency

## Logging and Audit Requirements

### Configuration Audit

Track:

- policy CRUD
- rule CRUD
- internal document set publish and rollback
- bundle activation

### Runtime Audit

Track:

- which policy profile matched
- which entity types were detected
- whether a request was blocked, masked, tokenized, or allowed
- source app and request correlation ID

### Sensitive Access Audit

Track:

- break-glass original-value access
- manual restore or debug access
- privileged report exports

Raw sensitive values must not be written into standard logs.

## Rollout Plan

### Phase 1 Foundation

- create `privacy-filter` service skeleton
- compile and publish bundles
- implement regex, pattern, and dictionary detectors
- support `BLOCK`, `MASK`, `TOKENIZE`, `ALLOW`
- add encrypted Redis vault
- support non-streaming sanitize and restore
- add management board basics
- add baseline audit and reports

### Phase 2 Streaming and Governance

- add streaming restore
- expand policy binding by source app, API key, and workspace
- add full reports and audit UX
- add bundle rollback
- add management workflows for enforcement tuning after shadow-mode learning

### Phase 3 Intelligence

- add NER adapter
- add confidence fusion
- add stronger language-aware preprocessing
- extend internal document ingestion
- add local trusted LLM fallback orchestration

## Testing Strategy

### Unit Tests

- detector behavior
- classifier precedence
- transform behavior
- placeholder generation
- vault encryption and TTL helpers
- restore logic
- bundle compiler and validator

### Integration Tests

- OmniRoute to privacy-filter sanitize flow
- block prevents external provider call
- transformed request preserves downstream contract
- response restore correctness
- policy profile selection by source app and API key

### Streaming Tests

- SSE chunk restore
- interrupted stream cleanup
- unresolved placeholder handling

### Security Tests

- unauthorized internal API access
- encrypted vault persistence
- no raw sensitive data in logs
- break-glass audit enforcement

### Dashboard Tests

- policy CRUD
- rule CRUD
- internal document set publish
- bundle activation and rollback
- report visibility by role

## Shadow Mode Requirement

Phase 1 should include shadow mode.

Shadow mode behavior:

- detect, classify, transform, and validate in parallel
- do not block production traffic
- record what would have been blocked or transformed
- allow tuning of false positives before enforcement

This is required to reduce rollout risk for internal-document and business-term rules.

## Open Questions Resolved

- Dashboard and RBAC stay in OmniRoute, not in the privacy service.
- OpenWebUI and OpenClaw continue to call OmniRoute only.
- The privacy service is internal-only.
- Internal document management in phase 1 is dictionary and rule-pack driven.
- Phase 1 does not require a heavyweight NER model.

## Recommended Implementation Boundary

The first implementation plan should focus on:

- control-plane models and APIs in OmniRoute
- internal `privacy-filter` service contract
- bundle compiler and publisher
- Redis encrypted vault
- non-streaming sanitize and restore path
- management board MVP
- shadow mode

This boundary is intentionally narrow enough to ship a working vertical slice without mixing in phase 2 and phase 3 complexity.
