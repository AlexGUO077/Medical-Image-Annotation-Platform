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

# Retain official Python 3.11; Ubuntu supplies the maintained glibc and document
# conversion libraries. Debian 12/13 candidates failed the unchanged image gate.
FROM python:3.11-slim-trixie@sha256:0dd364ba7e10242f07755449e3a3d0e35f9efd987952737b90def6709ab0c5ce AS python
FROM ubuntu:26.04@sha256:f144425ff09be612d6d9ad965196e9cdc23dae1f42110a8a11a3e9a8198759f7 AS runtime
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends ca-certificates libstdc++6 libgomp1 libgl1 libglib2.0-0t64 poppler-utils libreoffice-writer libreoffice-calc fonts-noto-cjk libssl3t64 zlib1g libbz2-1.0 libexpat1 libffi8 liblzma5 libsqlite3-0 libreadline8t64 libncursesw6 uuid-runtime && rm -rf /var/lib/apt/lists/*
COPY --from=python /usr/local /usr/local
RUN ldconfig
COPY server/workers/requirements.txt /tmp/worker-requirements.txt
COPY deploy/server/patch-paddlenlp.py /tmp/patch-paddlenlp.py
RUN python -m pip install --no-cache-dir --upgrade pip==26.2.1 setuptools==84.0.0 wheel==0.48.0 \
    && python -m pip install --no-cache-dir -r /tmp/worker-requirements.txt \
    && python -m pip check \
    && python /tmp/patch-paddlenlp.py \
    && python -m pip uninstall -y pip \
    && rm -rf /usr/local/lib/python3.11/ensurepip /tmp/worker-requirements.txt /tmp/patch-paddlenlp.py
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app/server
COPY --from=dependencies /app/node_modules /app/node_modules
COPY --from=dependencies /app/server/package.json ./package.json
COPY --from=dependencies /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY server/workers/deid_worker.py ./workers/deid_worker.py
COPY deploy/bootstrap.cjs ./bootstrap.cjs
COPY --chmod=755 deploy/server/worker-python /usr/local/bin/miap-python
RUN groupadd --gid 10001 miap && useradd --uid 10001 --gid 10001 --create-home miap \
    && mkdir -p /home/miap/.cache/paddle && chown -R 10001:10001 /home/miap
ENV NODE_ENV=production DEID_WORKER_PYTHON=/usr/local/bin/miap-python \
    PADDLE_HOME=/home/miap/.cache/paddle IMPORT_QUARANTINE_DIR=/tmp/miap-import-quarantine
USER 10001:10001
EXPOSE 3000
CMD ["node", "dist/main.js"]
