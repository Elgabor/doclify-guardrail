import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { decodeLocalPath } from './local-url.mjs';
import { stripCodeBlocks, stripInlineCode } from './markdown-content.mjs';
import { MARKDOWN_EXTENSIONS } from './markdown-files.mjs';
import {
  createPrivateNetworkBlockingLookup,
  getBlockedRemoteUrlReason
} from './network-guard.mjs';
import { getReadContainment } from './workspace-path.mjs';

const DEFAULT_LINK_TIMEOUT_MS = 8000;
const DEFAULT_LINK_CONCURRENCY = 5;
const MAX_REDIRECTS = 5;
const HEAD_FALLBACK_STATUSES = new Set([403, 404, 405, 501]);

function sanitizeCapturedUrl(url, kind) {
  let normalized = url.trim().replace(/[>*_`]+$/g, '');

  let openParens = (normalized.match(/\(/g) || []).length;
  let closeParens = (normalized.match(/\)/g) || []).length;
  while (closeParens > openParens && normalized.endsWith(')')) {
    normalized = normalized.slice(0, -1);
    closeParens -= 1;
  }

  if (kind !== 'inline') {
    normalized = normalized.replace(/[),.;!?]+$/g, '');
  } else {
    normalized = normalized.replace(/[.;!?]+$/g, '');
  }

  return normalized;
}

function extractLinks(content) {
  const stripped = stripCodeBlocks(content);
  const lines = stripped.split('\n');
  const links = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = stripInlineCode(lines[idx]);
    const lineNumber = idx + 1;

    const inlineRx = /\[[^\]]*\]\(([^()\s]*(?:\([^)]*\)[^()\s]*)*)\)/g;
    let inline;
    while ((inline = inlineRx.exec(line)) !== null) {
      links.push({ url: inline[1].trim(), line: lineNumber, kind: 'inline' });
    }

    const refDefRx = /^\[[^\]]+\]:\s*(\S+)/;
    const ref = line.match(refDefRx);
    if (ref) {
      links.push({ url: ref[1].trim(), line: lineNumber, kind: 'reference' });
    }

    const bareRx = /\bhttps?:\/\/\S+/g;
    let bare;
    while ((bare = bareRx.exec(line)) !== null) {
      links.push({ url: bare[0].trim(), line: lineNumber, kind: 'bare' });
    }
  }

  // Remove trailing punctuation from bare/reference URL captures (not inline — already delimited by markdown syntax)
  return links.map((l) => ({
    ...l,
    url: sanitizeCapturedUrl(l.url, l.kind)
  }));
}

function isSkippableUrl(url) {
  return url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('#');
}

function isAllowListed(url, allowList) {
  if (!allowList || allowList.length === 0) return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  for (const pattern of allowList) {
    // Wildcard pattern: "https://wger.de/*" → prefix match
    if (pattern.includes('/') && pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (url.startsWith(prefix)) return true;
      continue;
    }
    // Full URL match
    if (pattern.includes('/')) {
      if (url === pattern) return true;
      continue;
    }
    // Domain-only: suffix match on hostname (e.g. "wger.de" matches "api.wger.de")
    if (parsed.hostname === pattern || parsed.hostname.endsWith('.' + pattern)) return true;
  }
  return false;
}

function getHeader(headers, name) {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  if (typeof opts.requestFn === 'function') {
    return opts.requestFn(url, opts, timeoutMs);
  }

  const parsed = new URL(url);
  const client = parsed.protocol === 'https:' ? https : http;
  if (client !== http && client !== https) {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }

  return new Promise((resolve, reject) => {
    const timeoutError = new Error(`Timeout (${timeoutMs / 1000}s)`);
    timeoutError.name = 'AbortError';
    const req = client.request(parsed, {
      method: opts.method,
      lookup: opts.lookup
    }, (res) => {
      res.resume();
      resolve({
        status: res.statusCode ?? 0,
        headers: {
          get: (name) => getHeader(res.headers, name)
        }
      });
    });
    const timer = setTimeout(() => {
      req.destroy(timeoutError);
    }, timeoutMs);
    req.on('error', reject);
    req.on('close', () => {
      clearTimeout(timer);
    });
    req.end();
  });
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function fetchFollowingRedirects(url, { method, timeoutMs, allowPrivateLinks, dnsCache, lookupFn, requestFn }) {
  let currentUrl = url;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!allowPrivateLinks) {
      const blocked = await getBlockedRemoteUrlReason(currentUrl, { dnsCache, lookupFn });
      if (blocked) {
        return { error: blocked };
      }
    }

    const response = await fetchWithTimeout(currentUrl, {
      method,
      lookup: allowPrivateLinks ? undefined : createPrivateNetworkBlockingLookup({ lookupFn }),
      requestFn
    }, timeoutMs);
    if (!isRedirectStatus(response.status)) {
      return { response };
    }

    const location = response.headers.get('location');
    if (!location) {
      return { response };
    }

    if (redirects === MAX_REDIRECTS) {
      return { error: `Too many redirects (${MAX_REDIRECTS})` };
    }

    try {
      currentUrl = new URL(location, currentUrl).toString();
    } catch {
      return { error: `Invalid redirect location (${location})` };
    }
  }

  return { error: `Too many redirects (${MAX_REDIRECTS})` };
}

async function checkRemoteUrl(url, opts = {}) {
  const timeoutMs = Number.isInteger(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_LINK_TIMEOUT_MS;
  const allowPrivateLinks = Boolean(opts.allowPrivateLinks);
  const dnsCache = opts.dnsCache instanceof Map ? opts.dnsCache : new Map();
  const lookupFn = opts.lookupFn;
  const requestFn = opts.requestFn;

  try {
    const headResult = await fetchFollowingRedirects(url, {
      method: 'HEAD',
      timeoutMs,
      allowPrivateLinks,
      dnsCache,
      lookupFn,
      requestFn
    });
    if (headResult.error) {
      return headResult.error;
    }

    const headRes = headResult.response;
    if (headRes.status < 400) {
      return null;
    }

    if (HEAD_FALLBACK_STATUSES.has(headRes.status)) {
      const getResult = await fetchFollowingRedirects(url, {
        method: 'GET',
        timeoutMs,
        allowPrivateLinks,
        dnsCache,
        lookupFn,
        requestFn
      });
      if (getResult.error) {
        return getResult.error;
      }

      const getRes = getResult.response;
      if (getRes.status < 400) return null;
      return `HTTP ${getRes.status}`;
    }

    return `HTTP ${headRes.status}`;
  } catch (err) {
    if (err.name === 'AbortError') return `Timeout (${timeoutMs / 1000}s)`;
    return err.message;
  }
}

function buildRootRelativeCandidates(targetPath) {
  const candidates = [targetPath];
  if (path.extname(targetPath)) return candidates;

  for (const extension of MARKDOWN_EXTENSIONS) {
    candidates.push(targetPath + extension);
    candidates.push(path.join(targetPath, 'index' + extension));
  }

  return [...new Set(candidates)];
}

function resolveLocalUrl(url, { sourceFile, siteRoot } = {}) {
  const withoutAnchor = decodeLocalPath(url);
  if (!withoutAnchor) return null;

  if (withoutAnchor.startsWith('/')) {
    if (!siteRoot) {
      return {
        code: 'unverifiable-root-relative-link',
        severity: 'warning',
        message: `Root-relative link not verified: ${url} (siteRoot not configured)`
      };
    }
    const siteRelativeTarget = withoutAnchor.replace(/^\/+/, '');
    const targetPath = path.resolve(siteRoot, siteRelativeTarget);
    return {
      targetPath,
      candidatePaths: buildRootRelativeCandidates(targetPath),
      unverifiableIfMissing: path.extname(siteRelativeTarget).length === 0
    };
  }

  return { targetPath: path.resolve(path.dirname(sourceFile), withoutAnchor) };
}

function checkLocalUrl(url, opts = {}) {
  const resolved = resolveLocalUrl(url, opts);
  if (!resolved) return null;
  if (resolved.message) return resolved;

  const candidatePaths = resolved.candidatePaths || [resolved.targetPath];
  if (opts.readBoundary) {
    for (const candidate of candidatePaths) {
      const containment = getReadContainment(candidate, opts.readBoundary);
      if (containment !== 'inside') {
        return {
          code: containment === 'outside' ? 'link-outside-workspace' : 'link-unreadable',
          severity: 'error',
          operational: true,
          message: containment === 'outside'
            ? `Local link is outside the workspace: ${url}`
            : `Local link cannot be safely resolved: ${url}`
        };
      }
    }
  }
  if (candidatePaths.some(candidate => fs.existsSync(candidate))) {
    return null;
  }

  if (resolved.unverifiableIfMissing) {
    return {
      code: 'unverifiable-root-relative-link',
      severity: 'warning',
      message: `Root-relative link not verified against source files: ${url} (no matching file under siteRoot)`
    };
  }

  return {
    code: 'dead-link',
    severity: 'error',
    message: `Dead link: ${url} (Target not found)`
  };
}

async function runWithConcurrency(tasks, limit) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function buildEmptyStats() {
  return {
    remoteLinksChecked: 0,
    remoteCacheHits: 0,
    remoteCacheMisses: 0,
    remoteTimeouts: 0
  };
}

async function checkDeadLinksDetailed(content, {
  sourceFile,
  siteRoot,
  linkAllowList,
  timeoutMs,
  concurrency,
  remoteCache,
  readBoundary,
  allowPrivateLinks,
  checkRemote = true,
  lookupFn,
  requestFn
} = {}) {
  const links = extractLinks(content);
  const findings = [];
  const diagnostics = [];
  const seen = new Set();
  const cache = remoteCache instanceof Map ? remoteCache : new Map();
  const dnsCache = new Map();
  const allowPrivate = Boolean(allowPrivateLinks);
  const concurrencyLimit = Number.isInteger(concurrency) && concurrency > 0
    ? concurrency
    : DEFAULT_LINK_CONCURRENCY;
  const stats = buildEmptyStats();

  // Local links first (sync, fast)
  const remoteChecks = new Map(); // URL -> first link occurrence

  for (const link of links) {
    const url = link.url;
    if (!url || isSkippableUrl(url)) continue;

    const dedupeKey = `${link.line}:${url}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (!checkRemote) continue;
      if (remoteChecks.has(url)) continue;
      if (!allowPrivate) {
        const blocked = await getBlockedRemoteUrlReason(url, { dnsCache, lookupFn });
        if (blocked) {
          findings.push({
            code: 'dead-link',
            scope: 'remote',
            severity: 'error',
            line: link.line,
            message: `Dead link: ${url} (${blocked})`,
            source: sourceFile
          });
          continue;
        }
      }
      if (isAllowListed(url, linkAllowList)) continue;
      remoteChecks.set(url, link);
      continue;
    }

    const localFinding = checkLocalUrl(url, { sourceFile, siteRoot, readBoundary });
    if (localFinding) {
      const result = {
        code: localFinding.code,
        scope: 'local',
        severity: localFinding.severity,
        operational: localFinding.operational === true,
        line: link.line,
        message: localFinding.message,
        source: sourceFile
      };
      findings.push(result);
      if (localFinding.operational) diagnostics.push(result);
    }
  }

  // Remote links in parallel with concurrency limit
  if (remoteChecks.size > 0) {
    const entries = Array.from(remoteChecks.entries());
    const tasks = entries.map(([url, link]) => async () => {
      let error;
      const cacheKey = `${timeoutMs || DEFAULT_LINK_TIMEOUT_MS}\0${url}`;
      stats.remoteLinksChecked += 1;
      if (cache.has(cacheKey)) {
        error = cache.get(cacheKey);
        stats.remoteCacheHits += 1;
      } else if (timeoutMs == null && cache.has(url)) {
        // Keep the original URL-only cache contract for callers that use the
        // default timeout; explicit policies must never share an outcome.
        error = cache.get(url);
        stats.remoteCacheHits += 1;
      } else {
        stats.remoteCacheMisses += 1;
        error = await checkRemoteUrl(url, {
          timeoutMs,
          allowPrivateLinks: allowPrivate,
          dnsCache,
          lookupFn,
          requestFn
        });
        cache.set(cacheKey, error);
      }
      if (typeof error === 'string' && error.startsWith('Timeout')) {
        stats.remoteTimeouts += 1;
      }
      return { url, link, error };
    });

    const results = await runWithConcurrency(tasks, concurrencyLimit);
    for (const { url, link, error } of results) {
      if (error) {
        findings.push({
          code: 'dead-link',
          scope: 'remote',
          severity: 'error',
          line: link.line,
          message: `Dead link: ${url} (${error})`,
          source: sourceFile
        });
      }
    }
  }

  return { findings, diagnostics, stats };
}

async function checkDeadLinks(content, opts = {}) {
  const { findings } = await checkDeadLinksDetailed(content, opts);
  return findings.filter((finding) => finding.severity === 'error');
}

export { extractLinks, checkDeadLinks };
export { checkDeadLinksDetailed };
export { DEFAULT_LINK_TIMEOUT_MS, DEFAULT_LINK_CONCURRENCY };
