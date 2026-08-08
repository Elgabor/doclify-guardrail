import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { check } from '../src/api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'index.mjs');

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-v2-git-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env || process.env
  });
}

function runCli(args, cwd, env = {}) {
  return run(process.execPath, [CLI, ...args], {
    cwd,
    env: {
      LANG: 'C',
      LC_ALL: 'C',
      NO_COLOR: '1',
      PATH: process.env.PATH || '',
      TMPDIR: process.env.TMPDIR || '',
      TMP: process.env.TMP || '',
      TEMP: process.env.TEMP || '',
      ...env
    }
  });
}

function git(cwd, ...args) {
  return run('git', args, { cwd });
}

function initRepository(t) {
  const root = makeTempDir(t);
  assert.equal(git(root, 'init', '-q').status, 0);
  assert.equal(git(root, 'config', 'user.email', 'fixture@example.invalid').status, 0);
  assert.equal(git(root, 'config', 'user.name', 'Fixture').status, 0);
  return root;
}

function commitAll(root, message = 'fixture') {
  assert.equal(git(root, 'add', '.').status, 0);
  assert.equal(git(root, 'commit', '-qm', message).status, 0);
}

test('v2 changed is root-correct and quote-safe from repository subdirectories', (t) => {
  const root = initRepository(t);
  const docs = path.join(root, 'docs');
  fs.mkdirSync(docs);
  fs.writeFileSync(path.join(root, 'README.md'), '# Original\n', 'utf8');
  fs.writeFileSync(path.join(docs, 'guida più.md'), '# Original\n', 'utf8');
  fs.writeFileSync(path.join(docs, 'space name.mdx'), '# Original\n', 'utf8');
  fs.writeFileSync(path.join(docs, 'tab\tname.md'), '# Original\n', 'utf8');
  fs.writeFileSync(path.join(docs, 'line\nbreak.md'), '# Original\n', 'utf8');
  commitAll(root);

  fs.writeFileSync(path.join(root, 'README.md'), '# Changed\n', 'utf8');
  fs.writeFileSync(path.join(docs, 'guida più.md'), '# Changed\n', 'utf8');
  fs.writeFileSync(path.join(docs, 'space name.mdx'), '# Changed\n', 'utf8');
  fs.writeFileSync(path.join(docs, 'tab\tname.md'), '# Changed\n', 'utf8');
  fs.writeFileSync(path.join(docs, 'line\nbreak.md'), '# Changed\n', 'utf8');

  const rootBase = runCli(['changed', '--base', 'HEAD', '--format', 'json'], root);
  const subdirBase = runCli(['changed', '--base', 'HEAD', '--format', 'json'], docs);
  assert.equal(rootBase.status, 0, rootBase.stderr);
  assert.equal(subdirBase.status, 0, subdirBase.stderr);
  assert.equal(subdirBase.stdout, rootBase.stdout);
  assert.deepEqual(new Set(JSON.parse(rootBase.stdout).files.map((file) => file.path)), new Set([
    'README.md',
    'docs/guida più.md',
    'docs/space name.mdx',
    'docs/tab\tname.md',
    'docs/line\nbreak.md'
  ]));

  assert.equal(git(root, 'add', '.').status, 0);
  const rootStaged = runCli(['changed', '--staged', '--format', 'json'], root);
  const subdirStaged = runCli(['changed', '--staged', '--format', 'json'], docs);
  assert.equal(rootStaged.status, 0, rootStaged.stderr);
  assert.equal(subdirStaged.status, 0, subdirStaged.stderr);
  assert.equal(subdirStaged.stdout, rootStaged.stdout);
});

test('v2 changed scans rename destinations and excludes deletions and untracked files', (t) => {
  const root = initRepository(t);
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.md\n', 'utf8');
  fs.writeFileSync(path.join(root, 'old.md'), '# Old\n', 'utf8');
  fs.writeFileSync(path.join(root, 'deleted.md'), '# Delete\n', 'utf8');
  commitAll(root);

  assert.equal(git(root, 'mv', 'old.md', 'renamed più.md').status, 0);
  assert.equal(git(root, 'rm', '-q', 'deleted.md').status, 0);
  fs.writeFileSync(path.join(root, 'untracked.md'), '# Untracked\n', 'utf8');
  fs.writeFileSync(path.join(root, 'ignored.md'), '# Ignored\n', 'utf8');

  for (const selector of [['--base', 'HEAD'], ['--staged']]) {
    const result = runCli(['changed', ...selector, '--format', 'json'], root);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).files.map((file) => file.path), ['renamed più.md']);
  }
});

