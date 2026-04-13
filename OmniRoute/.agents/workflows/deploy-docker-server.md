---
description: Deploy OmniRoute, OpenWebUI, or OpenClaw to the local server (192.168.1.65) via Docker — preserves all server data
---

# Deploy to Server (Docker) Workflow

Safely deploys any service to the local Ubuntu server running Docker.
Data volumes are **never removed** — only the container image is swapped.

**Server:** `192.168.1.65` (alias: `mizuki-sv`)  
**User:** `mzk-12-10`  
**SSH Key:** `~/.ssh/server-mzk-12-10`  
**Data Root:** `/data/ai/openclaw/data/`

> [!IMPORTANT]
> All service data lives in bind mounts under `/data/ai/openclaw/data/` on the server.
> The deploy script **never touches** these paths — only the container is swapped.

---

## Deploy OmniRoute

### 1. Build CLI bundle and Docker image, then deploy

// turbo

```bash
cd /Users/thont/Local/POC/LocalAgent/OmniRoute && npm run build:cli && bash scripts/deploy-to-server.sh omniroute
```

### 2. Verify it's healthy

// turbo

```bash
ssh mizuki-sv "sudo docker ps | grep omniroute && curl -sf http://localhost:20128/api/health || echo 'not ready yet'"
```

---

## Deploy Open-WebUI (pull latest from registry)

### 1. Pull and deploy latest open-webui

// turbo

```bash
cd /Users/thont/Local/POC/LocalAgent/OmniRoute && bash scripts/deploy-to-server.sh open-webui
```

---

## Deploy OpenClaw

### 1. Build and deploy openclaw

// turbo

```bash
cd /Users/thont/Local/POC/LocalAgent/OmniRoute && bash scripts/deploy-to-server.sh openclaw
```

---

## Rollback any service

If a deploy fails, roll back with:

```bash
ssh mizuki-sv "sudo docker tag <image>:<backup_tag> <image>:<original_tag> && sudo docker restart <container_name>"
```

The backup tag is printed during each deploy (format: `intel_backup_YYYYMMDD_HHMMSS`).

---

## Data Safety Guarantees

| What                | Where                                    | Protected?            |
| ------------------- | ---------------------------------------- | --------------------- |
| OmniRoute DB & logs | `/data/ai/openclaw/data/omniroute-data`  | ✅ Never touched      |
| OpenWebUI data      | `/data/ai/openclaw/data/open-webui-data` | ✅ Never touched      |
| OpenClaw config     | `/data/ai/openclaw/`                     | ✅ Never touched      |
| Container image     | Swapped atomically                       | —                     |
| `.env` files        | `/home/mzk-12-10/<service>/.env`         | ✅ Managed separately |
