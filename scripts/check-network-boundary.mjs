#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';

import { checkDeadLinksDetailed } from '../src/links.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

async function run() {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url === '/missing') {
      response.writeHead(503).end();
      return;
    }
    if (request.url === '/slow') return;
    response.writeHead(200).end();
  });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  const watchdog = setTimeout(() => {
    server.closeAllConnections();
    server.close();
  }, 5000);
  try {
    const blocked = await checkDeadLinksDetailed(`[blocked](${base}/ok)`, {
      sourceFile: 'README.md', timeoutMs: 100
    });
    assert.equal(blocked.findings.length, 1);
    assert.match(blocked.findings[0].message, /Blocked private host\/IP/);
    assert.deepEqual(requests, []);

    const allowed = await checkDeadLinksDetailed(`[ok](${base}/ok)`, {
      sourceFile: 'README.md', timeoutMs: 100, allowPrivateLinks: true
    });
    assert.deepEqual(allowed.findings, []);
    assert.deepEqual(requests, ['HEAD /ok']);

    const beforeAllowList = requests.length;
    const skipped = await checkDeadLinksDetailed(`[skip](${base}/skip)`, {
      sourceFile: 'README.md', timeoutMs: 100, allowPrivateLinks: true,
      linkAllowList: [`${base}/skip`]
    });
    assert.deepEqual(skipped.findings, []);
    assert.equal(requests.length, beforeAllowList);

    const missing = await checkDeadLinksDetailed(`[missing](${base}/missing)`, {
      sourceFile: 'README.md', timeoutMs: 100, allowPrivateLinks: true
    });
    assert.equal(missing.findings.length, 1);
    assert.match(missing.findings[0].message, /HTTP 503/);

    const timeout = await checkDeadLinksDetailed(`[slow](${base}/slow)`, {
      sourceFile: 'README.md', timeoutMs: 40, allowPrivateLinks: true
    });
    assert.equal(timeout.findings.length, 1);
    assert.match(timeout.findings[0].message, /Timeout/);
  } finally {
    clearTimeout(watchdog);
    await close(server);
  }
  process.stdout.write('network-boundary: pass | SSRF block, allow-list, HTTP failure, timeout\n');
}

run().catch((error) => {
  process.stderr.write(`network-boundary: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
