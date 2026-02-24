import fs from 'node:fs';
import path from 'node:path';
import { stripCodeBlocks, stripInlineCode } from './checker.mjs';

const LINK_TIMEOUT_MS = 8000;
const CONCURRENCY = 5;

function extractLinks(content) {
  const stripped = stripCodeBlocks(content);
  const lines = stripped.split('\n');
  const links = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = stripInlineCode(lines[idx]);
    const lineNumber = idx + 1;

    const inlineRx = /\[[^\]]*\]\(([^)]+)\)/g;
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

  // Remove trailing punctuation from bare URL captures
  return links.map((l) => ({
    ...l,
    url: l.url.replace(/[),.;!?]+$/g, '')
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

async function checkRemoteUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_TIMEOUT_MS);

  try {
    const headRes = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    clearTimeout(timer);
    if (headRes.status < 400) {
      return null;
    }

    if (headRes.status === 405 || headRes.status === 501) {
      const timer2 = setTimeout(() => controller.abort(), LINK_TIMEOUT_MS);
      const getRes = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
      clearTimeout(timer2);
      if (getRes.status < 400) return null;
      return `HTTP ${getRes.status}`;
    }

    return `HTTP ${headRes.status}`;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return `Timeout (${LINK_TIMEOUT_MS / 1000}s)`;
    return err.message;
  }
}

function checkLocalUrl(url, sourceFile) {
  const withoutAnchor = url.split('#')[0];
  if (!withoutAnchor) return null;

  const targetPath = path.resolve(path.dirname(sourceFile), withoutAnchor);
  return fs.existsSync(targetPath) ? null : 'Target not found';
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

async function checkDeadLinks(content, { sourceFile, linkAllowList } = {}) {
  const links = extractLinks(content);
  const findings = [];
  const seen = new Set();

  // Local links first (sync, fast)
  const remoteChecks = [];

  for (const link of links) {
    const url = link.url;
    if (!url || isSkippableUrl(url)) continue;

    const dedupeKey = `${link.line}:${url}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (isAllowListed(url, linkAllowList)) continue;
      remoteChecks.push({ url, link });
      continue;
    }

    if (url.startsWith('/')) {
      continue;
    }

    const localError = checkLocalUrl(url, sourceFile);
    if (localError) {
      findings.push({
        code: 'dead-link',
        severity: 'error',
        line: link.line,
        message: `Dead link: ${url} (${localError})`,
        source: sourceFile
      });
    }
  }

  // Remote links in parallel with concurrency limit
  if (remoteChecks.length > 0) {
    const tasks = remoteChecks.map(({ url, link }) => async () => {
      const error = await checkRemoteUrl(url);
      return { url, link, error };
    });

    const results = await runWithConcurrency(tasks, CONCURRENCY);
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

  return findings;
}

export { extractLinks, checkDeadLinks };