test('v2 changed CLI and API share selection and reject invalid API selectors', async (t) => {
  const root = initRepository(t);
  fs.writeFileSync(path.join(root, 'doc.md'), '# Original\n', 'utf8');
  commitAll(root);
  fs.writeFileSync(path.join(root, 'doc.md'), '# Changed\n', 'utf8');

  const cli = runCli(['changed', '--base', 'HEAD', '--format', 'json'], root);
  const api = await check({ command: 'changed', changed: { base: 'HEAD' }, cwd: root });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), api);

  for (const changed of [{}, { base: 'HEAD', staged: true }, { base: '' }, { base: '', staged: true }, { staged: false }]) {
    await assert.rejects(
      check({ command: 'changed', changed, cwd: root }),
      (error) => error?.code === 'invalid-changed-selector'
    );
  }
});

test('v2 Git failure modes are stable while check works without Git', async (t) => {
  const outside = makeTempDir(t);
  fs.writeFileSync(path.join(outside, 'doc.md'), '# Clean\n', 'utf8');

  const checked = await check({ cwd: outside, paths: ['doc.md'] });
  assert.equal(checked.status, 'pass');

  const noRepository = runCli(['changed', '--base', 'HEAD'], outside);
  assert.equal(noRepository.status, 2);
  assert.match(noRepository.stderr, /^not-a-git-repository:/);

  const noGit = runCli(['changed', '--base', 'HEAD'], outside, { PATH: '' });
  assert.equal(noGit.status, 2);
  assert.match(noGit.stderr, /^git-unavailable:/);

  const root = initRepository(t);
  fs.writeFileSync(path.join(root, 'doc.md'), '# Clean\n', 'utf8');
  commitAll(root);
  const unknown = runCli(['changed', '--base', 'does-not-exist'], root);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /^unknown-base-ref:/);
});

test('v2 automatic config is hierarchical, relative to each config, and consistent by cwd', async (t) => {
  const root = initRepository(t);
  const docs = path.join(root, 'docs');
  const drafts = path.join(docs, 'drafts');
  const publicDir = path.join(docs, 'public');
  fs.mkdirSync(drafts, { recursive: true });
  fs.mkdirSync(publicDir);
  fs.writeFileSync(path.join(root, '.doclify-guardrail.json'), JSON.stringify({
    ignoreRules: ['placeholder'],
    linkAllowList: ['https://root.example']
  }), 'utf8');
  fs.writeFileSync(path.join(docs, '.doclify-guardrail.json'), JSON.stringify({
    ignoreRules: ['img-alt'],
    exclude: ['drafts'],
    siteRoot: 'public',
    linkAllowList: ['https://docs.example']
  }), 'utf8');
  fs.writeFileSync(path.join(docs, 'guide.md'), '# Guide\n\nTODO\n\n![](image.png)\n\n[ok](/existing.md)\n', 'utf8');
  fs.writeFileSync(path.join(docs, 'image.png'), '', 'utf8');
  fs.writeFileSync(path.join(drafts, 'ignored.md'), '# Draft\n', 'utf8');
  fs.writeFileSync(path.join(publicDir, 'existing.md'), '# Existing\n', 'utf8');
  commitAll(root);

  const fromRoot = await check({ cwd: root, paths: ['docs/guide.md'] });
  const fromDocs = await check({ cwd: docs, paths: ['guide.md'] });
  assert.equal(fromRoot.status, 'pass');
  assert.equal(fromDocs.status, 'pass');
  assert.deepEqual(fromRoot.findings, []);
  assert.deepEqual(fromDocs.findings, []);

  const recursive = await check({ cwd: root, paths: ['.'] });
  assert.equal(recursive.files.some((file) => file.path === 'docs/drafts/ignored.md'), false);
});

test('v2 CLI and API overrides apply after hierarchical configuration', async (t) => {
  const root = initRepository(t);
  fs.writeFileSync(path.join(root, '.doclify-guardrail.json'), JSON.stringify({
    ignoreRules: ['placeholder']
  }), 'utf8');
  fs.writeFileSync(path.join(root, 'doc.md'), '# Guide\n\nTODO\n\n![](image.png)\n', 'utf8');
  fs.writeFileSync(path.join(root, 'image.png'), '', 'utf8');
  commitAll(root);

  const api = await check({ cwd: root, paths: ['doc.md'], ignoreRules: ['img-alt'] });
  const cli = runCli(['check', 'doc.md', '--ignore-rules', 'img-alt', '--format', 'json'], root);
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), api);
  assert.deepEqual(api.findings, []);
});

