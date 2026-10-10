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

On 2026-10-06, the merged WP-12 Security run identified CVE-2026-75140 (HIGH)
in the attachment module's jsoup 1.21.2. The image replaces its sole JAR with
Maven Central's checksum-pinned 1.23.2, retaining the module's original path and
UID/GID. Maven Central SHA512 was verified before pinning SHA256. The
[official release](https://jsoup.org/news/release-1.23.2) includes nested XML
namespace/depth safeguards; the release tag contains upstream fix commit
`862ba2f`. The isolated smoke additionally checks the jsoup payload hash/version
and HTML attachment extraction. Existing source digests, runtime user and scan
thresholds remain unchanged. Running local services/volumes are not replaced.

Local verification (2026-10-06, macOS arm64 Docker Desktop): final amd64 image
built; `aquasec/trivy:0.70.0 image --input ... --scanners vuln --severity
HIGH,CRITICAL --exit-code 1` with freshly updated vulnerability/Java databases
returned exit 0 and zero HIGH/CRITICAL findings. Like the failed merge run, Trivy
reported 133 OS packages skipped for mismatched PURL namespace (69 recognized
Chainguard packages plus JAR scanning); this result is limited to that scanner
coverage. The same Dockerfile's arm64 build
passed `python3 scripts/verify-elasticsearch-image.py
miap/elasticsearch:jsoup-1.23.2-arm64-smoke linux/arm64`: non-root startup,
Jackson/jsoup hashes and metadata, embedded Core payloads, JSON indexing/search,
SQL and synthetic HTML attachment extraction. amd64 runtime smoke on this arm64
host failed before module loading: `seccomp unavailable: CONFIG_SECCOMP not
compiled into kernel`; this is retained as an environment limitation, not a
runtime pass. The ES Security matrix now runs this isolated smoke on native amd64 after its
blocking scan; that result is pending remote validation.
Existing 45 script tests, forbidden-file check and `docker compose ... config
--quiet` passed. Raw local output is ignored under `reports/es-jsoup-20261006/`;
no application behavior or persistent service data changed. Rollback uses the
previous Git image definition but reintroduces the blocked finding, so requires
security disposition before use.

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
| Elasticsearch | `miap/elasticsearch:8.19.21-netty-4.1.137-jackson-2.18.11-jsoup-1.23.2-lz4-1.11.4` | `docker.elastic.co/elasticsearch/elasticsearch-wolfi:8.19.21` | `sha256:4780b851ca7f79eb59c94d5151984c2748c7548c8074047c870a0b187eb918ea` | `docker/elasticsearch/Dockerfile` |
| Server | `miap/server:wp16-pebble-free` | `ubuntu:26.04` | `sha256:f144425ff09be612d6d9ad965196e9cdc23dae1f42110a8a11a3e9a8198759f7` | `deploy/server/Dockerfile` |
| Nginx | `miap/nginx:wp16` | `nginx:alpine` | `sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2` | `deploy/nginx/Dockerfile` |

WP-16 adds the last two images in `deploy/compose.yml`, preserving the same five
middleware definitions. Server/nginx run as UID 10001/101. Server retains official
Python 3.11 (`sha256:0dd364ba7e10242f07755449e3a3d0e35f9efd987952737b90def6709ab0c5ce`)
and Node 24.14.0 (`sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8`);
nginx uses that Node source only to build static files. D-44 records the fixed
worker dependencies and optional-installer import patch. See the WP-16 evidence
and STATUS for actual verification; this table does not grant deployment approval.

On 2026-10-10, PRs #60/#61/#62 were blocked by the same four HIGH findings.
Elasticsearch's sole `lz4-java` 1.11.1 payload is replaced with Maven Central's
1.11.4 ([artifact](https://repo.maven.apache.org/maven2/at/yawk/lz4/lz4-java/1.11.4/)),
fixing CVE-2026-106451. SHA512 was checked before pinning SHA256; the existing
JAR path, module name and UID/GID are retained. The isolated runtime smoke checks
its hash/metadata, LZ4 compression/decompression with the selected implementation
and safe Java fallback, and flushed ES source readback alongside existing search,
SQL and attachment tests.

The server's three Go findings (CVE-2026-78667, CVE-2026-78669 and
CVE-2026-97031) belong to Ubuntu's `/usr/bin/pebble`. Image inspection confirmed
that this binary has no dpkg package owner. It is removed from the final image:
the application starts Node directly, Compose supplies `init: true`, and no
application, worker or deployment script invokes Pebble. No package database is
altered, and required Node/Python/document conversion tools remain present.
The updated image tags are used consistently by Compose, scans and worker
verification. Source digests, non-root users and HIGH/CRITICAL gates are unchanged;
no ignore rules are added. Existing containers and data volumes are not replaced.
Reverting these image changes reintroduces the blocked findings.

Local verification for this patch (2026-10-10): both final `linux/amd64` images
built successfully and Trivy 0.70.0 with freshly downloaded vulnerability/Java
DBs returned exit 0, zero HIGH/CRITICAL. The ES scan retains its existing
133-package PURL namespace coverage warning; this is not a claim of complete OS
coverage. The same ES Dockerfile's native arm64 smoke passed the checks above;
CI runs that smoke on native amd64. The server's isolated non-root smoke verified
Pebble absence, Node 24.14.0, Python 3.11.17, Poppler and LibreOffice. All 45
script tests, forbidden-file check and both Compose config checks passed; the
read-only reviewer found no blocking issue. Raw local evidence is ignored under
`reports/security-20261010/`. Remote results are the checks on each PR's current
head; no local scan grants release approval.
