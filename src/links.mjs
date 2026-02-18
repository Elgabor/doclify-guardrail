import fs from 'node:fs';
import path from 'node:path';
import { stripCodeBlocks, stripInlineCode } from './checker.mjs';

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

async function checkRemoteUrl(url) {
  try {
    const headRes = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (headRes.status < 400) {
      return null;
    }

    if (headRes.status === 405 || headRes.status === 501) {
      const getRes = await fetch(url, { method: 'GET', redirect: 'follow' });
      if (getRes.status < 400) return null;
      return `HTTP ${getRes.status}`;
    }

    return `HTTP ${headRes.status}`;
  } catch (err) {
    return err.message;
  }
}

function checkLocalUrl(url, sourceFile) {
  const withoutAnchor = url.split('#')[0];
  if (!withoutAnchor) return null;

  const targetPath = path.resolve(path.dirname(sourceFile), withoutAnchor);
  return fs.existsSync(targetPath) ? null : 'Target not found';
}

async function checkDeadLinks(content, { sourceFile }) {
  const links = extractLinks(content);
  const findings = [];
  const seen = new Set();

  for (const link of links) {
    const url = link.url;
    if (!url || isSkippableUrl(url)) continue;

    const dedupeKey = `${link.line}:${url}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (url.startsWith('http://') || url.startsWith('https://')) {
      const error = await checkRemoteUrl(url);
      if (error) {
        findings.push({
          code: 'dead-link',
          severity: 'error',
          line: link.line,
          message: `Dead link: ${url} (${error})`,
          source: sourceFile
        });
      }
      continue;
    }

    if (url.startsWith('/')) {
      // Absolute filesystem paths are intentionally ignored for portability.
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

  return findings;
}

export { extractLinks, checkDeadLinks };