test('v2 explicit config is one contained file and disables implicit hierarchy', async (t) => {
  const root = initRepository(t);
  const docs = path.join(root, 'docs');
  fs.mkdirSync(docs);
  fs.writeFileSync(path.join(root, 'explicit.json'), JSON.stringify({ ignoreRules: ['placeholder'] }), 'utf8');
  fs.writeFileSync(path.join(root, '.doclify-guardrail.json'), JSON.stringify({ unknownRootKey: true }), 'utf8');
  fs.writeFileSync(path.join(docs, '.doclify-guardrail.json'), JSON.stringify({ unknownNestedKey: true }), 'utf8');
  fs.writeFileSync(path.join(docs, 'doc.md'), '# Guide\n\nTODO\n', 'utf8');
  commitAll(root);

  const api = await check({ cwd: root, paths: ['docs/doc.md'], config: 'explicit.json' });
  const cli = runCli(['check', 'docs/doc.md', '--config', 'explicit.json', '--format', 'json'], root);
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), api);
  assert.deepEqual(api.findings, []);

  const subdirectoryApi = await check({ cwd: docs, paths: ['doc.md'], config: '../explicit.json' });
  const subdirectoryCli = runCli([
    'check',
    'doc.md',
    '--config',
    '../explicit.json',
    '--format',
    'json'
  ], docs);
  assert.equal(subdirectoryCli.status, 0, subdirectoryCli.stderr);
  assert.deepEqual(JSON.parse(subdirectoryCli.stdout), subdirectoryApi);
  assert.deepEqual(subdirectoryApi.findings, []);

  fs.writeFileSync(path.join(docs, 'doc.md'), '# Guide\n\nTODO changed\n', 'utf8');
  const changedApi = await check({
    command: 'changed',
    changed: { base: 'HEAD' },
    cwd: docs,
    config: '../explicit.json'
  });
  const changedCli = runCli([
    'changed',
    '--base',
    'HEAD',
    '--config',
    '../explicit.json',
    '--format',
    'json'
  ], docs);
  assert.equal(changedCli.status, 0, changedCli.stderr);
  assert.deepEqual(JSON.parse(changedCli.stdout), changedApi);
  assert.deepEqual(changedApi.files.map((file) => file.path), ['docs/doc.md']);
  assert.deepEqual(changedApi.findings, []);

  await assert.rejects(
    check({ cwd: root, paths: ['docs/doc.md'], config: 'missing.json' }),
    (error) => error?.code === 'config-not-found'
  );

  const outside = makeTempDir(t);
  const outsideConfig = path.join(outside, 'config.json');
  fs.writeFileSync(outsideConfig, '{}', 'utf8');
  fs.symlinkSync(outsideConfig, path.join(root, 'linked-config.json'));
  await assert.rejects(
    check({ cwd: root, paths: ['docs/doc.md'], config: 'linked-config.json' }),
    (error) => error?.code === 'config-outside-workspace'
  );
});

test('v2 config rejects removed, unknown, malformed, and invalid keys with stable codes', async (t) => {
  const cases = [
    [{ strict: true }, 'config-removed-key'],
    [{ checkLinks: true }, 'config-removed-key'],
    [{ externalLinks: true }, 'config-unknown-key'],
    [{ futureOption: true }, 'config-unknown-key'],
    [{ ignoreRules: 'placeholder' }, 'config-invalid'],
    [{ linkTimeoutMs: 0 }, 'config-invalid']
  ];

  for (const [config, code] of cases) {
    const root = initRepository(t);
    fs.writeFileSync(path.join(root, '.doclify-guardrail.json'), JSON.stringify(config), 'utf8');
    fs.writeFileSync(path.join(root, 'doc.md'), '# Clean\n', 'utf8');
    await assert.rejects(
      check({ cwd: root, paths: ['doc.md'] }),
      (error) => error?.code === code,
      JSON.stringify(config)
    );
    const cli = runCli(['check', 'doc.md'], root);
    assert.equal(cli.status, 2);
    assert.match(cli.stderr, new RegExp(`^${code}:`));
  }

  const malformed = initRepository(t);
  fs.writeFileSync(path.join(malformed, '.doclify-guardrail.json'), '{', 'utf8');
  fs.writeFileSync(path.join(malformed, 'doc.md'), '# Clean\n', 'utf8');
  await assert.rejects(
    check({ cwd: malformed, paths: ['doc.md'] }),
    (error) => error?.code === 'config-invalid'
  );
});

