# Server Deploy Guide (Ubuntu Intel)

Source of truth vận hành: `deploy/DEPLOY_KNOWLEDGE.md`

## Mục tiêu
- Chạy `layer1-platform` (Postgres/Redis/MinIO/Traefik) và `layer2-apps` (OmniRoute/OpenWebUI/OpenClaw) theo 2-layer stack.
- Toàn bộ persistent data nằm dưới `${LA_DATA_ROOT:-/data/localagent}`.
- Release từng phần bằng cách restart đúng service (không cần down toàn stack).

## Prereqs
- Docker Engine + Docker Compose plugin (`docker compose version` phải chạy được)
- Mở cổng từ LAN vào server:
  - `80/tcp` (Traefik)
  - `443/tcp` (Traefik HTTPS)
  - `8088/tcp` (Traefik dashboard, optional)

## Deploy (khuyến nghị trên server)
1) Copy thư mục `deploy/` lên server (hoặc clone repo này vào server).

2) Tạo env:
- `cp deploy/env/stack.server.env.example deploy/env/stack.env`
- Chỉnh các biến required: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `MINIO_ROOT_*`, `JWT_SECRET`, `API_KEY_SECRET`, `STORAGE_ENCRYPTION_KEY`, `INITIAL_PASSWORD`…

3) Tạo data directories (chạy 1 lần):
- `sudo -E bash deploy/scripts/bootstrap_data_dirs.sh`

4) Start infra:
- `bash deploy/scripts/stack.sh platform up -d`
  - bước này sẽ auto-generate CA/cert nội bộ cho Traefik dưới `${LA_DATA_ROOT}/platform/proxy/traefik`

5) Bootstrap OpenClaw transport/security:
- `bash deploy/scripts/bootstrap_openclaw.sh`
  - bước này sẽ set origin HTTPS cho Control UI, trust Traefik proxy IP, và giữ `OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH=false` trừ khi bạn chủ động đổi env

6) Start apps:
- `bash deploy/scripts/stack.sh apps up -d`

7) Reconcile app auth/runtime:
- `bash deploy/scripts/bootstrap_app_clients.sh`
  - provision OmniRoute app keys cho OpenWebUI/OpenClaw nếu env còn placeholder
  - sync OpenWebUI runtime config trong Postgres
  - seed OpenClaw provider/model defaults theo OmniRoute catalog

8) Lấy dashboard URL cho OpenClaw:
- `bash deploy/scripts/openclaw_dashboard.sh`
  - script in public URL đã kèm `#token=...` theo host/port hiện tại

## DNS / Hosts
- Nếu không có DNS nội bộ, thêm `/etc/hosts` trên máy client:
  - `<server-ip>  router.localagent.server api.localagent.server chat.localagent.server openclaw.localagent.server`
  - `<server-ip>  s3.localagent.server minio.localagent.server traefik.localagent.server`

Ghi chú: nếu bạn truy cập qua Tailscale, `<server-ip>` có thể là IP Tailnet (ví dụ `100.101.77.8`).

## HTTPS / Certificates
- Truy cập qua:
  - `https://router.localagent.server`
  - `https://chat.localagent.server`
  - `https://openclaw.localagent.server`
  - `https://minio.localagent.server`
  - `https://traefik.localagent.server`
- CA nội bộ của server nằm tại `${LA_DATA_ROOT}/platform/proxy/traefik/ca/ca.crt`.
- Nếu truy cập từ Mac client, copy file CA này về máy client và trust nó để bỏ cảnh báo cert.

## Upgrade / Rollback nhanh
- Upgrade 1 service: xem `deploy/STACK_GUIDE.md`
- Rollback: đổi tag image trong `deploy/env/stack.env` rồi chạy lại `bash deploy/scripts/stack.sh apps up -d --no-deps <service>`

## Backup
- Postgres backup tự chạy (xem `${LA_DATA_ROOT:-/data/localagent}/platform/backups/postgres`)
- Snapshot file data: `sudo -E bash deploy/scripts/backup_snapshot.sh`

## Security baseline (khuyến nghị)
- Đổi mật khẩu user, ưu tiên SSH key-only, tắt password login cho SSH.
- Có thể giữ `REQUIRE_API_KEY=false` trong bootstrap đầu tiên; sau khi `bootstrap_app_clients.sh` đã provision app keys và healthcheck xanh, mới cân nhắc bật `REQUIRE_API_KEY=true`.
- Giữ `gateway.trustedProxies` chỉ trỏ tới Traefik edge IP hiện tại; nếu đổi IP/container, chạy lại `bootstrap_openclaw.sh`.
- Giữ `OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH=false` trên server/public gateway.
