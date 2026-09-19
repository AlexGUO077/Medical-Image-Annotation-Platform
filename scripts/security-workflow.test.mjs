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
    /^\| (PostgreSQL|Orthanc|MinIO|Redis|Elasticsearch) \| `([^`]+)` \| `(sha256:[a-f0-9]{64})` \|$/gm,
  )].map(([, label, image, digest]) => ({
    service: serviceNames[label],
    image,
    digest,
  }));
}

test('Trivy blocks HIGH and CRITICAL findings in every documented Compose image digest', () => {
  const documented = documentedImages(imageContract);
  const composeImages = Object.entries(compose.services).map(([service, definition]) => ({
    service,
    image: definition.image,
  }));

  assert.deepEqual(documented.map(({ service }) => service), expectedServices);
  assert.deepEqual(
    documented.map(({ service, image }) => ({ service, image })),
    composeImages,
    'the image contract must cover exactly the five Compose services and references',
  );

  const imageJob = workflow.jobs['trivy-images'];
  assert.ok(imageJob, 'security.yml must define the trivy-images job');
  assert.equal(imageJob.name, 'Trivy image scan (${{ matrix.service }} @ ${{ matrix.digest }})');
  assert.equal(imageJob.strategy['fail-fast'], false, 'every digest must complete even if another fails');
  assert.deepEqual(imageJob.strategy.matrix.include, documented);

  const scanStep = imageJob.steps.find((step) => step.uses?.startsWith('aquasecurity/trivy-action@'));
  assert.ok(scanStep, 'trivy-images must invoke aquasecurity/trivy-action');
  assert.equal(scanStep.name, 'Scan ${{ matrix.image }}@${{ matrix.digest }}');
  assert.deepEqual(scanStep.with, {
    'scan-type': 'image',
    'image-ref': '${{ matrix.image }}@${{ matrix.digest }}',
    scanners: 'vuln',
    severity: 'HIGH,CRITICAL',
    'exit-code': '1',
  });
});

test('Trivy retains the blocking filesystem and configuration scan', () => {
  const scanStep = workflow.jobs.trivy.steps.find(
    (step) => step.uses?.startsWith('aquasecurity/trivy-action@'),
  );

  assert.equal(scanStep.with['scan-type'], 'fs');
  assert.equal(scanStep.with['scan-ref'], '.');
  assert.equal(scanStep.with.scanners, 'vuln,secret,misconfig');
  assert.equal(scanStep.with.severity, 'HIGH,CRITICAL');
  assert.equal(scanStep.with['exit-code'], '1');
});
