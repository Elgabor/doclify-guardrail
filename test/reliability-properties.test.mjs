import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { check } from '../src/api.mjs';
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

test('workspace containment is stable for missing, Unicode, and symlinked paths', (t) => {
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
