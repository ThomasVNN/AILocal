# Deployment Guide

_Last reviewed: 2026-04-11_

Tài liệu này là **operator guide chuẩn** để cài đặt, deploy, verify, backup và rollback stack `LocalAgent`.

Nếu có mâu thuẫn giữa guide này và runtime behavior, ưu tiên:

1. `deploy/DEPLOY_KNOWLEDGE.md`
2. `ops/deploy_local.sh` / `ops/deploy_server.sh`
3. `deploy/scripts/*`

## 1. Hệ thống này deploy cái gì

`LocalAgent` hiện deploy theo mô hình **2-layer Docker stack**:

- `layer1-platform`
  - `postgres-primary`
  - `postgres-backup`
  - `redis`
  - `minio`
  - `minio-init`
  - `traefik`
- `layer2-apps`
  - `omniroute`
  - `open-webui`
  - `openclaw-gateway`
  - `openclaw-cli`

Vai trò của từng app:

- `OmniRoute`: control plane + API plane trung tâm
- `OpenWebUI`: chat UI, chỉ gọi `OmniRoute /v1`
- `OpenClaw`: gateway/control UI, cũng chỉ gọi `OmniRoute /v1`
- `Traefik`: ingress duy nhất publish ra ngoài

## 2. Chế độ deploy được hỗ trợ

Guide này hỗ trợ 4 tình huống:

1. deploy local lần đầu
2. redeploy local cho phát triển
3. cài đặt server lần đầu
4. update server từ máy dev

## 3. Kiến trúc file cần biết

Các path quan trọng:

- `deploy/`: compose, env mẫu, script deploy
- `ops/`: entrypoint local/server hiện tại
- `.localagent-data/`: data root local runtime
- `deploy/env/stack.local.env`: env local
- `deploy/env/stack.env`: env server

Compose files:

- `deploy/layer1-platform/docker-compose.yml`
- `deploy/layer2-apps/docker-compose.yml`

Entry point thực tế hiện tại:

- local: `bash ops/agent.sh deploy local`
- server update: `bash ops/agent.sh deploy server`

## 4. Prerequisites

### 4.1 Máy local dev

Cần có:

- Docker Engine / Docker Desktop
- `docker compose`
- `node`
- `npm`
- `bash`

Khuyến nghị thêm:

- `ssh`
- `rsync`
- `sshpass` nếu server còn dùng password SSH

Kiểm tra nhanh:

```bash
docker compose version
node -v
npm -v
```

### 4.2 Server Linux

Cần có:

- Linux x86_64
- Docker Engine + Compose plugin
- quyền ghi vào `${LA_DATA_ROOT}` mặc định là `/data/localagent`
- mở cổng:
  - `80/tcp`
  - `443/tcp`
  - `8088/tcp` nếu cần Traefik dashboard

Kiểm tra nhanh:

```bash
docker compose version
docker info
```

### 4.3 Máy client truy cập UI

Nếu chưa có DNS nội bộ, cần cấu hình `/etc/hosts`.

Local:

```text
127.0.0.1  router.localagent.local api.localagent.local chat.localagent.local openclaw.localagent.local s3.localagent.local minio.localagent.local traefik.localagent.local
```

Server:

```text
<server-ip>  router.localagent.server api.localagent.server chat.localagent.server openclaw.localagent.server s3.localagent.server minio.localagent.server traefik.localagent.server
```

## 5. Env và secrets

### 5.1 Local

Local dùng:

```text
deploy/env/stack.local.env
```

File này sẽ được generate tự động nếu chạy:

```bash
bash ops/agent.sh deploy local
```

### 5.2 Server

Server dùng:

```text
deploy/env/stack.env
```

Tạo từ mẫu:

```bash
cp deploy/env/stack.server.env.example deploy/env/stack.env
```

Các secret bắt buộc phải chỉnh:

- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `MINIO_ROOT_PASSWORD`
- `JWT_SECRET`
- `API_KEY_SECRET`
- `STORAGE_ENCRYPTION_KEY`
- `INITIAL_PASSWORD`
- `OPENCLAW_GATEWAY_TOKEN`

## 6. Deploy local lần đầu

Chạy tại repo root:

```bash
bash ops/agent.sh deploy local
```

Script local hiện sẽ tự làm:

1. tạo `deploy/env/stack.local.env` nếu chưa có
2. generate local secrets
3. ép local dùng `TRAEFIK_HTTPS_PORT=8443`
4. reconcile local app image tags về `omniroute:local`, `open-webui:local`, `openclaw:local`
5. build đủ 3 app image trực tiếp từ source workspace
6. tạo data directories dưới `.localagent-data/`
7. bootstrap cert nội bộ và Traefik dynamic config
8. start `platform`
9. chờ `postgres-primary` và `redis` healthy
10. bootstrap OpenClaw security/origin
11. start `omniroute` và chờ healthy
12. reconcile app keys/runtime config, từ đó mới create/restart `open-webui` và `openclaw-gateway`
13. start `openclaw-cli`
14. healthcheck
15. smoke test

Local default hiện tại:

- `OmniRoute`: build từ source trong workspace
- `OpenWebUI`: build từ source trong workspace
- `OpenClaw`: build từ source trong workspace

App layer source mode không chấp nhận `docker compose pull`. Nếu image app chưa tồn tại local, operator phải build lại từ source bằng `bash ops/agent.sh deploy local` hoặc `ENV_FILE=... bash deploy/scripts/build_app_images.sh`.

App layer registry mode chấp nhận `docker compose pull` thông qua `deploy/scripts/stack.sh` khi `LOCALAGENT_USE_REGISTRY_IMAGES=true`.

Nếu muốn local dùng cùng registry multi-arch với UAT/server, bật registry mode trong env rồi reconcile:

```bash
LOCALAGENT_USE_REGISTRY_IMAGES=true \
LOCALAGENT_IMAGE_REGISTRY=mizuk1210.mulley-ray.ts.net:9999 \
bash deploy/scripts/reconcile_app_image_env.sh local deploy/env/stack.local.env
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh platform pull
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps pull omniroute open-webui openclaw-gateway openclaw-cli
```

Khi xong, các URL local chuẩn là:

- `https://router.localagent.local:8443`
- `https://api.localagent.local:8443/v1`
- `https://chat.localagent.local:8443`
- `https://openclaw.localagent.local:8443`

## 7. Redeploy local cho phát triển

### 7.1 Redeploy toàn stack

```bash
bash ops/agent.sh deploy local
```

### 7.2 Restart từng layer

```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh platform up -d
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps up -d
```

### 7.3 Restart từng service

```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps up -d --no-deps omniroute
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps up -d --no-deps open-webui
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps up -d --no-deps openclaw-gateway openclaw-cli
```

Nếu service app chưa có local image mới, build lại trước:

```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/build_app_images.sh omniroute
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/build_app_images.sh open-webui
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/build_app_images.sh openclaw
```

### 7.4 Khi nào phải chạy lại bootstrap

Chạy lại `bootstrap_openclaw.sh` nếu đổi:

- `OPENCLAW_HOST`
- `TRAEFIK_HTTPS_PORT`
- TLS/proxy config

Chạy lại `bootstrap_app_clients.sh` nếu:

- rotate app key
- đổi `OMNIROUTE_API_PORT`
- OpenWebUI/OpenClaw còn giữ config cũ

Commands:

```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_openclaw.sh
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_app_clients.sh
```

## 8. Cài đặt server lần đầu

### 8.1 Chuẩn bị code trên server

Có 2 cách:

1. clone repo lên server
2. copy riêng thư mục `deploy/` lên server

Nếu copy riêng `deploy/`, cần đảm bảo server cũng có runtime images hoặc đường build/pull phù hợp.

### 8.2 Tạo env server

```bash
cp deploy/env/stack.server.env.example deploy/env/stack.env
```

Sau đó chỉnh:

- secrets
- hostnames
- `LA_DATA_ROOT` nếu không dùng `/data/localagent`

### 8.3 Tạo data directories

```bash
sudo -E bash deploy/scripts/bootstrap_data_dirs.sh
```

### 8.4 Start platform

```bash
bash deploy/scripts/stack.sh platform up -d
```

Bước này sẽ:

- generate CA/cert nội bộ cho Traefik
- render dynamic config
- start Postgres/Redis/MinIO/Traefik

### 8.5 Bootstrap OpenClaw security

```bash
bash deploy/scripts/bootstrap_openclaw.sh
```

### 8.6 Rollout app layer từ registry

Khuyến nghị: chạy từ máy dev/build host:

