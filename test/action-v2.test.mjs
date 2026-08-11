import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ACTION_INPUTS, buildCliArgs } from '../action/entrypoint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACTION_SOURCE = path.join(ROOT, 'action', 'entrypoint.mjs');
const ACTION_BUNDLE = path.join(ROOT, 'action', 'dist', 'index.mjs');

function temp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-action-v2-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function parseOutputs(content) {
  const outputs = {};
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([^<]+)<<(.+)$/.exec(lines[index]);
    if (!match) continue;
    const [, name, delimiter] = match;
    const value = [];
    for (index += 1; index < lines.length && lines[index] !== delimiter; index += 1) value.push(lines[index]);
    outputs[name] = value.join('\n');
  }
  return outputs;
}

function runAction(t, content, inputs = {}, entrypoint = ACTION_SOURCE, prepare) {
  const cwd = temp(t);
  fs.writeFileSync(path.join(cwd, 'README.md'), content, 'utf8');
  const outputFile = path.join(cwd, 'github-output');
  fs.writeFileSync(outputFile, '', 'utf8');
  if (prepare) prepare(cwd);
  const env = {
    PATH: process.env.PATH || '',
    LANG: 'C',
    LC_ALL: 'C',
    NO_COLOR: '1',
    GITHUB_WORKSPACE: cwd,
    GITHUB_OUTPUT: outputFile,
    INPUT_PATH: 'README.md'
  };
  for (const [name, value] of Object.entries(inputs)) {
    env[`INPUT_${name.toUpperCase()}`] = String(value);
  }
  const run = spawnSync(process.execPath, [entrypoint], {
    cwd,
    encoding: 'utf8',
    env,
    maxBuffer: 16 * 1024 * 1024
  });
  return { ...run, outputs: parseOutputs(fs.readFileSync(outputFile, 'utf8')) };
}

test('Action v2 is token-free and offline by default', (t) => {
  const metadata = fs.readFileSync(path.join(ROOT, 'action', 'action.yml'), 'utf8');
  const declaredInputs = [...metadata.slice(metadata.indexOf('inputs:'), metadata.indexOf('outputs:'))
    .matchAll(/^  ([a-z][a-z-]+):$/gm)].map((match) => match[1]).sort();
  assert.deepEqual(declaredInputs, [...ACTION_INPUTS].sort());
  const actionPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'action', 'package.json'), 'utf8'));
  assert.equal(actionPackage.dependencies['@actions/github'], undefined);
  assert.match(metadata, /external-links:\s+[\s\S]*?default: 'false'/);

  const run = runAction(t, '# Readme\n\n[private](http://127.0.0.1:1/private)\n');
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stderr, '');
  assert.deepEqual(run.outputs, {
    status: 'pass',
    complete: 'true',
    files: '1',
    blocking: '0',
    advisory: '0',
    diagnostics: '0'
  });
});

