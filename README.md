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
- `deploy/DEPLOYMENT_GUIDE.md` (guide chuẩn để cài, deploy, verify, backup, rollback)
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

## Deploy nhanh

Local:

```bash
bash ops/agent.sh deploy local
```

Server update:

```bash
SERVER_SSH_PASS='***' bash ops/agent.sh deploy server
```

Guide đầy đủ cho:

- prerequisites
- `/etc/hosts`
- env/secrets
- first deploy local
- first install server
- partial restart
- healthcheck / smoke test
- backup / rollback

xem tại `deploy/DEPLOYMENT_GUIDE.md`.