```bash
bash ops/agent.sh deploy server
```

Mặc định lệnh này dùng registry transport:

- mirror Layer 1 images vào `mizuk1210.mulley-ray.ts.net:9999/localagent-platform/*`
- build/push Layer 2 multi-arch images vào `mizuk1210.mulley-ray.ts.net:9999/localagent-apps/*`
- upload `deploy/` lên server
- pull images trên server rồi rollout app bằng `--no-build`

Nếu server cũng giữ full source checkout và bạn chủ động build trực tiếp trên server:

```bash
ENV_FILE=deploy/env/stack.env bash deploy/scripts/build_app_images.sh omniroute open-webui openclaw
ENV_FILE=deploy/env/stack.env bash deploy/scripts/stack.sh apps up -d --no-deps omniroute
ENV_FILE=deploy/env/stack.env bash deploy/scripts/wait_for_service_health.sh apps omniroute 420
ENV_FILE=deploy/env/stack.env bash deploy/scripts/bootstrap_app_clients.sh
ENV_FILE=deploy/env/stack.env bash deploy/scripts/stack.sh apps up -d --no-deps openclaw-cli
```

### 8.7 Reconcile app runtime

`bootstrap_app_clients.sh` là bước bắt buộc sau khi đổi app image, đổi key, hoặc rollout OmniRoute mới.

### 8.8 Verify server

```bash
ENV_FILE=deploy/env/stack.env bash deploy/scripts/healthcheck.sh server
ENV_FILE=deploy/env/stack.env bash deploy/scripts/smoke_stack.sh server
```

## 9. Update server từ máy dev

Entry point hiện tại:

```bash
bash ops/agent.sh deploy server
```

Script hiện sẽ:

1. publish full-stack multi-arch images lên registry
2. đóng gói `deploy/` rồi upload lên server
3. reconcile remote env về registry image tags
4. ensure HTTPS env trên server
5. pull Layer 1 và Layer 2 images từ registry
6. start/reconcile `platform`
7. bootstrap OpenClaw config
8. start `omniroute` trước bằng `--no-build` và chờ healthy
9. reconcile app auth/runtime, từ đó mới create/restart `open-webui` và `openclaw-gateway`
10. start `openclaw-cli` bằng `--no-build`
11. healthcheck
12. smoke test

Các biến có thể override:

- `SERVER_REMOTE`
- `SERVER_DIR`
- `SERVER_ENV_FILE`
- `SERVER_SSH_KEY`
- `SERVER_SSH_PASS`
- `SERVER_STRICT_HOST_KEY_CHECKING`
- `SERVER_DEPLOY_IMAGE_TRANSPORT=registry|tar` (default `registry`)
- `LOCALAGENT_IMAGE_REGISTRY` (default `mizuk1210.mulley-ray.ts.net:9999`)
- `LOCALAGENT_IMAGE_TAG` (default `dev`)
- `LOCALAGENT_IMAGE_PLATFORMS` (default `linux/arm64,linux/amd64`)

Ví dụ:

```bash
SERVER_REMOTE='user@server' \
SERVER_DIR='~/localagent' \
SERVER_ENV_FILE='~/localagent/deploy/env/stack.env' \
SERVER_SSH_KEY="$HOME/.ssh/id_ed25519" \
bash ops/agent.sh deploy server
```

Publish images without deploying:

```bash
LOCALAGENT_IMAGE_REGISTRY=mizuk1210.mulley-ray.ts.net:9999 \
LOCALAGENT_IMAGE_TAG=dev \
bash deploy/scripts/publish_multiarch_images.sh all
```

Dry-run the publish commands:

```bash
bash deploy/scripts/publish_multiarch_images.sh --dry-run all
```

Tar fallback:

```bash
SERVER_DEPLOY_IMAGE_TRANSPORT=tar bash ops/agent.sh deploy server
```

## 10. Verify sau deploy

### 10.1 Healthcheck

Local:

```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/healthcheck.sh local
```

Server:

```bash
ENV_FILE=deploy/env/stack.env bash deploy/scripts/healthcheck.sh server
```

### 10.2 Smoke test

Local:

```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/smoke_stack.sh local
```

Server:

```bash
ENV_FILE=deploy/env/stack.env bash deploy/scripts/smoke_stack.sh server
```

Smoke test hiện xác nhận:

