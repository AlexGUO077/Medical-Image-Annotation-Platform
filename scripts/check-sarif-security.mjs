import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

function inputError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateRules(rules) {
  if (!Array.isArray(rules)) throw inputError('SARIF_INPUT_MALFORMED');
  for (const rule of rules) {
    if (!isObject(rule)) throw inputError('SARIF_INPUT_MALFORMED');
    if (rule.id !== undefined && (typeof rule.id !== 'string' || rule.id.length === 0)) {
      throw inputError('SARIF_INPUT_MALFORMED');
    }
    if (rule.properties !== undefined && !isObject(rule.properties)) {
      throw inputError('SARIF_INPUT_MALFORMED');
    }
  }
}

function validateToolComponent(component) {
  if (!isObject(component)) throw inputError('SARIF_INPUT_MALFORMED');
  if (component.name !== undefined && (typeof component.name !== 'string' || component.name.length === 0)) {
    throw inputError('SARIF_INPUT_MALFORMED');
  }
  if (component.guid !== undefined && (typeof component.guid !== 'string' || component.guid.length === 0)) {
    throw inputError('SARIF_INPUT_MALFORMED');
  }
  if (component.rules !== undefined) validateRules(component.rules);
}

function validateRuleReference(reference) {
  if (!isObject(reference)) throw inputError('SARIF_INPUT_MALFORMED');
  if (reference.id !== undefined && (typeof reference.id !== 'string' || reference.id.length === 0)) {
    throw inputError('SARIF_INPUT_MALFORMED');
  }
  if (reference.index !== undefined && !isNonNegativeInteger(reference.index)) {
    throw inputError('SARIF_INPUT_MALFORMED');
  }
  if (reference.toolComponent !== undefined) {
    const component = reference.toolComponent;
    if (!isObject(component)) throw inputError('SARIF_INPUT_MALFORMED');
    if (component.name !== undefined && (typeof component.name !== 'string' || component.name.length === 0)) {
      throw inputError('SARIF_INPUT_MALFORMED');
    }
    if (component.guid !== undefined && (typeof component.guid !== 'string' || component.guid.length === 0)) {
      throw inputError('SARIF_INPUT_MALFORMED');
    }
    if (component.index !== undefined && !isNonNegativeInteger(component.index)) {
      throw inputError('SARIF_INPUT_MALFORMED');
    }
    if (component.name === undefined && component.guid === undefined && component.index === undefined) {
      throw inputError('SARIF_INPUT_MALFORMED');
    }
  }
}

function validateSarifDocument(sarif) {
  if (!isObject(sarif) || sarif.version !== '2.1.0' || !Array.isArray(sarif.runs)) {
    throw inputError('SARIF_INPUT_MALFORMED');
  }
  for (const run of sarif.runs) {
    if (!isObject(run) || !isObject(run.tool) || !isObject(run.tool.driver)
      || (run.results !== undefined && !Array.isArray(run.results))) {
      throw inputError('SARIF_INPUT_MALFORMED');
    }
    validateToolComponent(run.tool.driver);
    if (run.tool.extensions !== undefined && !Array.isArray(run.tool.extensions)) {
      throw inputError('SARIF_INPUT_MALFORMED');
    }
    for (const extension of run.tool.extensions ?? []) validateToolComponent(extension);
    for (const result of run.results ?? []) {
      if (!isObject(result)) throw inputError('SARIF_INPUT_MALFORMED');
      if (result.ruleId !== undefined && (typeof result.ruleId !== 'string' || result.ruleId.length === 0)) {
        throw inputError('SARIF_INPUT_MALFORMED');
      }
      if (result.ruleIndex !== undefined && !isNonNegativeInteger(result.ruleIndex)) {
        throw inputError('SARIF_INPUT_MALFORMED');
      }
      if (result.rule !== undefined) validateRuleReference(result.rule);
      const reference = result.rule ?? {};
      if (result.ruleId === undefined && result.ruleIndex === undefined && reference.id === undefined && reference.index === undefined) {
        throw inputError('SARIF_INPUT_MALFORMED');
      }
    }
  }
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
  return [run.tool.driver, ...(run.tool.extensions ?? [])];
}

function referencedComponent(run, components, reference) {
  if (!reference) return undefined;
  const explicitReference = reference.name !== undefined
    || reference.guid !== undefined
    || reference.index !== undefined;
  if (!explicitReference) return undefined;

  const referencedExtension = reference.index === undefined
    ? undefined
    : run.tool.extensions?.[reference.index];
  const component = components.find((candidate) => (
    (reference.name === undefined || candidate.name === reference.name)
    && (reference.guid === undefined || candidate.guid === reference.guid)
    && (reference.index === undefined || candidate === referencedExtension)
  ));
  if (!component) throw inputError('SARIF_INPUT_UNSUPPORTED_REFERENCE');
  return component;
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
    throw inputError('SARIF_INPUT_UNSUPPORTED_REFERENCE');
  }
  if (Number.isInteger(ruleIndex)) {
    const rule = component
      ? component.rules?.[ruleIndex]
      : candidates[0]?.rules?.[ruleIndex];
    if (rule) return rule;
    throw inputError('SARIF_INPUT_UNSUPPORTED_REFERENCE');
  }
  throw inputError('SARIF_INPUT_UNSUPPORTED_REFERENCE');
}

function parseSecuritySeverity(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
  const severity = Number(value);
  return Number.isFinite(severity) ? severity : undefined;
}

export function countBlockingSarifResults(directory) {
  let blockingResults = 0;

  for (const path of findSarifFiles(directory)) {
    let sarif;
    try {
      sarif = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw inputError('SARIF_INPUT_MALFORMED');
    }
    validateSarifDocument(sarif);
    for (const run of sarif.runs) {
      for (const result of run.results ?? []) {
        const severity = parseSecuritySeverity(resolveRule(run, result)?.properties?.['security-severity']);
        if (severity !== undefined && severity >= 7.0) blockingResults += 1;
      }
    }
  }

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
