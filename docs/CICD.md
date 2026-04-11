# CI/CD Guide (Local + Server)

Tài liệu này mô tả cách build/deploy LocalAgent theo “2-layer stack” bằng các script đã có trong repo.

Source of truth vận hành: `deploy/DEPLOY_KNOWLEDGE.md`

## 0) Khái niệm nhanh

LocalAgent chạy theo 2 layer:
- **Layer 1 (platform/infra):** Postgres + Redis + MinIO + Traefik
- **Layer 2 (apps/compute):** OmniRoute + OpenWebUI + OpenClaw

Traefik là cổng duy nhất publish ra host:
- local macOS: `80/8443`
- server Linux: `80/443`
- dashboard: `8088`

HTTP được redirect sang HTTPS port theo env.

## 1) Domain & /etc/hosts

### Local (Mac)
Suffix: `*.localagent.local` → `127.0.0.1`

Thêm vào `/etc/hosts` trên Mac:
```text
127.0.0.1  router.localagent.local api.localagent.local chat.localagent.local openclaw.localagent.local s3.localagent.local minio.localagent.local traefik.localagent.local
```

Lưu ý: local macOS mặc định dùng `TRAEFIK_HTTPS_PORT=8443` để tránh xung đột với Tailscale trên port `443`.

### Server (Linux)
Suffix: `*.localagent.server` → IP Tailscale server (ví dụ `100.101.77.8`)

Thêm vào `/etc/hosts` trên máy client (Mac) để truy cập UI:
```text
100.101.77.8  router.localagent.server api.localagent.server chat.localagent.server openclaw.localagent.server s3.localagent.server minio.localagent.server traefik.localagent.server
```

## 2) Env files (variables)

### 2.1 File env nào dùng ở đâu

- **Local:** `deploy/env/stack.local.env` (được generate tự động lần đầu)
- **Server:** `deploy/env/stack.env` (tự tạo trên server, không sync secrets từ máy local)

Mẫu:
- `deploy/env/stack.env.example` (mặc định `.localagent.local`)
- `deploy/env/stack.server.env.example` (mặc định `.localagent.server`)

### 2.2 Nhóm biến quan trọng

**Shared**
- `TZ`
- `LA_DATA_ROOT` (local mặc định: `.localagent-data` trong repo; server khuyến nghị: `/data/localagent`)