- OmniRoute public catalog hoạt động
- OmniRoute có ít nhất 1 provider active
- OpenWebUI runtime trỏ đúng `http://omniroute:<port>/v1`
- OpenClaw runtime trỏ đúng `http://omniroute:<port>/v1`
- chat path end-to-end trả kết quả thật

## 11. Backup và rollback

### 11.1 Backup

Postgres backup định kỳ:

```text
${LA_DATA_ROOT}/platform/backups/postgres
```

Snapshot file data:

```bash
sudo -E bash deploy/scripts/backup_snapshot.sh
```

### 11.2 Rollback nhanh

Rollback registry:

1. đổi `LOCALAGENT_IMAGE_TAG` trong env về tag cũ
2. chạy `bash deploy/scripts/reconcile_app_image_env.sh server deploy/env/stack.env`
3. pull và restart đúng service bằng `--no-build`

Ví dụ:

```bash
LOCALAGENT_IMAGE_TAG=git-oldsha bash deploy/scripts/reconcile_app_image_env.sh server deploy/env/stack.env
ENV_FILE=deploy/env/stack.env bash deploy/scripts/stack.sh apps pull omniroute
ENV_FILE=deploy/env/stack.env bash deploy/scripts/stack.sh apps up -d --no-build --no-deps omniroute
```

Rollback tar fallback:

```bash
docker load < artifacts/images/archives/localagent-app-images.tar
LOCALAGENT_USE_REGISTRY_IMAGES=false bash deploy/scripts/reconcile_app_image_env.sh server deploy/env/stack.env
ENV_FILE=deploy/env/stack.env bash deploy/scripts/stack.sh apps up -d --no-build --no-deps omniroute
```

Nếu rollback ảnh hưởng app config/runtime, chạy lại:

```bash
ENV_FILE=deploy/env/stack.env bash deploy/scripts/bootstrap_app_clients.sh
```

## 12. CA và HTTPS

CA nội bộ:

```text
${LA_DATA_ROOT}/platform/proxy/traefik/ca/ca.crt
```

Cert runtime:

```text
${LA_DATA_ROOT}/platform/proxy/traefik/certs/tls.crt
${LA_DATA_ROOT}/platform/proxy/traefik/certs/tls.key
```

Nếu browser báo warning cert:

- copy `ca.crt` từ server/local runtime về máy client
- import và trust CA đó

## 13. Troubleshooting

### OpenWebUI lên nhưng không thấy model

```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_app_clients.sh
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/smoke_stack.sh local
```

### OpenClaw báo pairing required hoặc auth lỗi

```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_openclaw.sh
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_app_clients.sh
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/openclaw_dashboard.sh
```

### Đổi host/port/domain xong bị lỗi routing

Chạy lại tối thiểu:

```bash
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/ensure_https_env.sh deploy/env/stack.local.env
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh platform up -d
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/wait_for_service_health.sh platform postgres-primary 180
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/wait_for_service_health.sh platform redis 180
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_openclaw.sh
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps up -d --no-deps omniroute
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/wait_for_service_health.sh apps omniroute 420
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/bootstrap_app_clients.sh
ENV_FILE=deploy/env/stack.local.env bash deploy/scripts/stack.sh apps up -d --no-deps openclaw-cli
```

### Docker build/pull local bị treo ở bước resolve image

Luồng local hiện tối ưu theo hướng:

- cả `OmniRoute`, `OpenWebUI`, `OpenClaw` đều build từ source workspace
- app layer không cho `pull`
- deploy ưu tiên daemon BuildKit và log `plain progress`

Nếu Docker daemon vẫn bị treo khi resolve image:

1. dừng deploy đang chạy
2. xác nhận base images/dependency registry truy cập được, hoặc preload base image cần thiết
3. chạy lại với log plain để dễ triage

```bash
BUILDKIT_PROGRESS=plain bash ops/agent.sh deploy local
```

## 14. Tài liệu liên quan

- `deploy/DEPLOY_KNOWLEDGE.md`: runtime source of truth
- `deploy/STACK_GUIDE.md`: stack topology, release notes từng service
- `deploy/SERVER_GUIDE.md`: server-specific notes
- `docs/SYSTEM_ARCHITECTURE.md`: kiến trúc tổng thể
- `docs/DEPLOY_ARCHITECTURE_REVIEW.md`: review và hướng refactor vận hành
