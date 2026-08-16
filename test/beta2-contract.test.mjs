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

test('purpose and root-context policies separate current commands from historical text', async (t) => {
  const cwd = makeTempDir(t);
  fs.mkdirSync(path.join(cwd, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.github'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'packages', 'app'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'tools'));
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
    name: 'purpose-context-fixture',
    workspaces: ['packages/*'],
    scripts: { present: 'true' }
  }), 'utf8');
  fs.writeFileSync(path.join(cwd, 'packages', 'app', 'package.json'), JSON.stringify({
    name: '@scope/app', scripts: { present: 'true' }
  }), 'utf8');
  fs.writeFileSync(path.join(cwd, 'Makefile'), 'present:\n\t@true\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'tools', 'Makefile'), 'present:\n\t@true\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'guide.md'), '# Guide\n## Existing\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'README.md'), '# Root\n\n`npm run missing`\n`npm run present`\n`make missing`\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'docs', 'guide.md'), '# Docs\n\n`npm run missing`\n`make missing`\n`make -C tools missing`\n`make --directory tools missing`\n', 'utf8');
  fs.writeFileSync(path.join(cwd, '.github', 'copilot-instructions.md'), '# Instructions\n\n`npm run missing`\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'ROADMAP.md'), '# Roadmap\n\n`npm run missing`\n`make missing`\n[missing file](absent.md)\n[missing anchor](guide.md#missing)\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'CHANGELOG.md'), [
    '# Changes', '',
    'Historical command: `npm run missing`.',
    'Historical CLI: `doclify-guardrail review --bogus`.',
    '[missing file](absent.md)',
    '[missing anchor](guide.md#missing)', ''
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(cwd, 'packages', 'app', 'README.md'), [
    '# App', '',
    '`npm run missing`',
    '`npm --workspace @scope/app run missing`',
    '`npm --workspace @scope/missing run present`',
    '`npm run missing --workspace @scope/app`',
    '`npm run present --workspace @scope/missing`', ''
  ].join('\n'), 'utf8');

  const root = await check({ cwd, paths: ['README.md'] });
  assert.deepEqual(root.findings.map(({ ruleId, message, evidence }) => ({
    ruleId, message, source: evidence?.source
  })), [
    { ruleId: 'package-script', message: 'Unknown npm script: missing.', source: 'package.json' },
    { ruleId: 'make-target', message: 'Unknown make target: missing.', source: 'Makefile' }
  ]);

  const nested = await check({ cwd, paths: ['docs/guide.md'] });
  assert.deepEqual(nested.findings.map(({ ruleId, line, message, evidence }) => ({
    ruleId, line, message, source: evidence?.source
  })), [
    { ruleId: 'make-target', line: 5, message: 'Unknown make target: missing.', source: 'tools/Makefile' },
    { ruleId: 'make-target', line: 6, message: 'Unknown make target: missing.', source: 'tools/Makefile' }
  ]);

  const copilot = await check({ cwd, paths: ['.github/copilot-instructions.md'] });
  assert.deepEqual(copilot.findings.filter(({ ruleId }) => ['package-script', 'workspace-package', 'make-target', 'cli-contract'].includes(ruleId)), []);

  const changelog = await check({ cwd, paths: ['CHANGELOG.md'] });
  assert.equal(changelog.findings.some(({ ruleId }) => ['package-script', 'workspace-package', 'make-target', 'cli-contract'].includes(ruleId)), false);
  assert.equal(changelog.findings.filter(({ ruleId }) => ruleId === 'local-link').length, 2);

  const roadmap = await check({ cwd, paths: ['ROADMAP.md'] });
  assert.equal(roadmap.findings.some(({ ruleId }) => ['package-script', 'workspace-package', 'make-target', 'cli-contract'].includes(ruleId)), false);
  assert.deepEqual(roadmap.findings.filter(({ ruleId, line, message }) => ruleId === 'local-link').map(({ line, message }) => ({ line, message })), [
    { line: 5, message: 'Dead link: absent.md (Target not found)' },
    { line: 6, message: 'Missing local anchor: #missing.' }
  ]);

  const configuredPlan = await check({ cwd, paths: ['README.md'], purpose: 'plan' });
  assert.equal(configuredPlan.findings.some(({ ruleId }) => ['package-script', 'workspace-package', 'make-target', 'cli-contract'].includes(ruleId)), false);

  const configuredCurrent = await check({ cwd, paths: ['CHANGELOG.md'], purpose: 'fragment' });
  assert.equal(configuredCurrent.findings.some(({ ruleId }) => ruleId === 'package-script'), true);
  assert.equal(configuredCurrent.findings.some(({ ruleId }) => ruleId === 'cli-contract'), true);

  const app = await check({ cwd, paths: ['packages/app/README.md'] });
  assert.deepEqual(app.findings.map(({ ruleId, line, message, evidence }) => ({
    ruleId, line, message, source: evidence?.source
  })), [
    { ruleId: 'package-script', line: 4, message: 'Unknown npm script: missing.', source: 'packages/app/package.json' },
    { ruleId: 'workspace-package', line: 5, message: 'Unknown workspace package: @scope/missing.', source: 'workspace package.json manifests' },
    { ruleId: 'package-script', line: 6, message: 'Unknown npm script: missing.', source: 'packages/app/package.json' },
    { ruleId: 'workspace-package', line: 7, message: 'Unknown workspace package: @scope/missing.', source: 'workspace package.json manifests' }
  ]);
});

