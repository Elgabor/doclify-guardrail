import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { check } from '../src/api.mjs';
import { createResult } from '../src/result.mjs';
import { renderResult } from '../src/result-renderers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'index.mjs');
const PACKAGE_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function makeTempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-beta2-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function runCli(args, cwd, input) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: { LANG: 'C', LC_ALL: 'C', NO_COLOR: '1', PATH: process.env.PATH || '' }
  });
}

test('npm-style binary symlink invokes the CLI entrypoint', { skip: process.platform === 'win32' }, (t) => {
  const cwd = makeTempDir(t);
  const bin = path.join(cwd, 'doclify-guardrail');
  fs.symlinkSync(CLI, bin);

  const run = spawnSync(bin, ['--version'], {
    cwd,
    encoding: 'utf8',
    env: { LANG: 'C', LC_ALL: 'C', NO_COLOR: '1', PATH: process.env.PATH || '' }
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, `${PACKAGE_VERSION}\n`);
});

function writeRepository(root) {
  fs.mkdirSync(path.join(root, 'packages', 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'root', workspaces: ['packages/*'], scripts: { test: 'node --test' }
  }), 'utf8');
  fs.writeFileSync(path.join(root, 'packages', 'app', 'package.json'), JSON.stringify({
    name: '@scope/app', scripts: { build: 'node build.mjs' }
  }), 'utf8');
  fs.writeFileSync(path.join(root, 'Makefile'), 'check:\n\t@true\n', 'utf8');
  fs.writeFileSync(path.join(root, 'guide.md'), '# Guide\n\n## Existing\n', 'utf8');
}

test('beta.2 classifies all document purposes with config taking precedence', async (t) => {
  const cwd = makeTempDir(t);
  writeRepository(cwd);
  fs.mkdirSync(path.join(cwd, 'docs'));
  fs.mkdirSync(path.join(cwd, 'plan'));
  fs.writeFileSync(path.join(cwd, 'README.md'), '# Readme\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'CHANGELOG.md'), '# Changes\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'AGENTS.md'), '# Instructions\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'ROADMAP.md'), '# Roadmap\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'plan', 'notes.md'), '# Plan notes\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'docs', 'guide.md'), '# Guide\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'note.generated.md'), '# Generated\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'docs', 'component.mdx'), '# Component\n', 'utf8');
  fs.writeFileSync(path.join(cwd, '.doclify-guardrail.json'), JSON.stringify({ purpose: 'fragment' }), 'utf8');

  const configured = await check({ cwd, paths: ['README.md'] });
  assert.equal(configured.files[0].purpose, 'fragment');
  fs.unlinkSync(path.join(cwd, '.doclify-guardrail.json'));
  const result = await check({ cwd, paths: ['README.md', 'CHANGELOG.md', 'AGENTS.md', 'ROADMAP.md', 'plan/notes.md', 'docs/guide.md', 'docs/component.mdx', 'note.generated.md'] });
  assert.deepEqual(result.files.map((file) => [file.path, file.purpose]), [
    ['AGENTS.md', 'instructions'],
    ['CHANGELOG.md', 'changelog'],
    ['README.md', 'published'],
    ['ROADMAP.md', 'plan'],
    ['docs/component.mdx', 'fragment'],
    ['docs/guide.md', 'published'],
    ['note.generated.md', 'generated'],
    ['plan/notes.md', 'plan']
  ]);
});

test('beta.2 blocks only static, reproducible repository claim failures', async (t) => {
  const cwd = makeTempDir(t);
  writeRepository(cwd);
  fs.writeFileSync(path.join(cwd, 'README.md'), [
    '# Readme', '',
    'Run `npm run missing`.',
    'Run `npm --workspace @scope/missing run build`.',
    'Run `npm --workspace @scope/app run missing`.',
    'Run `make missing`.',
    'Run `doclify-guardrail review --bogus`.',
    '[broken](missing.md)',
    '[anchor](guide.md#missing)',
    '[valid](guide.md#existing)', ''
  ].join('\n'), 'utf8');

  const result = await check({ cwd, paths: ['README.md'] });
  assert.equal(result.status, 'fail');
  assert.deepEqual(new Set(result.findings.map((finding) => finding.ruleId)), new Set([
    'package-script', 'workspace-package', 'make-target', 'cli-contract', 'local-link'
  ]));
  assert.equal(result.findings.every((finding) => finding.severity === 'blocking' && finding.confidence === 'verified' && finding.evidence), true);
  assert.match(result.findings.find((finding) => finding.ruleId === 'package-script').evidence.source, /package\.json/);
  assert.equal(result.findings.some((finding) => finding.message.includes('Existing')), false);
});

test('make-target ignores assignments and checks options, directories, and every explicit target', async (t) => {
  const cwd = makeTempDir(t);
  writeRepository(cwd);
  fs.appendFileSync(path.join(cwd, 'Makefile'), 'deploy:\n\t@true\n');
  fs.mkdirSync(path.join(cwd, 'tools'));
  fs.writeFileSync(path.join(cwd, 'tools', 'Makefile'), 'build:\n\t@true\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'README.md'), [
    '# Make', '',
    '`make BUILD_TLS=yes`',
    '`make CFLAGS="-O2 -g"`',
    '`make MALLOC=libc`',
    '`make PREFIX=/opt/redis-deploy`',
    '`make check doclify-definitely-missing`',
    '`make -j8 doclify-definitely-missing`',
    '`make -C tools build`',
    '`make -C tools doclify-definitely-missing`',
    '`make BUILD_TLS=yes doclify-definitely-missing`', ''
  ].join('\n'), 'utf8');

  const result = await check({ cwd, paths: ['README.md'] });
  const findings = result.findings.filter((finding) => finding.ruleId === 'make-target');
  assert.equal(findings.length, 4);
  assert.equal(findings.every((finding) => finding.message.includes('doclify-definitely-missing')), true);
  assert.equal(findings.some((finding) => /BUILD_TLS|CFLAGS|MALLOC|PREFIX/.test(finding.message)), false);
  assert.equal(findings.some((finding) => finding.evidence.source === 'tools/Makefile'), true);
});

