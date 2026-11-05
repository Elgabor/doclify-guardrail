import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

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
