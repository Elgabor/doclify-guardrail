import fs from 'node:fs';
import path from 'node:path';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { stripCodeBlocks, stripInlineCode } from './checker.mjs';

const DEFAULT_LINK_TIMEOUT_MS = 8000;
const DEFAULT_LINK_CONCURRENCY = 5;
const MAX_REDIRECTS = 5;
const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal'
]);

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
    url: l.kind === 'inline' ? l.url : l.url.replace(/[),.;!?]+$/g, '')
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

async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeHost(input) {
  if (!input) return '';
  let host = input.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (host.endsWith('.')) {
    host = host.slice(0, -1);
  }
  const zoneIndex = host.indexOf('%');
  if (zoneIndex >= 0) {
    host = host.slice(0, zoneIndex);
  }
  return host;
}

function isBlockedIpv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;

  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isBlockedIpv6(host) {
  if (host === '::' || host === '::1') return true;

  const mappedV4 = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedV4 && isBlockedIpv4(mappedV4[1])) return true;

  const first = host.split(':')[0];
  const firstHextet = parseInt(first || '0', 16);
  if (!Number.isNaN(firstHextet)) {
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10
  }
  return false;
}

function blockedHostReason(host, resolvedIp = null) {
  const normalizedHost = normalizeHost(host);
  const candidateIp = normalizeHost(resolvedIp || normalizedHost);
  if (!normalizedHost) return null;

  const localHost = normalizedHost === 'localhost' || normalizedHost.endsWith('.localhost');
  if (localHost || METADATA_HOSTNAMES.has(normalizedHost)) {
    return resolvedIp
      ? `Blocked private host/IP (${normalizedHost} -> ${resolvedIp})`
      : `Blocked private host/IP (${normalizedHost})`;
  }

  const ipVersion = net.isIP(candidateIp);
  if (ipVersion === 4 && isBlockedIpv4(candidateIp)) {
    return resolvedIp
      ? `Blocked private host/IP (${normalizedHost} -> ${candidateIp})`
      : `Blocked private host/IP (${normalizedHost})`;
  }
  if (ipVersion === 6 && isBlockedIpv6(candidateIp)) {
    return resolvedIp
      ? `Blocked private host/IP (${normalizedHost} -> ${candidateIp})`
      : `Blocked private host/IP (${normalizedHost})`;
  }
  return null;
}

async function resolveAddresses(hostname, dnsCache) {
  if (dnsCache.has(hostname)) {
    return dnsCache.get(hostname);
  }

  const promise = lookup(hostname, { all: true, verbatim: true })
    .then((entries) => entries.map((entry) => normalizeHost(entry.address)).filter(Boolean))
    .catch(() => []);
  dnsCache.set(hostname, promise);
  return promise;
}

async function getBlockedRemoteUrlReason(url, { dnsCache } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const host = normalizeHost(parsed.hostname);
  const directReason = blockedHostReason(host);
  if (directReason) return directReason;

  if (net.isIP(host) !== 0) return null;

  const cache = dnsCache instanceof Map ? dnsCache : new Map();
  const addresses = await resolveAddresses(host, cache);
  for (const address of addresses) {
    const reason = blockedHostReason(host, address);
    if (reason) return reason;
  }

  return null;
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function fetchFollowingRedirects(url, { method, timeoutMs, allowPrivateLinks, dnsCache }) {
  let currentUrl = url;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!allowPrivateLinks) {
      const blocked = await getBlockedRemoteUrlReason(currentUrl, { dnsCache });
      if (blocked) {
        return { error: blocked };
      }
    }

    const response = await fetchWithTimeout(currentUrl, { method, redirect: 'manual' }, timeoutMs);
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

  try {
    const headResult = await fetchFollowingRedirects(url, {
      method: 'HEAD',
      timeoutMs,
      allowPrivateLinks,
      dnsCache
    });
    if (headResult.error) {
      return headResult.error;
    }

    const headRes = headResult.response;
    if (headRes.status < 400) {
      return null;
    }

    if (headRes.status === 405 || headRes.status === 501) {
      const getResult = await fetchFollowingRedirects(url, {
        method: 'GET',
        timeoutMs,
        allowPrivateLinks,
        dnsCache
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

function resolveLocalUrl(url, { sourceFile, siteRoot } = {}) {
  const withoutAnchor = url.split('#')[0];
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
    return { targetPath: path.resolve(siteRoot, siteRelativeTarget) };
  }

  return { targetPath: path.resolve(path.dirname(sourceFile), withoutAnchor) };
}

function checkLocalUrl(url, opts = {}) {
  const resolved = resolveLocalUrl(url, opts);
  if (!resolved) return null;
  if (resolved.message) return resolved;

  return fs.existsSync(resolved.targetPath)
    ? null
    : {
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

async function checkDeadLinksDetailed(content, { sourceFile, siteRoot, linkAllowList, timeoutMs, concurrency, remoteCache, allowPrivateLinks } = {}) {
  const links = extractLinks(content);
  const findings = [];
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
      if (remoteChecks.has(url)) continue;
      if (!allowPrivate) {
        const blocked = await getBlockedRemoteUrlReason(url, { dnsCache });
        if (blocked) {
          findings.push({
            code: 'dead-link',
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

    const localFinding = checkLocalUrl(url, { sourceFile, siteRoot });
    if (localFinding) {
      findings.push({
        code: localFinding.code,
        severity: localFinding.severity,
        line: link.line,
        message: localFinding.message,
        source: sourceFile
      });
    }
  }

  // Remote links in parallel with concurrency limit
  if (remoteChecks.size > 0) {
    const entries = Array.from(remoteChecks.entries());
    const tasks = entries.map(([url, link]) => async () => {
      let error;
      stats.remoteLinksChecked += 1;
      if (cache.has(url)) {
        error = cache.get(url);
        stats.remoteCacheHits += 1;
      } else {
        stats.remoteCacheMisses += 1;
        error = await checkRemoteUrl(url, { timeoutMs, allowPrivateLinks: allowPrivate, dnsCache });
        cache.set(url, error);
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
          severity: 'error',
          line: link.line,
          message: `Dead link: ${url} (${error})`,
          source: sourceFile
        });
      }
    }
  }

  return { findings, stats };
}

async function checkDeadLinks(content, opts = {}) {
  const { findings } = await checkDeadLinksDetailed(content, opts);
  return findings.filter((finding) => finding.severity === 'error');
}

export { extractLinks, checkDeadLinks };
export { checkDeadLinksDetailed };
export { DEFAULT_LINK_TIMEOUT_MS, DEFAULT_LINK_CONCURRENCY };