**Platform/Infra**
- Postgres: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- Redis: `REDIS_PASSWORD`
- MinIO: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BOOTSTRAP_BUCKET`
- Traefik: `TRAEFIK_HTTP_PORT`, `TRAEFIK_HTTPS_PORT`, `TRAEFIK_DASHBOARD_PORT`, `TRAEFIK_DASHBOARD_HOST`, `TRAEFIK_TLS_ENABLED`, `TRAEFIK_HSTS_SECONDS`, `TRAEFIK_EDGE_IP` (fallback only)
- Hostnames: `MINIO_API_HOST`, `MINIO_CONSOLE_HOST`

**Apps/Compute**
- OmniRoute: `OMNIROUTE_IMAGE`, `OMNIROUTE_PLATFORM`, `OMNIROUTE_HOST`, `OMNIROUTE_API_HOST`, `OMNIROUTE_PUBLIC_URL`
- OmniRoute secrets: `JWT_SECRET`, `API_KEY_SECRET`, `STORAGE_ENCRYPTION_KEY`, `INITIAL_PASSWORD`, `MACHINE_ID_SALT`
- OpenWebUI: `OPENWEBUI_TAG`, `OPENWEBUI_HOST`, `OPENWEBUI_OPENAI_API_KEY`, `OPENWEBUI_DATABASE_URL`, `OPENWEBUI_REDIS_URL`, `OPENWEBUI_S3_*`
- OpenClaw: `OPENCLAW_IMAGE`, `OPENCLAW_PLATFORM`, `OPENCLAW_HOST`, `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_OPENAI_API_KEY`, `OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH`

### 2.3 Variables CI (deploy server)

Khi chạy CI/CD từ máy build (Mac/dev hoặc runner tự-host), nên đặt:
- `SERVER_REMOTE` (vd: `mzk-12-10@100.101.77.8`)
- `SERVER_DIR` (default `~/localagent`)
- `SERVER_ENV_FILE` (default `~/localagent/deploy/env/stack.env`)
- `SERVER_SSH_PASS` (chỉ khi chưa dùng SSH key)

Tối thiểu cần:
```bash
SERVER_SSH_PASS='***' bash ops/agent.sh deploy server
```

## 2.4 Variables CI (deploy local)

Local deploy chủ yếu dùng khi dev/test trên Mac. Nếu muốn “CI local” (trên Mac runner):
- `LOCAL_ENV_FILE` (default `deploy/env/stack.local.env`)
- `DEPLOY_LOCAL_STOP_FIRST` (default `1`)
- `HEALTHCHECK_TIMEOUT_SECONDS` (default `420`)
- `HEALTHCHECK_INTERVAL_SECONDS` (default `10`)
- `OMNIROUTE_BUILD_NODE_OPTIONS` (default `--max-old-space-size=3072`)
- `OMNIROUTE_NEXT_BUILD_CPUS` (default `2`)

## 3) Scripts CI/CD (điểm vào chuẩn)

Điểm vào 1-lệnh:
- `ops/agent.sh deploy local`
- `ops/agent.sh deploy server`

### 3.1 Local deploy (Mac)

Chạy tại repo root:
```bash
bash ops/agent.sh deploy local
```

Script `ops/deploy_local.sh` làm:
1) Tạo/generate `deploy/env/stack.local.env` (nếu chưa có) + tự generate secrets.
2) Migrate env sang HTTPS mặc định (`ensure_https_env.sh`).
3) (Mặc định) dừng stack cũ để giải phóng RAM: `DEPLOY_LOCAL_STOP_FIRST=1`.
4) Build images:
   - `omniroute:local` (`linux/arm64`, target `runner-base`)
   - `openclaw:local` (`linux/arm64`)
5) Bootstrap data dirs (dưới `${LA_DATA_ROOT}`).
6) Up `platform` rồi `apps`.
   - `stack.sh platform` sẽ auto-generate cert nội bộ và render Traefik dynamic config.
   - `bootstrap_openclaw.sh` sẽ set `gateway.controlUi.allowedOrigins=["https://..."]`, `gateway.trustedProxies`, và cờ device-auth theo env hiện tại.
7) Reconcile app auth/runtime:
   - `bootstrap_app_clients.sh` sẽ provision app keys cho OpenWebUI/OpenClaw.
   - Sync `config.data.openai` trong Postgres **và** Redis của OpenWebUI để runtime luôn dùng `http://omniroute:<port>/v1`, không dùng loopback `127.0.0.1`.
   - Seed OpenClaw provider/model defaults theo OmniRoute catalog và ép `models.providers.omniroute.baseUrl=http://omniroute:<port>/v1`.
   - Force recreate `open-webui` + `openclaw-gateway` để runtime nạp config mới thật sự.
8) Chạy healthcheck có retry qua HTTPS.
9) Chạy smoke test end-to-end qua OmniRoute.

**Build tuning (khi Docker Desktop thiếu RAM)**
- `OMNIROUTE_BUILD_NODE_OPTIONS` (default `--max-old-space-size=3072`)
- `OMNIROUTE_NEXT_BUILD_CPUS` (default `2`) để giảm số worker Next.js khi build.

Ví dụ:
```bash
OMNIROUTE_NEXT_BUILD_CPUS=1 OMNIROUTE_BUILD_NODE_OPTIONS="--max-old-space-size=2048" bash ops/agent.sh deploy local
```

