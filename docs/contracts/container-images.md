# Local container image resolution

This Compose environment is restricted to synthetic local development. Its named
volumes must never hold real DICOM objects, reports, patient information, or
production backups.

Every local runtime image is built from a source image pinned by manifest digest.
The same Dockerfile and source digest are used by Compose and the blocking Trivy
matrix. They intentionally exclude credentials.

`minio/minio` was unavailable from Docker Hub on 2026-09-18 (`denied:
requested access to the resource is denied` / `unauthorized: authentication
required`). The upstream MinIO Docker guide identifies `quay.io/minio/minio` as
the supported public image, so the local-only Compose service uses that upstream
replacement. Its in-image `mc ready local` command replaces the unavailable
HTTP-client probe.

The generic `docker.elastic.co/elasticsearch/elasticsearch:8` tag was also not
published by the Elastic registry. Elastic's 8.x Docker guide specifies
`8.19.21` and its hardened Wolfi variant. The local image retains Elasticsearch
8.19.21 and replaces the bundled Netty 4.1.135 artifacts with checksum-pinned
4.1.137 artifacts from Maven Central, the compatible release containing the
Trivy-reported fixes.

On 2026-09-29, the blocking scan identified CVE-2026-68497 (HIGH) in four
bundled Jackson Databind 2.18.9 copies. The hardened image additionally replaces
all four with Maven Central's 2.18.10 patch, which the
[upstream release notes](https://github.com/FasterXML/jackson/wiki/Jackson-Release-2.18.10)
identify as fixed. The downloaded JAR was checked against Maven Central's SHA512
and its SHA256 is pinned in the Dockerfile. Existing JAR paths are preserved for
Elastic's module loading/policies; the embedded implementation and Maven metadata
are 2.18.10. The build fails if the expected four old paths are absent. This is a
dependency patch, not a vulnerability waiver; HIGH/CRITICAL remain blocking.

On 2026-10-02, the resumed blocking scan identified additional fixed HIGH findings:
Redis libcrypto3/libssl3 CVE-2026-75804 and CVE-2026-84782; Orthanc OpenSSL
CVE-2026-84782; Elasticsearch Jackson Core CVE-2026-89407/CVE-2026-89425 and
Databind CVE-2026-91776/CVE-2026-91777. The original source digests remain pinned.
Redis pins both libraries to Alpine 3.3.7-r2; Orthanc pins libssl3t64, openssl and
openssl-provider-legacy to Ubuntu 3.5.5-1ubuntu3.7 (the current repository candidate,
newer than the scanner's unavailable 3.6 minimum fix). Elasticsearch replaces all
nine Core and four Databind copies with 2.18.11, verifies counts, preserves module
paths and pins SHA256 after checking Maven Central SHA512. Three additional Core copies are embedded in the SQL CLI and the two x-content
archives. The build replaces their Core payloads using the bundled JDK, rejects
signed archives and retains Elastic manifests, module descriptors and implementation
paths. The isolated smoke script verifies all 13 standalone hashes, exact embedded
Core payloads, SQL CLI startup, JSON index/search and SQL. The runtime user,
service versions, source digests and HIGH/CRITICAL blocking policy are unchanged.
Existing local containers/data volumes are not automatically replaced by this patch.

On 2026-09-19, Redis moved from `redis:7` to the exact Redis 7 Alpine release
below. Local image inspection confirmed the manifest digest, and the existing
synthetic `miap-redis-data` volume was reused without deletion. Redis 7.4.11
reached healthy and aggregate readiness returned HTTP 200. The blocking matrix
now builds and scans the same digest-pinned local runtime image used by Compose.

PostgreSQL replaces the vulnerable Go-based `gosu` helper with Alpine's native
`su-exec` while retaining the upstream entrypoint's volume ownership repair.
Orthanc removes the runtime-unneeded `linux-libc-dev` headers. The archived
upstream MinIO container is replaced by Chainguard's current MinIO build of the
same product (`RELEASE.2026-07-17T12-07-51Z`, Go 1.27.1) under its default
non-root UID/GID `65532:65532`. Existing synthetic MinIO volumes require a
one-time ownership migration from the previous root-running image. Redis keeps
the exact previously selected 7.4.11 Alpine source image.
All five final images explicitly declare a non-root runtime user; PostgreSQL,
Orthanc, MinIO, Redis, and Elasticsearch run as UID 70, 999, 65532, 999, and
1000 respectively in the local Compose environment.

| Service | Runtime image | Source image | Resolved digest | Dockerfile |
| --- | --- | --- | --- | --- |
| PostgreSQL | `miap/postgres:16.15-alpine3.24` | `postgres:16.15-alpine3.24` | `sha256:3c5c8892d184f738f4fe282d14ddaa613a38f00f4189d2d94725ebe6f2909ddb` | `docker/postgres/Dockerfile` |
| Orthanc | `miap/orthanc:26.9.0-openssl-r7` | `orthancteam/orthanc` | `sha256:1ca07ad4a70f67f815e55a558e76718d572ed9d0571268a3fbc1516a9155c5ca` | `docker/orthanc/Dockerfile` |
| MinIO | `miap/minio:2026-07-17-hardened` | `cgr.dev/chainguard/minio` | `sha256:4e5b5ca6f76e889e07c6cf1d39d6cbe2efe8019819e3ac4e618bd5594731665e` | `docker/minio/Dockerfile` |
| Redis | `miap/redis:7.4.11-alpine3.21-openssl-r2` | `redis:7.4.11-alpine3.21` | `sha256:520775a41a63e77e06c73e35d2fd9cc15921a609516818796b4ecbb813078bc7` | `docker/redis/Dockerfile` |
| Elasticsearch | `miap/elasticsearch:8.19.21-netty-4.1.137-jackson-2.18.11` | `docker.elastic.co/elasticsearch/elasticsearch-wolfi:8.19.21` | `sha256:4780b851ca7f79eb59c94d5151984c2748c7548c8074047c870a0b187eb918ea` | `docker/elasticsearch/Dockerfile` |
