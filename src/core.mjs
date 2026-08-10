import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULE_CATALOG } from './rule-catalog.mjs';
import { ConfigV2Error, createV2ConfigResolver } from './config-v2.mjs';
import { discoverGitRoot, getChangedFilesFromRoot, GitSelectionError } from './diff.mjs';
import { checkDeadLinksDetailed } from './links.mjs';
import { createResult } from './result.mjs';
import { allowsRepositoryClaims, resolveDocumentPurpose } from './document-purpose.mjs';
import { createSuppressionMatcher } from './suppressions.mjs';
import { buildRepositoryIndex } from './repository-index.mjs';
import { checkRepositoryClaims, hasRepositoryClaim } from './claim-checker.mjs';
import { isMarkdownPath } from './markdown-files.mjs';
import { TargetSelectionError, relativePath, selectTargets } from './target-selector.mjs';
import { getReadContainment, isDescendantOrSame } from './workspace-path.mjs';

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
    'changed',
    'paths',
    'cwd',
    'config',
    'ignoreRules',
    'exclude',
    'siteRoot',
    'externalLinks',
    'links',
    'purpose',
    'stdin',
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
  if (options.config != null && (typeof options.config !== 'string' || options.config.trim() === '')) {
    throw new DoclifyUsageError('config-invalid', 'config must be a non-empty path.');
  }
  if (options.changed != null && (typeof options.changed !== 'object' || Array.isArray(options.changed))) {
    throw new DoclifyUsageError('invalid-changed-selector', 'changed must be a selector object.');
  }
  if (options.changed) {
    const unknownChangedOption = Object.keys(options.changed).find((key) => !['base', 'staged'].includes(key));
    if (unknownChangedOption) {
      throw new DoclifyUsageError('invalid-changed-selector', `Unknown changed selector: ${unknownChangedOption}.`);
    }
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
  if (options.purpose != null && typeof options.purpose !== 'string') {
    throw new DoclifyUsageError('invalid-purpose', 'purpose must be a string.');
  }
  if (options.stdin != null && (!options.stdin || typeof options.stdin !== 'object' || Array.isArray(options.stdin)
    || typeof options.stdin.content !== 'string' || typeof options.stdin.name !== 'string' || options.stdin.name === '')) {
    throw new DoclifyUsageError('invalid-stdin', 'stdin must contain string content and a non-empty name.');
  }
  if (options.links != null && (typeof options.links !== 'object' || Array.isArray(options.links))) {
    throw new DoclifyUsageError('invalid-links', 'links must be an object.');
  }
  if (options.links?.allowList != null && (!Array.isArray(options.links.allowList) || options.links.allowList.some((item) => typeof item !== 'string'))) {
    throw new DoclifyUsageError('invalid-link-allow-list', 'links.allowList must be an array of strings.');
  }
  const unknownLinkOption = options.links && Object.keys(options.links).find((key) => !['allowList', 'timeoutMs', 'concurrency'].includes(key));
  if (unknownLinkOption) {
    throw new DoclifyUsageError('invalid-links', `Unknown links option: ${unknownLinkOption}.`);
  }
  if (options.externalLinks !== true
    && (options.links?.allowList?.length > 0 || options.links?.timeoutMs != null || options.links?.concurrency != null)) {
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

function changedSelector(options) {
  if (options.command !== 'changed') {
    if (options.changed != null) {
      throw new DoclifyUsageError('invalid-changed-selector', 'changed selectors require command: changed.');
    }
    return null;
  }
  if (options.paths != null && options.paths.length > 0) {
    throw new DoclifyUsageError('unexpected-target', 'changed does not accept paths.');
  }
  const selector = options.changed || {};
  if (Object.hasOwn(selector, 'base') && (typeof selector.base !== 'string' || selector.base.length === 0)) {
    throw new DoclifyUsageError('invalid-changed-selector', 'changed.base must be a non-empty string.');
  }
  const hasBase = typeof selector.base === 'string' && selector.base.length > 0;
  const hasStaged = selector.staged === true;
  if (Number(hasBase) + Number(hasStaged) !== 1 || (Object.hasOwn(selector, 'staged') && selector.staged !== true)) {
    throw new DoclifyUsageError('invalid-changed-selector', 'changed requires exactly one of base or staged.');
  }
  return selector;
}

function configOverrides(options) {
  const overrides = {
    ignoreRules: options.ignoreRules || [],
    exclude: options.exclude || [],
    links: options.links || {}
  };
  if (Object.hasOwn(options, 'siteRoot')) overrides.siteRoot = options.siteRoot;
  if (Object.hasOwn(options, 'externalLinks')) overrides.externalLinks = options.externalLinks;
  if (Object.hasOwn(options, 'purpose')) overrides.purpose = options.purpose;
  return overrides;
}

function validateResolvedOptions(options, readBoundary) {
  validateRuleIds(options.ignoreRules);
  if (options.siteRoot && !isDescendantOrSame(options.siteRoot, readBoundary)) {
    throw new DoclifyUsageError('site-root-outside-workspace', 'siteRoot must stay inside the repository or workspace boundary.');
  }
}

function asUsageError(error) {
  if (error instanceof DoclifyUsageError) return error;
  if (error instanceof ConfigV2Error || error instanceof GitSelectionError) {
    return new DoclifyUsageError(error.code, error.message);
  }
  return error;
}

/**
 * Scan Markdown paths and return the deterministic schemaVersion 3 result.
 * Partial scans resolve with status "incomplete". Invalid usage, invalid
 * configuration, and total scan failure reject with a stable error.code.
 *
 * @param {object} [options]
 * @param {'check'|'changed'} [options.command='check'] Result command label.
 * @param {string[]} [options.paths=['.']] Paths relative to cwd or contained absolute paths for check.
 * @param {string} [options.cwd=process.cwd()] Selected workspace.
 * @param {{base?: string, staged?: true}} [options.changed] Selector required by command changed.
 * @param {string} [options.config] One explicit v2 config file; disables automatic hierarchy.
 * @param {string[]} [options.ignoreRules=[]] Known rule ids to suppress.
 * @param {string[]} [options.exclude=[]] Workspace-relative exclusions.
 * @param {string} [options.siteRoot] Root for root-relative local links.
 * @param {boolean} [options.externalLinks=false] Explicit network opt-in.
 * @param {{allowList?: string[], timeoutMs?: number, concurrency?: number}} [options.links]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>}
 */
async function check(options = {}) {
  return (await runCheck(options)).result;
}

async function runCheck(options = {}) {
  validateOptions(options);
  const command = options.command === 'changed' ? 'changed' : 'check';
  if (options.stdin && command !== 'check') {
    throw new DoclifyUsageError('invalid-stdin', 'stdin is supported only by check.');
  }
  const selector = changedSelector({ ...options, command });
  const invocationCwd = path.resolve(options.cwd || process.cwd());
  let cwdStat;
  try {
    cwdStat = fs.statSync(invocationCwd);
  } catch {
    throw new DoclifyUsageError('workspace-unreadable', 'Workspace does not exist or cannot be inspected.');
  }
  if (!cwdStat.isDirectory()) {
    throw new DoclifyUsageError('workspace-invalid', 'Workspace must be a directory.');
  }

  const ignoreRules = [...new Set(options.ignoreRules || [])];
  validateRuleIds(ignoreRules);

  let gitRoot;
  try {
    gitRoot = discoverGitRoot(invocationCwd, { required: command === 'changed' });
  } catch (error) {
    throw asUsageError(error);
  }
  const workspace = command === 'changed' ? gitRoot : invocationCwd;
  const discoveryRoot = gitRoot || workspace;

  let selectedPaths = options.paths;
  if (command === 'changed') {
    try {
      selectedPaths = getChangedFilesFromRoot(gitRoot, {
        base: selector.base || 'HEAD',
        staged: selector.staged === true,
        markdownOnly: true
      }).map((entry) => entry.path);
    } catch (error) {
      throw asUsageError(error);
    }
  }

  let configResolver;
  try {
    configResolver = createV2ConfigResolver({
      workspace,
      discoveryRoot,
      config: options.config,
      configBase: invocationCwd,
      overrides: configOverrides({ ...options, ignoreRules })
    });
    validateResolvedOptions(configResolver.forPath(workspace, { directory: true }), discoveryRoot);
  } catch (error) {
    throw asUsageError(error);
  }

  let selection;
  if (options.stdin) {
    const stdinPath = path.resolve(workspace, options.stdin.name);
    if (getReadContainment(stdinPath, workspace) !== 'inside') {
      throw new DoclifyUsageError('stdin-name-outside-workspace', 'stdin-name must stay inside the selected workspace.');
    }
    if (!isMarkdownPath(stdinPath)) {
      throw new DoclifyUsageError('invalid-stdin', 'stdin-name must name a Markdown or MDX document.');
    }
    if (configResolver.isExcluded(stdinPath)) {
      throw new DoclifyUsageError('invalid-stdin', 'stdin-name is excluded by the active configuration.');
    }
    selection = { workspace, paths: [stdinPath], diagnostics: [] };
  } else {
    try {
      selection = selectTargets({
        cwd: workspace,
        paths: selectedPaths,
        isExcluded: configResolver.isExcluded
      });
    } catch (error) {
      if (error instanceof TargetSelectionError) {
        throw new DoclifyUsageError(error.code, error.message);
      }
      throw asUsageError(error);
    }
  }

  const files = [];
  const findings = [];
  const diagnostics = [...selection.diagnostics];
  const remoteCache = new Map();
  let repositoryIndex = null;
  const getRepositoryIndex = () => {
    if (!repositoryIndex) {
      repositoryIndex = buildRepositoryIndex(discoveryRoot, { isExcluded: configResolver.isExcluded });
    }
    return repositoryIndex;
  };

  for (const absolutePath of selection.paths) {
    if (options.signal?.aborted) {
      throw new DoclifyUsageError('aborted', 'Scan was aborted.');
    }
    const filePath = relativePath(absolutePath, selection.workspace);
    if (getReadContainment(absolutePath, workspace) === 'outside') {
      files.push({ path: filePath, purpose: null, scanned: false, findings: null, suppressions: [] });
      diagnostics.push({
        code: 'target-outside-workspace',
        severity: 'error',
        path: filePath,
        message: 'Target resolved outside the workspace before it could be read.'
      });
      continue;
    }
    let fileOptions;
    try {
      fileOptions = configResolver.forPath(absolutePath);
      validateResolvedOptions(fileOptions, discoveryRoot);
    } catch (error) {
      throw asUsageError(error);
    }
    let content;
    try {
      content = options.stdin && absolutePath === selection.paths[0]
        ? options.stdin.content
        : fs.readFileSync(absolutePath, 'utf8');
    } catch (error) {
      files.push({ path: filePath, purpose: null, scanned: false, findings: null, suppressions: [] });
      diagnostics.push(stableReadDiagnostic(absolutePath, selection.workspace, error));
      continue;
    }

    const suppressionMatcher = createSuppressionMatcher(content);
    const suppressions = suppressionMatcher.suppressions;
    const purpose = resolveDocumentPurpose(filePath, content, fileOptions.purpose);
    const ignored = new Set(fileOptions.ignoreRules);
    const indexPath = relativePath(absolutePath, discoveryRoot);
    const fileFindings = (allowsRepositoryClaims(purpose) && hasRepositoryClaim(content)
      ? checkRepositoryClaims(content, getRepositoryIndex(), indexPath) : [])
      .filter((finding) => !ignored.has(finding.ruleId) && !suppressionMatcher.isSuppressed(finding.ruleId, finding.line))
      .map((finding) => ({ ...finding, path: filePath }));

    const linkResult = await checkDeadLinksDetailed(content, {
      sourceFile: absolutePath,
      siteRoot: fileOptions.siteRoot,
      linkAllowList: fileOptions.linkAllowList,
      timeoutMs: fileOptions.linkTimeoutMs || undefined,
      concurrency: fileOptions.linkConcurrency || undefined,
      remoteCache,
      checkRemote: fileOptions.externalLinks === true,
      readBoundary: discoveryRoot
    });
    for (const finding of linkResult.findings) {
      if (finding.scope === 'local' && finding.code === 'unverifiable-root-relative-link') {
        const ruleId = 'local-link';
        if (!ignored.has(ruleId) && !suppressionMatcher.isSuppressed(ruleId, finding.line)) {
          fileFindings.push({
            ruleId,
            severity: 'advisory',
            confidence: 'unverified',
            path: filePath,
            line: Number.isInteger(finding.line) ? finding.line : null,
            column: null,
            message: String(finding.message),
            evidence: null
          });
        }
        continue;
      }
      if (finding.scope === 'remote') {
        const ruleId = 'external-link';
        if (!ignored.has(ruleId) && !suppressionMatcher.isSuppressed(ruleId, finding.line)) {
          fileFindings.push({
            ruleId,
            severity: 'advisory',
            confidence: 'unverified',
            path: filePath,
            line: Number.isInteger(finding.line) ? finding.line : null,
            column: null,
            message: String(finding.message),
            evidence: null
          });
        }
        continue;
      }
      if (finding.scope !== 'local' || finding.code !== 'dead-link') {
        diagnostics.push({
          code: String(finding.code),
          severity: 'error',
          path: filePath,
          message: String(finding.message)
        });
        continue;
      }
      const ruleId = 'local-link';
      if (ignored.has(ruleId) || suppressionMatcher.isSuppressed(ruleId, finding.line)) continue;
      fileFindings.push({
        ruleId,
        severity: 'blocking',
        confidence: 'verified',
        path: filePath,
        line: Number.isInteger(finding.line) ? finding.line : null,
        column: null,
        message: String(finding.message),
        evidence: {
          fact: String(finding.message),
          source: `${filePath}:${Number.isInteger(finding.line) ? finding.line : 1}`
        }
      });
    }
    files.push({ path: filePath, purpose, scanned: true, findings: fileFindings.length, suppressions });
    findings.push(...fileFindings);
  }

  if (command === 'check' && selection.paths.length === 0 && diagnostics.length === 0) {
    throw new DoclifyUsageError('scan-failed', 'No selected Markdown files could be scanned.');
  }

  return {
    workspace,
    result: createResult({
      toolVersion: PACKAGE.version,
      command,
      files,
      findings,
      diagnostics
    })
  };
}

export { DoclifyUsageError, check, runCheck };
