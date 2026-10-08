FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web-anno/package.json ./web-anno/
COPY scripts/runtime-version.mjs ./scripts/
RUN npm ci
COPY web-anno/index.html web-anno/tsconfig*.json web-anno/vite.config.ts ./web-anno/
COPY web-anno/src ./web-anno/src
COPY test/fixtures/synthetic/*.ts ./test/fixtures/synthetic/
RUN npm run build --workspace web-anno

FROM nginx:alpine@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2
RUN apk upgrade --no-cache && rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /app/web-anno/dist /usr/share/nginx/html
# The deployment mounts a reviewed configuration and private TLS files.
USER nginx
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
