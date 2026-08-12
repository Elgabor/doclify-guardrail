import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { check } from '../src/api.mjs';
import { COMMANDS, FLAGS, SCAN_FLAGS, validateCliInvocation } from '../src/cli-contract.mjs';
import { createResult } from '../src/result.mjs';
import { renderResult, terminalText } from '../src/result-renderers.mjs';
import { parseV2Args, renderV2Help } from '../src/v2-command.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'index.mjs');

function temp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-output-contract-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8', env: { LANG: 'C', LC_ALL: 'C', NO_COLOR: '1', PATH: process.env.PATH || '' }
  });
}

test('v2 parser, help, and documentation checker share one scan surface', () => {
  const invocations = new Map([
    ['--format', ['check', 'doc.md', '--format', 'json']],
    ['--output', ['check', 'doc.md', '--output', 'result.json']],
    ['--all', ['check', 'doc.md', '--all']],
    ['--ignore-rules', ['check', 'doc.md', '--ignore-rules', 'local-link']],
    ['--exclude', ['check', 'doc.md', '--exclude', 'drafts']],
    ['--config', ['check', 'doc.md', '--config', 'config.json']],
    ['--purpose', ['check', 'doc.md', '--purpose', 'published']],
    ['--site-root', ['check', 'doc.md', '--site-root', 'site']],
    ['--external-links', ['check', 'doc.md', '--external-links']],
    ['--link-allow-list', ['check', 'doc.md', '--link-allow-list', 'https://example.test']],
    ['--link-timeout-ms', ['check', 'doc.md', '--link-timeout-ms', '100']],
    ['--link-concurrency', ['check', 'doc.md', '--link-concurrency', '2']],
    ['--stdin-name', ['check', '-', '--stdin-name', 'doc.md']],
    ['--no-color', ['check', 'doc.md', '--no-color']],
    ['--base', ['changed', '--base', 'HEAD~1']],
    ['--staged', ['changed', '--staged']],
    ['--help', ['check', '--help']],
    ['-h', ['check', '-h']]
  ]);

  assert.deepEqual(new Set(invocations.keys()), SCAN_FLAGS);
  for (const [flag, argv] of invocations) {
    assert.doesNotThrow(() => parseV2Args(argv), flag);
    if (flag.startsWith('--') && !['--base', '--staged', '--help'].includes(flag)) {
      assert.match(renderV2Help('check'), new RegExp(`^  ${flag}(?: |$)`, 'm'));
    }
  }

  for (const argv of [
    ['check', 'doc.md', '--base', 'HEAD~1'],
    ['check', 'doc.md', '--staged'],
    ['changed', '--base', 'HEAD~1', '--stdin-name', 'doc.md']
  ]) {
    assert.throws(() => parseV2Args(argv), (error) => error?.code === 'invalid-option');
  }

  const topLevelHelp = run(['--help'], ROOT);
  assert.equal(topLevelHelp.status, 0, topLevelHelp.stderr);
  for (const command of COMMANDS) assert.match(topLevelHelp.stdout, new RegExp(`doclify-guardrail ${command}`));

  const nonScanInvocations = new Map([
    ['--print', ['init', '--print']],
    ['--write', ['init', '--write']],
    ['--version', ['--version']],
    ['-v', ['-v']]
  ]);
  assert.deepEqual(new Set([...SCAN_FLAGS, ...nonScanInvocations.keys()]), FLAGS);
  for (const argv of nonScanInvocations.values()) {
    const cwd = argv.includes('--write') ? fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-init-contract-')) : ROOT;
    try {
      const result = run(argv, cwd);
      assert.equal(result.status, 0, result.stderr);
    } finally {
      if (cwd !== ROOT) fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('command help and invocation validation are command-aware', () => {
  const expectedFlags = new Map([
    ['check', [
      '--format', '--output', '--all', '--ignore-rules', '--exclude', '--config', '--purpose',
      '--site-root', '--external-links', '--link-allow-list', '--link-timeout-ms',
      '--link-concurrency', '--no-color', '--stdin-name', '--help'
    ]],
    ['changed', [
      '--format', '--output', '--all', '--ignore-rules', '--exclude', '--config', '--purpose',
      '--site-root', '--external-links', '--link-allow-list', '--link-timeout-ms',
      '--link-concurrency', '--no-color', '--base', '--staged', '--help'
    ]],
    ['explain', ['--help']],
    ['init', ['--print', '--write', '--help']]
  ]);
  for (const [command, flags] of expectedFlags) {
    const result = run([command, '--help'], ROOT);
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.deepEqual([...result.stdout.matchAll(/^  (-{1,2}[a-z][a-z-]*)/gm)].map((match) => match[1]), flags);
  }
  assert.match(run(['check', '--help'], ROOT).stdout, /^doclify-guardrail check \[paths\.\.\.\] \[options\]/);
  assert.match(run(['changed', '--help'], ROOT).stdout, /^doclify-guardrail changed \(--base <ref> \| --staged\) \[options\]/);
  assert.match(run(['explain', '--help'], ROOT).stdout, /^doclify-guardrail explain <rule-id>/);
  assert.match(run(['init', '--help'], ROOT).stdout, /^doclify-guardrail init --print\ndoclify-guardrail init --write/);

  for (const argv of [
    ['changed', '--stdin-name', 'README.md'],
    ['check', '--base', 'HEAD'],
    ['explain', '--format', 'json'],
    ['init', '--external-links'],
    ['changed', '--base', 'HEAD', '--staged'],
    ['changed']
  ]) {
    assert.equal(validateCliInvocation(argv).valid, false, argv.join(' '));
    const result = run(argv, ROOT);
    assert.equal(result.status, 2, argv.join(' '));
  }
});

test('v2 result order, bounded human output, and complete machine output are deterministic', () => {
  const findings = Array.from({ length: 55 }, (_, index) => ({
    ruleId: 'local-link', severity: index === 54 ? 'blocking' : 'advisory', confidence: 'verified',
    path: 'many.md', line: index + 1, column: null, message: `Finding ${index + 1}.`, evidence: { fact: 'fixture', source: 'many.md' }
  }));
  const result = createResult({ toolVersion: '2.0.0-test', command: 'check', files: [
    { path: 'z.md', purpose: 'fragment', scanned: true, findings: 0, suppressions: [] },
    { path: 'many.md', purpose: 'published', scanned: true, findings: 55, suppressions: [] }
  ], findings, diagnostics: [] });
  assert.deepEqual(result.files.map((file) => file.path), ['many.md', 'z.md']);
  assert.equal((renderResult(result, { format: 'compact' }).match(/\[local-link\]/g) || []).length, 50);
  assert.match(renderResult(result, { format: 'compact' }), /5 findings omitted; rerun with --all/);
  assert.equal(JSON.parse(renderResult(result, { format: 'json' })).findings.length, 55);
  assert.equal(JSON.parse(renderResult(result, { format: 'sarif' })).runs[0].results.length, 55);
  assert.match(renderResult(result, { format: 'junit' }), /tests="2" failures="1" errors="0"/);
  assert.equal(terminalText('safe\u001b[31m\u202etext'), 'safe\\u001b[31m\\u202etext');
});

test('v2 machine formats produce one parseable document without human logs', (t) => {
  const cwd = temp(t);
  fs.writeFileSync(path.join(cwd, 'doc.md'), '# Clean\n', 'utf8');
  for (const format of ['json', 'sarif', 'junit']) {
    const result = run(['check', 'doc.md', '--format', format], cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    if (format === 'junit') assert.match(result.stdout, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<testsuite/);
    else assert.doesNotThrow(() => JSON.parse(result.stdout));
  }
});

test('v2 output remains explicit, contained, and cannot replace an input through links', (t) => {
  const cwd = temp(t);
  const document = path.join(cwd, 'doc.md');
  fs.writeFileSync(document, '# Clean\n', 'utf8');
  const inside = run(['check', 'doc.md', '--format', 'json', '--output', 'out/result.json'], cwd);
  assert.equal(inside.status, 0, inside.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'out', 'result.json'), 'utf8')).schemaVersion, 3);
  const repeated = run(['check', 'doc.md', '--format', 'json', '--output', 'out/result.json'], cwd);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'out', 'result.json'), 'utf8')).schemaVersion, 3);
  assert.match(run(['check', 'doc.md', '--format', 'json', '--output', '../result.json'], cwd).stderr, /^output-outside-workspace:/);
  fs.symlinkSync(document, path.join(cwd, 'result.json'));
  const symlink = run(['check', 'doc.md', '--format', 'json', '--output', 'result.json'], cwd);
  assert.match(symlink.stderr, /^output-overwrites-input:/);
  fs.unlinkSync(path.join(cwd, 'result.json'));
  fs.linkSync(document, path.join(cwd, 'result.json'));
  const hardlink = run(['check', 'doc.md', '--format', 'json', '--output', 'result.json'], cwd);
  assert.match(hardlink.stderr, /^output-overwrites-input:/);
  assert.equal(fs.readFileSync(document, 'utf8'), '# Clean\n');

  fs.mkdirSync(path.join(cwd, '.git'));
  fs.writeFileSync(path.join(cwd, '.git', 'config'), 'preserve\n', 'utf8');
  const gitMetadata = run(['check', 'doc.md', '--format', 'json', '--output', '.git/config'], cwd);
  assert.equal(gitMetadata.status, 2);
  assert.match(gitMetadata.stderr, /^output-in-git-directory:/);
  assert.equal(fs.readFileSync(path.join(cwd, '.git', 'config'), 'utf8'), 'preserve\n');

  fs.symlinkSync('.git', path.join(cwd, 'git-alias'), 'dir');
  const gitAlias = run(['check', 'doc.md', '--format', 'json', '--output', 'git-alias/config'], cwd);
  assert.equal(gitAlias.status, 2);
  assert.match(gitAlias.stderr, /^output-in-git-directory:/);
  assert.equal(fs.readFileSync(path.join(cwd, '.git', 'config'), 'utf8'), 'preserve\n');
});