test('v2 network access requires an explicit CLI or API option', async (t) => {
  const root = initRepository(t);
  fs.writeFileSync(path.join(root, 'doc.md'), '# Clean\n', 'utf8');
  fs.writeFileSync(path.join(root, '.doclify-guardrail.json'), JSON.stringify({
    linkTimeoutMs: 25,
    linkConcurrency: 1,
    linkAllowList: ['https://example.invalid']
  }), 'utf8');
  commitAll(root);

  assert.equal((await check({ cwd: root, paths: ['doc.md'] })).status, 'pass');
  assert.equal((await check({ cwd: root, paths: ['doc.md'], externalLinks: true })).status, 'pass');
  await assert.rejects(
    check({ cwd: root, paths: ['doc.md'], links: { timeoutMs: 25 } }),
    (error) => error?.code === 'invalid-link-options'
  );
  const cli = runCli(['check', 'doc.md', '--link-timeout-ms', '25'], root);
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /^invalid-link-options:/);
});

test('v2 automatic config never reads above the Git root or non-Git workspace', async (t) => {
  const parent = makeTempDir(t);
  fs.writeFileSync(path.join(parent, '.doclify-guardrail.json'), JSON.stringify({ inheritedByMistake: true }), 'utf8');

  const repository = path.join(parent, 'repo');
  fs.mkdirSync(repository);
  assert.equal(git(repository, 'init', '-q').status, 0);
  assert.equal(git(repository, 'config', 'user.email', 'fixture@example.invalid').status, 0);
  assert.equal(git(repository, 'config', 'user.name', 'Fixture').status, 0);
  fs.writeFileSync(path.join(repository, 'doc.md'), '# Clean\n', 'utf8');
  commitAll(repository);
  assert.equal((await check({ cwd: repository, paths: ['doc.md'] })).status, 'pass');

  const standalone = path.join(parent, 'standalone');
  fs.mkdirSync(standalone);
  fs.writeFileSync(path.join(standalone, 'doc.md'), '# Clean\n', 'utf8');
  assert.equal((await check({ cwd: standalone, paths: ['doc.md'] })).status, 'pass');
});

test('v2 exclusions prune unreadable directories before nested config discovery', async (t) => {
  const root = initRepository(t);
  const restricted = path.join(root, 'restricted');
  fs.mkdirSync(restricted);
  fs.writeFileSync(path.join(root, 'doc.md'), '# Clean\n', 'utf8');
  fs.writeFileSync(path.join(restricted, 'hidden.md'), '# Hidden\n', 'utf8');
  commitAll(root);
  fs.chmodSync(restricted, 0o000);
  try {
    const direct = await check({ cwd: root, paths: ['restricted/hidden.md'] });
    assert.equal(direct.complete, false);
    assert.deepEqual(direct.files.map((file) => ({ path: file.path, scanned: file.scanned })), [
      { path: 'restricted/hidden.md', scanned: false }
    ]);
    assert.equal(direct.diagnostics.some((item) => item.code === 'file-unreadable'), true);
    assert.equal(direct.diagnostics.some((item) => item.code === 'target-outside-workspace'), false);

    const incomplete = await check({ cwd: root, paths: ['.'] });
    assert.equal(incomplete.complete, false);
    assert.equal(incomplete.diagnostics.some((item) => item.code === 'directory-unreadable'), true);

    const excludedByOption = await check({ cwd: root, paths: ['.'], exclude: ['restricted'] });
    assert.equal(excludedByOption.complete, true);
    assert.deepEqual(excludedByOption.files.map((file) => file.path), ['doc.md']);

    fs.writeFileSync(path.join(root, '.doclify-guardrail.json'), JSON.stringify({ exclude: ['restricted'] }), 'utf8');
    const excluded = await check({ cwd: root, paths: ['.'] });
    assert.equal(excluded.complete, true);
    assert.deepEqual(excluded.files.map((file) => file.path), ['doc.md']);
  } finally {
    fs.chmodSync(restricted, 0o700);
  }
});