test('npm run keeps literal script keys and leaves dynamic forms unverified', async (t) => {
  const cwd = makeTempDir(t);
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
    name: 'npm-static-repro',
    scripts: { test: 'true', 'test.unit': 'true', 'literal:*': 'true' }
  }), 'utf8');
  fs.writeFileSync(path.join(cwd, 'README.md'), [
    '# npm', '',
    '`npm run build:*`',
    '`npm run literal:*`',
    '`npm run test.unit`',
    '`npm run missing.unit`',
    '`npm run optional --if-present`',
    '`npm run optional -- --if-present`',
    '`npm run env`',
    '`npm run restart`',
    '`npm run start`', ''
  ].join('\n'), 'utf8');

  const result = await check({ cwd, paths: ['README.md'] });
  assert.deepEqual(result.findings.map(({ ruleId, line, message }) => ({ ruleId, line, message })), [
    { ruleId: 'package-script', line: 6, message: 'Unknown npm script: missing.unit.' },
    { ruleId: 'package-script', line: 8, message: 'Unknown npm script: optional.' }
  ]);
});

test('npm run accepts only complete static shell words', async (t) => {
  const cwd = makeTempDir(t);
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
    name: 'npm-shell-static', scripts: { 'test.unit': 'true' }
  }), 'utf8');
  fs.writeFileSync(path.join(cwd, 'README.md'), [
    '# npm', '',
    '```sh',
    'npm run test.unit',
    'npm run "test.unit"',
    'npm run missing.unit',
    'npm run foo -- arg',
    'npm run optional --if-present',
    'npm run optional -- --if-present',
    'npm run --silent',
    'npm run -s',
    'npm run separator-missing && echo done',
    'npm run pipe-missing | cat',
    'npm run semicolon-missing; echo done',
    'npm run $SCRIPT',
    'npm run ${SCRIPT}',
    'npm run <script>',
    'npm run build*',
    'npm run `build`',
    'npm run "unterminated',
    '```', ''
  ].join('\n'), 'utf8');

  const result = await check({ cwd, paths: ['README.md'] });
  assert.deepEqual(result.findings.map(({ ruleId, line, message }) => ({ ruleId, line, message })), [
    { ruleId: 'package-script', line: 6, message: 'Unknown npm script: missing.unit.' },
    { ruleId: 'package-script', line: 7, message: 'Unknown npm script: foo.' },
    { ruleId: 'package-script', line: 9, message: 'Unknown npm script: optional.' }
  ]);
});

