# WP-00 scan policy

## Purpose and scope

WP-00 keeps CI and security evidence gates closed to real medical data. Pull
requests and the protected default branch run the root verification gates; the
security workflow also runs weekly. CI validates Compose syntax only and never
starts services or prints environment values.

## Blocking policy

`npm audit --audit-level=high` and Trivy filesystem/configuration scans fail on
`HIGH` or `CRITICAL` findings. CodeQL, dependency review, and Gitleaks secret
scanning also block the workflow on findings. Dependency review rejects added
`GPL-2.0`, `GPL-3.0`, `AGPL-1.0`, and `AGPL-3.0` licenses. Other license
identifiers found in `package-lock.json` are listed in the workflow job summary
for review.

A finding can be excepted only through a separately reviewed and approved
record that identifies the finding, scope, mitigation, approver, and expiry.
There is no implicit exception. In particular, [D-38](../decisions/D-38-node20-runtime.md)
selects Node `20.20.2` for compatibility; its end-of-support risk is not a
blanket vulnerability waiver, and it does not permit high or critical findings.

## Repository-content control

`npm run check:forbidden-files` examines `git ls-files -z`, so it evaluates only
tracked content. It rejects real `.env` files, credential/key/token material,
medical images, dumps/backups, and runtime storage roots. Medical-image test
fixtures are allowed only under `test/fixtures/synthetic/` and
`server/test/fixtures/synthetic/`; this exception does not allow credentials,
environment files, dumps, or runtime storage.

## Workflow supply-chain control

The workflows use maintained major/minor action tags rather than unverified
commit SHAs: `actions/checkout@v4`, `actions/setup-node@v4`,
`github/codeql-action@v3`, `actions/dependency-review-action@v4`,
`gitleaks/gitleaks-action@v2`, and `aquasecurity/trivy-action@0.28.0`.
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
