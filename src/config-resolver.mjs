import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FRESHNESS_DAYS } from './quality.mjs';
import { DEFAULT_LINK_CONCURRENCY, DEFAULT_LINK_TIMEOUT_MS } from './links.mjs';

const CONFIG_NAME = '.doclify-guardrail.json';

const DEFAULT_OPTIONS = {
  maxLineLength: 160,
  strict: false,
  checkLinks: false,
  checkFreshness: false,
  checkFrontmatter: false,
  checkInlineHtml: false,
  freshnessMaxDays: DEFAULT_FRESHNESS_DAYS,
  linkTimeoutMs: DEFAULT_LINK_TIMEOUT_MS,
  linkConcurrency: DEFAULT_LINK_CONCURRENCY,
  ignoreRules: [],
  exclude: [],
  linkAllowList: []
};

function isDescendantOrSame(candidatePath, basePath) {
  const rel = path.relative(basePath, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function parseConfigFile(configPath) {
  if (!configPath || !fs.existsSync(configPath)) return {};

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('must be a JSON object');
    }
    return parsed;
  } catch (err) {
    throw new Error(`Invalid config (${configPath}): ${err.message}`);
  }
}

function mergeConfigLayer(current, layer) {
  return {
    ...current,
    maxLineLength: layer.maxLineLength ?? current.maxLineLength,
    strict: layer.strict ?? current.strict,
    checkLinks: layer.checkLinks ?? current.checkLinks,
    checkFreshness: layer.checkFreshness ?? current.checkFreshness,
    checkFrontmatter: layer.checkFrontmatter ?? current.checkFrontmatter,
    checkInlineHtml: layer.checkInlineHtml ?? current.checkInlineHtml,
    freshnessMaxDays: layer.freshnessMaxDays ?? current.freshnessMaxDays,
    linkTimeoutMs: layer.linkTimeoutMs ?? current.linkTimeoutMs,
    linkConcurrency: layer.linkConcurrency ?? current.linkConcurrency,
    ignoreRules: [
      ...(Array.isArray(current.ignoreRules) ? current.ignoreRules : []),
      ...(Array.isArray(layer.ignoreRules) ? layer.ignoreRules : [])
    ],
    exclude: [
      ...(Array.isArray(current.exclude) ? current.exclude : []),
      ...(Array.isArray(layer.exclude) ? layer.exclude : [])
    ],
    linkAllowList: [
      ...(Array.isArray(current.linkAllowList) ? current.linkAllowList : []),
      ...(Array.isArray(layer.linkAllowList) ? layer.linkAllowList : [])
    ]
  };
}

function applyCliOverrides(current, args = {}) {
  const merged = {
    ...current,
    ignoreRules: [...current.ignoreRules, ...(args.ignoreRules || [])],
    exclude: [...current.exclude, ...(args.exclude || [])],
    linkAllowList: [...current.linkAllowList, ...(args.linkAllowList || [])]
  };

  if (args.maxLineLength != null) merged.maxLineLength = args.maxLineLength;
  if (args.strict === true) merged.strict = true;
  if (args.checkLinks === true) merged.checkLinks = true;
  if (args.checkFreshness === true) merged.checkFreshness = true;
  if (args.checkFrontmatter === true) merged.checkFrontmatter = true;
  if (args.checkInlineHtml === true) merged.checkInlineHtml = true;
  if (args.freshnessMaxDays != null) merged.freshnessMaxDays = args.freshnessMaxDays;
  if (args.linkTimeoutMs != null) merged.linkTimeoutMs = args.linkTimeoutMs;
  if (args.linkConcurrency != null) merged.linkConcurrency = args.linkConcurrency;
  return merged;
}

