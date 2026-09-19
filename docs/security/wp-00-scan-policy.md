# WP-00 scan policy

## Purpose and scope

WP-00 keeps CI and security evidence gates closed to real medical data. Pull
requests and the protected default branch run the root verification gates; the
security workflow also runs weekly. CI validates Compose syntax only and never
starts services or prints environment values.

## Blocking policy

`npm audit --audit-level=high` and Trivy filesystem/configuration scans fail on
`HIGH` or `CRITICAL` findings. A separate Trivy image matrix scans the exact
digest-pinned PostgreSQL, Orthanc, MinIO, Redis, and Elasticsearch references
recorded in [the container image contract](../contracts/container-images.md).
Every matrix leg is identified by service and full digest and exits nonzero on
`HIGH` or `CRITICAL` image vulnerabilities. Updating a Compose image therefore
requires updating its resolved digest in the contract and the workflow matrix
in the same reviewed change.

CodeQL saves SARIF locally with `upload: never` and `upload-database: false`
because this private repository does not have GitHub Advanced Security enabled.
The workflow disables both SARIF and database uploads. Its explicit repository
gate still recursively parses every regular `.sarif` and `.json` file in CodeQL's SARIF
output directory. It resolves each result's rule metadata across driver and
referenced extension components, blocking strictly numeric `security-severity`
scores of `7.0` or higher on pull requests, pushes, and scheduled runs. Missing,
unreadable, empty, or malformed SARIF input fails closed, including unsupported
result or explicit tool-component references.

The repository-native whole-lock dependency job replaces GitHub's hosted
Dependency Review action, which is unavailable without GitHub Advanced
Security in this private repository. It runs under exact Node `20.20.2`, uses
`npm audit --audit-level=high` to block High/Critical dependency findings, and
evaluates every `package-lock.json` package entry. It blocks `GPL-2.0`,
`GPL-3.0`, `AGPL-1.0`, and `AGPL-3.0` identifiers even inside compound license
expressions, records sorted allowed identifiers in the job summary, and reports
the count of entries without lockfile license metadata. Invalid lockfile input
fails closed. Gitleaks also blocks secret findings; its job receives only
`contents: read` and `pull-requests: read`, the latter being required to list PR
commits.

A finding can be excepted only through a separately reviewed and approved
record that identifies the finding, scope, mitigation, approver, and expiry.
There is no implicit exception. In particular, [D-38](../decisions/D-38-node20-runtime.md)
selects Node `20.20.2` for compatibility; its end-of-support risk is not a
blanket vulnerability waiver, and it does not permit high or critical findings.

## Repository-content control

`npm run check:forbidden-files` examines `git ls-files -z`, so it evaluates only
tracked content. It rejects real `.env` files, `.credentials/` directories,
credential/key/token material, medical images, dumps/backups, and runtime
storage roots. Medical-image test
fixtures are allowed only under `test/fixtures/synthetic/` and
`server/test/fixtures/synthetic/`; this exception does not allow credentials,
environment files, dumps, or runtime storage.

## Workflow supply-chain control

The workflows use maintained major/minor action tags rather than unverified
commit SHAs: `actions/checkout@v4`, `actions/setup-node@v4`,
`github/codeql-action@v3`, `gitleaks/gitleaks-action@v2`, and
`aquasecurity/trivy-action@v0.36.0`. The Trivy ref and the workflow's
`scan-type`, `scan-ref`, `image-ref`, `scanners`, `severity`, `exit-code`, and
`skip-dirs` inputs were checked against the official `v0.36.0` action metadata.
Tags are mutable, so each Dependabot update and workflow change must be reviewed
as a supply-chain change. Once a release SHA is independently verified against
the publisher's release, replace the corresponding tag with that immutable SHA;
do not invent a digest or SHA.

## Evidence and response

Capture the workflow URL, run timestamp, scanner version, finding identifiers,
and disposition in the relevant release or security evidence. Do not copy
secret values, tokens, private keys, or real clinical data into job summaries,
issues, pull requests, or evidence documents. Rotate and revoke any credential
identified by a secret scan before closing the finding.
