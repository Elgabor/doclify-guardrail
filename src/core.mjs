import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULE_CATALOG } from './checker.mjs';
import { checkWithLegacyEngine } from './legacy-adapter.mjs';
import { checkDeadLinksDetailed } from './links.mjs';
import { createResult } from './result.mjs';
import { TargetSelectionError, relativePath, selectTargets } from './target-selector.mjs';
import { isDescendantOrSame } from './workspace-path.mjs';

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, '..', 'package.json'), 'utf8'));
const KNOWN_RULE_IDS = new Set(RULE_CATALOG.map((rule) => rule.id));

class DoclifyUsageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DoclifyUsageError';
    this.code = code;
  }
}

function assertPositiveInteger(value, label) {
  if (value == null) return;
  if (!Number.isInteger(value) || value <= 0) {
    throw new DoclifyUsageError('invalid-option', `${label} must be a positive integer.`);
  }
}

function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new DoclifyUsageError('invalid-options', 'check options must be an object.');
  }
  const knownOptions = new Set([
    'command',
    'paths',
    'cwd',
    'ignoreRules',
    'exclude',
    'siteRoot',
    'externalLinks',
    'links',
    'signal'
  ]);
  const unknownOption = Object.keys(options).find((key) => !knownOptions.has(key));
  if (unknownOption) {
    throw new DoclifyUsageError('unknown-option', `Unknown check option: ${unknownOption}.`);
  }
  if (options.cwd != null && typeof options.cwd !== 'string') {
    throw new DoclifyUsageError('invalid-workspace', 'cwd must be a string.');
  }
  if (options.paths != null && (!Array.isArray(options.paths) || options.paths.some((item) => typeof item !== 'string'))) {
    throw new DoclifyUsageError('invalid-paths', 'paths must be an array of strings.');
  }
  if (options.command != null && !['check', 'changed'].includes(options.command)) {
    throw new DoclifyUsageError('invalid-command', 'command must be check or changed.');
  }
  if (options.ignoreRules != null && !Array.isArray(options.ignoreRules)) {
    throw new DoclifyUsageError('invalid-ignore-rules', 'ignoreRules must be an array.');
  }
  if (options.ignoreRules?.some((item) => typeof item !== 'string')) {
    throw new DoclifyUsageError('invalid-ignore-rules', 'ignoreRules must contain only strings.');
  }
  if (options.exclude != null && !Array.isArray(options.exclude)) {
    throw new DoclifyUsageError('invalid-exclude', 'exclude must be an array.');
  }
  if (options.exclude?.some((item) => typeof item !== 'string')) {
    throw new DoclifyUsageError('invalid-exclude', 'exclude must contain only strings.');
  }
  if (options.siteRoot != null && typeof options.siteRoot !== 'string') {
    throw new DoclifyUsageError('invalid-site-root', 'siteRoot must be a string.');
  }
  if (options.externalLinks != null && typeof options.externalLinks !== 'boolean') {
    throw new DoclifyUsageError('invalid-external-links', 'externalLinks must be a boolean.');
  }
  if (options.links != null && (typeof options.links !== 'object' || Array.isArray(options.links))) {
    throw new DoclifyUsageError('invalid-links', 'links must be an object.');
  }
  if (options.links?.allowList != null && (!Array.isArray(options.links.allowList) || options.links.allowList.some((item) => typeof item !== 'string'))) {
    throw new DoclifyUsageError('invalid-link-allow-list', 'links.allowList must be an array of strings.');
  }
  if (options.externalLinks !== true && (options.links?.allowList?.length > 0 || options.links?.timeoutMs != null || options.links?.concurrency != null)) {
    throw new DoclifyUsageError('invalid-link-options', 'Remote link options require externalLinks: true.');
  }
  assertPositiveInteger(options.links?.timeoutMs, 'links.timeoutMs');
  assertPositiveInteger(options.links?.concurrency, 'links.concurrency');
}

function validateRuleIds(ignoreRules) {
  for (const ruleId of ignoreRules) {
    if (!KNOWN_RULE_IDS.has(ruleId)) {
      throw new DoclifyUsageError('unknown-rule', `Unknown rule id: ${ruleId}`);
    }
  }
}

