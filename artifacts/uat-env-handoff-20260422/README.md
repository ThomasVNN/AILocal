# LocalAgent UAT Secret Handoff

Generated: 2026-04-22 Asia/Ho_Chi_Minh
Server LAN: 192.168.1.65
Server Tailscale: 100.101.77.8
SSH user: mzk-12-10
SSH password: 123513
Remote env: /data/ai/openclaw/source/deploy/env/stack.env
Remote data root: /data/ai/openclaw

Files in this directory:
- stack.env: source-of-truth UAT env with passwords/tokens/keys
- omniroute.container.env: effective OmniRoute container env
- open-webui.container.env: effective OpenWebUI container env
- openclaw-gateway.container.env: effective OpenClaw gateway env
- openclaw.json: OpenClaw runtime config file

URLs:
- https://router.localagent.server:8443
- https://api.localagent.server:8443/v1
- https://chat.localagent.server:8443
- https://openclaw.localagent.server:8443

Client /etc/hosts entry:
192.168.1.65 router.localagent.server api.localagent.server chat.localagent.server openclaw.localagent.server s3.localagent.server minio.localagent.server traefik.localagent.server

Important access notes:
- OpenWebUI is fresh after data wipe. If no user exists, create the first account; it should become admin.
- INITIAL_PASSWORD is in stack.env. Use it where the app asks for initial/admin password.
- OmniRoute currently has no provider connections, so /v1/models returns an empty list until providers are imported/configured.
