# WP-S0 Security and Contract Foundation Implementation Plan

> **历史计划，执行流程已退役（2026-09-19）。** 后续只按 [AGENTS.md](../../../AGENTS.md) 执行；本文保留需求、接口及既有决定的追溯信息，下面的步骤和命令不再作为执行清单。停止 Superpowers、默认双代理、强制 RED/GREEN、owner/文件占用登记、实现交接及全文证据转录。当前状态统一见 [STATUS](../../STATUS.md)。 Task 1 文档验证器及后续对该验证器、manifest、固定标题/排版测试的依赖全部取消，不新建这些脚本或测试；其余安全/契约内容按基线相关要求落实，决策批准、数据准入和 SG 验收要求不变。原 `wp-s0-status.md` 等当前状态记录由 STATUS 单表替代，证据材料仅保留引用。

**Goal:** Produce the reviewed contracts and evidence required to keep real medical data closed while establishing traceable decisions, data boundaries, authorization, threat controls, and security gates for all later work packages.

**Architecture:** Treat security and contract documents as executable governance artifacts. A Node built-in validation harness checks required decisions, headings, identifiers, owners, blocked states, and forbidden placeholders. Documents remain modular—decisions, data, authorization, threats, operations, and gate evidence—so later work packages can consume stable interfaces without rewriting the product architecture.

**Tech Stack:** Markdown, JSON, Mermaid text diagrams, Node.js 20.20.2 built-in test runner, GitHub Pull Request workflow.

**Spec:** `docs/superpowers/specs/2026-09-18-wp-s0-wp-00-foundation-design.md`

## Global Constraints

- WP-S0 does not replace the source manual or invent product features, fields, APIs, states, roles, or permissions.
- Real-data entry remains closed until SG-0 and all relevant downstream security gates have evidence and responsible-unit approval.
- A decision is closed only when its record contains status, authority, rationale, impact, tests, rollback, and effective date.
- Legal/compliance documents record engineering evidence and open approvals; they do not claim formal legal, ethics, filing, classified-protection, or certification conclusions.
- Medical data, patient information, raw reports, identity mappings, credentials, production logs, backups, and real screenshots must not enter documents or Git.
- D-38 fixes Node.js at `20.20.2`; it does not waive critical/high vulnerability findings.
- Every task records owner and file scope in the external daily engineering log before editing.
- PR #1 must be merged before this plan is executed; create `security/wp-s0-foundation` from current `origin/main`.

---

### Task 1: Build the executable WP-S0 document validator

**Files:**
- Create: `scripts/wp-s0-validation.mjs`
- Test: `scripts/wp-s0-validation.test.mjs`
- Create: `docs/security/wp-s0-manifest.json`

**Interfaces:**
- Consumes: UTF-8 Markdown files and the manifest of required documents/sections/decision IDs.
- Produces: `validateWpS0(root: string, manifest: Manifest): ValidationIssue[]`; `node scripts/wp-s0-validation.mjs` exits nonzero for missing evidence without depending on WP-00 files.

- [ ] **Step 1: Write failing validator tests**

```js
test('reports missing documents and required sections', () => {
  const issues = validateWpS0(fixtureRoot, {
    documents: [{ path: 'docs/security/threat-model.md', headings: ['## Assets'] }],
    decisions: ['D-03', 'D-38']
  });
  assert.deepEqual(issues.map((issue) => issue.code), ['MISSING_DOCUMENT', 'MISSING_DECISION']);
});

test('rejects unresolved placeholder language in a closed decision', () => {
  const issues = validateDecision('# D-38\n\n状态：已批准\n\nTODO');
  assert.equal(issues[0].code, 'CLOSED_DECISION_PLACEHOLDER');
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/wp-s0-validation.test.mjs`

Expected: FAIL because `wp-s0-validation.mjs` does not exist.

- [ ] **Step 3: Implement deterministic validation**

The validator checks:

- every manifest path exists;
- exact required headings exist;
- every P0 ID appears in `docs/decisions/index.md` once;
- closed decisions contain no `TBD`, `TODO`, “待补充”, “以后确定”, or empty owner/date fields;
- blocked decisions state the exact blocked WP and permitted work;
- no file contains credential patterns or prohibited medical file links;
- relative document links resolve within the repository.

- [ ] **Step 4: Define the initial manifest**

The manifest lists the decision index, data inventory/flow, source authorization contract, authorization matrix, audit catalog, threat model, cryptography/secrets plan, logging plan, incident plan, retention/deletion plan, DICOM de-identification profile, and SG-0/SG-1 evidence index.

- [ ] **Step 5: Verify the red/green cycle**

Run: `node --test scripts/wp-s0-validation.test.mjs`

Expected: validator unit tests PASS; `node scripts/wp-s0-validation.mjs` still exits nonzero because required documents have not yet been created. This expected failure proves later tasks are required.

- [ ] **Step 6: Commit the validator**

```bash
git add scripts/wp-s0-validation.mjs scripts/wp-s0-validation.test.mjs docs/security/wp-s0-manifest.json
git commit -m "test: add WP-S0 contract validation"
```

### Task 2: Establish the decision register and blocked-work map

**Files:**
- Create: `docs/decisions/index.md`
- Create: `docs/decisions/decision-record-template.md`
- Modify: `docs/decisions/D-38-node20-runtime.md`
- Create: `docs/contracts/blocked-work-map.md`
- Test: `scripts/wp-s0-validation.test.mjs`

**Interfaces:**
- Consumes: baseline D-01 through D-38.
- Produces: one authoritative status row per decision and an exact mapping from unresolved decisions to blocked work packages/files/interfaces.

- [ ] **Step 1: Extend tests to require every P0 decision ID**

Add a test asserting that the index contains D-01 through D-14 and D-30 through D-38 exactly once, with one of `已批准`, `已阻断`, or `不适用`.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/wp-s0-validation.test.mjs`

Expected: FAIL with missing-decision issues.

- [ ] **Step 3: Create the decision index**

Record:

- D-01: approved—NestJS + TypeORM default path;
- D-02: approved—Ant Design v5;
- D-38: approved—Node 20.20.2, no vulnerability waiver;
- all other P0 items: blocked, with exact affected WP from the baseline.

The template requires: context, decision, authority, alternatives, contract impact, security/data impact, validation, rollback, effective date, review date, and related WP/SG.

- [ ] **Step 4: Create the blocked-work map**

For every blocked ID, state the fields/endpoints/components that must not be implemented. Example: D-08 blocks the external representation of “报告未提及” in WP-09/WP-10 but does not block WP-00 route scaffolding.

- [ ] **Step 5: Run decision validation**

Run: `node scripts/wp-s0-validation.mjs --scope decisions`

Expected: exit 0 for decision completeness; blocked decisions remain valid because their boundaries are explicit.

- [ ] **Step 6: Commit the decision register**

```bash
git add docs/decisions docs/contracts/blocked-work-map.md scripts/wp-s0-validation.test.mjs
git commit -m "docs: establish P0 decision register"
```

### Task 3: Document the data inventory, classification, and trust boundaries

**Files:**
- Create: `docs/security/data-inventory.md`
- Create: `docs/security/data-flow-and-trust-boundaries.md`
- Create: `docs/security/environment-boundaries.md`
- Test: `scripts/wp-s0-validation.test.mjs`

**Interfaces:**
- Consumes: baseline S1-S4 data classes, runtime architecture, and lifecycle controls.
- Produces: canonical data asset IDs, stores, processors, flows, trust-boundary IDs, allowed environments, and real-data closure state.

- [ ] **Step 1: Add failing manifest tests for required assets and boundaries**

Require asset IDs for original DICOM, de-identified DICOM, raw report, masked report, mask map, UID mapping, clinical text, attachments, annotations, audit events, credentials, backups, exports, caches, and ES documents. Require boundaries for browser/nginx, server/private services, quarantine/formal storage, admin access, backup, and export recipient.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/wp-s0-validation.test.mjs`

Expected: FAIL because the data documents are absent.

