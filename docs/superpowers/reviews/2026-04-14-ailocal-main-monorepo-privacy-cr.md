# AILocal Main Monorepo + Privacy Filter CR

## Summary

CR này hợp nhất 2 thay đổi lớn vào repo gốc `AILocal`:

1. `AILocal` bắt đầu track trực tiếp full source tree của `OmniRoute`, `openclaw`, `open-webui`, và `claude-code` thay vì chỉ giữ deploy/docs ở root.
2. `OmniRoute` được tích hợp privacy filter phase 1 cho outbound request flow, management APIs, dashboard board, runtime restore non-streaming, và test coverage đi kèm.

## Scope

### 1. Root Monorepo Tracking

- bỏ mô hình nested git repo bên trong workspace active
- flatten source của:
  - `OmniRoute/`
  - `openclaw/`
  - `open-webui/`
  - `claude-code/`
- cập nhật tài liệu root để phản ánh `AILocal` là repo track full LocalAI project
- chỉnh `ops/audit_workspace.sh` để audit đúng snapshot workspace hiện tại

### 2. OmniRoute Privacy Filter

- thêm privacy runtime cho `chat.completions`
- single-parse request body ở `/api/v1/chat/completions`
- sanitize payload trước outbound call
- block request theo policy khi phát hiện entity level `L1`
- mask / tokenize entity theo profile
- restore placeholder ở response non-streaming
- thêm internal privacy APIs
- thêm dashboard page cho privacy management/reporting
- thêm DB migration cho privacy runtime

## Key Files

### Root Repo

- `README.md`
- `docs/WORKSPACE_STRUCTURE.md`
- `ops/audit_workspace.sh`

### OmniRoute Privacy Runtime

- `OmniRoute/src/app/api/v1/chat/completions/route.ts`
- `OmniRoute/src/sse/handlers/chat.ts`
- `OmniRoute/src/lib/privacy/*`
- `OmniRoute/src/app/api/internal/privacy/**`
- `OmniRoute/src/app/api/privacy/**`
- `OmniRoute/src/lib/db/migrations/022_privacy_filter_runtime.sql`

### OmniRoute Dashboard / UI

- `OmniRoute/src/app/(dashboard)/dashboard/privacy-filter/**`
- `OmniRoute/src/shared/constants/sidebarVisibility.ts`
- `OmniRoute/src/shared/components/Sidebar.tsx`
- `OmniRoute/src/app/(dashboard)/dashboard/settings/components/AppearanceTab.tsx`
- `OmniRoute/src/i18n/messages/en.json`
- `OmniRoute/src/i18n/messages/vi.json`

### OmniRoute Verification Fixes

- `OmniRoute/open-sse/translator/helpers/geminiHelper.ts`
- `OmniRoute/open-sse/services/autoCombo/__tests__/providerDiversity.test.ts`
- `OmniRoute/eslint.config.mjs`
- `OmniRoute/vitest.config.ts`
- `OmniRoute/.github/workflows/ci.yml`

## Verification

### OmniRoute

Đã chạy local trên `AILocal/OmniRoute`:

- `node --import tsx/esm --test tests/unit/privacy-*.test.mjs tests/integration/privacy-*.test.mjs`
- `npx vitest run --config vitest.privacy.config.ts`
- `npm run lint`
- `npm run typecheck:core`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:vitest`

Kết quả cuối:

- `privacy node/integration suite`: pass
- `privacy vitest`: `2/2 pass`
- `lint`: pass, warnings only
- `typecheck:core`: pass
- `test:unit`: `1508/1508 pass`
- `test:integration`: `124/124 pass`
- `test:vitest`: `76/76 pass`

### Root AILocal

Đã chạy:

- `bash ops/audit_workspace.sh`

Kết quả:

- audit pass
- workspace snapshot hợp lệ với active paths và non-deploy paths hiện có

## Source Tracking Notes

- các nested `.git` metadata đã được di chuyển ra ngoài repo gốc để root `AILocal` track source thật
- backup path:
  - `/Users/thont/Local/POC/.ailocal-embedded-git-backups/2026-04-14`

Các repo metadata đã backup gồm:

- `OmniRoute/.git`
- `OmniRoute/Proxy/grok2api/.git`
- `OmniRoute/Proxy/kimi-proxy/.git`
- `openclaw/.git`
- `open-webui/.git`
- `claude-code/.git`

## Rollout / Risk

### Rollout

- merge vào `AILocal/main`
- root repo từ thời điểm này trở thành source-of-truth cho full LocalAI workspace
- OmniRoute privacy filter phase 1 có thể bật profile dần qua dashboard config

### Residual Risk

- `lint` vẫn có warnings sẵn trong nhiều file legacy/current, nhưng không còn error
- `privacy` hiện restore non-streaming; streaming restore vẫn chưa bật ở phase này
- root repo commit sẽ rất lớn vì lần đầu ingest toàn bộ component sources

## Rollback

- rollback git commit ở root `AILocal`
- nếu cần khôi phục nested repo workflows cũ, dùng backup tại:
  - `/Users/thont/Local/POC/.ailocal-embedded-git-backups/2026-04-14`

## Reviewer Checklist

- xác nhận root `AILocal` đang track đầy đủ source của 4 component active
- xác nhận privacy dashboard xuất hiện tại `OmniRoute /dashboard/privacy-filter`
- xác nhận `/api/v1/chat/completions` parse body một lần
- xác nhận `npm run lint`, `npm run typecheck:core`, `npm run test:unit`, `npm run test:integration`, `npm run test:vitest` đều pass trên `OmniRoute`
- xác nhận `bash ops/audit_workspace.sh` pass ở root