test('npm workspace claims require one explicit static package context', async (t) => {
  const cwd = makeTempDir(t);
  fs.mkdirSync(path.join(cwd, 'packages', 'app'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
    name: 'workspace-root', workspaces: ['packages/*'], scripts: { rootOnly: 'true' }
  }), 'utf8');
  fs.writeFileSync(path.join(cwd, 'packages', 'app', 'package.json'), JSON.stringify({
    name: '@scope/app', scripts: { build: 'true' }
  }), 'utf8');
  fs.writeFileSync(path.join(cwd, 'README.md'), [
    '# Root', '',
    '`npm run missing --workspace=@scope/app`',
    '`npm -w @scope/app run missing`',
    '`npm --workspace ./packages/app run missing`',
    '`npm --workspaces run missing`',
    '`npm --workspace @scope/app --workspace @scope/other run missing`',
    '`cd packages/app && npm run missing`',
    '`npm --workspace /outside/app run missing`',
    '`npm --workspace ../packages/app run missing`',
    '`npm --workspace packages run missing`',
    '`npm --workspace ./packages run missing`',
    '`npm --workspace @scope/missing run build`',
    '`npm run root-missing`', ''
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(cwd, 'packages', 'app', 'README.md'), [
    '# App', '',
    '`npm run build`',
    '`npm run missing`',
    '`npm --workspace @scope/app run missing`', ''
  ].join('\n'), 'utf8');

  const result = await check({ cwd, paths: ['README.md', 'packages/app/README.md'] });
  assert.deepEqual(result.findings.map(({ path: findingPath, line, ruleId, message, evidence }) => ({
    path: findingPath, line, ruleId, message, source: evidence?.source
  })), [
    { path: 'README.md', line: 3, ruleId: 'package-script', message: 'Unknown npm script: missing.', source: 'packages/app/package.json' },
    { path: 'README.md', line: 4, ruleId: 'package-script', message: 'Unknown npm script: missing.', source: 'packages/app/package.json' },
    { path: 'README.md', line: 5, ruleId: 'package-script', message: 'Unknown npm script: missing.', source: 'packages/app/package.json' },
    { path: 'README.md', line: 13, ruleId: 'workspace-package', message: 'Unknown workspace package: @scope/missing.', source: 'workspace package.json manifests' },
    { path: 'README.md', line: 14, ruleId: 'package-script', message: 'Unknown npm script: root-missing.', source: 'package.json' },
    { path: 'packages/app/README.md', line: 5, ruleId: 'package-script', message: 'Unknown npm script: missing.', source: 'packages/app/package.json' }
  ]);
});

test('workspace globs stay bounded and exclusions do not invent unknown packages', async (t) => {
  const makeWorkspaceFixture = (pattern) => {
    const root = makeTempDir(t);
    fs.mkdirSync(path.join(root, 'packages', 'nested', 'app'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'glob-root', workspaces: [pattern]
    }), 'utf8');
    fs.writeFileSync(path.join(root, 'packages', 'nested', 'app', 'package.json'), JSON.stringify({
      name: '@scope/deep', scripts: { build: 'true' }
    }), 'utf8');
    fs.writeFileSync(path.join(root, 'README.md'), '# Root\n\n`npm --workspace @scope/deep run missing`\n', 'utf8');
    return root;
  };
  const singleLevel = makeWorkspaceFixture('packages/*');
  const singleResult = await check({ cwd: singleLevel, paths: ['README.md'] });
  assert.deepEqual(singleResult.findings.map(({ ruleId, message }) => ({ ruleId, message })), [
    { ruleId: 'workspace-package', message: 'Unknown workspace package: @scope/deep.' }
  ]);

  const recursive = makeWorkspaceFixture('packages/**');
  const recursiveResult = await check({ cwd: recursive, paths: ['README.md'] });
  assert.deepEqual(recursiveResult.findings.map(({ ruleId, message, evidence }) => ({
    ruleId, message, source: evidence?.source
  })), [
    { ruleId: 'package-script', message: 'Unknown npm script: missing.', source: 'packages/nested/app/package.json' }
  ]);

  const recursiveSuffix = makeWorkspaceFixture('packages/**/app');
  const recursiveSuffixResult = await check({ cwd: recursiveSuffix, paths: ['README.md'] });
  assert.deepEqual(recursiveSuffixResult.findings.map(({ ruleId, message, evidence }) => ({
    ruleId, message, source: evidence?.source
  })), [
    { ruleId: 'package-script', message: 'Unknown npm script: missing.', source: 'packages/nested/app/package.json' }
  ]);

  const dotPrefix = makeWorkspaceFixture('./packages/*');
  const dotPrefixResult = await check({ cwd: dotPrefix, paths: ['README.md'] });
  assert.deepEqual(dotPrefixResult.findings.map(({ ruleId, message }) => ({ ruleId, message })), [
    { ruleId: 'workspace-package', message: 'Unknown workspace package: @scope/deep.' }
  ]);

  const excluded = makeTempDir(t);
  fs.mkdirSync(path.join(excluded, 'packages', 'app'), { recursive: true });
  fs.writeFileSync(path.join(excluded, 'package.json'), JSON.stringify({
    name: 'excluded-root', workspaces: ['packages/*']
  }), 'utf8');
  fs.writeFileSync(path.join(excluded, 'packages', 'app', 'package.json'), JSON.stringify({
    name: '@scope/app', scripts: { build: 'true' }
  }), 'utf8');
  fs.writeFileSync(path.join(excluded, 'README.md'), '# Root\n\n`npm --workspace @scope/app run missing`\n', 'utf8');
  const excludedResult = await check({ cwd: excluded, paths: ['README.md'], exclude: ['packages/app'] });
  assert.deepEqual(excludedResult.findings, []);

  const irrelevantExcluded = makeTempDir(t);
  fs.mkdirSync(path.join(irrelevantExcluded, 'docs'));
  fs.writeFileSync(path.join(irrelevantExcluded, 'package.json'), JSON.stringify({
    name: 'complete-root', workspaces: ['packages/*']
  }), 'utf8');
  fs.writeFileSync(path.join(irrelevantExcluded, 'docs', 'note.md'), '# Note\n', 'utf8');
  fs.writeFileSync(path.join(irrelevantExcluded, 'README.md'), '# Root\n\n`npm --workspace @scope/missing run build`\n', 'utf8');
  const irrelevantExcludedResult = await check({
    cwd: irrelevantExcluded, paths: ['README.md'], exclude: ['docs']
  });
  assert.deepEqual(irrelevantExcludedResult.findings.map(({ ruleId }) => ruleId), ['workspace-package']);
  assert.deepEqual(irrelevantExcludedResult.diagnostics, []);
});

