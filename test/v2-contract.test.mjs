import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { check } from '../src/api.mjs';
import { checkDeadLinksDetailed } from '../src/links.mjs';
import { createResult } from '../src/result.mjs';
import { renderResult, terminalText } from '../src/result-renderers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'index.mjs');
const GOLDEN_DIR = path.join(ROOT, 'test', 'golden');

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-v2-contract-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      LANG: 'C',
      LC_ALL: 'C',
      NO_COLOR: '1',
      PATH: process.env.PATH || '',
      TMPDIR: process.env.TMPDIR || '',
      TMP: process.env.TMP || '',
      TEMP: process.env.TEMP || ''
    }
  });
}

function readGolden(name) {
  return fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8');
}

function contractResult() {
  return createResult({
    toolVersion: '2.0.0-test',
    command: 'check',
    files: [
      { path: 'z-clean.md', scanned: true, findings: 0, suppressions: [] },
      {
        path: 'b-suppressed.md',
        scanned: true,
        findings: 1,
        suppressions: [{ scope: 'file', rules: null, line: 1 }]
      },
      { path: 'a-broken.md', scanned: true, findings: 1, suppressions: [] },
      { path: 'locked.md', scanned: false, findings: null, suppressions: [] }
    ],
    findings: [
      {
        ruleId: 'placeholder',
        severity: 'advisory',
        confidence: 'unverified',
        path: 'b-suppressed.md',
        line: 4,
        column: null,
        message: 'Placeholder found.',
        evidence: null
      },
      {
        ruleId: 'single-h1',
        severity: 'blocking',
        confidence: 'high',
        path: 'a-broken.md',
        line: 1,
        column: null,
        message: 'Missing H1 heading.',
        evidence: {
          fact: 'No H1 heading was found.',
          source: 'a-broken.md:1'
        }
      }
    ],
    diagnostics: [
      {
        code: 'file-unreadable',
        severity: 'error',
        path: 'locked.md',
        message: 'Unable to read file (EACCES).'
      }
    ]
  });
}

test('v2 result is deterministic, flat, and distinguishes incomplete scans', () => {
  const result = contractResult();

  assert.equal(result.schemaVersion, 3);
  assert.equal(result.complete, false);
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.files.map((file) => file.path), [
    'a-broken.md',
    'b-suppressed.md',
    'locked.md',
    'z-clean.md'
  ]);
  assert.deepEqual(result.findings.map((finding) => `${finding.path}:${finding.line}:${finding.ruleId}`), [
    'a-broken.md:1:single-h1',
    'b-suppressed.md:4:placeholder'
  ]);
  assert.deepEqual(result.summary, {
    filesSelected: 4,
    filesScanned: 3,
    filesSkipped: 1,
    blocking: 1,
    advisory: 1,
    diagnostics: 1,
    filesWithSuppressions: 1
  });
});

test('v2 terminal output escapes control and bidirectional formatting characters', () => {
  assert.equal(terminalText('safe\u001b[31m\u202etext'), 'safe\\u001b[31m\\u202etext');
});

