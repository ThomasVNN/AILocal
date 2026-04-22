FROM node:24.14.1-trixie-slim AS builder
WORKDIR /app

ARG TARGETARCH
ARG BUILD_NODE_OPTIONS="--max-old-space-size=3072"
ENV NODE_OPTIONS="${BUILD_NODE_OPTIONS}"
ENV NEXT_TELEMETRY_DISABLED=1

# Reduce Next.js build parallelism to lower memory use in Docker builds (especially on Docker Desktop).
ARG OMNIROUTE_NEXT_BUILD_CPUS=2
ENV OMNIROUTE_NEXT_BUILD_CPUS="${OMNIROUTE_NEXT_BUILD_CPUS}"

# Make npm installs more resilient to transient network issues during docker builds.
ARG NPM_CONFIG_FETCH_RETRIES=5
ARG NPM_CONFIG_FETCH_RETRY_FACTOR=2
ARG NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000
ARG NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
ARG NPM_CONFIG_STRICT_SSL=true
ARG NODE_TLS_REJECT_UNAUTHORIZED=1
ENV NPM_CONFIG_FETCH_RETRIES="${NPM_CONFIG_FETCH_RETRIES}"
ENV NPM_CONFIG_FETCH_RETRY_FACTOR="${NPM_CONFIG_FETCH_RETRY_FACTOR}"
ENV NPM_CONFIG_FETCH_RETRY_MINTIMEOUT="${NPM_CONFIG_FETCH_RETRY_MINTIMEOUT}"
ENV NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT="${NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT}"
ENV NPM_CONFIG_REGISTRY="${NPM_CONFIG_REGISTRY}"
ENV NPM_CONFIG_STRICT_SSL="${NPM_CONFIG_STRICT_SSL}"
ENV NODE_TLS_REJECT_UNAUTHORIZED="${NODE_TLS_REJECT_UNAUTHORIZED}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libsecret-1-0 \
    ca-certificates \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY scripts/postinstall.mjs ./scripts/postinstall.mjs
COPY scripts/postinstallSupport.mjs ./scripts/postinstallSupport.mjs
COPY scripts/native-binary-compat.mjs ./scripts/native-binary-compat.mjs
<<<<<<< HEAD
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi \
  && case "$TARGETARCH" in \
    amd64) css_pkg="lightningcss-linux-x64-gnu" ;; \
    arm64) css_pkg="lightningcss-linux-arm64-gnu" ;; \
    *) css_pkg="lightningcss-linux-x64-gnu" ;; \
  esac \
  && npm install --no-save --no-audit --no-fund "$css_pkg"
=======
COPY scripts/postinstallSupport.mjs ./scripts/postinstallSupport.mjs
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
>>>>>>> 08d0e9f8b4e412fea54cb5999c022bd368bfb9cd

COPY . ./
RUN mkdir -p /app/data && npm run build -- --webpack

FROM node:24.14.1-trixie-slim AS runner-base
WORKDIR /app

LABEL org.opencontainers.image.title="omniroute" \
  org.opencontainers.image.description="Unified AI proxy — route any LLM through one endpoint" \
  org.opencontainers.image.url="https://omniroute.online" \
  org.opencontainers.image.source="https://github.com/diegosouzapw/OmniRoute" \
  org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NODE_OPTIONS="--max-old-space-size=512"

# Data directory inside Docker — must match the volume mount in docker-compose.yml
ENV DATA_DIR=/app/data
RUN apt-get update \
  && apt-get install -y --no-install-recommends libsecret-1-0 ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/data

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
# Explicitly copy @swc/helpers — not always traced by standalone output but needed at runtime
COPY --from=builder /app/node_modules/@swc/helpers ./node_modules/@swc/helpers
# Explicitly copy pino transport dependencies — pino spawns a worker that requires
# pino-abstract-transport at runtime; Next.js standalone trace does not capture it (#449)
COPY --from=builder /app/node_modules/pino-abstract-transport ./node_modules/pino-abstract-transport
COPY --from=builder /app/node_modules/pino-pretty ./node_modules/pino-pretty
COPY --from=builder /app/node_modules/split2 ./node_modules/split2
COPY --from=builder /app/scripts/run-standalone.mjs ./run-standalone.mjs
COPY --from=builder /app/scripts/runtime-env.mjs ./runtime-env.mjs
COPY --from=builder /app/scripts/bootstrap-env.mjs ./bootstrap-env.mjs
COPY --from=builder /app/scripts/healthcheck.mjs ./healthcheck.mjs

EXPOSE 20128

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "healthcheck.mjs"]

CMD ["node", "run-standalone.mjs"]

FROM runner-base AS runner-cli

# Install system dependencies required by openclaw (git+ssh references).
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates docker.io docker-compose \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system url."https://github.com/".insteadOf "ssh://git@github.com/"

# Install CLI tools globally. Separate layer from apt for better cache reuse.
RUN npm install -g --no-audit --no-fund @openai/codex @anthropic-ai/claude-code droid openclaw@latest