test('required evidence failures are incomplete without inventing negatives', async (t) => {
  const malformedRoot = makeTempDir(t);
  fs.writeFileSync(path.join(malformedRoot, 'package.json'), '{ invalid json', 'utf8');
  fs.writeFileSync(path.join(malformedRoot, 'README.md'), '# Root\n\n`npm run missing`\n', 'utf8');
  const malformedRootResult = await check({ cwd: malformedRoot, paths: ['README.md'] });
  assert.equal(malformedRootResult.status, 'incomplete');
  assert.equal(malformedRootResult.complete, false);
  assert.deepEqual(malformedRootResult.findings, []);
  assert.deepEqual(malformedRootResult.diagnostics.map(({ code, path: diagnosticPath }) => ({ code, path: diagnosticPath })), [
    { code: 'evidence-source-invalid', path: 'package.json' }
  ]);

  const malformedWorkspace = makeTempDir(t);
  fs.mkdirSync(path.join(malformedWorkspace, 'packages', 'app'), { recursive: true });
  fs.writeFileSync(path.join(malformedWorkspace, 'package.json'), JSON.stringify({
    name: 'root', workspaces: ['packages/*']
  }), 'utf8');
  fs.writeFileSync(path.join(malformedWorkspace, 'packages', 'app', 'package.json'), '{ invalid json', 'utf8');
  fs.writeFileSync(path.join(malformedWorkspace, 'README.md'), '# Root\n\n`npm --workspace ./packages/app run build`\n', 'utf8');
  const malformedWorkspaceResult = await check({ cwd: malformedWorkspace, paths: ['README.md'] });
  assert.equal(malformedWorkspaceResult.status, 'incomplete');
  assert.deepEqual(malformedWorkspaceResult.findings, []);
  assert.deepEqual(malformedWorkspaceResult.diagnostics.map(({ code, path: diagnosticPath }) => ({ code, path: diagnosticPath })), [
    { code: 'evidence-source-invalid', path: 'packages/app/package.json' }
  ]);

  const absent = makeTempDir(t);
  fs.writeFileSync(path.join(absent, 'README.md'), '# No manifest\n\n`npm run missing`\n', 'utf8');
  const absentResult = await check({ cwd: absent, paths: ['README.md'] });
  assert.equal(absentResult.status, 'pass');
  assert.equal(absentResult.complete, true);
  assert.deepEqual(absentResult.findings, []);
  assert.deepEqual(absentResult.diagnostics, []);

  const absentWithPartialAnchorIndex = makeTempDir(t);
  fs.writeFileSync(path.join(absentWithPartialAnchorIndex, 'Page.md'), '<div id={dynamic}>\n', 'utf8');
  fs.writeFileSync(path.join(absentWithPartialAnchorIndex, 'README.md'), '# Root\n\n`npm run missing`\n', 'utf8');
  const absentWithPartialAnchorResult = await check({ cwd: absentWithPartialAnchorIndex, paths: ['README.md'] });
  assert.equal(absentWithPartialAnchorResult.status, 'pass');
  assert.deepEqual(absentWithPartialAnchorResult.diagnostics, []);

  const irrelevant = makeTempDir(t);
  fs.writeFileSync(path.join(irrelevant, 'package.json'), '{ invalid json', 'utf8');
  fs.writeFileSync(path.join(irrelevant, 'README.md'), '# No repository claim\n', 'utf8');
  const irrelevantResult = await check({ cwd: irrelevant, paths: ['README.md'] });
  assert.equal(irrelevantResult.status, 'pass');
  assert.deepEqual(irrelevantResult.diagnostics, []);

  if (process.platform !== 'win32') {
    const unreadableAnchor = makeTempDir(t);
    const unreadableTarget = path.join(unreadableAnchor, 'guide.md');
    fs.writeFileSync(path.join(unreadableAnchor, 'README.md'), '# Root\n\n[guide](guide.md#existing)\n', 'utf8');
    fs.writeFileSync(unreadableTarget, '# Existing\n', 'utf8');
    fs.chmodSync(unreadableTarget, 0);
    let unreadableResult;
    try {
      unreadableResult = await check({ cwd: unreadableAnchor, paths: ['README.md'] });
    } finally {
      fs.chmodSync(unreadableTarget, 0o600);
    }
    assert.equal(unreadableResult.status, 'incomplete');
    assert.deepEqual(unreadableResult.findings, []);
    assert.deepEqual(unreadableResult.diagnostics.map(({ code, path: diagnosticPath }) => ({ code, path: diagnosticPath })), [
      { code: 'evidence-source-unreadable', path: 'guide.md' }
    ]);
  }

  if (process.platform !== 'win32') {
    const unreadableMake = makeTempDir(t);
    const unreadableMakefile = path.join(unreadableMake, 'Makefile');
    fs.writeFileSync(unreadableMakefile, 'check:\n\t@true\n', 'utf8');
    fs.writeFileSync(path.join(unreadableMake, 'README.md'), '# Root\n\n`make missing`\n', 'utf8');
    fs.chmodSync(unreadableMakefile, 0);
    let unreadableMakeResult;
    try {
      unreadableMakeResult = await check({ cwd: unreadableMake, paths: ['README.md'] });
    } finally {
      fs.chmodSync(unreadableMakefile, 0o600);
    }
    assert.equal(unreadableMakeResult.status, 'incomplete');
    assert.deepEqual(unreadableMakeResult.findings, []);
    assert.deepEqual(unreadableMakeResult.diagnostics.map(({ code, path: diagnosticPath }) => ({ code, path: diagnosticPath })), [
      { code: 'evidence-source-unreadable', path: 'Makefile' }
    ]);
  }

  const excludedAnchor = makeTempDir(t);
  fs.writeFileSync(path.join(excludedAnchor, 'README.md'), '# Root\n\n[guide](guide.md#existing)\n', 'utf8');
  fs.writeFileSync(path.join(excludedAnchor, 'guide.md'), '# Existing\n', 'utf8');
  const excludedAnchorResult = await check({ cwd: excludedAnchor, paths: ['README.md'], exclude: ['guide.md'] });
  assert.equal(excludedAnchorResult.status, 'incomplete');
  assert.deepEqual(excludedAnchorResult.findings, []);
  assert.deepEqual(excludedAnchorResult.diagnostics.map(({ code, path: diagnosticPath }) => ({ code, path: diagnosticPath })), [
    { code: 'evidence-source-unavailable', path: 'guide.md' }
  ]);

  const excludedLocalPath = makeTempDir(t);
  fs.writeFileSync(path.join(excludedLocalPath, 'README.md'), '# Root\n\n[guide](guide.md)\n', 'utf8');
  fs.writeFileSync(path.join(excludedLocalPath, 'guide.md'), '# Existing\n', 'utf8');
  const excludedLocalPathResult = await check({
    cwd: excludedLocalPath, paths: ['README.md'], exclude: ['guide.md']
  });
  assert.equal(excludedLocalPathResult.status, 'incomplete');
  assert.deepEqual(excludedLocalPathResult.findings, []);
  assert.deepEqual(excludedLocalPathResult.diagnostics.map(({ code, path: diagnosticPath }) => ({
    code, path: diagnosticPath
  })), [
    { code: 'evidence-source-unavailable', path: 'guide.md' }
  ]);

  const excludedMake = makeTempDir(t);
  fs.writeFileSync(path.join(excludedMake, 'Makefile'), 'present:\n\t@true\n', 'utf8');
  fs.writeFileSync(path.join(excludedMake, 'README.md'), '# Root\n\n`make missing`\n', 'utf8');
  const excludedMakeResult = await check({
    cwd: excludedMake, paths: ['README.md'], exclude: ['Makefile']
  });
  assert.equal(excludedMakeResult.status, 'incomplete');
  assert.deepEqual(excludedMakeResult.findings, []);
  assert.deepEqual(excludedMakeResult.diagnostics.map(({ code, path: diagnosticPath }) => ({
    code, path: diagnosticPath
  })), [
    { code: 'evidence-source-unavailable', path: 'Makefile' }
  ]);

  if (process.platform !== 'win32') {
    const unreadableWorkspace = makeTempDir(t);
    const unreadableDirectory = path.join(unreadableWorkspace, 'packages', 'app');
    fs.mkdirSync(unreadableDirectory, { recursive: true });
    fs.writeFileSync(path.join(unreadableWorkspace, 'package.json'), JSON.stringify({
      name: 'root', workspaces: ['packages/*']
    }), 'utf8');
    fs.writeFileSync(path.join(unreadableDirectory, 'package.json'), JSON.stringify({
      name: '@scope/app', scripts: { build: 'true' }
    }), 'utf8');
    fs.writeFileSync(path.join(unreadableWorkspace, 'README.md'),
      '# Root\n\n`npm --workspace ./packages/app run missing`\n', 'utf8');
    fs.chmodSync(unreadableDirectory, 0);
    let unreadableWorkspaceResult;
    try {
      unreadableWorkspaceResult = await check({ cwd: unreadableWorkspace, paths: ['README.md'] });
    } finally {
      fs.chmodSync(unreadableDirectory, 0o700);
    }
    assert.equal(unreadableWorkspaceResult.status, 'incomplete');
    assert.deepEqual(unreadableWorkspaceResult.findings, []);
    assert.deepEqual(unreadableWorkspaceResult.diagnostics.map(({ code, path: diagnosticPath }) => ({
      code, path: diagnosticPath
    })), [
      { code: 'evidence-source-unreadable', path: 'packages/app' }
    ]);
  }
});