test('v2 output refuses to replace an existing file outside the scan', (t) => {
  const cwd = temp(t);
  fs.mkdirSync(path.join(cwd, 'docs'));
  fs.writeFileSync(path.join(cwd, 'docs', 'doc.md'), '# Clean\n', 'utf8');
  const existing = path.join(cwd, 'README.md');
  fs.writeFileSync(existing, '# Preserve me\n', 'utf8');

  const result = run(['check', 'docs', '--format', 'json', '--output', 'README.md'], cwd);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^output-exists:/);
  assert.equal(fs.readFileSync(existing, 'utf8'), '# Preserve me\n');

  for (const [name, link] of [['linked.json', fs.symlinkSync], ['hardlinked.json', fs.linkSync]]) {
    const output = path.join(cwd, name);
    link(existing, output);
    const linkedResult = run(['check', 'docs', '--format', 'json', '--output', name], cwd);
    assert.equal(linkedResult.status, 0, linkedResult.stderr);
    assert.equal(fs.readFileSync(existing, 'utf8'), '# Preserve me\n');
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).schemaVersion, 3);
  }
});

test('v2 rejects workspace escapes and leaves skipped files without an invented purpose', async (t) => {
  const cwd = temp(t);
  const outside = temp(t);
  fs.writeFileSync(path.join(cwd, 'doc.md'), '# Clean\n', 'utf8');
  fs.writeFileSync(path.join(outside, 'outside.md'), '# Outside\n', 'utf8');
  fs.symlinkSync(path.join(outside, 'outside.md'), path.join(cwd, 'outside.md'));
  await assert.rejects(check({ cwd, paths: ['outside.md'] }), (error) => error?.code === 'target-outside-workspace');
  await assert.rejects(check({ cwd, paths: ['../**/*.md'] }), (error) => error?.code === 'target-outside-workspace');
  const partial = await check({ cwd, paths: ['doc.md', 'missing.md'] });
  assert.equal(partial.files.find((file) => file.path === 'missing.md').purpose, null);
});
