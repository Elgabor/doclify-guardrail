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

// === Core rules tests ===

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

// === Line number tests ===

test('frontmatter: finding has line 1', () => {
  const md = `# Titolo\nContenuto`;
  const res = checkMarkdown(md);
  const fm = res.warnings.find((w) => w.code === 'frontmatter');
  assert.ok(fm, 'frontmatter warning should exist');
  assert.equal(fm.line, 1);
});

test('single-h1: duplicate H1s produce separate findings with correct line numbers', () => {
  const md = `---\ntitle: Test\n---\n# First\nContent\n# Second\nMore\n# Third`;
  const res = checkMarkdown(md);
  const h1Errors = res.errors.filter((e) => e.code === 'single-h1');
  assert.equal(h1Errors.length, 3);
  assert.equal(h1Errors[0].line, 4);
  assert.equal(h1Errors[1].line, 6);
  assert.equal(h1Errors[2].line, 8);
});

test('line-length: finding has correct line number', () => {
  const longLine = 'x'.repeat(200);
  const md = `---\ntitle: Test\n---\n# Titolo\nshort\n${longLine}`;
  const res = checkMarkdown(md);
  const ll = res.warnings.find((w) => w.code === 'line-length');
  assert.ok(ll, 'line-length warning should exist');
  assert.equal(ll.line, 6);
});

test('placeholder: each occurrence has its own line number', () => {
  const md = `---\ntitle: Test\n---\n# Titolo\nOk line\nTODO first\nAnother line\nTODO second`;
  const res = checkMarkdown(md);
  const todos = res.warnings.filter((w) => w.code === 'placeholder');
  assert.ok(todos.length >= 2, 'Should find at least 2 placeholder warnings');
  const todoLines = todos.map((w) => w.line);
  assert.ok(todoLines.includes(6), 'Should find TODO at line 6');
  assert.ok(todoLines.includes(8), 'Should find TODO at line 8');
});

test('insecure-link: each link reported with line number', () => {
  const md = `---\ntitle: Test\n---\n# Titolo\n[a](http://a.com)\nok\n[b](http://b.com)`;
  const res = checkMarkdown(md);
  const links = res.warnings.filter((w) => w.code === 'insecure-link');
  assert.equal(links.length, 2);
  assert.equal(links[0].line, 5);
  assert.equal(links[1].line, 7);
});

test('all findings have numeric line field', () => {
  const md = `No frontmatter\nTODO placeholder\n[link](http://insecure.com)`;
  const res = checkMarkdown(md);
  const allFindings = [...res.errors, ...res.warnings];
  assert.ok(allFindings.length > 0, 'Should have findings');
  for (const f of allFindings) {
    assert.equal(typeof f.line, 'number', `Finding ${f.code} should have numeric line`);
  }
});