test('v2 --no-color remains a color-free compatibility option', (t) => {
  const cwd = makeTempDir(t);
  fs.writeFileSync(path.join(cwd, 'doc.md'), '# Clean\n', 'utf8');

  const regular = runCli(['check', 'doc.md'], cwd);
  const noColor = runCli(['check', 'doc.md', '--no-color'], cwd);
  assert.equal(noColor.status, 0, noColor.stderr);
  assert.equal(noColor.stderr, '');
  assert.equal(noColor.stdout, regular.stdout);
  assert.doesNotMatch(noColor.stdout, /\u001b\[/);
});

for (const format of ['text', 'json', 'sarif', 'junit']) {
  test(`v2 ${format} renderer matches its golden contract`, () => {
    assert.equal(renderResult(contractResult(), { format }), readGolden(`v2-result.${format}`));
  });
}

test('v2 human output is bounded while machine formats stay complete', () => {
  const findings = Array.from({ length: 55 }, (_, index) => ({
    ruleId: 'placeholder',
    severity: 'advisory',
    confidence: 'unverified',
    path: 'many.md',
    line: index + 1,
    column: null,
    message: `Placeholder ${index + 1}.`,
    evidence: null
  }));
  const files = [{ path: 'many.md', scanned: true, findings: 55, suppressions: [] }];
  findings[54].severity = 'blocking';
  const result = createResult({ toolVersion: '2.0.0-test', command: 'check', files, findings, diagnostics: [] });
  const compact = renderResult(result, { format: 'compact' });
  const completeCompact = renderResult(result, { format: 'compact', all: true });

  assert.equal(result.findings.length, 55);
  assert.equal(result.summary.advisory, 54);
  assert.equal(result.summary.blocking, 1);
  assert.equal(result.files[0].findings, 55);
  assert.equal((compact.match(/\[placeholder\]/g) || []).length, 50);
  assert.match(compact, /5 findings omitted; rerun with --all/);
  assert.equal((completeCompact.match(/\[placeholder\]/g) || []).length, 55);
  assert.doesNotMatch(completeCompact, /findings omitted/);
  assert.equal(JSON.parse(renderResult(result, { format: 'json' })).findings.length, 55);
  assert.equal(JSON.parse(renderResult(result, { format: 'sarif' })).runs[0].results.length, 55);
  assert.match(renderResult(result, { format: 'junit' }), /tests="1" failures="1" errors="0"/);
  assert.match(renderResult(result, { format: 'junit' }), /Placeholder 55\./);
});

test('v2 CLI and API return the same schemaVersion 3 result', async (t) => {
  const cwd = makeTempDir(t);
  fs.writeFileSync(path.join(cwd, 'doc.md'), 'Body without a heading.\n', 'utf8');

  const apiResult = await check({ cwd, paths: ['doc.md'] });
  const cli = runCli(['check', 'doc.md', '--format', 'json'], cwd);

  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stderr, '');
  assert.deepEqual(JSON.parse(cli.stdout), apiResult);
  assert.equal(apiResult.schemaVersion, 3);
  assert.equal(apiResult.findings[0].severity, 'advisory');
  assert.equal(apiResult.findings[0].confidence, 'unverified');
  assert.equal(apiResult.findings[0].evidence, null);
});

test('v2 partial scan returns a structured incomplete result and exit 1', async (t) => {
  const cwd = makeTempDir(t);
  fs.writeFileSync(path.join(cwd, 'clean.md'), '# Clean\n', 'utf8');

  const apiResult = await check({ cwd, paths: ['clean.md', 'missing.md'] });
  const cli = runCli(['check', 'clean.md', 'missing.md', '--format', 'json', '--all'], cwd);

  assert.equal(apiResult.complete, false);
  assert.equal(apiResult.status, 'incomplete');
  assert.equal(apiResult.summary.blocking, 0);
  assert.equal(apiResult.diagnostics[0].code, 'file-unreadable');
  assert.equal(apiResult.files.find((file) => file.path === 'missing.md').findings, null);
  assert.equal(cli.status, 1, cli.stderr);
  assert.equal(cli.stderr, '');
  assert.deepEqual(JSON.parse(cli.stdout), apiResult);
});

test('v2 unreadable targets stay structured while empty scans and invalid usage exit 2', async (t) => {
  const cwd = makeTempDir(t);

  const missing = runCli(['check', 'missing.md', '--format', 'json'], cwd);
  assert.equal(missing.status, 1, missing.stderr);
  assert.equal(missing.stderr, '');
  const missingResult = JSON.parse(missing.stdout);
  assert.equal(missingResult.status, 'incomplete');
  assert.equal(missingResult.files[0].scanned, false);
  assert.equal(missingResult.diagnostics[0].code, 'file-unreadable');

  const empty = runCli(['check', '.', '--format', 'json'], cwd);
  assert.equal(empty.status, 2);
  assert.equal(empty.stdout, '');
  assert.match(empty.stderr, /^scan-failed:/);

  const legacyFlag = runCli(['check', '--json'], cwd);
  assert.equal(legacyFlag.status, 2);
  assert.equal(legacyFlag.stdout, '');
  assert.match(legacyFlag.stderr, /Use --format json/);

  await assert.rejects(
    check({ cwd, paths: ['.'], config: '.doclify-guardrail.json' }),
    (error) => error?.name === 'DoclifyUsageError' && error?.code === 'config-not-found'
  );
  const config = runCli(['check', '.', '--config', '.doclify-guardrail.json'], cwd);
  assert.equal(config.status, 2);
  assert.equal(config.stdout, '');
  assert.match(config.stderr, /^config-not-found:/);
});

