import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

function inputError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function findSarifFiles(directory) {
  let root;
  try {
    root = statSync(directory);
  } catch {
    throw inputError('SARIF_INPUT_UNREADABLE');
  }
  if (!root.isDirectory()) throw inputError('SARIF_INPUT_NO_SARIF');

  const files = [];
  function visit(currentDirectory) {
    let entries;
    try {
      entries = readdirSync(currentDirectory, { withFileTypes: true });
    } catch {
      throw inputError('SARIF_INPUT_UNREADABLE');
    }
    for (const entry of entries) {
      const path = join(currentDirectory, entry.name);
      if (entry.isDirectory()) visit(path);
      if (entry.isFile() && ['.sarif', '.json'].includes(extname(entry.name).toLowerCase())) files.push(path);
    }
  }

  visit(directory);
  if (files.length === 0) throw inputError('SARIF_INPUT_NO_SARIF');
  return files;
}

function getToolComponents(run) {
  const tool = run.tool ?? {};
  return [tool.driver, ...(tool.extensions ?? [])].filter(Boolean);
}

function referencedComponent(run, components, reference) {
  if (!reference) return undefined;
  if (reference.name) return components.find((component) => component.name === reference.name);
  if (Number.isInteger(reference.index)) {
    return run.tool?.extensions?.[reference.index] ?? components[reference.index];
  }
  return undefined;
}

function resolveRule(run, result) {
  const reference = result.rule ?? {};
  const ruleId = result.ruleId ?? reference.id;
  const ruleIndex = result.ruleIndex ?? reference.index;
  const components = getToolComponents(run);
  const component = referencedComponent(run, components, reference.toolComponent);
  const candidates = component ? [component] : components;

  if (ruleId) {
    for (const candidate of candidates) {
      const rule = candidate.rules?.find((item) => item.id === ruleId);
      if (rule) return rule;
    }
  }
  if (Number.isInteger(ruleIndex)) {
    if (component) return component.rules?.[ruleIndex];
    return candidates[0]?.rules?.[ruleIndex];
  }
  return undefined;
}

function parseSecuritySeverity(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
  const severity = Number(value);
  return Number.isFinite(severity) ? severity : undefined;
}

export function countBlockingSarifResults(directory) {
  let parsedSarifFiles = 0;
  let blockingResults = 0;

  for (const path of findSarifFiles(directory)) {
    let sarif;
    try {
      sarif = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw inputError('SARIF_INPUT_MALFORMED');
    }
    if (!Array.isArray(sarif.runs)) continue;

    parsedSarifFiles += 1;
    for (const run of sarif.runs) {
      for (const result of run.results ?? []) {
        const severity = parseSecuritySeverity(resolveRule(run, result)?.properties?.['security-severity']);
        if (severity !== undefined && severity >= 7.0) blockingResults += 1;
      }
    }
  }

  if (parsedSarifFiles === 0) throw inputError('SARIF_INPUT_NO_SARIF');
  return blockingResults;
}

function main() {
  try {
    const blockingResults = countBlockingSarifResults(process.argv[2]);
    if (blockingResults > 0) {
      console.error(`SARIF_SECURITY_THRESHOLD: ${blockingResults} result(s) at or above 7.0.`);
      process.exitCode = 1;
      return;
    }
    console.log('SARIF_SECURITY_CLEAR: no result at or above 7.0.');
  } catch (error) {
    const category = typeof error?.code === 'string' ? error.code : 'SARIF_INPUT_UNREADABLE';
    console.error(`SARIF_SECURITY_GATE_FAILED_CLOSED: ${category}.`);
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) main();