### 3.2 Server deploy (Linux qua Tailscale)

Mục tiêu hiện tại của script server: **update OmniRoute + reconcile app auth/runtime + rollout HTTPS edge config** (build + sync deploy + restart `platform`/`omniroute`/`open-webui`/`openclaw-gateway`) và healthcheck.

Chạy tại repo root (trên máy Mac):
```bash
SERVER_SSH_PASS='***' bash ops/agent.sh deploy server
```

Script `ops/deploy_server.sh` làm:
1) Build `omniroute:intel` (`linux/amd64`, target `runner-base`) trên máy Mac.
2) `docker save` → gzip thành tar.
3) `rsync deploy/` lên server (không sync `deploy/env/stack.env`).
4) Trên server:
   - migrate env sang HTTPS mặc định (`ensure_https_env.sh`)
   - `stack.sh platform up -d` để generate cert + restart Traefik
   - `bootstrap_openclaw.sh` để cập nhật allowed origins / trusted proxy / device-auth policy
   - `docker load` image OmniRoute mới
   - `stack.sh apps up -d --no-deps omniroute open-webui openclaw-gateway`
   - `bootstrap_app_clients.sh` để đồng bộ OmniRoute app keys và OpenWebUI/OpenClaw runtime config
5) Healthcheck từ server qua HTTPS loopback-resolve:
   - `ENV_FILE=~/localagent/deploy/env/stack.env bash deploy/scripts/healthcheck.sh server`
6) Smoke test từ server:
   - `ENV_FILE=~/localagent/deploy/env/stack.env bash deploy/scripts/smoke_stack.sh server`

**SSH auth**
- Script hiện dùng `sshpass` nếu server vẫn login bằng password.
- Khuyến nghị chuyển sang SSH key-only để bỏ `SERVER_SSH_PASS`.

## 4) “CD” / Working directory trong CI

Mọi lệnh assume chạy tại **repo root**:
```bash
cd <path-to-LocalAgent>
```

Các script tự resolve đường dẫn theo vị trí file nên không cần `pwd` cố định, nhưng khuyến nghị chạy ở repo root để dễ debug.

## 5) Deploy layer-by-layer (manual ops)

### 5.1 Start/stop
```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh platform up -d
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps up -d

ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps down --remove-orphans
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh platform down --remove-orphans
```

### 5.2 Healthcheck
```bash
ENV_FILE=deploy/env/stack.local.env HEALTHCHECK_TIMEOUT_SECONDS=420 HEALTHCHECK_INTERVAL_SECONDS=10 bash deploy/scripts/healthcheck.sh local
```

### 5.3 Smoke test
```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/smoke_stack.sh local
```

## 6) Lưu ý quan trọng

### 6.1 Traefik dynamic config
`deploy/scripts/stack.sh platform ...` sẽ render dynamic config vào:
```text
${LA_DATA_ROOT}/platform/proxy/traefik/dynamic.yml
```
và auto-generate cert nội bộ tại:
```text
${LA_DATA_ROOT}/platform/proxy/traefik/ca/ca.crt
${LA_DATA_ROOT}/platform/proxy/traefik/certs/tls.crt
${LA_DATA_ROOT}/platform/proxy/traefik/certs/tls.key
```

### 6.2 Container gọi ngược qua domain (quan trọng)
Traefik được set network aliases trên `edge` theo các host `${OMNIROUTE_HOST}`, `${OPENWEBUI_HOST}`, ... để:
- OpenWebUI/OpenClaw (trong container) gọi `http://router.localagent.*` **không bị resolve về 127.0.0.1** trong container.

### 6.3 HTTPS / CA trust
- Browser sẽ truy cập qua `https://*.localagent.server`, và local là `https://*.localagent.local:8443`.
- Nếu browser báo cert warning, import/trust CA tại `${LA_DATA_ROOT}/platform/proxy/traefik/ca/ca.crt` trên máy client.
- OpenClaw Control UI chỉ hoạt động ổn định khi origin là HTTPS hoặc localhost secure-context; đây là lý do rollout này thêm TLS ở Traefik.