test('local links keep host routes separate from complete anchor evidence', async (t) => {
  const cwd = makeTempDir(t);
  fs.writeFileSync(path.join(cwd, 'Page.md'), [
    '# Page', '',
    'Setext title',
    '------------', '',
    '<a id="html-anchor"></a>',
    '<a name="named-anchor"></a>', '',
    '## Duplicate',
    '## Duplicate', ''
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(cwd, 'README.md'), [
    '# Links', '',
    '[route](Page)',
    '[setext](Page.md#setext-title)',
    '[html](Page.md#html-anchor)',
    '[named](Page.md#named-anchor)',
    '[duplicate](Page.md#duplicate-1)',
    '[missing-anchor](Page.md#missing)',
    '[missing-file](missing.md)', ''
  ].join('\n'), 'utf8');

  const result = await check({ cwd, paths: ['README.md'] });
  assert.deepEqual(result.findings.map(({ line, message }) => ({ line, message })), [
    { line: 8, message: 'Missing local anchor: #missing.' },
    { line: 9, message: 'Dead link: missing.md (Target not found)' }
  ]);

  const exactExtensionless = makeTempDir(t);
  fs.writeFileSync(path.join(exactExtensionless, 'Page'), '# Existing\n', 'utf8');
  fs.writeFileSync(path.join(exactExtensionless, 'README.md'), '# Links\n\n[exact](Page#existing)\n', 'utf8');
  const exactResult = await check({ cwd: exactExtensionless, paths: ['README.md'] });
  assert.equal(exactResult.status, 'pass');
  assert.deepEqual(exactResult.findings, []);

  const fenced = makeTempDir(t);
  fs.writeFileSync(path.join(fenced, 'Page.md'), '```md\n# Fenced\n```\n', 'utf8');
  fs.writeFileSync(path.join(fenced, 'README.md'), '# Links\n\n[fenced](Page.md#fenced)\n', 'utf8');
  const fencedResult = await check({ cwd: fenced, paths: ['README.md'] });
  assert.deepEqual(fencedResult.findings.map(({ line, message }) => ({ line, message })), [
    { line: 3, message: 'Missing local anchor: #fenced.' }
  ]);

  const unclosedFence = makeTempDir(t);
  fs.writeFileSync(path.join(unclosedFence, 'Page.md'), '```md\n# Fenced\n', 'utf8');
  fs.writeFileSync(path.join(unclosedFence, 'README.md'), '# Links\n\n[fenced](Page.md#fenced)\n', 'utf8');
  const unclosedFenceResult = await check({ cwd: unclosedFence, paths: ['README.md'] });
  assert.equal(unclosedFenceResult.status, 'incomplete');
  assert.deepEqual(unclosedFenceResult.findings, []);
  assert.deepEqual(unclosedFenceResult.diagnostics.map(({ code, path: diagnosticPath }) => ({ code, path: diagnosticPath })), [
    { code: 'evidence-source-unavailable', path: 'Page.md' }
  ]);

  const dynamic = makeTempDir(t);
  fs.writeFileSync(path.join(dynamic, 'Page.md'), '<div\n id={dynamic}>\n</div>\n', 'utf8');
  fs.writeFileSync(path.join(dynamic, 'README.md'), '# Links\n\n[dynamic](Page.md#missing)\n', 'utf8');
  const dynamicResult = await check({ cwd: dynamic, paths: ['README.md'] });
  assert.equal(dynamicResult.status, 'incomplete');
  assert.deepEqual(dynamicResult.findings, []);
  assert.deepEqual(dynamicResult.diagnostics.map(({ code, path: diagnosticPath }) => ({ code, path: diagnosticPath })), [
    { code: 'evidence-source-unavailable', path: 'Page.md' }
  ]);

  const dataAttribute = makeTempDir(t);
  fs.writeFileSync(path.join(dataAttribute, 'Page.md'), '<div data-id="not-an-anchor"></div>\n', 'utf8');
  fs.writeFileSync(path.join(dataAttribute, 'README.md'), '# Links\n\n[data](Page.md#not-an-anchor)\n', 'utf8');
  const dataAttributeResult = await check({ cwd: dataAttribute, paths: ['README.md'] });
  assert.equal(dataAttributeResult.status, 'fail');
  assert.deepEqual(dataAttributeResult.findings.map(({ ruleId, message }) => ({ ruleId, message })), [
    { ruleId: 'local-link', message: 'Missing local anchor: #not-an-anchor.' }
  ]);

  for (const targetContent of [
    '<Component {...props} />\n',
    '<a id="maybe"\n',
    '<div>complete</div><a id="maybe"\n'
  ]) {
    const ambiguousHtml = makeTempDir(t);
    fs.writeFileSync(path.join(ambiguousHtml, 'Page.mdx'), targetContent, 'utf8');
    fs.writeFileSync(path.join(ambiguousHtml, 'README.md'), '# Links\n\n[unknown](Page.mdx#maybe)\n', 'utf8');
    const ambiguousHtmlResult = await check({ cwd: ambiguousHtml, paths: ['README.md'] });
    assert.equal(ambiguousHtmlResult.status, 'incomplete');
    assert.deepEqual(ambiguousHtmlResult.findings, []);
    assert.deepEqual(ambiguousHtmlResult.diagnostics.map(({ code, path: diagnosticPath }) => ({
      code, path: diagnosticPath
    })), [
      { code: 'evidence-source-unavailable', path: 'Page.mdx' }
    ]);
  }

  for (const fencedContent of [
    '```md\n<Component {...props} />\n```\n',
    '```html\n<a id="maybe"\n```\n',
    '```html\n<div\n id="maybe">\n```\n'
  ]) {
    const fencedMarkup = makeTempDir(t);
    fs.writeFileSync(path.join(fencedMarkup, 'Page.mdx'), fencedContent, 'utf8');
    fs.writeFileSync(path.join(fencedMarkup, 'README.md'), '# Links\n\n[missing](Page.mdx#missing)\n', 'utf8');
    const fencedMarkupResult = await check({ cwd: fencedMarkup, paths: ['README.md'] });
    assert.equal(fencedMarkupResult.status, 'fail');
    assert.deepEqual(fencedMarkupResult.diagnostics, []);
    assert.deepEqual(fencedMarkupResult.findings.map(({ ruleId, message }) => ({ ruleId, message })), [
      { ruleId: 'local-link', message: 'Missing local anchor: #missing.' }
    ]);
  }
});

test('unqualified make does not infer cwd from a nested document', async (t) => {
  const cwd = makeTempDir(t);
  fs.mkdirSync(path.join(cwd, 'packages', 'app'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'Makefile'), 'root:\n\t@true\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'packages', 'app', 'Makefile'), 'build:\n\t@true\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'README.md'), '# Root\n\n`make root-missing`\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'packages', 'app', 'README.md'), [
    '# App', '',
    '`make build`',
    '`make -C packages/app build`',
    '`make -C packages/app missing`', ''
  ].join('\n'), 'utf8');

  const result = await check({ cwd, paths: ['README.md', 'packages/app/README.md'] });
  assert.deepEqual(result.findings.map(({ path: findingPath, line, message, evidence }) => ({
    path: findingPath, line, message, source: evidence?.source
  })), [
    { path: 'README.md', line: 3, message: 'Unknown make target: root-missing.', source: 'Makefile' },
    { path: 'packages/app/README.md', line: 5, message: 'Unknown make target: missing.', source: 'packages/app/Makefile' }
  ]);
});

