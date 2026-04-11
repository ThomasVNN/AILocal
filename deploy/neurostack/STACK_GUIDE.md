# NeuroStack — 2-Layer Stack Guide

> **Brand:** `neurostack` (tách biệt hoàn toàn với `localagent` brand của Codex agent)  
> **Principle:** OmniRouter là Central Brain — tất cả LLM traffic đi qua đây.

---

## Stack Overview

```
Layer 1 — Platform (neurostack-platform)
  ├── postgres-primary + postgres-backup   → DB cho OpenWebUI
  ├── redis                                → Session, WebSocket, Cache
  ├── minio + minio-init                   → Object storage cho OpenWebUI files
  └── traefik                              → Edge ingress (TLS termination)

Layer 2 — Apps (neurostack-apps)
  ├── omnirouter      → 🧠 Central LLM Gateway (tất cả /v1 calls đi đây)
  ├── open-webui      → Chat UI cho end users
  ├── openclaw-gateway → Automation gateway (shared, per-user data isolation)
  └── openclaw-cli     → CLI companion
```

## Brand Isolation vs LocalAgent (Codex)

| Aspect | LocalAgent (Codex) | NeuroStack |
|---|---|---|
| Docker project | `localagent-*` | `neurostack-*` |
| Networks | `localagent_platform`, `localagent_edge` | `neurostack_platform`, `neurostack_edge` |
| Data root (local) | `.localagent-data/` | `.nstack-data/` |
| Data root (server) | `/data/localagent/` | `/data/neurostack/` |
| Domain (local) | `*.localagent.local` | `*.nstack.local` |
| Domain (server) | `*.localagent.server` | `*.nstack.server` |
| Traefik HTTP (local) | `80` | `81` |
| Traefik HTTPS (local) | `8443` | `9443` |
| Traefik Dashboard (local) | `8088` | `8089` |
| Traefik HTTP (server) | `80` | `8181` |
| Traefik HTTPS (server) | `443` | `8444` |
| OmniRouter ports | `20128/20129` | `21128/21129` |
| Env file | `deploy/env/stack.local.env` | `deploy/env/nstack.local.env` |

## Source Code (Custom Forks)

Tất cả microservices đều là **custom forks** của công ty, có git riêng bên trong:

- `OmniRoute/` → Custom OmniRouter (Central LLM Gateway)
- `openclaw/` → Custom OpenClaw (Automation Gateway)
- `open-webui/` → Custom OpenWebUI (Chat UI)

Build từ source:

```bash
bash ops/agent.sh deploy nstack-local
````

## Quick Deploy

### Local (M1 Mac):

```bash
bash ops/agent.sh deploy nstack-local
```

### Server (192.168.1.65):

```bash
SERVER_SSH_PASS='123513' bash ops/agent.sh deploy nstack-server
```

## /etc/hosts Setup

### M1 Mac local:

```
127.0.0.1  router.nstack.local api.nstack.local chat.nstack.local claw.nstack.local
127.0.0.1  s3.nstack.local minio.nstack.local traefik.nstack.local
```

### Client truy cập server:

```
192.168.1.65  router.nstack.server api.nstack.server chat.nstack.server claw.nstack.server
192.168.1.65  s3.nstack.server minio.nstack.server traefik.nstack.server
```

## URLs sau khi deploy

### Local:

- OmniRouter Dashboard: `https://router.nstack.local:9443`
- OmniRouter API: `https://api.nstack.local:9443/v1`
- OpenWebUI: `https://chat.nstack.local:9443`
- OpenClaw: `https://claw.nstack.local:9443`

### Server:

- OmniRouter Dashboard: `https://router.nstack.server:8444`
- OmniRouter API: `https://api.nstack.server:8444/v1`
- OpenWebUI: `https://chat.nstack.server:8444`
- OpenClaw: `https://claw.nstack.server:8444`

## Per-User OpenClaw (Option A: Shared GW + Isolated Data)

Mỗi user được cấp:
- **OPENCLAW user token** riêng → auth với openclaw-gateway
- **OmniRouter API key** riêng → quota tracking per user trong OmniRouter dashboard

Workspace isolation:

```
${NS_DATA_ROOT}/apps/openclaw/
  ├── config/           → shared gateway config
  └── workspace/        → per-user workspace dirs
      ├── alice/
      └── bob/
```

Provision user bằng `bootstrap_app_clients.sh` với per-user params.

## Partial Restart

```bash
# Restart chỉ OmniRouter
ENV_FILE=deploy/env/nstack.local.env \
  docker compose -f deploy/neurostack/layer2-apps/docker-compose.yml \
  up -d --no-deps omnirouter

# Restart chỉ OpenClaw
ENV_FILE=deploy/env/nstack.local.env \
  docker compose -f deploy/neurostack/layer2-apps/docker-compose.yml \
  up -d --no-deps openclaw-gateway openclaw-cli

# Restart platform (layer 1)
ENV_FILE=deploy/env/nstack.local.env \
  docker compose -f deploy/neurostack/layer1-platform/docker-compose.yml up -d
```

## Troubleshooting

### OpenWebUI không thấy models:

```bash
ENV_FILE=deploy/env/nstack.local.env bash deploy/scripts/bootstrap_app_clients.sh
```

### OpenClaw báo pairing required:

```bash
ENV_FILE=deploy/env/nstack.local.env bash deploy/scripts/bootstrap_openclaw.sh
ENV_FILE=deploy/env/nstack.local.env bash deploy/scripts/bootstrap_app_clients.sh
ENV_FILE=deploy/env/nstack.local.env bash deploy/scripts/openclaw_dashboard.sh
```

### Kiểm tra LocalAgent (Codex) không bị ảnh hưởng:

```bash
docker ps | grep localagent          # vẫn running
docker network ls | grep localagent  # localagent_edge + localagent_platform intact
```
