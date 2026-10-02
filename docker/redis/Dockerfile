FROM redis:7.4.11-alpine3.21@sha256:520775a41a63e77e06c73e35d2fd9cc15921a609516818796b4ecbb813078bc7

# Patch the OpenSSL libraries identified by the blocking image scan.
RUN apk add --no-cache libcrypto3=3.3.7-r2 libssl3=3.3.7-r2

USER redis
