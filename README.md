# LocalAgent (2-layer Docker Stack)

LocalAgent gồm 2 layer:
- **Layer 1 (platform/infra):** Postgres + Redis + MinIO + Traefik
- **Layer 2 (apps/compute):** OmniRoute + OpenWebUI + OpenClaw

Luồng chuẩn hiện tại:
- **OmniRoute** là control plane + API plane trung tâm.
- **OpenWebUI** chỉ gọi `OmniRoute /v1`.
- **OpenClaw** (web UI + gateway) cũng chỉ gọi `OmniRoute /v1`.
- Các provider Web2API (`chatgpt-web2api`, `perplexity-web2api`, `gemini-web2api`, `claude`) được quản lý tập trung trong OmniRoute.

Tài liệu chi tiết:
- `deploy/DEPLOY_KNOWLEDGE.md` (source of truth cho deploy runtime, generated files, endpoints)
- `deploy/STACK_GUIDE.md` (kiến trúc, release từng service)
- `deploy/SERVER_GUIDE.md` (cài đặt + vận hành trên server)
- `docs/CICD.md` (CI/CD local + server, variables, lưu ý)
- `docs/WORKSPACE_STRUCTURE.md` (quy ước cấu trúc root, legacy/artifacts, acceptance criteria)

## Workspace layout
- `deploy/`, `ops/`, `docs/`: điểm vào vận hành thật của stack 2-layer hiện tại.
- `.localagent-data/`: runtime data root đang được container mount khi chạy local.
- `OmniRoute/`, `openclaw/`, `open-webui/`, `claude-code/`: source/workspace đang active.
- `legacy/unified-stack/`: compose/config/state/script của stack cũ, được cô lập để không lẫn với deploy chuẩn.
- `legacy/quarantine/`: dữ liệu thô/sensitive capture không thuộc runtime hiện tại.
- `artifacts/`: image tar, backup, snapshot để tham chiếu hoặc restore thủ công.
- `OmniRoute-merge/`: merge sandbox đang có local edit, không nằm trong deploy path hiện tại.

Audit nhanh workspace:

```bash
bash ops/audit_workspace.sh
```

Nguyên tắc an toàn:
- `ops/agent.sh`, `deploy/scripts/*`, `deploy/layer*` chỉ được phép phụ thuộc vào stack 2-layer hiện tại.
- Không xóa trực tiếp `legacy/` hoặc `artifacts/` nếu chưa xác nhận không còn nhu cầu restore/forensics.
- Nếu cần dọn tiếp, ưu tiên xóa generated output trong repo con trước khi đụng vào source hoặc runtime data.

## Domain conventions
- **Local (Mac):** `*.localagent.local` trỏ về `127.0.0.1`
- **Server (Linux):** `*.localagent.server` trỏ về IP Tailscale của server (ví dụ `100.101.77.8`)

## Deploy local (Mac M1)
1) Thêm hostnames vào `/etc/hosts`:

```text
127.0.0.1  router.localagent.local api.localagent.local chat.localagent.local openclaw.localagent.local s3.localagent.local minio.localagent.local traefik.localagent.local
```

2) Deploy (tự generate env + migrate HTTPS env + build images arm64 + up platform/apps + reconcile app config + healthcheck + smoke test):

```bash
cd <path-to-LocalAgent>
bash ops/agent.sh deploy local
```

Env local mặc định: `deploy/env/stack.local.env` (được tạo tự động nếu chưa có).

## Deploy server (Linux Intel, qua Tailscale)
### 1) Trên máy client (Mac) để truy cập UI qua domain
Thêm hostnames vào `/etc/hosts`:

```text
100.101.77.8  router.localagent.server api.localagent.server chat.localagent.server openclaw.localagent.server s3.localagent.server minio.localagent.server traefik.localagent.server
```

### 2) Lần đầu setup stack trên server
Làm theo `deploy/SERVER_GUIDE.md` (tạo `deploy/env/stack.env`, bootstrap data dir, up `platform` rồi `apps`).

### 3) Update/redeploy nhanh
Script này build image `linux/amd64`, sync `deploy/` (không sync secrets), migrate HTTPS env trên server, reconcile `platform` + `openclaw-gateway` + `omniroute` + `open-webui`, rồi chạy healthcheck + smoke test:

```bash
cd <path-to-LocalAgent>
SERVER_SSH_PASS='***' bash ops/agent.sh deploy server
```

Yêu cầu trên máy client (Mac): có `sshpass` để SSH bằng password (khuyến nghị chuyển sang SSH key để bỏ bước này).

Các biến quan trọng:
- `SERVER_REMOTE` (default: `mzk-12-10@100.101.77.8`)
- `SERVER_DIR` (default: `~/localagent`)
- `SERVER_ENV_FILE` (default: `~/localagent/deploy/env/stack.env`)

## Healthcheck
- Local:
  - `ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/healthcheck.sh local`
- Server (chạy trên server):
  - `ENV_FILE=deploy/env/stack.env bash deploy/scripts/healthcheck.sh server`

## Smoke test
- Local:
  - `ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/smoke_stack.sh local`
- Server (chạy trên server):
  - `ENV_FILE=deploy/env/stack.env bash deploy/scripts/smoke_stack.sh server`

Smoke test xác nhận:
- OmniRoute public catalog có model
- OmniRoute có ít nhất 1 provider trung tâm đang active
- OpenWebUI runtime đang trỏ về `http://omniroute:<port>/v1` và không còn key `bootstrap`
- OpenClaw runtime đang trỏ về `http://omniroute:<port>/v1`
- Đường chat trung tâm `client -> OmniRoute -> provider` trả kết quả thật

## HTTPS / certificates
- Server mặc định publish `80` và `443`; local macOS mặc định publish `80` và `8443`.
- Cert nội bộ được generate tại `${LA_DATA_ROOT}/platform/proxy/traefik/certs`.
- CA nội bộ nằm tại `${LA_DATA_ROOT}/platform/proxy/traefik/ca/ca.crt`; nếu muốn browser hết cảnh báo cert, trust CA này trên máy client.
- Local trên macOS hiện dùng `8443` mặc định vì Tailscale system extension thường chiếm `443`, nên truy cập local bằng `https://<host>:8443`.