function validateResolvedOptions(resolved, contextPath) {
  const maxLineLength = Number(resolved.maxLineLength);
  if (!Number.isInteger(maxLineLength) || maxLineLength <= 0) {
    throw new Error(`Invalid maxLineLength in config: ${resolved.maxLineLength}`);
  }

  const freshnessMaxDays = Number(resolved.freshnessMaxDays);
  if (!Number.isInteger(freshnessMaxDays) || freshnessMaxDays <= 0) {
    throw new Error(`Invalid freshnessMaxDays in config: ${resolved.freshnessMaxDays}`);
  }

  const linkTimeoutMs = Number(resolved.linkTimeoutMs);
  if (!Number.isInteger(linkTimeoutMs) || linkTimeoutMs <= 0) {
    throw new Error(`Invalid linkTimeoutMs in config: ${resolved.linkTimeoutMs}`);
  }

  const linkConcurrency = Number(resolved.linkConcurrency);
  if (!Number.isInteger(linkConcurrency) || linkConcurrency <= 0) {
    throw new Error(`Invalid linkConcurrency in config: ${resolved.linkConcurrency}`);
  }

  const dedupe = (arr) => [...new Set(arr.filter(Boolean))];

  return {
    maxLineLength,
    strict: Boolean(resolved.strict),
    checkLinks: Boolean(resolved.checkLinks),
    checkFreshness: Boolean(resolved.checkFreshness),
    checkFrontmatter: Boolean(resolved.checkFrontmatter),
    checkInlineHtml: Boolean(resolved.checkInlineHtml),
    freshnessMaxDays,
    linkTimeoutMs,
    linkConcurrency,
    ignoreRules: new Set(dedupe(resolved.ignoreRules || [])),
    exclude: dedupe(resolved.exclude || []),
    linkAllowList: dedupe(resolved.linkAllowList || []),
    configPath: contextPath,
    configLoaded: Boolean(contextPath && fs.existsSync(contextPath))
  };
}

function findParentConfigs(startDir, opts = {}) {
  const { baseDir = null } = opts;
  const configs = [];
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  const boundary = baseDir ? path.resolve(baseDir) : root;

  while (isDescendantOrSame(dir, boundary)) {
    const configPath = path.join(dir, CONFIG_NAME);
    if (fs.existsSync(configPath)) {
      configs.unshift(configPath);
    }
    if (dir === boundary) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return configs;
}

function getConfigChainForFile(filePath, args = {}) {
  const rootConfigPath = path.resolve(args.configPath || CONFIG_NAME);
  const rootDir = path.dirname(rootConfigPath);
  const fileDir = path.dirname(path.resolve(filePath));

  const chain = [];
  if (fs.existsSync(rootConfigPath)) {
    chain.push(rootConfigPath);
  }

  if (isDescendantOrSame(fileDir, rootDir)) {
    const parentChain = findParentConfigs(fileDir, { baseDir: rootDir });
    for (const candidate of parentChain) {
      if (candidate !== rootConfigPath) {
        chain.push(candidate);
      }
    }
  } else {
    const nearest = path.join(fileDir, CONFIG_NAME);
    if (fs.existsSync(nearest) && nearest !== rootConfigPath) {
      chain.push(nearest);
    }
  }

  return chain;
}

function resolveOptions(args) {
  const rootConfigPath = path.resolve(args.configPath);
  const rootCfg = parseConfigFile(rootConfigPath);
  const merged = applyCliOverrides(mergeConfigLayer(DEFAULT_OPTIONS, rootCfg), args);
  return validateResolvedOptions(merged, rootConfigPath);
}

function resolveFileOptions(filePath, _baseResolved, args) {
  const chain = getConfigChainForFile(filePath, args);
  let merged = { ...DEFAULT_OPTIONS };
  for (const configPath of chain) {
    merged = mergeConfigLayer(merged, parseConfigFile(configPath));
  }
  merged = applyCliOverrides(merged, args);

  const contextPath = chain.length > 0
    ? chain[chain.length - 1]
    : path.resolve(args.configPath);
  const out = validateResolvedOptions(merged, contextPath);
  out.configChain = chain;
  return out;
}

export {
  CONFIG_NAME,
  DEFAULT_OPTIONS,
  parseConfigFile,
  findParentConfigs,
  resolveOptions,
  resolveFileOptions
};