- [ ] **Step 3: Write the data inventory**

For each asset record classification S1-S4, source, purpose, allowed subjects, prohibited destinations, system of record, encryption requirement, retention decision ID, and deletion evidence. Explicitly state that `reports.raw_text` contains masked text, not the original report.

- [ ] **Step 4: Write the target data-flow diagram and table**

The diagram covers browser, nginx, server, quarantine, PostgreSQL, Orthanc, MinIO/OSS, Redis, Elasticsearch, backup, export, and administrator. Every arrow has flow ID, protocol, data class, authorization point, audit event, failure behavior, and status (`关闭` until its gate passes).

- [ ] **Step 5: Define environment separation**

Document development/test/pre-production/production identities, networks, buckets, databases, secrets, and allowed data classes. Development and CI allow only synthetic/approved anonymous fixtures.

- [ ] **Step 6: Validate and commit**

Run: `node scripts/wp-s0-validation.mjs --scope data`

Expected: exit 0.

```bash
git add docs/security/data-inventory.md docs/security/data-flow-and-trust-boundaries.md docs/security/environment-boundaries.md scripts/wp-s0-validation.test.mjs
git commit -m "docs: define data and trust boundaries"
```

### Task 4: Define source authorization and real-data admission

**Files:**
- Create: `docs/contracts/source-authorization-ledger.md`
- Create: `docs/security/real-data-admission-checklist.md`
- Create: `docs/security/real-data-closure-status.md`
- Test: `scripts/wp-s0-validation.test.mjs`

**Interfaces:**
- Consumes: D-31 and SG-0 requirements.
- Produces: source-ledger contract and an explicit `CLOSED` admission state consumed by import/task/publish/export plans.

- [ ] **Step 1: Add failing tests for mandatory ledger fields**

Require provider, contact role, agreement/ethics/authorization reference, lawful basis, data categories, purposes, geography, term, authorized users, derivative rights, redistribution/export terms, withdrawal, deletion, backup handling, and approval status.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/wp-s0-validation.test.mjs`

Expected: FAIL with missing source-authorization document fields.

- [ ] **Step 3: Define the ledger contract without inventing a database table**

Specify semantic fields and validation rules, but mark the physical table/API as blocked by D-31. `cases.source` is explicitly insufficient. Task creation, publication, and export must later consume an `authorization_status=active` decision from the approved service contract.

- [ ] **Step 4: Define admission and closure evidence**

The admission checklist requires responsible-unit approval, source authorization, data classification, impact assessment, environment isolation, de-identification evidence, access controls, audit availability, retention rule, and incident contacts. `real-data-closure-status.md` states `CLOSED` and lists the exact evidence needed to change it.

- [ ] **Step 5: Validate and commit**

Run: `node scripts/wp-s0-validation.mjs --scope source`

Expected: exit 0 and closure state remains `CLOSED`.

```bash
git add docs/contracts/source-authorization-ledger.md docs/security/real-data-admission-checklist.md docs/security/real-data-closure-status.md scripts/wp-s0-validation.test.mjs
git commit -m "docs: define source authorization gate"
```

### Task 5: Define authorization policy and audit event contracts

**Files:**
- Create: `docs/contracts/authorization-policy-matrix.md`
- Create: `docs/contracts/audit-event-catalog.md`
- Create: `docs/security/negative-authorization-tests.md`
- Test: `scripts/wp-s0-validation.test.mjs`

**Interfaces:**
- Consumes: account role, system qualification, task role, resource relationship, case state, and baseline section 8.6.
- Produces: policy IDs and audit event IDs referenced by WP-02 onward.

- [ ] **Step 1: Add failing tests for protected actions**

Require policies for login/session, account/qualification changes, case/report/attachment access, task claim, annotation write, review/publish, frame ticket/fetch, search, export request/approval/download, mask-map access, and audit search.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/wp-s0-validation.test.mjs`

Expected: FAIL because policy IDs are absent.

- [ ] **Step 3: Write the authorization matrix**