function stableReadDiagnostic(filePath, workspace, error) {
  return {
    code: 'file-unreadable',
    severity: 'error',
    path: relativePath(filePath, workspace),
    message: `Unable to read file (${error?.code || 'UNKNOWN'}).`
  };
}

/**
 * Scan Markdown paths and return the deterministic schemaVersion 3 result.
 * Partial scans resolve with status "incomplete". Invalid usage, invalid
 * configuration, and total scan failure reject with a stable error.code.
 *
 * @param {object} [options]
 * @param {'check'|'changed'} [options.command='check'] Result command label.
 * @param {string[]} [options.paths=['.']] Paths relative to cwd or contained absolute paths.
 * @param {string} [options.cwd=process.cwd()] Selected workspace.
 * @param {string[]} [options.ignoreRules=[]] Known rule ids to suppress.
 * @param {string[]} [options.exclude=[]] Workspace-relative exclusions.
 * @param {string} [options.siteRoot] Root for root-relative local links.
 * @param {boolean} [options.externalLinks=false] Explicit network opt-in.
 * @param {{allowList?: string[], timeoutMs?: number, concurrency?: number}} [options.links]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>}
 */
async function check(options = {}) {
  validateOptions(options);
  const command = options.command === 'changed' ? 'changed' : 'check';
  const cwd = path.resolve(options.cwd || process.cwd());
  let cwdStat;
  try {
    cwdStat = fs.statSync(cwd);
  } catch {
    throw new DoclifyUsageError('workspace-unreadable', 'Workspace does not exist or cannot be inspected.');
  }
  if (!cwdStat.isDirectory()) {
    throw new DoclifyUsageError('workspace-invalid', 'Workspace must be a directory.');
  }

  const ignoreRules = [...new Set(options.ignoreRules || [])];
  validateRuleIds(ignoreRules);
  const siteRoot = options.siteRoot == null ? null : path.resolve(cwd, options.siteRoot);
  if (siteRoot && !isDescendantOrSame(siteRoot, cwd)) {
    throw new DoclifyUsageError('site-root-outside-workspace', 'siteRoot must stay inside the workspace.');
  }

  let selection;
  try {
    selection = selectTargets({ cwd, paths: options.paths, exclude: options.exclude });
  } catch (error) {
    if (error instanceof TargetSelectionError) {
      throw new DoclifyUsageError(error.code, error.message);
    }
    throw error;
  }

  const files = [];
  const findings = [];
  const diagnostics = [...selection.diagnostics];
  const remoteCache = new Map();

  for (const absolutePath of selection.paths) {
    if (options.signal?.aborted) {
      throw new DoclifyUsageError('aborted', 'Scan was aborted.');
    }
    const filePath = relativePath(absolutePath, selection.workspace);
    let content;
    try {
      content = fs.readFileSync(absolutePath, 'utf8');
    } catch (error) {
      files.push({ path: filePath, scanned: false, findings: null, suppressions: [] });
      diagnostics.push(stableReadDiagnostic(absolutePath, selection.workspace, error));
      continue;
    }

    const adapted = checkWithLegacyEngine(content, {
      path: filePath,
      absolutePath,
      ignoreRules
    });

    const linkResult = await checkDeadLinksDetailed(content, {
      sourceFile: absolutePath,
      siteRoot,
      linkAllowList: options.links?.allowList || [],
      timeoutMs: options.links?.timeoutMs,
      concurrency: options.links?.concurrency,
      remoteCache,
      checkRemote: options.externalLinks === true
    });
    const ignored = new Set(ignoreRules);
    for (const finding of linkResult.findings) {
      if (ignored.has(finding.code)) continue;
      adapted.findings.push({
        ruleId: String(finding.code),
        severity: 'advisory',
        confidence: 'unverified',
        path: filePath,
        line: Number.isInteger(finding.line) ? finding.line : null,
        column: null,
        message: String(finding.message),
        evidence: null
      });
    }
    adapted.file.findings = adapted.findings.length;

    files.push(adapted.file);
    findings.push(...adapted.findings);
  }

  if (command === 'check' && selection.paths.length === 0 && diagnostics.length === 0) {
    throw new DoclifyUsageError('scan-failed', 'No selected Markdown files could be scanned.');
  }

  return createResult({
    toolVersion: PACKAGE.version,
    command,
    files,
    findings,
    diagnostics
  });
}

export { DoclifyUsageError, check };
