import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const verifier = fileURLToPath(new URL('./verify-release.mjs', import.meta.url));
const env = {
  PATH: process.env.PATH || '', LANG: 'C', LC_ALL: 'C',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0'
};

function fixture(t, manifest = { name: 'doclify-guardrail', version: '2.0.1' }) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-release-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release@example.invalid');
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify(manifest));
  git('add', 'package.json');
  git('commit', '-qm', 'fixture');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const run = (overrides = {}) => {
    const output = path.join(cwd, 'outputs');
    fs.writeFileSync(output, '');
    const result = spawnSync(process.execPath, [verifier], {
      cwd, encoding: 'utf8', env: {
        ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
        RELEASE_TAG: 'v2.0.1', GITHUB_OUTPUT: output, ...overrides
      }
    });
    return { ...result, outputs: fs.readFileSync(output, 'utf8') };
  };
  return { cwd, git, run };
}

function rejected(run) {
  assert.equal(run.status, 1, run.stdout || run.stderr);
  assert.equal(run.outputs, '');
  assert.match(run.stderr, /Release verification failed/);
}

test('release verifier accepts an annotated version tag on origin/main and emits immutable IDs', (t) => {
  const { git, run } = fixture(t);
  git('tag', '-a', 'v2.0.1', '-m', 'fixture release');
  const commit = git('rev-parse', 'HEAD');
  const tag = git('rev-parse', 'refs/tags/v2.0.1');
  const result = run({ EXPECTED_COMMIT: commit, EXPECTED_TAG_OBJECT: tag });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs, `commit=${commit}\ntag-object=${tag}\n`);
});

test('release verifier refuses other events, branches and invalid tag input', (t) => {
  const { git, run } = fixture(t);
  git('tag', '-a', 'v2.0.1', '-m', 'fixture release');
  for (const overrides of [
    { GITHUB_EVENT_NAME: 'push' }, { GITHUB_REF: 'refs/heads/feature' },
    { RELEASE_TAG: '--help' }, { RELEASE_TAG: 'v2.0.1;echo injected' },
    { RELEASE_TAG: 'v2.0.1-beta.1' }, { RELEASE_TAG: 'v02.0.1' }
  ]) rejected(run(overrides));
});

test('release verifier refuses a lightweight tag', (t) => {
  const { git, run } = fixture(t);
  git('tag', 'v2.0.1');
  rejected(run());
});

test('release verifier refuses a tagged commit outside origin/main', (t) => {
  const { cwd, git, run } = fixture(t);
  fs.writeFileSync(path.join(cwd, 'other'), 'outside main');
  git('add', 'other');
  git('commit', '-qm', 'unmerged');
  git('tag', '-a', 'v2.0.1', '-m', 'fixture release');
  rejected(run());
});

test('release verifier refuses a tag/version mismatch', (t) => {
  const { git, run } = fixture(t);
  git('tag', '-a', 'v2.0.2', '-m', 'fixture release');
  rejected(run({ RELEASE_TAG: 'v2.0.2' }));
});

test('release verifier refuses changed commit or annotation after the test job', (t) => {
  const { git, run } = fixture(t);
  git('tag', '-a', 'v2.0.1', '-m', 'fixture release');
  rejected(run({ EXPECTED_COMMIT: '0'.repeat(40) }));
  rejected(run({ EXPECTED_TAG_OBJECT: '0'.repeat(40) }));
});

test('release verifier refuses an unexpected or private package', (t) => {
  for (const manifest of [
    { name: 'other-package', version: '2.0.1' },
    { name: 'doclify-guardrail', version: '2.0.1', private: true }
  ]) {
    const { git, run } = fixture(t, manifest);
    git('tag', '-a', 'v2.0.1', '-m', 'fixture release');
    rejected(run());
  }
});