Each row states policy ID, subject, qualification, assignment, resource chain, allowed states, recent-auth/2FA need, allow result, external denial response, internal denial reason, and audit event. Preserve the fixed check order: login → account state → role/qualification → assignment → resource existence.

- [ ] **Step 4: Write the audit event catalog**

Each event states actor, action, target type/id, outcome, policy ID, reason code, request ID, minimized metadata, IP handling, retention class, and whether audit failure blocks the business action. Never log passwords, JWTs, 2FA secrets, full frame tokens, raw reports, DICOM tags, mask maps, or object-store credentials.

- [ ] **Step 5: Define negative test cases**

For every high-value policy include unauthenticated, disabled, expired, wrong role, wrong qualification, unassigned, cross-case, cross-series, invalid state, non-existent resource, replay, and concurrent-race cases where applicable.

- [ ] **Step 6: Validate and commit**

Run: `node scripts/wp-s0-validation.mjs --scope authorization`

Expected: exit 0.

```bash
git add docs/contracts/authorization-policy-matrix.md docs/contracts/audit-event-catalog.md docs/security/negative-authorization-tests.md scripts/wp-s0-validation.test.mjs
git commit -m "docs: define authorization and audit contracts"
```

### Task 6: Complete the threat model and operational security plans

**Files:**
- Create: `docs/security/threat-model.md`
- Create: `docs/security/cryptography-and-secrets.md`
- Create: `docs/security/logging-and-monitoring.md`
- Create: `docs/security/incident-response.md`
- Create: `docs/security/retention-and-deletion.md`
- Test: `scripts/wp-s0-validation.test.mjs`

**Interfaces:**
- Consumes: asset IDs, flow IDs, boundary IDs, policies, and audit events.
- Produces: threat IDs, mitigation owners, verification commands, rotation triggers, incident playbooks, and deletion evidence requirements.

- [ ] **Step 1: Add failing tests for mandatory threats and playbooks**

Require IDOR, session theft, frame scraping, token replay, unauthorized export, zip bomb, path traversal, malicious attachment, SSRF, XSS, injection, log leakage, insider misuse, audit failure, secret leakage, backup exposure, and re-identification.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/wp-s0-validation.test.mjs`

Expected: FAIL because operational documents are absent.

- [ ] **Step 3: Write threat records**

Each threat includes asset, actor, entry point, prerequisite, abuse flow, impact, existing requirement, planned mitigation, verification, residual risk, owner role, and blocking SG. Do not mark a threat mitigated before evidence exists.

- [ ] **Step 4: Define secrets, logs, incidents, and lifecycle rules**

Cryptography/secrets covers separate environment/use keys, storage, injection, rotation, revocation, backup, emergency handling, and prohibition on reusing JWT keys for frame tokens. Logging defines trustworthy time, access, integrity decision D-36, alerts, and minimized fields. Incident response covers account leakage, signing-key leakage, retained raw packages, mass frame access, export-link leakage, and audit outage. Retention maps every asset to D-30 until responsible-unit durations are approved.

- [ ] **Step 5: Validate and commit**

Run: `node scripts/wp-s0-validation.mjs --scope operations`

Expected: exit 0; unresolved D-30, D-34, D-35, and D-36 remain visibly blocking rather than silently defaulted.

```bash
git add docs/security/threat-model.md docs/security/cryptography-and-secrets.md docs/security/logging-and-monitoring.md docs/security/incident-response.md docs/security/retention-and-deletion.md scripts/wp-s0-validation.test.mjs
git commit -m "security: document threats and operations controls"
```

### Task 7: Define the DICOM de-identification decision package

**Files:**
- Create: `docs/security/dicom-deidentification-profile.md`
- Create: `docs/security/dicom-deidentification-verification.md`
- Test: `scripts/wp-s0-validation.test.mjs`

**Interfaces:**
- Consumes: current DICOM PS3.15 requirement and D-37.
- Produces: decision checklist for Attribute Confidentiality Profile/options, private-tag policy, UID/date handling, Clean Pixel Data, OCR, manual review, and synthetic verification fixtures.

- [ ] **Step 1: Add failing tests for profile decision sections**

Require profile/version, options, removed/replaced/preserved attributes, private tags, UID mapping, date handling, burned-in text, pixel cleaning, character sets, failure quarantine, manual confirmation, evidence retention, and deviation approval.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/wp-s0-validation.test.mjs`