test('make ignores shell and prefix contexts before a later make token', async (t) => {
  const cwd = makeTempDir(t);
  fs.mkdirSync(path.join(cwd, 'tools'));
  fs.writeFileSync(path.join(cwd, 'Makefile'), 'present:\n\t@true\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'tools', 'Makefile'), 'present:\n\t@true\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'README.md'), [
    '# Make', '',
    '`cd tools && make missing`',
    '`echo make missing`', ''
  ].join('\n'), 'utf8');

  const result = await check({ cwd, paths: ['README.md'] });
  assert.deepEqual(result.findings, []);
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
  fs.appendFileSync(path.join(cwd, 'Makefile'), 'deploy:\n\t@true\n.PHONY: phony-only\n');
  fs.mkdirSync(path.join(cwd, 'tools'));
  fs.writeFileSync(path.join(cwd, 'tools', 'Makefile'), 'build:\n\t@true\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'README.md'), [
    '# Make', '',
    '`make BUILD_TLS=yes`',
    '`make CFLAGS="-O2 -g"`',
    '`make MALLOC=libc`',
    '`make PREFIX=/opt/redis-deploy`',
    '`make phony-only`',
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
    '`echo doclify-guardrail review --bogus`',
    '`npx doclify-guardrail review --bogus`',
    '`doclify-guardrail <command> [options]`',
    '`doclify-guardrail`',
    '`doclify-guardrail@next`',
    '`Elgabor/doclify-guardrail/action@v2`',
    '`.doclify-guardrail.json`', ''
  ].join('\n'), 'utf8');

  const result = await check({ cwd, paths: ['README.md'] });
  assert.equal(result.findings.filter((finding) => finding.ruleId === 'cli-contract').length, 7);
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
  assert.match(explained.stdout, /root document|explicit workspace/i);
  const explainedMake = runCli(['explain', 'make-target'], cwd);
  assert.equal(explainedMake.status, 0, explainedMake.stderr);
  assert.match(explainedMake.stdout, /root document|explicit (?:-C|directory)/i);
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
