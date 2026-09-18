# Local container image resolution

This Compose environment is restricted to synthetic local development. Its named
volumes must never hold real DICOM objects, reports, patient information, or
production backups.

Resolved digests are recorded after `docker compose --env-file .env.local pull`
on a Docker-capable development machine. They intentionally exclude credentials.
On 2026-09-18, this task's Docker daemon reported: `Docker Desktop is manually
paused. Unpause it through the Whale menu or Dashboard.` No image was pulled,
so recording a digest would be fabricated.

| Service | Image reference | Resolved digest |
| --- | --- | --- |
| PostgreSQL | `postgres:16` | Not resolved: Docker Desktop paused |
| Orthanc | `orthancteam/orthanc` | Not resolved: Docker Desktop paused |
| MinIO | `minio/minio` | Not resolved: Docker Desktop paused |
| Redis | `redis:7` | Not resolved: Docker Desktop paused |
| Elasticsearch | `docker.elastic.co/elasticsearch/elasticsearch:8` | Not resolved: Docker Desktop paused |
