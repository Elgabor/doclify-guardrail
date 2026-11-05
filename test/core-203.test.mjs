import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { check } from '../src/api.mjs';
import { createResult } from '../src/result.mjs';
import { renderResult } from '../src/result-renderers.mjs';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-core-203-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('link-free input stays within a bounded scanner budget in all three grammars', (t) => {
  const root = temp(t);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { scanInlineLinks } from ${JSON.stringify(new URL('../src/inline-links.mjs', import.meta.url).href)};
    const inputs = ['a'.repeat(32 * 1024 * 1024), '['.repeat(32 * 1024 * 1024)];
    for (let run = 0; run < 8; run += 1) {
      for (const mode of ['link', 'claim', 'heading']) {
        for (const input of inputs) assert.deepEqual(scanInlineLinks(input, mode), []);
      }
    }
  `], {
    cwd: root, encoding: 'utf8', timeout: 5000,
    env: { PATH: process.env.PATH || '' }
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test('repeated local evidence checks stay within a bounded filesystem budget', (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, '.doclify-guardrail.json'), JSON.stringify({ exclude: ['private/**'] }));
  fs.writeFileSync(path.join(root, 'README.md'), '[target](docs/target.md)\n'.repeat(80000));
  fs.writeFileSync(path.join(root, 'docs', 'target.md'), '# Target\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { check } from ${JSON.stringify(new URL('../src/api.mjs', import.meta.url).href)};
    const result = await check({ cwd: process.cwd(), paths: ['README.md'] });
    assert.equal(result.complete, true);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.diagnostics, []);
  `], {
    cwd: root, encoding: 'utf8', timeout: 5000,
    env: { PATH: process.env.PATH || '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test('filesystem and exclusion memoization never survives an API scan', async (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'README.md'), '[target](docs/target.md)\n');
  fs.writeFileSync(path.join(root, 'docs', 'target.md'), '# Target\n');
  const configPath = path.join(root, '.doclify-guardrail.json');
  fs.writeFileSync(configPath, JSON.stringify({ exclude: ['private/**'] }));
  assert.equal((await check({ cwd: root, paths: ['README.md'] })).status, 'pass');
  fs.writeFileSync(configPath, JSON.stringify({ exclude: ['docs/**'] }));
  const excluded = await check({ cwd: root, paths: ['README.md'] });
  assert.equal(excluded.complete, false);
  assert.deepEqual(excluded.findings, []);
  assert.deepEqual(excluded.diagnostics.map(({ code }) => code), ['evidence-source-unavailable']);
  fs.writeFileSync(configPath, JSON.stringify({ exclude: ['private/**'] }));
  assert.equal((await check({ cwd: root, paths: ['README.md'] })).status, 'pass');
});

test('literal less-than prose cannot consume a later HTML anchor as an incomplete tag', async (t) => {
  for (const newline of ['\n', '\r\n']) {
    const root = temp(t);
    fs.writeFileSync(path.join(root, 'README.md'), '[support](guide.md#drop-old-node)\n');
    fs.writeFileSync(path.join(root, 'guide.md'), [
      '# Guide', '', 'Node.js < v20.19 is unsupported.', '',
      '## <a name="drop-old-node"></a> Node support', ''
    ].join(newline));
    const result = await check({ cwd: root, paths: ['README.md'] });
    assert.equal(result.complete, true);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.diagnostics, []);
  }
});

test('real multiline and unclosed HTML anchors still leave evidence incomplete', async (t) => {
  for (const content of ['<a\n name="present">\n</a>\n', '<a name="present"\n', '<Component\n id={dynamic}>\n']) {
    const root = temp(t);
    fs.writeFileSync(path.join(root, 'README.md'), '[anchor](guide.md#missing)\n');
    fs.writeFileSync(path.join(root, 'guide.md'), content);
    const result = await check({ cwd: root, paths: ['README.md'] });
    assert.equal(result.complete, false);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.diagnostics.map(({ code }) => code), ['evidence-source-unavailable']);
  }
});

test('JUnit totals count emitted errors and failures when a file has both kinds of evidence', () => {
  const result = createResult({
    toolVersion: '2.0.2',
    files: [
      { path: 'both.md', scanned: true },
      { path: 'blocking.md', scanned: true },
      { path: 'unscanned.md', scanned: false },
      { path: 'diagnostics.md', scanned: true }
    ],
    findings: ['both.md', 'blocking.md', 'unscanned.md'].map(file => ({
      path: file, ruleId: 'local-link', severity: 'blocking', message: 'Missing local file.'
    })),
    diagnostics: ['both.md', 'diagnostics.md', 'diagnostics.md', 'orphan.md'].map(file => ({
      path: file, code: 'evidence-source-unavailable', severity: 'error', message: 'Incomplete source.'
    }))
  });
  const xml = renderResult(result, { format: 'junit' });
  assert.match(xml, /tests="5" failures="1" errors="4"/);
  assert.equal([...xml.matchAll(/<testcase\b/g)].length, 5);
  assert.equal([...xml.matchAll(/<failure\b/g)].length, 1);
  assert.equal([...xml.matchAll(/<error\b/g)].length, 4);
});
