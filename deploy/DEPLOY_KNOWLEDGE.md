# Deploy Knowledge Base

Tài liệu này là **source of truth vận hành** cho stack `deploy/`.

Nếu tài liệu khác mâu thuẫn với hành vi runtime, ưu tiên đọc theo thứ tự:
1. `ops/agent.sh`
2. `ops/deploy_local.sh` / `ops/deploy_server.sh`
3. `deploy/scripts/*`
4. `deploy/env/*.env`
5. Tài liệu markdown

## 1) Invariants hiện tại

- Stack chạy theo **2 layer**:
  - `layer1-platform`: Postgres, Redis, MinIO, Traefik
  - `layer2-apps`: OmniRoute, OpenWebUI, OpenClaw
- Tất cả external traffic đi qua Traefik.
- App backend vẫn chạy HTTP nội bộ; TLS terminate ở Traefik.
- OpenClaw Control UI **bắt buộc secure context** nếu không dùng localhost exception, nên deployment chuẩn phải có HTTPS.

## 2) Local vs Server

### Local (Mac)
- Domain suffix: `*.localagent.local`
- `/etc/hosts` trỏ về `127.0.0.1`
- HTTPS external port mặc định: `8443`
- Lý do dùng `8443`: macOS/Tailscale thường chiếm `443`
- Data root mặc định: `.localagent-data/`

### Server (Linux)
- Domain suffix: `*.localagent.server`
- Client `/etc/hosts` trỏ về IP Tailscale server, hiện tại `100.101.77.8`
- HTTPS external port mặc định: `443`
- Data root mặc định: `/data/localagent`

## 3) Generated files — không coi là source of truth

Các file dưới đây là **generated/runtime artifacts**; không nên edit tay rồi kỳ vọng deploy giữ nguyên:

- `${LA_DATA_ROOT}/platform/proxy/traefik/dynamic.yml`
  - được render bởi `deploy/scripts/render_traefik_dynamic.sh`
- `${LA_DATA_ROOT}/platform/proxy/traefik/ca/ca.crt`
- `${LA_DATA_ROOT}/platform/proxy/traefik/certs/tls.crt`
- `${LA_DATA_ROOT}/platform/proxy/traefik/certs/tls.key`
  - được generate bởi `deploy/scripts/bootstrap_tls.sh`
- `${LA_DATA_ROOT}/apps/openclaw/config/openclaw.json`
  - được reconcile bởi `deploy/scripts/bootstrap_openclaw.sh` và `deploy/scripts/bootstrap_app_clients.sh`

File tĩnh trong repo:
- `deploy/layer1-platform/traefik/dynamic.yml`
  - chỉ là **sample/reference snapshot**, không phải runtime file Traefik đang đọc.

## 4) Entry points thật để deploy

### Local
```bash
bash ops/agent.sh deploy local
```

Thực tế script local sẽ:
1. tạo/cập nhật `deploy/env/stack.local.env`
2. ép local dùng `TRAEFIK_HTTPS_PORT=8443`
3. chạy `ensure_https_env.sh`
4. build image local
5. bootstrap data dir
6. bootstrap TLS
7. render Traefik config
8. bootstrap OpenClaw config
9. up stack
10. reconcile OpenWebUI/OpenClaw app auth/runtime
11. healthcheck
12. smoke test end-to-end

### Server
```bash
SERVER_SSH_PASS='***' bash ops/agent.sh deploy server
```

Thực tế script server sẽ:
1. build `omniroute:intel`
2. sync `deploy/` lên server
3. chạy `ensure_https_env.sh` trên server
4. start/reconcile `platform`
5. bootstrap OpenClaw config
6. load image OmniRoute mới
7. restart `omniroute` + `open-webui` + `openclaw-gateway`
8. reconcile OpenWebUI/OpenClaw app auth/runtime
9. healthcheck
10. smoke test end-to-end

## 5) App auth bootstrap specifics

