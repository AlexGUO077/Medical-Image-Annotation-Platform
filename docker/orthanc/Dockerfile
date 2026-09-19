FROM orthancteam/orthanc@sha256:1ca07ad4a70f67f815e55a558e76718d572ed9d0571268a3fbc1516a9155c5ca

USER root

# Kernel development headers are not needed to run Orthanc.
RUN apt-get purge --yes --auto-remove linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*
