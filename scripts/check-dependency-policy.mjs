import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DENIED_LICENSE_IDENTIFIERS = Object.freeze([
  'AGPL-1.0',
  'AGPL-3.0',
  'GPL-2.0',
  'GPL-3.0',
]);

const SPDX_OPERATORS = new Set(['AND', 'OR', 'WITH']);

function licenseValues(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return value;
  return [];
}

function licenseIdentifiers(expression) {
  return (expression.match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g) ?? [])
    .filter((identifier) => !SPDX_OPERATORS.has(identifier));
}

export function evaluateDependencyPolicy(lockfile) {
  if (
    !lockfile
    || typeof lockfile !== 'object'
    || !lockfile.packages
    || typeof lockfile.packages !== 'object'
    || Array.isArray(lockfile.packages)
  ) {
    throw new Error('DEPENDENCY_POLICY_INVALID_LOCKFILE');
  }

  const denied = new Set();
  const allowed = new Set();
  const entriesWithoutLicense = [];
  const deniedSet = new Set(DENIED_LICENSE_IDENTIFIERS);

  for (const [packagePath, packageEntry] of Object.entries(lockfile.packages)) {
    if (packagePath === '') continue;

    const values = licenseValues(packageEntry?.license);
    const identifiers = values.flatMap(licenseIdentifiers);
    if (identifiers.length === 0) {
      entriesWithoutLicense.push(packagePath);
      continue;
    }

    for (const identifier of identifiers) {
      if (deniedSet.has(identifier)) denied.add(identifier);
      else allowed.add(identifier);
    }
  }

  return {
    allowedLicenses: [...allowed].sort(),
    deniedLicenses: [...denied].sort(),
    entriesWithoutLicense: entriesWithoutLicense.sort(),
  };
}

export function formatLicenseSummary(result) {
  const allowed = result.allowedLicenses.length === 0
    ? 'No allowed license identifiers were detected.'
    : result.allowedLicenses.map((license) => `- ${license}`).join('\n');
  const denied = result.deniedLicenses.length === 0
    ? 'None.'
    : result.deniedLicenses.map((license) => `- ${license}`).join('\n');

  return [
    '## Whole-lock dependency license policy',
    '',
    '### Detected allowed license identifiers',
    '',
    allowed,
    '',
    '### Denied license identifiers',
    '',
    denied,
    '',
    `Entries without license metadata: ${result.entriesWithoutLicense.length}`,
    '',
  ].join('\n');
}

function runCli() {
  try {
    const lockfilePath = process.argv[2] ?? 'package-lock.json';
    const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
    const result = evaluateDependencyPolicy(lockfile);
    const summary = formatLicenseSummary(result);

    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    }

    if (result.deniedLicenses.length > 0) {
      console.error(`DENIED_LICENSE_IDENTIFIERS: ${result.deniedLicenses.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    console.log(
      `Dependency license policy passed: ${result.allowedLicenses.length} allowed identifiers; `
      + `${result.entriesWithoutLicense.length} entries without license metadata.`,
    );
  } catch {
    console.error('DEPENDENCY_POLICY_INPUT_ERROR');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
