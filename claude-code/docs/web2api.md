# Web2API

## Mục tiêu

`claude-code` có sẵn nhiều phần liên quan `claude.ai`, nhưng phần đó chủ yếu là:

- OAuth và token plumbing
- remote-control / bridge session
- MCP proxy / remote session transport

Nó **không** phải một public HTTP API sạch để expose trực tiếp.

Vì vậy implementation trong repo này đi theo hướng:

- **không** expose bridge/session internals
- **có** dựng một HTTP API layer nhỏ, tái dùng chính auth + model selection hiện có

Điểm này quan trọng: bridge của `claude.ai/code` phù hợp cho remote session, không phù hợp làm API bền vững cho client ngoài.

## Auth nguồn

Server `web2api` dùng đúng auth của repo:

- `ANTHROPIC_API_KEY`, hoặc
- OAuth/token đã login qua `claude.ai` trong local config của Claude Code

Nếu cần chặn client gọi vào API này, set thêm:

- `CLAUDE_CODE_WEB2API_AUTH_TOKEN`

Khi đó request phải gửi:

- `Authorization: Bearer <token>`, hoặc
- `x-api-key: <token>`

## Endpoints

- `GET /health`
- `GET /v1/models`
- `POST /api/chat`
- `POST /v1/messages`
- `POST /v1/chat/completions`

### `POST /api/chat`

Endpoint này phục vụ trực tiếp cho web app trong thư mục `web/`. Stream format là SSE với payload theo kiểu Anthropic message events.

### `POST /v1/messages`

Anthropic-style wrapper tối giản.

### `POST /v1/chat/completions`

OpenAI-compatible wrapper tối giản để các client quen OpenAI API có thể dùng nhanh.

## Phạm vi hiện tại

Bản đầu tiên này là **text-first**:

- hỗ trợ chat text
- hỗ trợ streaming
- normalize model alias như `sonnet`, `opus`, `haiku`

Chưa làm full normalization cho:

- multimodal/image inputs
- tool round-trip đầy đủ ở OpenAI endpoint
- session/bridge features của `claude.ai/code`

## Chạy local

Từ thư mục `/Users/thont/Local/POC/LocalAgent/claude-code`:

```bash
bun run web2api
```

Mặc định:

- host: `127.0.0.1`
- port: `3010`

Override bằng env:

```bash
CLAUDE_CODE_WEB2API_HOST=0.0.0.0
CLAUDE_CODE_WEB2API_PORT=3010
CLAUDE_CODE_WEB2API_AUTH_TOKEN=your-token
bun run web2api
```

## Ví dụ

### Health

```bash
curl http://127.0.0.1:3010/health
```

### Anthropic-style

```bash
curl http://127.0.0.1:3010/v1/messages \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "sonnet",
    "max_tokens": 256,
    "messages": [
      { "role": "user", "content": "hello" }
    ]
  }'
```

### OpenAI-compatible

```bash
curl http://127.0.0.1:3010/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "sonnet",
    "messages": [
      { "role": "user", "content": "hello" }
    ]
  }'
```

## Lưu ý kiến trúc

- Nếu mục tiêu là “API ổn định cho app ngoài”, dùng `web2api`.
- Nếu mục tiêu là “remote session như claude.ai/code”, dùng bridge.
- Không nên trộn hai boundary này làm một.