`deploy/scripts/bootstrap_app_clients.sh` hiện làm 4 việc:
- provision OmniRoute app keys cho `OpenWebUI` và `OpenClaw` nếu env còn placeholder
- sync `config.data.openai` trong Postgres và Redis để OpenWebUI dùng đúng base URL + app key
- seed `models.providers.omniroute` và `agents.defaults.model.*` trong OpenClaw config theo catalog OmniRoute
- restart `open-webui` và `openclaw-gateway` để apply runtime config mới

Điều này quan trọng vì:
- OpenWebUI có thể giữ app key cũ trong DB ngay cả khi env đã đổi
- OpenWebUI có thể giữ app key/base URL cũ trong Redis runtime cache ngay cả khi DB đã đúng
- OpenClaw sẽ fail model calls nếu `OPENCLAW_OPENAI_API_KEY` vẫn là placeholder như `bootstrap`
- trong container, OmniRoute phải được gọi qua Docker DNS `http://omniroute:<port>/v1`, không phải `127.0.0.1`

## 6) OpenClaw specifics

`deploy/scripts/bootstrap_openclaw.sh` hiện làm 3 việc:
- set `gateway.controlUi.allowedOrigins`
  - local: `["https://openclaw.localagent.local:8443"]`
  - server: `["https://openclaw.localagent.server"]`
- set `gateway.trustedProxies`
  - lấy IP hiện tại của container Traefik trên `localagent_edge`
  - fallback về `TRAEFIK_EDGE_IP` nếu chưa inspect được container
- set `gateway.controlUi.dangerouslyDisableDeviceAuth`
  - local: có thể `true` cho trusted dev gateway
  - server: nên giữ `false`

Điều này rất quan trọng vì:
- browser UI cần HTTPS để có secure context
- gateway cần trust đúng reverse proxy để xử lý forwarded headers
- gateway dev có thể bỏ pairing bằng cờ local-only, nhưng server/public gateway không nên bật

Helper truy cập dashboard:
```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/openclaw_dashboard.sh
```
Script này in public URL đã kèm `#token=...` theo `OPENCLAW_HOST`.

## 7) Khi đổi host/port/domain phải làm gì

Nếu đổi bất kỳ biến nào như:
- `OPENCLAW_HOST`
- `OPENWEBUI_HOST`
- `OMNIROUTE_HOST`
- `OMNIROUTE_API_HOST`
- `MINIO_*_HOST`
- `TRAEFIK_DASHBOARD_HOST`
- `TRAEFIK_HTTPS_PORT`

thì cần chạy lại tối thiểu:
```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/ensure_https_env.sh deploy/env/stack.local.env
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh platform up -d
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_openclaw.sh
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps up -d --no-deps openclaw-gateway omniroute open-webui
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_app_clients.sh
```

## 8) Endpoints chuẩn hiện tại

### Local
- `https://router.localagent.local:8443`
- `https://api.localagent.local:8443/v1`
- `https://chat.localagent.local:8443`
- `https://openclaw.localagent.local:8443`
- `wss://openclaw.localagent.local:8443`
- `https://s3.localagent.local:8443`
- `https://minio.localagent.local:8443`
- `https://traefik.localagent.local:8443`

### Server
- `https://router.localagent.server`
- `https://api.localagent.server/v1`
- `https://chat.localagent.server`
- `https://openclaw.localagent.server`
- `wss://openclaw.localagent.server`
- `https://s3.localagent.server`
- `https://minio.localagent.server`
- `https://traefik.localagent.server`

## 9) Validation chuẩn

Kiểm tra local:
```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/healthcheck.sh local
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/smoke_stack.sh local
```

Kiểm tra server:
```bash
ENV_FILE=deploy/env/stack.env bash deploy/scripts/healthcheck.sh server
ENV_FILE=deploy/env/stack.env bash deploy/scripts/smoke_stack.sh server
```

`healthcheck.sh` xác nhận HTTPS routing ở Traefik, không chỉ kiểm tra container process.
`smoke_stack.sh` xác nhận luồng thật:
- OmniRoute public catalog hoạt động
- có provider trung tâm active trong OmniRoute
- OpenWebUI runtime dùng đúng OmniRoute network URL
- OpenClaw runtime dùng đúng OmniRoute network URL
- chat request đi qua OmniRoute và trả kết quả thật