test('v2 unmatched targets cannot be hidden by a clean target', async (t) => {
  const cwd = makeTempDir(t);
  fs.writeFileSync(path.join(cwd, 'clean.md'), '# Clean\n', 'utf8');

  const result = await check({ cwd, paths: ['clean.md', 'missing/**/*.md'] });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.complete, false);
  assert.equal(result.diagnostics[0].code, 'target-unmatched');
});

test('v2 suppression metadata distinguishes a fully suppressed file from a clean file', async (t) => {
  const cwd = makeTempDir(t);
  fs.writeFileSync(path.join(cwd, 'clean.md'), '# Clean\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'suppressed.md'), '<!-- doclify-disable-file -->\nNo heading.\n', 'utf8');
  fs.writeFileSync(
    path.join(cwd, 'fenced.md'),
    '# Fenced\r\n\r\n```md\r\n<!-- doclify-disable-file -->\r\n```\r\n',
    'utf8'
  );

  const result = await check({ cwd, paths: ['suppressed.md', 'clean.md', 'fenced.md'] });
  const clean = result.files.find((file) => file.path === 'clean.md');
  const suppressed = result.files.find((file) => file.path === 'suppressed.md');
  const fenced = result.files.find((file) => file.path === 'fenced.md');

  assert.deepEqual(clean.suppressions, []);
  assert.deepEqual(suppressed.suppressions, [{ scope: 'file', rules: null, line: 1 }]);
  assert.deepEqual(fenced.suppressions, []);
  assert.equal(result.summary.filesWithSuppressions, 1);
});

test('v2 suppression metadata follows checker fence and rule-list semantics', async (t) => {
  const cwd = makeTempDir(t);
  fs.writeFileSync(
    path.join(cwd, 'directives.md'),
    '# Directives\r\n\r\n<!-- doclify-disable-next-line placeholder -->\r\nTODO later.\r\n<!-- doclify-disable single-h1, placeholder -->\r\nText.\r\n<!-- doclify-enable single-h1 placeholder -->\r\n',
    'utf8'
  );

  const result = await check({ cwd, paths: ['directives.md'] });
  assert.deepEqual(result.files[0].suppressions, [
    { scope: 'next-line', rules: ['placeholder'], line: 3 },
    { scope: 'block-start', rules: ['placeholder', 'single-h1'], line: 5 },
    { scope: 'block-end', rules: ['placeholder', 'single-h1'], line: 7 }
  ]);
  assert.equal(result.findings.some((finding) => finding.ruleId === 'placeholder' && finding.line === 4), false);
});

test('v2 local link checks remain offline unless external links are explicit', async (t) => {
  const cwd = makeTempDir(t);
  const sourceFile = path.join(cwd, 'doc.md');
  const { findings, stats } = await checkDeadLinksDetailed(
    '[missing](missing.md) [remote](https://example.com)',
    {
      sourceFile,
      checkRemote: false,
      requestFn: () => {
        throw new Error('remote request must not run');
      }
    }
  );

  assert.equal(findings.some((finding) => finding.code === 'dead-link'), true);
  assert.equal(findings.some((finding) => finding.message.includes('example.com')), false);
  assert.equal(stats.remoteLinksChecked, 0);
});

test('v2 directory selection is deterministically sorted', async (t) => {
  const cwd = makeTempDir(t);
  for (const name of ['zeta.md', 'alpha.md', 'mike.md', 'bravo.md']) {
    fs.writeFileSync(path.join(cwd, name), `# ${name}\n`, 'utf8');
  }

  const result = await check({ cwd, paths: ['.'] });
  assert.deepEqual(result.files.map((file) => file.path), [
    'alpha.md',
    'bravo.md',
    'mike.md',
    'zeta.md'
  ]);
});

test('v2 machine formats emit one document with no human logs', (t) => {
  const cwd = makeTempDir(t);
  fs.writeFileSync(path.join(cwd, 'doc.md'), '# Clean\n', 'utf8');

  for (const format of ['json', 'sarif', 'junit']) {
    const run = runCli(['check', 'doc.md', '--format', format], cwd);
    assert.equal(run.status, 0, `${format}: ${run.stderr}`);
    assert.equal(run.stderr, '', format);
    if (format === 'junit') {
      assert.match(run.stdout, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<testsuite/);
      assert.equal((run.stdout.match(/<\?xml/g) || []).length, 1);
    } else {
      assert.doesNotThrow(() => JSON.parse(run.stdout), format);
      assert.equal(run.stdout.trim().split('\nDoclify Guardrail').length, 1);
    }
  }
});

test('v2 CLI flushes a large complete machine document before exiting', (t) => {
  const cwd = makeTempDir(t);
  const placeholders = Array.from({ length: 1500 }, (_, index) => `TODO item ${index + 1}`).join('\n');
  fs.writeFileSync(path.join(cwd, 'many.md'), `# Many\n\n${placeholders}\n`, 'utf8');

  const run = runCli(['check', 'many.md', '--format', 'json'], cwd);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  assert.ok(run.stdout.length > 65_536, `expected output larger than a pipe buffer, got ${run.stdout.length}`);
  const result = JSON.parse(run.stdout);
  assert.equal(result.findings.length, result.summary.advisory);
  assert.ok(result.findings.length >= 1500);
});

test('v2 --output is explicit and contained in the workspace', (t) => {
  const cwd = makeTempDir(t);
  fs.writeFileSync(path.join(cwd, 'doc.md'), '# Clean\n', 'utf8');

  const inside = runCli(['check', 'doc.md', '--format', 'json', '--output', 'out/result.json'], cwd);
  assert.equal(inside.status, 0, inside.stderr);
  assert.equal(inside.stdout, '');
  assert.equal(inside.stderr, '');
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'out', 'result.json'), 'utf8')).schemaVersion, 3);

  const outside = runCli(['check', 'doc.md', '--format', 'json', '--output', '../result.json'], cwd);
  assert.equal(outside.status, 2);
  assert.equal(outside.stdout, '');
  assert.match(outside.stderr, /^output-outside-workspace:/);
});

