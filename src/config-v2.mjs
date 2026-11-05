import fs from 'node:fs';
import path from 'node:path';

import { PURPOSES } from './document-purpose.mjs';
import { isDescendantOrSame } from './workspace-path.mjs';
import { compileWildcard } from './wildcard.mjs';

const CONFIG_NAME = '.doclify-guardrail.json';
const ALLOWED_KEYS = new Set([
  'ignoreRules',
  'exclude',
  'siteRoot',
  'linkAllowList',
  'linkTimeoutMs',
  'linkConcurrency',
  'purpose'
]);
const REMOVED_KEYS = new Set([
  'strict',
  'maxLineLength',
  'checkLinks',
  'checkFreshness',
  'freshnessMaxDays',
  'checkFrontmatter',
  'checkInlineHtml',
  'push',
  'projectId'
]);
const OPTIONAL_CONFIG_UNAVAILABLE_CODES = new Set(['EACCES', 'EPERM', 'ENOTDIR']);
class ConfigV2Error extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ConfigV2Error';
    this.code = code;
  }
}

function unique(values) {
  return [...new Set(values)];
}

function canonicalDirectory(directory) {
  const resolved = path.resolve(directory);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isLexicallyContained(candidate, boundary) {
  const relative = path.relative(path.resolve(boundary), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertStringArray(value, key, configPath) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new ConfigV2Error('config-invalid', `${key} in ${configPath} must be an array of non-empty strings.`);
  }
}

function assertPositiveInteger(value, key, configPath) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigV2Error('config-invalid', `${key} in ${configPath} must be a positive integer.`);
  }
}

