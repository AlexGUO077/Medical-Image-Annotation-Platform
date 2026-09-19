import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

const workflow = yaml.load(readFileSync('.github/workflows/security.yml', 'utf8'));
const compose = yaml.load(readFileSync('docker-compose.yml', 'utf8'));
const imageContract = readFileSync('docs/contracts/container-images.md', 'utf8');

const serviceNames = {
  PostgreSQL: 'postgres',
  Orthanc: 'orthanc',
  MinIO: 'minio',
  Redis: 'redis',
  Elasticsearch: 'elasticsearch',
};
const expectedServices = ['postgres', 'orthanc', 'minio', 'redis', 'elasticsearch'];

function documentedImages(markdown) {
  return [...markdown.matchAll(
    /^\| (PostgreSQL|Orthanc|MinIO|Redis|Elasticsearch) \| `([^`]+)` \| `([^`]+)` \| `(sha256:[a-f0-9]{64})` \| `([^`]+)` \|$/gm,
  )].map(([, label, image, source, digest, dockerfile]) => ({
    service: serviceNames[label],
    image,
    source,
    digest,
    context: '.',
    dockerfile,
  }));
}

test('Trivy builds and blocks HIGH and CRITICAL findings in every documented hardened Compose image', () => {
  const documented = documentedImages(imageContract);
  const composeImages = Object.entries(compose.services).map(([service, definition]) => ({
    service,
    image: definition.image,
    context: definition.build?.context,
    dockerfile: definition.build?.dockerfile,
  }));

  assert.deepEqual(documented.map(({ service }) => service), expectedServices);
  assert.deepEqual(
    documented.map(({ service, image, context, dockerfile }) => ({ service, image, context, dockerfile })),
    composeImages,
    'the image contract must cover exactly the five Compose hardened build definitions',
  );

  const imageJob = workflow.jobs['trivy-images'];
  assert.ok(imageJob, 'security.yml must define the trivy-images job');
  assert.equal(imageJob.name, 'Trivy image scan (${{ matrix.service }} @ ${{ matrix.digest }})');
  assert.equal(imageJob.strategy['fail-fast'], false, 'every digest must complete even if another fails');
  assert.deepEqual(imageJob.strategy.matrix.include, documented);

  const buildStep = imageJob.steps.find((step) => step.name === 'Build ${{ matrix.image }}');
  assert.deepEqual(buildStep, {
    name: 'Build ${{ matrix.image }}',
    run: 'docker build --pull=false --file "${{ matrix.dockerfile }}" --tag "${{ matrix.image }}" "${{ matrix.context }}"',
  });

  const scanStep = imageJob.steps.find((step) => step.uses?.startsWith('aquasecurity/trivy-action@'));
  assert.ok(scanStep, 'trivy-images must invoke aquasecurity/trivy-action');
  assert.equal(scanStep.uses, 'aquasecurity/trivy-action@v0.36.0');
  assert.equal(scanStep.name, 'Scan ${{ matrix.image }}');
  assert.deepEqual(scanStep.with, {
    'scan-type': 'image',
    'image-ref': '${{ matrix.image }}',
    scanners: 'vuln',
    severity: 'HIGH,CRITICAL',
    'exit-code': '1',
  });
});

test('Trivy retains the blocking filesystem and configuration scan', () => {
  const scanStep = workflow.jobs.trivy.steps.find(
    (step) => step.uses?.startsWith('aquasecurity/trivy-action@'),
  );

  assert.equal(scanStep.uses, 'aquasecurity/trivy-action@v0.36.0');
  assert.equal(scanStep.with['scan-type'], 'fs');
  assert.equal(scanStep.with['scan-ref'], '.');
  assert.equal(scanStep.with.scanners, 'vuln,secret,misconfig');
  assert.equal(scanStep.with.severity, 'HIGH,CRITICAL');
  assert.equal(scanStep.with['exit-code'], '1');
});

test('every hardened Dockerfile explicitly ends with a non-root runtime user', () => {
  for (const { service, dockerfile } of documentedImages(imageContract)) {
    const content = readFileSync(dockerfile, 'utf8');
    const users = [...content.matchAll(/^USER\s+(\S+)/gm)].map(([, user]) => user);
    const runtimeUser = users.at(-1);

    assert.ok(runtimeUser, `${service} must declare its runtime user`);
    assert.doesNotMatch(runtimeUser, /^(?:root|0)(?::(?:root|0))?$/, `${service} must not run as root`);
  }
});

test('CodeQL keeps local SARIF gating without an unsupported GHAS upload', () => {
  const codeqlJob = workflow.jobs.codeql;
  const analyzeStep = codeqlJob.steps.find(
    (step) => step.uses?.startsWith('github/codeql-action/analyze@'),
  );
  const gateStep = codeqlJob.steps.find(
    (step) => step.run?.includes('scripts/check-sarif-security.mjs'),
  );

  assert.deepEqual(codeqlJob.permissions, { actions: 'read', contents: 'read' });
  assert.equal(analyzeStep.with.output, 'sarif-results');
  assert.equal(analyzeStep.with.upload, 'never');
  assert.equal(analyzeStep.with['upload-database'], false);
  assert.ok(gateStep, 'CodeQL SARIF must still pass through the local fail-closed gate');
  assert.equal(gateStep.env.CODEQL_SARIF_PATH, '${{ steps.analyze.outputs.sarif-output }}');
});

test('repository-native dependency policy replaces unsupported hosted dependency review', () => {
  assert.equal(workflow.jobs['dependency-review'], undefined);

  const policyJob = workflow.jobs['dependency-policy'];
  assert.ok(policyJob, 'security.yml must define the dependency-policy job');
  assert.deepEqual(policyJob.permissions, { contents: 'read' });

  const setupStep = policyJob.steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
  assert.equal(setupStep.with['node-version'], '20.20.2');
  assert.equal(setupStep.with.cache, 'npm');
  assert.ok(policyJob.steps.some((step) => step.run === 'npm ci'));
  assert.ok(policyJob.steps.some((step) => step.run === 'npm audit --audit-level=high'));
  assert.ok(policyJob.steps.some(
    (step) => step.run === 'node scripts/check-dependency-policy.mjs package-lock.json',
  ));
  assert.ok(
    policyJob.steps.findIndex(
      (step) => step.run === 'node scripts/check-dependency-policy.mjs package-lock.json',
    ) < policyJob.steps.findIndex((step) => step.run === 'npm audit --audit-level=high'),
    'license evidence must be recorded before a blocking vulnerability audit can stop the job',
  );
  assert.equal(
    policyJob.steps.some((step) => step.uses?.startsWith('actions/dependency-review-action@')),
    false,
  );
});

test('private SARIF diagnostics cannot skip the blocking gate or retain untrusted fork content', () => {
  const steps = workflow.jobs.codeql.steps;
  const analyzeIndex = steps.findIndex((step) => step.id === 'analyze');
  const artifactIndex = steps.findIndex((step) => step.uses === 'actions/upload-artifact@v4');
  const gateIndex = steps.findIndex((step) => step.run?.includes('scripts/check-sarif-security.mjs'));
  assert.ok(artifactIndex > analyzeIndex && artifactIndex < gateIndex);
  assert.equal(steps[artifactIndex].if, '${{ success() && github.event.repository.private == true && (github.event_name != \'pull_request\' || github.event.pull_request.head.repo.full_name == github.repository) }}');
  assert.deepEqual(steps[artifactIndex].with, {
    name: 'codeql-sarif-${{ github.run_id }}-${{ github.run_attempt }}',
    path: '${{ steps.analyze.outputs.sarif-output }}',
    'retention-days': 1,
    'if-no-files-found': 'error',
    'include-hidden-files': false,
  });
  assert.equal(steps[gateIndex].if, '${{ !cancelled() }}');
  assert.equal(steps[gateIndex]['continue-on-error'], undefined);
  assert.equal(workflow.jobs.codeql['continue-on-error'], undefined);
  assert.ok(steps.findIndex((step) => step.run === 'node scripts/check-forbidden-files.mjs') < analyzeIndex);
  assert.ok(steps.some((step) => step.run === 'node scripts/check-forbidden-files.mjs'));
});

test('Redis scans the exact selected Redis 7 Alpine release used by Compose', () => {
  const redis = workflow.jobs['trivy-images'].strategy.matrix.include.find((entry) => entry.service === 'redis');
  assert.equal(compose.services.redis.image, 'miap/redis:7.4.11-alpine3.21');
  assert.deepEqual(redis, {
    service: 'redis',
    image: 'miap/redis:7.4.11-alpine3.21',
    source: 'redis:7.4.11-alpine3.21',
    digest: 'sha256:520775a41a63e77e06c73e35d2fd9cc15921a609516818796b4ecbb813078bc7',
    context: '.',
    dockerfile: 'docker/redis/Dockerfile',
  });
});

test('Gitleaks can read pull request commit metadata with minimum permissions', () => {
  assert.deepEqual(workflow.jobs['secret-scan'].permissions, {
    contents: 'read',
    'pull-requests': 'read',
  });
});
