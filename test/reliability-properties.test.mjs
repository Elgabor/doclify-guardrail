import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { check } from '../src/api.mjs';
import { blockedHostReason } from '../src/network-guard.mjs';
import { getReadContainment } from '../src/workspace-path.mjs';

function temp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-properties-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('claim detection is stable across line endings, Markdown variants, and fences', async (t) => {
  for (const extension of ['md', 'mdx']) {
    for (const eol of ['\n', '\r\n']) {
      const root = temp(t);
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
        scripts: { test: 'node --test' }
      }), 'utf8');
      const cases = [
        { body: ['# Doc', '', '`npm run missing`'], expected: ['package-script'] },
        { body: ['# Doc', '', '```sh', 'npm run missing', '```'], expected: ['package-script'] },
        { body: ['# Doc', '', '~~~bash', 'npm run missing', '~~~'], expected: ['package-script'] },
        { body: ['# Doc', '', '```js', 'const command = "npm run missing";', '```'], expected: [] }
      ];
      for (const [index, fixture] of cases.entries()) {
        const file = `case-${index}.${extension}`;
        fs.writeFileSync(path.join(root, file), `${fixture.body.join(eol)}${eol}`, 'utf8');
        const result = await check({ cwd: root, paths: [file] });
        assert.deepEqual(result.findings.map((finding) => finding.ruleId), fixture.expected, `${extension}:${JSON.stringify(eol)}:${index}`);
      }
    }
  }
});

test('Unicode paths and encoded anchors resolve identically with LF and CRLF', async (t) => {
  for (const eol of ['\n', '\r\n']) {
    const root = temp(t);
    fs.writeFileSync(path.join(root, 'guida-è.md'), `# Guida${eol}${eol}## Café déjà vu${eol}`, 'utf8');
    fs.writeFileSync(
      path.join(root, 'README.md'),
      `# Readme${eol}${eol}[Guida](guida-%C3%A8.md#caf%C3%A9-d%C3%A9j%C3%A0-vu)${eol}`,
      'utf8'
    );
    const result = await check({ cwd: root, paths: ['README.md'] });
    assert.equal(result.status, 'pass');
    assert.deepEqual(result.findings, []);

    fs.writeFileSync(
      path.join(root, 'README.md'),
      `# Readme${eol}${eol}[Guida](guida-%C3%A8.md#missing)${eol}`,
      'utf8'
    );
    const missing = await check({ cwd: root, paths: ['README.md'] });
    assert.deepEqual(missing.findings.map((finding) => finding.ruleId), ['local-link']);
    assert.match(missing.findings[0].message, /Missing local anchor/);
  }
});

test('workspace containment is stable for missing, Unicode, and symlinked paths', { skip: process.platform === 'win32' }, (t) => {
  const parent = temp(t);
  const workspace = path.join(parent, 'workspace');
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(workspace);
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(workspace, 'dati-è'));
  fs.symlinkSync(outside, path.join(workspace, 'outside-link'));
  fs.symlinkSync(path.join(parent, 'missing-target'), path.join(workspace, 'broken-link'));
  fs.symlinkSync('loop-b', path.join(workspace, 'loop-a'));
  fs.symlinkSync('loop-a', path.join(workspace, 'loop-b'));

  const cases = [
    [workspace, 'inside'],
    [path.join(workspace, 'dati-è', 'missing.md'), 'inside'],
    [path.join(workspace, 'outside-link', 'doc.md'), 'outside'],
    [path.join(workspace, '..', 'outside', 'doc.md'), 'outside'],
    [path.join(workspace, 'broken-link', 'doc.md'), 'outside'],
    [path.join(workspace, 'loop-a', 'doc.md'), 'indeterminate']
  ];
  for (const [candidate, expected] of cases) {
    assert.equal(getReadContainment(candidate, workspace), expected, candidate);
  }
});

test('workspace containment fails closed for an excessive acyclic symlink chain', { skip: process.platform === 'win32' }, (t) => {
  const workspace = temp(t);
  fs.mkdirSync(path.join(workspace, 'terminal'));
  for (let index = 40; index >= 0; index -= 1) {
    const target = index === 40 ? 'terminal' : `link-${index + 1}`;
    fs.symlinkSync(target, path.join(workspace, `link-${index}`));
  }

  assert.equal(getReadContainment(path.join(workspace, 'link-0'), workspace), 'indeterminate');
});

test('target selection rejects paths whose containment is indeterminate', { skip: process.platform === 'win32' }, async (t) => {
  const workspace = temp(t);
  fs.symlinkSync('loop-b.md', path.join(workspace, 'loop-a.md'));
  fs.symlinkSync('loop-a.md', path.join(workspace, 'loop-b.md'));

  await assert.rejects(
    check({ cwd: workspace, paths: ['loop-a.md'] }),
    (error) => error?.code === 'target-unreadable'
  );
});

test('private-network guard blocks non-public SSRF destinations', () => {
  for (const host of [
    '100.64.0.1',
    '100.100.100.200',
    '192.0.0.1',
    '192.0.2.1',
    '192.88.99.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::127.0.0.1',
    '::7f00:1',
    '64:ff9b:1::1',
    '100::1',
    '2001:db8::1',
    'fec0::1',
    'ff02::1'
  ]) {
    assert.match(blockedHostReason(host), /Blocked private host\/IP/, host);
  }
  for (const host of [
    '100.63.255.255',
    '100.128.0.0',
    '192.0.0.9',
    '192.0.0.10',
    '192.0.3.1',
    '198.51.101.1',
    '203.0.114.1',
    '64:ff9b::1',
    '2001:4860::1',
    '::8.8.8.8'
  ]) {
    assert.equal(blockedHostReason(host), null, host);
  }
});

test('percent-decoded local links cannot escape the workspace', async (t) => {
  const parent = temp(t);
  const workspace = path.join(parent, 'workspace');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(parent, 'outside.md'), '# Outside\n', 'utf8');
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Readme\n\n[out](%2e%2e/outside.md)\n', 'utf8');
  const result = await check({ cwd: workspace, paths: ['README.md'] });
  assert.equal(result.complete, false);
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ['link-outside-workspace']);
});
