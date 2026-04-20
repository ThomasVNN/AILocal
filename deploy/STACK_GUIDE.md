# LocalAgent 2-Layer Stack (Infra Platform + Compute Apps)

Source of truth vận hành: `deploy/DEPLOY_KNOWLEDGE.md`

## Brand Code (deployment convention)
- Prefix tài nguyên: `localagent_*` cho network, `la-*` cho service name logic.
- Tách rõ `layer1-platform` và `layer2-apps`, deploy độc lập.
- Toàn bộ persistent path đặt dưới `${LA_DATA_ROOT:-/data/localagent}/...`.
- Chỉ `Traefik` mở cổng ra ngoài; DB/Redis/MinIO không publish host port.
- Traefik terminate TLS ở edge (`80 -> HTTPS port theo env`, app backend vẫn chạy HTTP nội bộ).

## 1) Kết quả audit nhanh
- `OpenWebUI`: hỗ trợ `DATABASE_URL` (Postgres), `REDIS_URL`, `STORAGE_PROVIDER=s3` (MinIO).
- `OmniRoute`: runtime hiện tại vẫn bám `SQLite` local (`DATA_DIR/storage.sqlite`), chưa có Postgres native.
- `OpenClaw`: chủ yếu lưu state/file local theo `OPENCLAW_STATE_DIR`/config path, chưa chuẩn DB external cho core gateway.

## 2) Cấu trúc mới
- Layer 1: `deploy/layer1-platform/docker-compose.yml`
  - `postgres-primary` + `postgres-backup`
  - `redis` (auth + persistence)
  - `minio` + `minio-init`
  - `traefik` (TLS routing + rate-limit cơ bản)
- Layer 2: `deploy/layer2-apps/docker-compose.yml`
  - `omniroute` (router/gateway)
  - `open-webui` (external DB/Redis/S3 endpoint)
  - `openclaw-gateway` + `openclaw-cli`

## 2.1) Domain conventions
- Local: `*.localagent.local` → `127.0.0.1`
- Server: `*.localagent.server` → IP Tailscale của server (ví dụ `100.101.77.8`)

## 3) Data layout chuẩn
```text
${LA_DATA_ROOT:-/data/localagent}/
  platform/
    db/primary
    redis/data
    minio/data
    logs/{postgres,redis,minio,traefik}
    backups/postgres
    proxy/acme
    proxy/traefik/{ca,certs}
  apps/
    omniroute/{data,logs}
    open-webui/runtime
    openclaw/{config,workspace}
```

## 4) Cách chạy
1. Tạo env:
   - `cp deploy/env/stack.env.example deploy/env/stack.env`
   - chỉnh secret/host/domain trong `deploy/env/stack.env` (đặc biệt: `LA_DATA_ROOT`, `OMNIROUTE_HOST`, `OPENWEBUI_HOST`, `OPENCLAW_HOST`)
   - OmniRoute required: `JWT_SECRET`, `API_KEY_SECRET`, `STORAGE_ENCRYPTION_KEY`, `INITIAL_PASSWORD`
   - nếu chưa có DNS nội bộ, map các host trên về IP server trong `/etc/hosts`
2. Tạo thư mục data:
   - Server (path dưới `/data/...`): `sudo -E bash deploy/scripts/bootstrap_data_dirs.sh`
   - Local (path user-owned): `bash deploy/scripts/bootstrap_data_dirs.sh`
3. Khởi động layer 1:
   - `bash deploy/scripts/stack.sh platform up -d`
   - Traefik dynamic config được render ra: `${LA_DATA_ROOT}/platform/proxy/traefik/dynamic.yml`
   - Traefik cert nội bộ được generate ra: `${LA_DATA_ROOT}/platform/proxy/traefik/{ca,certs}`
   - Traefik được gắn `edge` network aliases theo các host `${OMNIROUTE_HOST}`, `${OPENWEBUI_HOST}`... để container (ví dụ OpenWebUI) gọi ngược qua domain `*.localagent.*` mà không bị resolve về `127.0.0.1` trong container.
4. Bootstrap OpenClaw transport/security (chạy 1 lần, hoặc khi đổi host/TLS/proxy):
   - `bash deploy/scripts/bootstrap_openclaw.sh`
   - Script này set `gateway.controlUi.allowedOrigins=["https://<openclaw-host>"]`, `gateway.trustedProxies`, và `gateway.controlUi.dangerouslyDisableDeviceAuth` theo env hiện tại
5. Khởi động layer 2:
   - `bash deploy/scripts/stack.sh apps up -d`