test('Action v2 maps every declared scan option to structured CLI arguments', () => {
  const original = new Map([...ACTION_INPUTS].map((name) => {
    const key = `INPUT_${name.toUpperCase()}`;
    return [key, process.env[key]];
  }));
  const setInputs = (inputs) => {
    for (const name of ACTION_INPUTS) delete process.env[`INPUT_${name.toUpperCase()}`];
    for (const [name, value] of Object.entries(inputs)) process.env[`INPUT_${name.toUpperCase()}`] = value;
  };
  try {
    setInputs({
      mode: 'check', path: 'README.md', config: 'config.json',
      'ignore-rules': 'local-link', exclude: 'drafts', 'site-root': 'docs',
      'external-links': 'true', 'link-allow-list': 'example.com',
      'link-timeout-ms': '1000', 'link-concurrency': '2'
    });
    assert.deepEqual(buildCliArgs().slice(1), [
      'check', 'README.md', '--format', 'json', '--config', 'config.json',
      '--ignore-rules', 'local-link', '--exclude', 'drafts', '--site-root', 'docs',
      '--link-allow-list', 'example.com', '--link-timeout-ms', '1000',
      '--link-concurrency', '2', '--external-links'
    ]);
    setInputs({ mode: 'changed', base: 'origin/main', staged: 'false' });
    assert.deepEqual(buildCliArgs().slice(1), [
      'changed', '--base', 'origin/main', '--format', 'json'
    ]);
    setInputs({ mode: 'changed', staged: 'true' });
    assert.deepEqual(buildCliArgs().slice(1), ['changed', '--staged', '--format', 'json']);
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Action v2 annotates blocking findings and preserves result counts', (t) => {
  const run = runAction(t, '# Readme\n\n[missing](missing.md)\n');
  assert.equal(run.status, 1);
  assert.equal(run.stderr, '');
  assert.match(run.stdout, /::error /);
  assert.match(run.stdout, /local-link/);
  assert.equal(run.outputs.status, 'fail');
  assert.equal(run.outputs.complete, 'true');
  assert.equal(run.outputs.files, '1');
  assert.equal(run.outputs.blocking, '1');
  assert.equal(run.outputs.advisory, '0');
  assert.equal(run.outputs.diagnostics, '0');
});

test('Action v2 escapes annotation command data from Markdown', (t) => {
  const run = runAction(t, '# Readme\n\n[spoof](missing%0A::error::.md)\n');
  assert.equal(run.status, 1);
  assert.match(run.stdout, /missing%250A::error::\.md/);
  assert.doesNotMatch(run.stdout, /missing\n::error::/);
});

test('Action v2 makes remote checks explicit and reports annotation truncation', (t) => {
  const remote = runAction(t, '# Readme\n\n[private](http://127.0.0.1/private)\n', {
    'external-links': 'true'
  });
  assert.equal(remote.status, 0, remote.stderr || remote.stdout);
  assert.equal(remote.outputs.status, 'pass');
  assert.equal(remote.outputs.advisory, '1');
  assert.match(remote.stdout, /::warning /);
  assert.match(remote.stdout, /external-link/);

  const findings = Array.from({ length: 55 }, (_, index) => `[missing ${index}](missing-${index}.md)`).join('\n');
  const truncated = runAction(t, `# Readme\n\n${findings}\n`);
  assert.equal(truncated.status, 1);
  assert.equal(truncated.outputs.blocking, '55');
  assert.match(truncated.stdout, /50 of 55 annotations shown/);
});

test('Action v2 annotates incomplete scans before failing the step', (t) => {
  const run = runAction(t, '# Readme\n', { path: 'missing.md' });
  assert.equal(run.status, 1);
  assert.equal(run.outputs.status, 'incomplete');
  assert.equal(run.outputs.complete, 'false');
  assert.equal(run.outputs.diagnostics, '1');
  assert.match(run.stdout, /::error /);
  assert.match(run.stdout, /file-unreadable/);
  assert.match(run.stdout, /Doclify scan incomplete/);
});

test('Action v2 distinguishes invalid invocation from integrity failure', (t) => {
  const run = runAction(t, '# Readme\n', { path: '-' });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /Doclify could not start the requested scan/);
  assert.deepEqual(run.outputs, {});
});

test('Action v2 source and bundle delegate staged selection to changed', (t) => {
  for (const entrypoint of [ACTION_SOURCE, ACTION_BUNDLE]) {
    const run = runAction(t, '# Readme\n', { mode: 'changed', staged: 'true' }, entrypoint, (cwd) => {
      for (const args of [
        ['init', '-q'],
        ['config', 'user.name', 'Doclify Test'],
        ['config', 'user.email', 'doclify@example.invalid'],
        ['add', 'README.md'],
        ['commit', '-qm', 'baseline']
      ]) execFileSync('git', args, { cwd, stdio: 'ignore' });
      fs.appendFileSync(path.join(cwd, 'README.md'), '\n[missing](missing.md)\n');
      fs.writeFileSync(path.join(cwd, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
      execFileSync('git', ['add', 'CHANGELOG.md'], { cwd, stdio: 'ignore' });
    });
    assert.equal(run.status, 0, `${entrypoint}: ${run.stderr || run.stdout}`);
    assert.equal(run.outputs.status, 'pass');
    assert.equal(run.outputs.files, '1');
    assert.equal(run.outputs.blocking, '0');
  }
});

test('Action v2 committed bundle matches the source adapter', (t) => {
  const content = '# Readme\n\n[missing](missing.md)\n';
  const source = runAction(t, content);
  const bundle = runAction(t, content, {}, ACTION_BUNDLE);
  assert.equal(bundle.status, source.status, bundle.stderr || bundle.stdout);
  assert.equal(bundle.stdout, source.stdout);
  assert.equal(bundle.stderr, source.stderr);
  assert.deepEqual(bundle.outputs, source.outputs);
});
