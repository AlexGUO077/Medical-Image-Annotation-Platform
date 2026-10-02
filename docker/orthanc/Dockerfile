FROM orthancteam/orthanc@sha256:1ca07ad4a70f67f815e55a558e76718d572ed9d0571268a3fbc1516a9155c5ca

USER root

# Kernel development headers are not needed to run Orthanc.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      libssl3t64=3.5.5-1ubuntu3.7 openssl=3.5.5-1ubuntu3.7 openssl-provider-legacy=3.5.5-1ubuntu3.7 \
    && apt-get purge --yes --auto-remove linux-libc-dev \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/orthanc/db \
    && chown -R orthanc:orthanc /var/lib/orthanc

USER orthanc
