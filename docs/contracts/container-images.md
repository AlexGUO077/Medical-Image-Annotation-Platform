# Local container image resolution

This Compose environment is restricted to synthetic local development. Its named
volumes must never hold real DICOM objects, reports, patient information, or
production backups.

Resolved digests are recorded after `docker compose --env-file .env.local pull`
on a Docker-capable development machine. They intentionally exclude credentials.

`minio/minio` was unavailable from Docker Hub on 2026-09-18 (`denied:
requested access to the resource is denied` / `unauthorized: authentication
required`). The upstream MinIO Docker guide identifies `quay.io/minio/minio` as
the supported public image, so the local-only Compose service uses that upstream
replacement. Its in-image `mc ready local` command replaces the unavailable
HTTP-client probe.

The generic `docker.elastic.co/elasticsearch/elasticsearch:8` tag was also not
published by the Elastic registry. Elastic's current 8.x Docker guide specifies
`8.19.21`, so Compose pins that current release within the source-manual's
required Elasticsearch 8 major line.

| Service | Image reference | Resolved digest |
| --- | --- | --- |
| PostgreSQL | `postgres:16` | `sha256:f1c3376c26f2609ab9f29f71f824103fe2fcd8ee0346485cb6122a4f93df6f94` |
| Orthanc | `orthancteam/orthanc` | `sha256:1ca07ad4a70f67f815e55a558e76718d572ed9d0571268a3fbc1516a9155c5ca` |
| MinIO | `quay.io/minio/minio` | `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e` |
| Redis | `redis:7` | `sha256:71da9275c5f3fcb97d0fa0c8c5b36cc995327265420f17a04bfd544f458059f7` |
| Elasticsearch | `docker.elastic.co/elasticsearch/elasticsearch:8.19.21` | `sha256:cbf5cd6cfe5532a9c02d510c66d238bf329cd51fe3d57170a2a880aca7d47419` |
