import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkMarkdown, parseArgs, resolveOptions } from '../src/index.mjs';

const CLI_PATH = path.resolve('src/index.mjs');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-guardrail-'));
}

test('passa con H1 singolo', () => {
  const md = `---\ntitle: Test\n---\n# Titolo\nContenuto`;
  const res = checkMarkdown(md);
  assert.equal(res.summary.errors, 0);
  assert.equal(res.summary.warnings, 0);
});

test('fallisce senza H1', () => {
  const md = `---\ntitle: Test\n---\nContenuto`;
  const res = checkMarkdown(md);
  assert.equal(res.summary.errors, 1);
  assert.equal(res.errors[0].code, 'single-h1');
  assert.equal(res.errors[0].severity, 'error');
});

test('warning su placeholder', () => {
  const md = `# Titolo\nTODO: completare`;
  const res = checkMarkdown(md);
  assert.equal(res.warnings.some((w) => w.code === 'placeholder'), true);
});

test('parseArgs: errore opzione sconosciuta', () => {
  assert.throws(() => parseArgs(['--boh']), /Opzione sconosciuta/);
});

test('resolveOptions: legge .doclify-guardrail.json', () => {
  const tmp = makeTempDir();
  const cfg = path.join(tmp, '.doclify-guardrail.json');
  fs.writeFileSync(cfg, JSON.stringify({ maxLineLength: 80, strict: true }), 'utf8');

  const args = parseArgs(['--config', cfg, 'a.md']);
  const resolved = resolveOptions(args);

  assert.equal(resolved.maxLineLength, 80);
  assert.equal(resolved.strict, true);
});

test('CLI: strict mode trasforma warning in fail (exit 1)', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '# Titolo\nTODO da completare', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--strict'], {
    encoding: 'utf8'
  });

  assert.equal(run.status, 1);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.pass, false);
  assert.equal(parsed.strict, true);
  assert.equal(parsed.summary.warnings > 0, true);
});

test('CLI: warning senza strict resta pass (exit 0)', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '# Titolo\nTODO da completare', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath], {
    encoding: 'utf8'
  });

  assert.equal(run.status, 0);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.pass, true);
  assert.equal(parsed.summary.warnings > 0, true);
});

test('CLI: file non trovato -> exit 2', () => {
  const run = spawnSync(process.execPath, [CLI_PATH, 'not-existing.md'], {
    encoding: 'utf8'
  });
  assert.equal(run.status, 2);
});

test('CLI: config strict=true applicata anche senza flag', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  const cfgPath = path.join(tmp, '.doclify-guardrail.json');

  fs.writeFileSync(mdPath, '# Titolo\nTODO da completare', 'utf8');
  fs.writeFileSync(cfgPath, JSON.stringify({ strict: true }), 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--config', cfgPath], {
    encoding: 'utf8'
  });

  assert.equal(run.status, 1);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.strict, true);
});