Expected: FAIL because the DICOM package is absent.

- [ ] **Step 3: Write the decision package without claiming D-37 is closed**

Record the exact decisions required from the responsible medical/security authority. Preserve required imaging tags such as window and pixel spacing only after explicit profile review. Default private tags to removal. Any automatic, OCR, or manual failure keeps the case in quarantine.

- [ ] **Step 4: Define synthetic verification cases**

Include direct identifiers, private tags, nested sequences, UID consistency, dates, multibyte text, burned-in text, missing window values, multi-valued window values, corrupted DICOM, and false-positive/false-negative OCR review. No real DICOM fixture may be used.

- [ ] **Step 5: Validate and commit**

Run: `node scripts/wp-s0-validation.mjs --scope dicom`

Expected: exit 0 for package completeness while D-37 remains blocked pending approval.

```bash
git add docs/security/dicom-deidentification-profile.md docs/security/dicom-deidentification-verification.md scripts/wp-s0-validation.test.mjs
git commit -m "security: define DICOM de-identification decision package"
```

### Task 8: Assemble SG-0 and SG-1 evidence and open the Draft PR

**Files:**
- Create: `docs/evidence/sg-0-responsibility-and-legality.md`
- Create: `docs/evidence/sg-1-architecture-and-threats.md`
- Create: `docs/evidence/wp-s0-status.md`
- Modify: `docs/security/wp-s0-manifest.json`
- Modify: `/Users/guo/College/Medical-Image-Annotation-Platform/local-engineering-log/YYYY-MM-DD.md` (outside Git)

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: explicit gate status (`PASS`, `BLOCKED`, or `CONDITIONALLY_APPROVED`), evidence links, remote SHA, and Draft PR.

- [ ] **Step 1: Run full document validation**

Run:

```bash
node --test scripts/wp-s0-validation.test.mjs
node scripts/wp-s0-validation.mjs
git diff --check
```

Expected: commands exit 0. The WP-S0 validator performs its own tracked-file credential/medical-data checks, so this branch remains independently executable if WP-00 has not merged. This proves document completeness, not formal legal approval or gate passage.

- [ ] **Step 2: Write gate evidence without overclaiming**

SG-0 remains `BLOCKED` until the responsible unit supplies authority, lawful basis/source authorization, classification, impact assessment, and classified-protection applicability. SG-1 may be `PASS` only if data flow, trust boundaries, authorization matrix, key/log/incident plans, threat mitigations, and required reviewers are complete; otherwise list exact missing evidence.

- [ ] **Step 3: Write WP-S0 status**

Map every deliverable to its source section, decision IDs, owning role, review state, and downstream WP. Confirm real-data status remains `CLOSED`.

- [ ] **Step 4: Commit evidence**

```bash
git add docs/evidence docs/security/wp-s0-manifest.json
git commit -m "docs: assemble WP-S0 gate evidence"
```

- [ ] **Step 5: Push and create Draft PR**

```bash
git push -u origin security/wp-s0-foundation
gh pr create --draft --base main --head security/wp-s0-foundation --title "security: establish WP-S0 contract foundation" --body-file .github/pull_request_template.md
```

The PR must list Word sections 1.3, 2.2, 2.6, 5.1, 7.1-7.3, 8.1-8.4; baseline sections 2.5, 8, 9, 10.4, 13, 14; WP-S0; S0; SG-0 and SG-1; validator output; blocked decisions; real-data closure; D-38 risk; and rollback.

- [ ] **Step 6: Record remote evidence and release ownership**

Verify local and remote full SHA match. Update the external daily log with file releases, PR URL, reviewer needs, gate status, and exact blockers. Do not mark WP-S0 or SG-0 complete merely because the documents exist.
