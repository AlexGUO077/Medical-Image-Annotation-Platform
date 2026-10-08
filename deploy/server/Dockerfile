# Existing runtime versions; same source digests must be used in the security scan.
FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS node
FROM node AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web-anno/package.json ./web-anno/
COPY scripts/runtime-version.mjs ./scripts/
RUN npm ci
COPY server/tsconfig*.json server/nest-cli.json ./server/
COPY server/src ./server/src
RUN npm run build --workspace server

FROM node AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web-anno/package.json ./web-anno/
RUN npm ci --omit=dev --workspace server --ignore-scripts

# Same Python 3.11 / pinned worker requirements as the real-inference workflow.
FROM python:3.11-slim-bookworm@sha256:0a310eeecf4e1f5a0743f9a6520c90c88d089c903ca5fd283f501e3a805f5f89 AS runtime
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    libstdc++6 libgomp1 libgl1 libglib2.0-0 poppler-utils libreoffice-writer libreoffice-calc fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
COPY server/workers/requirements.txt /tmp/worker-requirements.txt
RUN python -m pip install --no-cache-dir -r /tmp/worker-requirements.txt && rm /tmp/worker-requirements.txt
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app/server
COPY --from=dependencies /app/node_modules /app/node_modules
COPY --from=dependencies /app/server/package.json ./package.json
COPY --from=build /app/server/dist ./dist
COPY server/workers/deid_worker.py ./workers/deid_worker.py
RUN groupadd --gid 10001 miap && useradd --uid 10001 --gid 10001 --create-home miap \
    && mkdir -p /home/miap/.cache/paddle && chown -R 10001:10001 /home/miap
ENV NODE_ENV=production DEID_WORKER_PYTHON=/usr/local/bin/python3 \
    PADDLE_HOME=/home/miap/.cache/paddle IMPORT_QUARANTINE_DIR=/tmp/miap-import-quarantine
USER 10001:10001
EXPOSE 3000
CMD ["node", "dist/main.js"]
