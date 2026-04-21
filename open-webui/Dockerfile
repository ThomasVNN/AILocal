# =========================
# 1. FRONTEND BUILD
# =========================
FROM node:22-alpine AS frontend-build

WORKDIR /app

# install deps (cache tốt)
COPY package.json package-lock.json ./
RUN npm ci || npm install --legacy-peer-deps

# copy source
COPY . .

# build
RUN npm run build


# =========================
# 2. PYTHON BUILD (deps only)
# =========================
FROM python:3.11-slim AS backend-builder

# install build deps (temporary)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc python3-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /install

# chỉ copy requirements để cache
COPY backend/requirements.txt .

# install python deps vào /install
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# =========================
# 3. FINAL IMAGE (RUNTIME)
# =========================
FROM python:3.11-slim

ARG UID=1000
ARG GID=1000

ENV PYTHONUNBUFFERED=1 \
    ENV=prod \
    PORT=8080 \
    HF_HOME="/app/backend/data/cache" \
    SENTENCE_TRANSFORMERS_HOME="/app/backend/data/cache" \
    WHISPER_MODEL_DIR="/app/backend/data/cache"

WORKDIR /app/backend

# install runtime deps only (NHẸ)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ffmpeg libsm6 libxext6 \
 && rm -rf /var/lib/apt/lists/*

# copy python deps từ builder
COPY --from=backend-builder /install /usr/local

# copy frontend build
COPY --from=frontend-build /app/build /app/build

# copy backend code
COPY backend .

# tạo user non-root (recommended)
RUN groupadd -g $GID app && \
    useradd -u $UID -g app -m app

RUN mkdir -p /app/backend/data && \
    chown -R app:app /app

USER app

EXPOSE 8080

# healthcheck nhẹ
HEALTHCHECK CMD curl -f http://localhost:8080/health || exit 1

CMD ["bash", "start.sh"]