test('v2 --output cannot overwrite a scanned file through a symlink', (t) => {
  const cwd = makeTempDir(t);
  const documentPath = path.join(cwd, 'doc.md');
  fs.writeFileSync(documentPath, '# Clean\n', 'utf8');
  fs.symlinkSync(documentPath, path.join(cwd, 'result.json'));

  const run = runCli(['check', 'doc.md', '--format', 'json', '--output', 'result.json'], cwd);
  assert.equal(run.status, 2);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /^output-overwrites-input:/);
  assert.equal(fs.readFileSync(documentPath, 'utf8'), '# Clean\n');
});

test('v2 paths cannot cross the workspace through symlinks', async (t) => {
  const cwd = makeTempDir(t);
  const outside = makeTempDir(t);
  fs.mkdirSync(path.join(cwd, 'docs'));
  fs.mkdirSync(path.join(cwd, 'shared-dir'));
  fs.writeFileSync(path.join(cwd, 'doc.md'), '# Clean\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'shared.md'), 'Body without a heading.\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'shared-dir', 'note.md'), '# Shared\n', 'utf8');
  fs.writeFileSync(path.join(outside, 'outside.md'), '# Outside\n', 'utf8');
  fs.symlinkSync('../shared.md', path.join(cwd, 'docs', 'linked.md'));
  fs.symlinkSync(outside, path.join(cwd, 'outside-dir'));
  fs.symlinkSync(path.join(outside, 'outside.md'), path.join(cwd, 'outside.md'));

  const internal = await check({ cwd, paths: ['docs'] });
  assert.equal(internal.complete, true);
  assert.deepEqual(internal.files.map((file) => file.path), ['docs/linked.md']);
  assert.equal(internal.findings.length, 1);
  fs.symlinkSync('../shared-dir', path.join(cwd, 'docs', 'linked-dir'));
  fs.symlinkSync('./missing.txt', path.join(cwd, 'docs', 'broken.txt'));
  fs.symlinkSync('./gone.md', path.join(cwd, 'docs', 'broken.md'));

  const lexicalDirectory = await check({ cwd, paths: ['docs'], exclude: ['docs/broken.md'] });
  assert.equal(lexicalDirectory.complete, true);
  assert.deepEqual(lexicalDirectory.files.map((file) => file.path), ['docs/linked.md']);

  const brokenMarkdown = await check({ cwd, paths: ['docs'] });
  assert.equal(brokenMarkdown.complete, false);
  assert.equal(
    brokenMarkdown.diagnostics.some(
      (diagnostic) => diagnostic.code === 'target-unreadable' && diagnostic.path === 'docs/broken.md'
    ),
    true
  );

  const output = runCli([
    'check',
    'doc.md',
    '--format',
    'json',
    '--output',
    'outside-dir/new/result.json'
  ], cwd);
  assert.equal(output.status, 2);
  assert.equal(output.stdout, '');
  assert.match(output.stderr, /^output-outside-workspace:/);
  assert.equal(fs.existsSync(path.join(outside, 'new', 'result.json')), false);

  await assert.rejects(
    check({ cwd, paths: ['outside.md'] }),
    (error) => error?.name === 'DoclifyUsageError' && error?.code === 'target-outside-workspace'
  );

  const linkedDirectory = await check({
    cwd,
    paths: ['.'],
    exclude: ['outside-dir', 'outside.md', 'docs/broken.md']
  });
  assert.equal(linkedDirectory.complete, true);
  assert.equal(linkedDirectory.files.some((file) => file.path === 'shared-dir/note.md'), true);
  assert.equal(linkedDirectory.files.some((file) => file.path.startsWith('docs/linked-dir/')), false);
});