6. Bootstrap app clients:
   - `bash deploy/scripts/bootstrap_app_clients.sh`
   - Script này provision/reconcile OmniRoute app keys cho OpenWebUI + OpenClaw, sync OpenWebUI runtime config trong Postgres, và seed OpenClaw provider/model defaults theo catalog của OmniRoute
7. Mở OpenClaw dashboard:
   - `bash deploy/scripts/openclaw_dashboard.sh`
   - Script này in public URL đã kèm `#token=...` theo `OPENCLAW_HOST` hiện tại

## 4.1) Quick start (local)
- `bash ops/agent.sh deploy local`

## 4.2) Quick update (server)
- `bash ops/agent.sh deploy server`

## 5) HA/stateless notes
- `OpenWebUI` có thể scale ngang (ví dụ `--scale open-webui=3`) vì session/cache đã đẩy ra Redis, DB ra Postgres, file lên MinIO.
- `OmniRoute` hiện vẫn stateful do SQLite local, nên giữ 1 replica cho production stable.
- `OpenClaw gateway` hiện cũng theo hướng single instance + externalized config/workspace volume.

## 6) Release từng phần (upgrade từng service)
- Local source mode: trước mỗi partial release, build lại image đúng service từ source workspace.
- OmniRoute: `ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/build_app_images.sh omniroute && ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps up -d --no-deps omniroute`
- OpenWebUI: `ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/build_app_images.sh open-webui && ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps up -d --no-deps open-webui`
- OpenClaw: `ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/build_app_images.sh openclaw && ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps up -d --no-deps openclaw-gateway openclaw-cli`
- Registry mode: publish image mới rồi pull/up bằng `--no-build`.
- Publish all: `LOCALAGENT_IMAGE_REGISTRY=mizuk1210.mulley-ray.ts.net:9999 bash deploy/scripts/publish_multiarch_images.sh all`
- Publish one app: `LOCALAGENT_IMAGE_REGISTRY=mizuk1210.mulley-ray.ts.net:9999 bash deploy/scripts/publish_multiarch_images.sh omniroute`
- Rollout registry app: `ENV_FILE=deploy/env/stack.env bash deploy/scripts/stack.sh apps pull omniroute && ENV_FILE=deploy/env/stack.env bash deploy/scripts/stack.sh apps up -d --no-build --no-deps omniroute`
- Sau khi upgrade `omniroute`, `open-webui`, hoặc `openclaw-gateway`, chạy lại `bash deploy/scripts/bootstrap_app_clients.sh` để đồng bộ app keys/runtime config

## 6.1) HTTPS local/server
- Server: truy cập UI qua `https://router.localagent.server`, `https://chat.localagent.server`, `https://openclaw.localagent.server`, ...
- Local macOS: truy cập UI qua `https://router.localagent.local:8443`, `https://chat.localagent.local:8443`, `https://openclaw.localagent.local:8443`, ...
- Nếu browser cảnh báo cert, trust CA tại `${LA_DATA_ROOT}/platform/proxy/traefik/ca/ca.crt` trên máy client.
- `TRAEFIK_HSTS_SECONDS=0` là mặc định an toàn cho private domains; chỉ bật HSTS dài hạn khi bạn đã ổn định cert rotation.

## 6.2) Auth bootstrap notes
- `OPENWEBUI_OPENAI_API_KEY` và `OPENCLAW_OPENAI_API_KEY` không nên để `bootstrap`; dùng `bootstrap_app_clients.sh` để provision key thật hoặc reconcile key có sẵn
- Local trusted dev gateway có thể đặt `OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH=true` để bỏ pairing trong browser
- Server/public gateway nên giữ `OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH=false`

## 6.3) Troubleshooting nhanh
- OpenWebUI vào được nhưng models rỗng:
  - `ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_app_clients.sh`
- OpenClaw báo `pairing required`:
  - `ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_openclaw.sh`
  - `ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_app_clients.sh`
  - `ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/openclaw_dashboard.sh`
- OpenClaw log `Incorrect API key provided`:
  - `ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_app_clients.sh`

## 7) Backup nhanh
- Postgres: tự backup theo lịch vào `${LA_DATA_ROOT:-/data/localagent}/platform/backups/postgres`
- Snapshot file data (MinIO + app volumes): `sudo -E bash deploy/scripts/backup_snapshot.sh`

## 8) Deploy lên server
- Hướng dẫn chi tiết: `deploy/SERVER_GUIDE.md`
- Sync nhanh thư mục `deploy/` (không sync secrets): `bash deploy/scripts/remote_sync.sh user@host /opt/localagent`