test('v2 reports unreadable discovered config without misclassifying it as malformed JSON', async (t) => {
  const root = initRepository(t);
  const configPath = path.join(root, '.doclify-guardrail.json');
  fs.writeFileSync(configPath, '{}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'doc.md'), '# Clean\n', 'utf8');
  commitAll(root);
  fs.chmodSync(configPath, 0o000);
  try {
    await assert.rejects(
      check({ cwd: root, paths: ['doc.md'] }),
      (error) => error?.code === 'config-invalid'
        && /cannot be read/.test(error.message)
        && !/valid JSON/.test(error.message)
    );

    const cli = runCli(['check', 'doc.md'], root);
    assert.equal(cli.status, 2);
    assert.match(cli.stderr, /^config-invalid: Configuration file cannot be read:/);
  } finally {
    fs.chmodSync(configPath, 0o600);
  }
});

test('v2 repository siteRoot is stable when check runs from a subdirectory', async (t) => {
  const root = initRepository(t);
  const docs = path.join(root, 'docs');
  const publicDir = path.join(root, 'public');
  fs.mkdirSync(docs);
  fs.mkdirSync(publicDir);
  fs.writeFileSync(path.join(root, '.doclify-guardrail.json'), JSON.stringify({ siteRoot: 'public' }), 'utf8');
  fs.writeFileSync(path.join(docs, 'guide.md'), '# Guide\n\n[home](/existing.md)\n', 'utf8');
  fs.writeFileSync(path.join(publicDir, 'existing.md'), '# Existing\n', 'utf8');
  commitAll(root);

  const fromRoot = await check({ cwd: root, paths: ['docs/guide.md'] });
  const fromDocs = await check({ cwd: docs, paths: ['guide.md'] });
  assert.equal(fromRoot.status, 'pass');
  assert.equal(fromDocs.status, 'pass');
  assert.deepEqual(fromRoot.findings, []);
  assert.deepEqual(fromDocs.findings, []);
});

test('v2 changed works from a linked worktree and its subdirectory', (t) => {
  const main = initRepository(t);
  fs.writeFileSync(path.join(main, 'doc.md'), '# Original\n', 'utf8');
  commitAll(main);

  const worktree = makeTempDir(t);
  fs.rmdirSync(worktree);
  assert.equal(git(main, 'worktree', 'add', '-q', '-b', 'fixture-worktree', worktree).status, 0);
  t.after(() => {
    git(main, 'worktree', 'remove', '--force', worktree);
    git(main, 'branch', '-D', 'fixture-worktree');
  });
  const docs = path.join(worktree, 'docs');
  fs.mkdirSync(docs);
  fs.writeFileSync(path.join(worktree, 'doc.md'), '# Changed\n', 'utf8');

  const rootRun = runCli(['changed', '--base', 'HEAD', '--format', 'json'], worktree);
  const subdirRun = runCli(['changed', '--base', 'HEAD', '--format', 'json'], docs);
  assert.equal(rootRun.status, 0, rootRun.stderr);
  assert.equal(subdirRun.status, 0, subdirRun.stderr);
  assert.equal(subdirRun.stdout, rootRun.stdout);
});

test('v2 Git discovery is constant per scan instead of per file', (t) => {
  const root = initRepository(t);
  for (let index = 0; index < 12; index += 1) {
    fs.writeFileSync(path.join(root, `doc-${index}.md`), '# Original\n', 'utf8');
  }
  commitAll(root);
  for (let index = 0; index < 12; index += 1) {
    fs.writeFileSync(path.join(root, `doc-${index}.md`), '# Changed\n', 'utf8');
  }

  const wrapperDirectory = makeTempDir(t);
  const logPath = path.join(wrapperDirectory, 'git-calls.log');
  const realGit = (process.env.PATH || '')
    .split(path.delimiter)
    .map((directory) => path.join(directory, 'git'))
    .find((candidate) => {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  assert.ok(realGit, 'git executable not found');
  const wrapper = path.join(wrapperDirectory, 'git');
  fs.writeFileSync(wrapper, `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
fs.appendFileSync(process.env.DOCLIFY_GIT_CALL_LOG, process.argv.slice(2).join(' ') + '\\n');
const result = spawnSync(process.env.DOCLIFY_REAL_GIT, process.argv.slice(2), { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
`, 'utf8');
  fs.chmodSync(wrapper, 0o755);
  const instrumentedEnvironment = {
    PATH: `${wrapperDirectory}${path.delimiter}${process.env.PATH || ''}`,
    DOCLIFY_GIT_CALL_LOG: logPath,
    DOCLIFY_REAL_GIT: realGit
  };

  const changed = runCli(['changed', '--base', 'HEAD', '--format', 'json'], root, instrumentedEnvironment);
  assert.equal(changed.status, 0, changed.stderr);
  assert.equal(JSON.parse(changed.stdout).files.length, 12);
  assert.equal(fs.readFileSync(logPath, 'utf8').trim().split('\n').length, 2);

  fs.writeFileSync(logPath, '', 'utf8');
  const checked = runCli(['check', '.', '--format', 'json'], root, instrumentedEnvironment);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).files.length, 12);
  assert.equal(fs.readFileSync(logPath, 'utf8').trim().split('\n').length, 1);
});