test('v2 glob prefixes cannot escape the workspace', async (t) => {
  const cwd = makeTempDir(t);
  await assert.rejects(
    check({ cwd, paths: ['../**/*.md'] }),
    (error) => error?.name === 'DoclifyUsageError' && error?.code === 'target-outside-workspace'
  );
});

test('v2 changed grammar requires exactly one selector', (t) => {
  const cwd = makeTempDir(t);
  const missing = runCli(['changed', '--format', 'json'], cwd);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /exactly one of --base or --staged/);

  const both = runCli(['changed', '--base', 'HEAD', '--staged', '--format', 'json'], cwd);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /exactly one of --base or --staged/);
});

test('v2 changed scans a root-level Git diff through the shared result model', (t) => {
  const cwd = makeTempDir(t);
  const git = (...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);
  assert.equal(git('config', 'user.email', 'fixture@example.invalid').status, 0);
  assert.equal(git('config', 'user.name', 'Fixture').status, 0);
  fs.writeFileSync(path.join(cwd, 'doc.md'), '# Original\n', 'utf8');
  assert.equal(git('add', 'doc.md').status, 0);
  assert.equal(git('commit', '-qm', 'fixture').status, 0);
  fs.writeFileSync(path.join(cwd, 'doc.md'), '# Changed\n', 'utf8');

  const run = runCli(['changed', '--base', 'HEAD', '--format', 'json', '--all'], cwd);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  const result = JSON.parse(run.stdout);
  assert.equal(result.schemaVersion, 3);
  assert.equal(result.command, 'changed');
  assert.deepEqual(result.files.map((file) => file.path), ['doc.md']);
});