test('make-target stays conservative for dynamic rules, includes, assignments, and eval', async (t) => {
  for (const dynamicRule of [
    '.DEFAULT:\n\t@true\n',
    '%-generated:\n\t@true\n',
    'include targets.mk\n',
    'VALUE := not-a-target\n'
  ]) {
    const cwd = makeTempDir(t);
    writeRepository(cwd);
    fs.appendFileSync(path.join(cwd, 'Makefile'), dynamicRule);
    const command = dynamicRule.startsWith('VALUE') ? 'make VALUE' : 'make dynamic-generated';
    fs.writeFileSync(path.join(cwd, 'README.md'), `# Make\n\n\`${command}\`\n`, 'utf8');
    const result = await check({ cwd, paths: ['README.md'] });
    const findings = result.findings.filter((finding) => finding.ruleId === 'make-target');
    if (dynamicRule.startsWith('VALUE')) {
      assert.equal(findings.length, 1);
      assert.match(findings[0].message, /VALUE/);
    } else {
      assert.deepEqual(findings, []);
    }
  }

  const cwd = makeTempDir(t);
  writeRepository(cwd);
  fs.writeFileSync(path.join(cwd, 'README.md'), '# Make\n\n`make --eval="dynamic: ; @true" dynamic`\n', 'utf8');
  const result = await check({ cwd, paths: ['README.md'] });
  assert.deepEqual(result.findings.filter((finding) => finding.ruleId === 'make-target'), []);
});

test('cli-contract validates complete invocations with the runtime command grammar', async (t) => {
  const cwd = makeTempDir(t);
  writeRepository(cwd);
  fs.writeFileSync(path.join(cwd, 'README.md'), [
    '# CLI', '',
    '`doclify-guardrail changed --stdin-name README.md`',
    '`doclify-guardrail check --base HEAD`',
    '`doclify-guardrail explain --format json`',
    '`doclify-guardrail init --external-links`',
    '`doclify-guardrail changed --base HEAD --staged`',
    '`doclify-guardrail changed`',
    '`doclify-guardrail check README.md --format json`',
    '`doclify-guardrail changed --base HEAD`',
    '`doclify-guardrail explain local-link`',
    '`doclify-guardrail init --print`',
    '`doclify-guardrail <command> [options]`',
    '`doclify-guardrail@next`',
    '`Elgabor/doclify-guardrail/action@v2`',
    '`.doclify-guardrail.json`', ''
  ].join('\n'), 'utf8');

  const result = await check({ cwd, paths: ['README.md'] });
  assert.equal(result.findings.filter((finding) => finding.ruleId === 'cli-contract').length, 6);
});

test('beta.2 leaves ordinary prose and unsupported claims unverified rather than failing', async (t) => {
  const cwd = makeTempDir(t);
  fs.writeFileSync(path.join(cwd, 'README.md'), '# Readme\n\nRun make missing after deployment. The service has an unsupported flag.\n', 'utf8');
  const result = await check({ cwd, paths: ['README.md'] });
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.findings, []);
});

