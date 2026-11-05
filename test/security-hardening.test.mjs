import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { check } from '../src/api.mjs';
import { compileWildcard } from '../src/wildcard.mjs';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-security-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function child(source, cwd) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd, encoding: 'utf8', timeout: 8000,
    env: { PATH: process.env.PATH || '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('SEC-02 filename glob treats regex operators literally within a bounded child', (t) => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, `${'a'.repeat(30)}!.md`), '# Test\n');
  fs.writeFileSync(path.join(root, 'literal(a+)+.md'), '# Test\n');
  child(`
    import assert from 'node:assert/strict';
    import { miniGlob } from ${JSON.stringify(new URL('../src/glob.mjs', import.meta.url).href)};
    assert.deepEqual(miniGlob('*(a+)+.md', process.cwd()).map(p => p.split('/').pop()), ['literal(a+)+.md']);
  `, root);
});

test('SEC-02 config exclusions avoid ambiguous wildcard backtracking', (t) => {
  const root = temp(t);
  const name = `${'a'.repeat(45)}.md`;
  fs.writeFileSync(path.join(root, name), '# Test\n');
  fs.writeFileSync(path.join(root, '.doclify-guardrail.json'), JSON.stringify({ exclude: ['*a'.repeat(24) + 'b'] }));
  child(`
    import assert from 'node:assert/strict';
    import { check } from ${JSON.stringify(new URL('../src/api.mjs', import.meta.url).href)};
    const result = await check({cwd: process.cwd(), paths: ['.']});
    assert.equal(result.complete, true);
    assert.equal(result.files.length, 1);
  `, root);
});

test('SEC-02 workspace patterns avoid ambiguous wildcard backtracking', (t) => {
  const root = temp(t);
  const directory = 'a'.repeat(45);
  fs.mkdirSync(path.join(root, directory));
  fs.writeFileSync(path.join(root, directory, 'package.json'), '{"name":"app"}');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['*a'.repeat(24) + 'b'] }));
  child(`
    import assert from 'node:assert/strict';
    import { buildRepositoryIndex } from ${JSON.stringify(new URL('../src/repository-index.mjs', import.meta.url).href)};
    assert.deepEqual(buildRepositoryIndex(process.cwd()).workspacePackages, []);
  `, root);
});

test('SEC-02 wildcard modes preserve their previous supported grammars', () => {
  const paths = ['', 'a', 'b', 'ab', 'a.md', 'docs/a.md', 'docs/sub/a.md', 'packages/app', 'packages/deep/app'];
  const patterns = ['', '*', '**', '**/*', '*.md', '**/*.md', 'docs/*', 'docs/**', 'docs/**/*.md', '**/app', 'packages/**/app', '*a*b', 'a**b'];
  for (const mode of ['filename', 'exclusion', 'workspace']) {
    for (const pattern of patterns) {
      let expression = '';
      for (let offset = 0; offset < pattern.length; offset += 1) {
        if (mode === 'workspace' && pattern.startsWith('**/', offset)) {
          expression += '(?:.*/)?';
          offset += 2;
        } else if (mode !== 'filename' && pattern.startsWith('**', offset)) {
          expression += '.*';
          offset += 1;
        } else if (pattern[offset] === '*') {
          expression += mode === 'filename' ? '.*' : '[^/]*';
        } else expression += pattern[offset].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      const previous = new RegExp(`^${expression}$`);
      const matches = compileWildcard(pattern, mode);
      for (const candidate of paths) assert.equal(matches(candidate), previous.test(candidate), `${mode}:${pattern}:${candidate}`);
    }
    for (const literal of ['(a+)+', '[ab]', 'a?b', 'a|b', '^a$', '{a}', '\\a']) {
      const matches = compileWildcard(`*${literal}`, mode);
      assert.equal(matches(`x${literal}`), true);
      assert.equal(matches('xaaab'), false);
    }
  }
});
