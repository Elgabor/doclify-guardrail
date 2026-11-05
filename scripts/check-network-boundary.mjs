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
  await checkResponseLifecycle();
  process.stdout.write('network-boundary: pass | SSRF block, allow-list, HTTP failure, timeout\n');
}

async function checkResponseLifecycle() {
  const sockets = new Set();
  const responses = new Set();
  const socketClosures = [];
  let peak = 0;
  const server = http.createServer((request, response) => {
    if (request.method === 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    responses.add(response);
    peak = Math.max(peak, responses.size);
    response.on('close', () => responses.delete(response));
    response.writeHead(request.url.startsWith('/redirect') ? 302 : 200, { location: '/stream' });
    response.flushHeaders();
    const timer = setInterval(() => response.write(Buffer.alloc(4096)), 5);
    response.on('close', () => clearInterval(timer));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socketClosures.push(new Promise((resolve) => socket.once('close', resolve)));
    socket.on('close', () => sockets.delete(socket));
  });
  const port = await listen(server);
  let expired = false;
  const watchdog = setTimeout(() => {
    expired = true;
    server.closeAllConnections();
  }, 5000);
  try {
    const content = Array.from({ length: 8 }, (_, index) => `[x](http://127.0.0.1:${port}/${index % 2 ? 'redirect' : 'stream'}/${index})`).join('\n');
    const result = await checkDeadLinksDetailed(content, {
      sourceFile: 'README.md', concurrency: 1, timeoutMs: 1000, allowPrivateLinks: true
    });
    assert.deepEqual(result.findings, []);
    assert.ok(peak <= 1, `response concurrency exceeded: ${peak}`);
    // A TCP peer observes the client's completed close asynchronously.
    await Promise.all(socketClosures);
    assert.equal(expired, false, 'response cleanup exceeded the watchdog');
    assert.equal(responses.size, 0, 'response streams remain active');
    assert.equal(sockets.size, 0, 'HTTP sockets remain active');
  } finally {
    clearTimeout(watchdog);
    await close(server);
  }
}

run().catch((error) => {
  process.stderr.write(`network-boundary: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