test('beta.2 reports a root-relative link without siteRoot as advisory rather than a false failure', async (t) => {
  const cwd = makeTempDir(t);
  fs.writeFileSync(path.join(cwd, 'README.md'), '# Readme\n\n[guide](/docs/guide.md)\n', 'utf8');
  const result = await check({ cwd, paths: ['README.md'] });
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.findings.map(({ ruleId, severity, confidence, evidence }) => ({ ruleId, severity, confidence, evidence })), [
    { ruleId: 'local-link', severity: 'advisory', confidence: 'unverified', evidence: null }
  ]);
});

test('beta.2 keeps an explicitly requested remote-link failure advisory and complete', async (t) => {
  const cwd = makeTempDir(t);
  fs.writeFileSync(path.join(cwd, 'README.md'), '# Readme\n\n[private](http://127.0.0.1/private)\n', 'utf8');
  const result = await check({ cwd, paths: ['README.md'], externalLinks: true });
  assert.equal(result.status, 'pass');
  assert.equal(result.complete, true);
  assert.deepEqual(result.findings.map(({ ruleId, severity, confidence, evidence }) => ({ ruleId, severity, confidence, evidence })), [
    { ruleId: 'external-link', severity: 'advisory', confidence: 'unverified', evidence: null }
  ]);
});

test('beta.2 keeps generated documents out of repository-command checks', async (t) => {
  const cwd = makeTempDir(t);
  fs.writeFileSync(path.join(cwd, 'notes.generated.md'), '# Generated\n\n`npm run missing`\n', 'utf8');
  const result = await check({ cwd, paths: ['notes.generated.md'] });
  assert.equal(result.files[0].purpose, 'generated');
  assert.deepEqual(result.findings, []);
});

test('beta.2 respects inline suppressions for evidence rules', async (t) => {
  const cwd = makeTempDir(t);
  writeRepository(cwd);
  fs.writeFileSync(path.join(cwd, 'README.md'), '# Readme\n\n<!-- doclify-disable-next-line package-script -->\n`npm run missing`\n', 'utf8');
  const result = await check({ cwd, paths: ['README.md'] });
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.files[0].suppressions, [{ scope: 'next-line', rules: ['package-script'], line: 3 }]);
});

test('beta.2 stdin is equivalent to a named document and remains workspace-contained', async (t) => {
  const cwd = makeTempDir(t);
  writeRepository(cwd);
  const content = '# Readme\n\n`npm run missing`\n';
  fs.writeFileSync(path.join(cwd, 'README.md'), content, 'utf8');
  const disk = await check({ cwd, paths: ['README.md'] });
  const stdin = runCli(['check', '-', '--stdin-name', 'README.md', '--format', 'json'], cwd, content);
  assert.equal(stdin.status, 1, stdin.stderr);
  assert.deepEqual(JSON.parse(stdin.stdout), disk);
  const escaped = runCli(['check', '-', '--stdin-name', '../README.md'], cwd, content);
  assert.equal(escaped.status, 2);
  assert.match(escaped.stderr, /^stdin-name-outside-workspace:/);
});

test('beta.2 explains rules, initializes explicitly, and rejects removed surfaces', (t) => {
  const cwd = makeTempDir(t);
  const explained = runCli(['explain', 'package-script'], cwd);
  assert.equal(explained.status, 0, explained.stderr);
  assert.match(explained.stdout, /static package manifest index/);
  const printed = runCli(['init', '--print'], cwd);
  assert.equal(printed.status, 0, printed.stderr);
  assert.deepEqual(JSON.parse(printed.stdout), { ignoreRules: [] });
  const written = runCli(['init', '--write'], cwd);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(fs.existsSync(path.join(cwd, '.doclify-guardrail.json')), true);
  const repeated = runCli(['init', '--write'], cwd);
  assert.equal(repeated.status, 2);
  assert.match(repeated.stderr, /^config-exists:/);
  const removed = runCli(['--fix'], cwd);
  assert.equal(removed.status, 2);
  assert.match(removed.stderr, /^legacy-option: --fix was removed in v2/);
});

test('beta.2 result and machine renderers keep purpose and evidence deterministic', () => {
  const result = createResult({
    toolVersion: '2.0.0-test', command: 'check',
    files: [{ path: 'README.md', purpose: 'published', scanned: true, findings: 1, suppressions: [] }],
    findings: [{ ruleId: 'local-link', severity: 'blocking', confidence: 'verified', path: 'README.md', line: 3, column: null, message: 'Broken.', evidence: { fact: 'Missing file.', source: 'missing.md' } }],
    diagnostics: []
  });
  const json = JSON.parse(renderResult(result, { format: 'json' }));
  assert.equal(json.files[0].purpose, 'published');
  assert.deepEqual(json.findings[0].evidence, { fact: 'Missing file.', source: 'missing.md' });
  assert.match(renderResult(result, { format: 'sarif' }), /"confidence": "verified"/);
  assert.match(renderResult(result, { format: 'junit' }), /local-link/);
});
