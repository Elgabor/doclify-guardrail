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

test('local evidence metadata calls grow with distinct paths instead of repeated links', (t) => {
  const root = temp(t);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    import { check } from ${JSON.stringify(new URL('../src/api.mjs', import.meta.url).href)};
    const root = process.cwd();
    const targets = Array.from({ length: 8 }, (_, index) => 'docs/target-' + index + '/guide.md');
    const parents = new Set();
    for (const target of targets) {
      const directory = path.dirname(path.join(root, target));
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(root, target), '# Target\\n');
      parents.add(directory);
      parents.add(fs.realpathSync(directory));
    }
    fs.writeFileSync(path.join(root, '.doclify-guardrail.json'), JSON.stringify({ exclude: ['private/**'] }));
    const methods = ['realpathSync', 'lstatSync', 'statSync', 'existsSync'];
    const originals = Object.fromEntries(methods.map(name => [name, fs[name]]));
    let counts;
    for (const name of methods) {
      fs[name] = function (...args) {
        // Count directory resolution; per-link containment still inspects each target file.
        if (counts && typeof args[0] === 'string' && parents.has(path.resolve(args[0]))) counts[name] += 1;
        return Reflect.apply(originals[name], this, args);
      };
    }
    syncBuiltinESMExports();
    async function measure(paths, repetitions) {
      fs.writeFileSync(path.join(root, 'README.md'), paths.map(target => '[target](' + target + ')\\n').join('').repeat(repetitions));
      counts = Object.fromEntries(methods.map(name => [name, 0]));
      const result = await check({ cwd: root, paths: ['README.md'] });
      assert.equal(result.complete, true);
      assert.equal(result.summary.filesScanned, 1);
      assert.deepEqual(result.findings, []);
      assert.deepEqual(result.diagnostics, []);
      return counts;
    }
    try {
      const single = await measure(targets.slice(0, 1), 1);
      const repeated = await measure(targets.slice(0, 1), 64);
      const distinct = await measure(targets, 1);
      const repeatedDistinct = await measure(targets, 64);
      process.stdout.write(JSON.stringify({ single, repeated, distinct, repeatedDistinct }));
    } finally {
      Object.assign(fs, originals);
      syncBuiltinESMExports();
    }
  `], {
    cwd: root, encoding: 'utf8', timeout: 60000,
    env: { PATH: process.env.PATH || '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  const { single, repeated, distinct, repeatedDistinct } = JSON.parse(result.stdout);
  t.diagnostic(JSON.stringify({ single, repeated, distinct, repeatedDistinct }));
  assert.deepEqual(repeated, single, 'Repeating one link must not repeat parent directory resolution.');
  assert.deepEqual(repeatedDistinct, distinct, 'Repeating several links must not repeat parent directory resolution.');
  const total = counts => Object.values(counts).reduce((sum, count) => sum + count, 0);
  assert.ok(total(single) > 0, 'The scan must inspect the evidence parent directory.');
  assert.ok(total(distinct) > total(single), 'New evidence directories must be inspected.');
  assert.ok(total(distinct) <= 8 * total(single), 'Directory resolution must grow with distinct paths.');
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

test('versioned host routes with Markdown companions abstain without hiding explicit missing files', async (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs', 'migrating-to-1.0.0.md'), '# Migration\n');
  fs.writeFileSync(path.join(root, 'docs', 'migrating-to-2.0.0.mdx'), '# Migration\n');
  fs.writeFileSync(path.join(root, 'README.md'), [
    '[md route](docs/migrating-to-1.0.0)',
    '[mdx route](./docs/migrating-to-2.0.0#host-only)',
    '[root route](/migrating-to-1.0.0)',
    '[missing source](docs/missing.md)',
    '[missing version](docs/migrating-to-3.0.0)',
    '[missing exact anchor](docs/migrating-to-1.0.0.md#missing)', ''
  ].join('\n'));
  const result = await check({ cwd: root, paths: ['README.md'], siteRoot: 'docs' });
  assert.equal(result.complete, true);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.findings.map(({ line, message }) => ({ line, message })), [
    { line: 4, message: 'Dead link: docs/missing.md (Target not found)' },
    { line: 5, message: 'Dead link: docs/migrating-to-3.0.0 (Target not found)' },
    { line: 6, message: 'Missing local anchor: #missing.' }
  ]);
});

test('heading emphasis allows rendered slugs and preserves internal snake_case and legacy anchors', async (t) => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'guide.md'), [
    '# Community _(Unofficial)_',
    '# Community _(Unofficial)_',
    '# __Bold__ and _italic_',
    '# snake_case',
    '# snake_case_name',
    '# _snake_case_ and _two words_',
    '# `_code_`', ''
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'README.md'), [
    '[rendered](guide.md#community-unofficial)',
    '[duplicate](guide.md#community-unofficial-1)',
    '[legacy](guide.md#community-_unofficial_)',
    '[strong](guide.md#bold-and-italic)',
    '[snake](guide.md#snake_case)',
    '[snake many](guide.md#snake_case_name)',
    '[missing](guide.md#snakecase)',
    '[inner underscore](guide.md#snake_case-and-two-words)',
    '[code](guide.md#_code_)',
    '[missing code](guide.md#code)', ''
  ].join('\n'));
  const result = await check({ cwd: root, paths: ['README.md'] });
  assert.equal(result.complete, true);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.findings.map(({ line, message }) => ({ line, message })), [
    { line: 7, message: 'Missing local anchor: #snakecase.' },
    { line: 10, message: 'Missing local anchor: #code.' }
  ]);
});

test('unmatched emphasis delimiters keep anchor analysis within a bounded budget', (t) => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'guide.md'), '# ' + '_a '.repeat(65536) + '\n');
  fs.writeFileSync(path.join(root, 'README.md'), '[missing](guide.md#missing)\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { check } from ${JSON.stringify(new URL('../src/api.mjs', import.meta.url).href)};
    const result = await check({ cwd: process.cwd(), paths: ['README.md'] });
    assert.equal(result.complete, true);
    assert.equal(result.findings.length, 1);
  `], {
    cwd: root, encoding: 'utf8', timeout: 5000,
    env: { PATH: process.env.PATH || '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test('HTML heading text supplies possible anchors while fenced headings and explicit IDs stay exact', async (t) => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'guide.md'), [
    '<h3>Technology Sponsors</h3>',
    '<H2 class="section"><em>Other</em> Sponsors</H2>',
    '<h3 id="chosen">Explicit Text</h3>',
    '```html', '<h3>Fenced Heading</h3>', '```', ''
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'README.md'), [
    '[html](guide.md#technology-sponsors)',
    '[nested](guide.md#other-sponsors)',
    '[explicit](guide.md#chosen)',
    '[fenced](guide.md#fenced-heading)',
    '[explicit text](guide.md#explicit-text)',
    '[missing](guide.md#absent)', ''
  ].join('\n'));
  const result = await check({ cwd: root, paths: ['README.md'] });
  assert.equal(result.complete, true);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.findings.map(({ line, message }) => ({ line, message })), [
    { line: 4, message: 'Missing local anchor: #fenced-heading.' },
    { line: 5, message: 'Missing local anchor: #explicit-text.' },
    { line: 6, message: 'Missing local anchor: #absent.' }
  ]);
});

test('HTML heading text that cannot be statically derived never proves an anchor absent', async (t) => {
  for (const content of [
    '<h3>\nTechnology Sponsors\n</h3>\n',
    '<h3>Technology &amp; Sponsors</h3>\n',
    '<h3>{title}</h3>\n'
  ]) {
    const root = temp(t);
    fs.writeFileSync(path.join(root, 'guide.md'), content);
    fs.writeFileSync(path.join(root, 'README.md'), '[anchor](guide.md#rendered-heading)\n');
    const result = await check({ cwd: root, paths: ['README.md'] });
    assert.equal(result.complete, false);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.diagnostics.map(({ code }) => code), ['evidence-source-unavailable']);
  }
});