### 6.4 Warm-up / 502 lúc mới up
Sau `docker compose up`, Traefik có thể trả `502` 10–30s đầu do service chưa “healthy”.
`deploy/scripts/healthcheck.sh` đã có retry nếu set `HEALTHCHECK_TIMEOUT_SECONDS`.

### 6.5 Secrets & sync
- Không sync `deploy/env/stack.env` lên server bằng script (tránh leak secrets).
- Secrets local auto-generate trong `deploy/env/stack.local.env`.
- Secrets server phải quản lý riêng (ví dụ lưu dưới `/data/...` hoặc secret manager).
- `OPENWEBUI_OPENAI_API_KEY` và `OPENCLAW_OPENAI_API_KEY` không nên để `bootstrap`; `bootstrap_app_clients.sh` sẽ rotate/provision giá trị thật nếu env còn placeholder.
- OpenWebUI có 2 lớp state: Postgres `config` và Redis runtime cache. Nếu chỉ sửa DB mà không sync Redis, UI vẫn có thể giữ key/url cũ.

### 6.6 Apple Silicon note (OpenWebUI image)
`open-webui` đang dùng image từ GHCR (thường là multi-arch), nhưng Docker có thể cảnh báo mismatch platform.
Nếu gặp lỗi runtime do kiến trúc:
- Set `platform: linux/arm64` cho service `open-webui` (compose layer2) hoặc pin tag multi-arch phù hợp.

### 6.7 Release từng service (không down toàn stack)
Ví dụ local:
```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps up -d --no-deps omniroute
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps up -d --no-deps open-webui
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps up -d --no-deps openclaw-gateway
```

## 7) Troubleshooting nhanh

### 7.1 OpenWebUI không thấy models / không connect OmniRoute
Kiểm tra OpenWebUI gọi được router domain từ trong container:
```bash
docker exec -it localagent-apps-open-webui-1 sh -lc 'getent hosts router.localagent.local && curl -sS -o /dev/null -w "%{http_code}\n" http://router.localagent.local/v1/models'
```
Nếu OmniRoute `/v1/models` có data nhưng UI vẫn rỗng:
```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_app_clients.sh
```
Lý do thường gặp:
- OpenWebUI còn giữ app key cũ trong Postgres `config.data.openai`.
- Redis còn giữ `open-webui:config:OPENAI_API_KEYS=["bootstrap"]` hoặc base URL cũ.
- `OPENWEBUI_OPENAI_API_KEY` trong env vẫn là placeholder cũ.

Để chốt nhanh:
```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/smoke_stack.sh local
```

### 7.2 Build OmniRoute bị OOM khi docker build
Giảm worker build + giảm heap:
```bash
OMNIROUTE_NEXT_BUILD_CPUS=1 OMNIROUTE_BUILD_NODE_OPTIONS="--max-old-space-size=2048" bash ops/agent.sh deploy local
```

### 7.3 OpenClaw báo pairing required / device identity
- Kiểm tra đang mở đúng URL `https://openclaw.localagent.local:8443` hoặc `https://openclaw.localagent.server`.
- Kiểm tra CA nội bộ đã được trust trên máy client.
- Kiểm tra config đã được bootstrap lại:
```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_openclaw.sh
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_app_clients.sh
```
- Local-only: có thể đặt `OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH=true` để bỏ pairing cho gateway dev nội bộ.
- Server: giữ `OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH=false`, sau đó lấy public dashboard URL đã kèm `#token=...` bằng:
```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/openclaw_dashboard.sh
```

### 7.4 OpenClaw log `Incorrect API key provided`
```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_app_clients.sh
```
Script này sẽ sync lại OpenClaw provider `omniroute` và env-backed API key.