function readConfig(configPath, boundary, required) {
  let stat;
  try {
    stat = fs.lstatSync(configPath);
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return null;
    if (!required && OPTIONAL_CONFIG_UNAVAILABLE_CODES.has(error?.code)) return null;
    if (required && error?.code === 'ENOENT') {
      throw new ConfigV2Error('config-not-found', `Configuration file not found: ${configPath}`);
    }
    throw new ConfigV2Error('config-invalid', `Configuration file cannot be inspected: ${configPath}`);
  }

  if (!stat.isFile() && !stat.isSymbolicLink()) {
    throw new ConfigV2Error('config-invalid', `Configuration path must be a JSON file: ${configPath}`);
  }
  if (!isDescendantOrSame(configPath, boundary)) {
    throw new ConfigV2Error('config-outside-workspace', 'Configuration file must stay inside its discovery boundary.');
  }

  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch {
    throw new ConfigV2Error('config-invalid', `Configuration file cannot be read: ${configPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigV2Error('config-invalid', `Configuration file is not valid JSON: ${configPath}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigV2Error('config-invalid', `Configuration file must contain a JSON object: ${configPath}`);
  }

  for (const key of Object.keys(parsed)) {
    if (REMOVED_KEYS.has(key)) {
      throw new ConfigV2Error('config-removed-key', `Configuration key removed in v2: ${key}`);
    }
    if (!ALLOWED_KEYS.has(key)) {
      throw new ConfigV2Error('config-unknown-key', `Unknown v2 configuration key: ${key}`);
    }
  }

  if (Object.hasOwn(parsed, 'ignoreRules')) assertStringArray(parsed.ignoreRules, 'ignoreRules', configPath);
  if (Object.hasOwn(parsed, 'exclude')) assertStringArray(parsed.exclude, 'exclude', configPath);
  if (Object.hasOwn(parsed, 'linkAllowList')) assertStringArray(parsed.linkAllowList, 'linkAllowList', configPath);
  if (Object.hasOwn(parsed, 'siteRoot') && parsed.siteRoot !== null
    && (typeof parsed.siteRoot !== 'string' || parsed.siteRoot.trim() === '')) {
    throw new ConfigV2Error('config-invalid', `siteRoot in ${configPath} must be a non-empty string or null.`);
  }
  if (Object.hasOwn(parsed, 'linkTimeoutMs')) assertPositiveInteger(parsed.linkTimeoutMs, 'linkTimeoutMs', configPath);
  if (Object.hasOwn(parsed, 'linkConcurrency')) assertPositiveInteger(parsed.linkConcurrency, 'linkConcurrency', configPath);
  if (Object.hasOwn(parsed, 'purpose') && !PURPOSES.has(parsed.purpose)) {
    throw new ConfigV2Error('config-invalid', `purpose in ${configPath} must be one of: ${[...PURPOSES].join(', ')}.`);
  }

  return parsed;
}

function normalizeExclusions(patterns, baseDir, boundary, errorCode) {
  return patterns.map((rawPattern) => {
    const pattern = rawPattern.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
    const prefix = pattern.split('*', 1)[0] || '.';
    const anchor = path.resolve(baseDir, prefix);
    if (!isLexicallyContained(anchor, boundary)) {
      throw new ConfigV2Error(errorCode, 'Exclude patterns must stay inside their resolution boundary.');
    }
    return { baseDir, pattern };
  });
}

function emptyConfig() {
  return {
    ignoreRules: [],
    exclusions: [],
    siteRoot: null,
    externalLinks: false,
    linkAllowList: [],
    linkTimeoutMs: null,
    linkConcurrency: null,
    purpose: null
  };
}

function mergeLayer(current, layer, configPath, boundary) {
  const baseDir = path.dirname(configPath);
  const next = {
    ...current,
    ignoreRules: [...current.ignoreRules],
    exclusions: [...current.exclusions],
    linkAllowList: [...current.linkAllowList]
  };

  if (Object.hasOwn(layer, 'ignoreRules')) next.ignoreRules.push(...layer.ignoreRules);
  if (Object.hasOwn(layer, 'exclude')) {
    next.exclusions.push(...normalizeExclusions(layer.exclude, baseDir, boundary, 'config-outside-workspace'));
  }
  if (Object.hasOwn(layer, 'linkAllowList')) next.linkAllowList.push(...layer.linkAllowList);
  if (Object.hasOwn(layer, 'siteRoot')) {
    next.siteRoot = layer.siteRoot == null ? null : path.resolve(baseDir, layer.siteRoot);
  }
  if (Object.hasOwn(layer, 'linkTimeoutMs')) next.linkTimeoutMs = layer.linkTimeoutMs;
  if (Object.hasOwn(layer, 'linkConcurrency')) next.linkConcurrency = layer.linkConcurrency;
  if (Object.hasOwn(layer, 'purpose')) next.purpose = layer.purpose;
  return next;
}

function mergeOverrides(current, overrides, workspace) {
  const next = {
    ...current,
    ignoreRules: unique([...current.ignoreRules, ...(overrides.ignoreRules || [])]),
    exclusions: [...current.exclusions],
    linkAllowList: unique([...current.linkAllowList, ...(overrides.links?.allowList || [])])
  };
  if (overrides.exclude?.length > 0) {
    next.exclusions.push(...normalizeExclusions(overrides.exclude, workspace, workspace, 'invalid-exclude'));
  }
  if (Object.hasOwn(overrides, 'siteRoot')) {
    next.siteRoot = overrides.siteRoot == null ? null : path.resolve(workspace, overrides.siteRoot);
  }
  if (Object.hasOwn(overrides, 'externalLinks')) next.externalLinks = overrides.externalLinks;
  if (overrides.links?.timeoutMs != null) next.linkTimeoutMs = overrides.links.timeoutMs;
  if (overrides.links?.concurrency != null) next.linkConcurrency = overrides.links.concurrency;
  if (Object.hasOwn(overrides, 'purpose')) next.purpose = overrides.purpose;
  next.exclusions = unique(next.exclusions.map(({ baseDir, pattern }) => `${baseDir}\0${pattern}`))
    .map((value) => {
      const separator = value.indexOf('\0');
      return { baseDir: value.slice(0, separator), pattern: value.slice(separator + 1) };
    });
  return next;
}

function matchesExclusion(comparableCandidate, exclusion, matchers) {
  const relative = path.relative(exclusion.baseDir, comparableCandidate).split(path.sep).join('/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  const pattern = exclusion.pattern;
  if (!pattern || pattern === '.') return pattern === '.' && relative === '';
  if (pattern.includes('*')) {
    if (!matchers.has(pattern)) matchers.set(pattern, compileWildcard(pattern, 'exclusion'));
    return matchers.get(pattern)(relative);
  }
  return relative === pattern || relative.startsWith(`${pattern}/`);
}

function createV2ConfigResolver(options) {
  const canonicalDirectories = new Map();
  function resolveCanonicalDirectory(rawDirectory) {
    const directory = path.resolve(rawDirectory);
    if (!canonicalDirectories.has(directory)) {
      canonicalDirectories.set(directory, canonicalDirectory(directory));
    }
    return canonicalDirectories.get(directory);
  }
  const workspace = resolveCanonicalDirectory(options.workspace);
  const discoveryRoot = resolveCanonicalDirectory(options.discoveryRoot || workspace);
  const overrides = options.overrides || {};
  const directoryCache = new Map();
  const overriddenDirectoryCache = new Map();
  const exclusionCache = new Map();
  const fileCache = new Map();
  const matchers = new Map();
  let explicitConfig = null;

  if (options.config != null) {
    if (typeof options.config !== 'string' || options.config.trim() === '') {
      throw new ConfigV2Error('config-invalid', 'config must be a non-empty path.');
    }
    const configPath = path.resolve(options.configBase || workspace, options.config);
    if (!isDescendantOrSame(configPath, discoveryRoot)) {
      throw new ConfigV2Error('config-outside-workspace', 'Explicit configuration must stay inside the repository or workspace boundary.');
    }
    const parsed = readConfig(configPath, discoveryRoot, true);
    explicitConfig = mergeLayer(emptyConfig(), parsed, configPath, discoveryRoot);
  }

  function readLayer(configPath) {
    if (fileCache.has(configPath)) return fileCache.get(configPath);
    const parsed = readConfig(configPath, discoveryRoot, false);
    fileCache.set(configPath, parsed);
    return parsed;
  }

  function resolveDirectory(rawDirectory) {
    if (explicitConfig) return explicitConfig;
    const directory = resolveCanonicalDirectory(rawDirectory);
    if (directoryCache.has(directory)) return directoryCache.get(directory);
    if (!isDescendantOrSame(directory, discoveryRoot)) {
      const resolved = emptyConfig();
      directoryCache.set(directory, resolved);
      return resolved;
    }

    let resolved;
    if (directory === discoveryRoot) {
      resolved = emptyConfig();
    } else {
      resolved = resolveDirectory(path.dirname(directory));
    }
    const configPath = path.join(directory, CONFIG_NAME);
    const layer = readLayer(configPath);
    if (layer) resolved = mergeLayer(resolved, layer, configPath, discoveryRoot);
    directoryCache.set(directory, resolved);
    return resolved;
  }

  function forPath(targetPath, optionsForPath = {}) {
    const directory = resolveCanonicalDirectory(optionsForPath.directory === true ? targetPath : path.dirname(targetPath));
    if (!overriddenDirectoryCache.has(directory)) {
      overriddenDirectoryCache.set(directory, mergeOverrides(resolveDirectory(directory), overrides, workspace));
    }
    return overriddenDirectoryCache.get(directory);
  }

  function isExcluded(targetPath, optionsForPath = {}) {
    const key = `${optionsForPath.directory === true ? 'directory' : 'file'}\0${path.resolve(targetPath)}`;
    if (exclusionCache.has(key)) return exclusionCache.get(key);
    let resolved;
    if (optionsForPath.directory === true && !explicitConfig) {
      const directory = resolveCanonicalDirectory(targetPath);
      if (directory === discoveryRoot) return false;
      resolved = forPath(path.dirname(directory), { directory: true });
    } else {
      resolved = forPath(targetPath, optionsForPath);
    }
    let excluded = false;
    if (resolved.exclusions.length > 0) {
      const parent = resolveCanonicalDirectory(path.dirname(targetPath));
      const comparableCandidate = path.join(parent, path.basename(targetPath));
      excluded = resolved.exclusions.some((exclusion) => matchesExclusion(comparableCandidate, exclusion, matchers));
    }
    exclusionCache.set(key, excluded);
    return excluded;
  }

  return {
    forPath,
    isExcluded
  };
}

export {
  ConfigV2Error,
  createV2ConfigResolver
};
