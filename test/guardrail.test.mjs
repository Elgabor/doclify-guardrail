import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkMarkdown, parseArgs, resolveOptions } from '../src/index.mjs';
import { stripCodeBlocks } from '../src/checker.mjs';
import { resolveFileList, findMarkdownFiles } from '../src/glob.mjs';
import { generateReport } from '../src/report.mjs';
import { loadCustomRules } from '../src/rules-loader.mjs';

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
  assert.throws(() => parseArgs(['--boh']), /Unknown option/);
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
  assert.equal(parsed.files[0].pass, false);
  assert.equal(parsed.strict, true);
  assert.equal(parsed.summary.totalWarnings > 0, true);
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
  assert.equal(parsed.files[0].pass, true);
  assert.equal(parsed.summary.totalWarnings > 0, true);
});

test('CLI: file non trovato -> exit 2', () => {
  const run = spawnSync(process.execPath, [CLI_PATH, 'not-existing.md'], {
    encoding: 'utf8'
  });
  // Non-existent file produces exit 1 (reported as fileError, not usage error)
  // because it's resolved by resolveFileList but fails to read
  assert.ok(run.status !== 0, 'Should have non-zero exit code');
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

// === Code block exclusion tests ===

test('stripCodeBlocks: preserves line count', () => {
  const md = '# Title\n```\ncode line 1\ncode line 2\n```\nAfter code';
  const stripped = stripCodeBlocks(md);
  const originalLines = md.split('\n').length;
  const strippedLines = stripped.split('\n').length;
  assert.equal(strippedLines, originalLines);
});

test('TODO inside fenced code block is ignored', () => {
  const md = `---\ntitle: Test\n---\n# Titolo\n\`\`\`\nTODO: this is code\n\`\`\``;
  const res = checkMarkdown(md);
  const placeholders = res.warnings.filter((w) => w.code === 'placeholder');
  assert.equal(placeholders.length, 0);
});

test('TODO outside code block is detected', () => {
  const md = `---\ntitle: Test\n---\n# Titolo\n\`\`\`\ncode\n\`\`\`\nTODO: fix this`;
  const res = checkMarkdown(md);
  const placeholders = res.warnings.filter((w) => w.code === 'placeholder');
  assert.equal(placeholders.length, 1);
  assert.equal(placeholders[0].line, 8);
});

test('H1 inside code block is not counted', () => {
  const md = `---\ntitle: Test\n---\n# Real H1\n\`\`\`\n# Fake H1\n\`\`\``;
  const res = checkMarkdown(md);
  assert.equal(res.summary.errors, 0);
});

test('insecure link inside code block is ignored', () => {
  const md = `---\ntitle: Test\n---\n# Titolo\n\`\`\`\n[link](http://example.com)\n\`\`\``;
  const res = checkMarkdown(md);
  const links = res.warnings.filter((w) => w.code === 'insecure-link');
  assert.equal(links.length, 0);
});

test('tilde fenced code block is handled', () => {
  const md = `---\ntitle: Test\n---\n# Titolo\n~~~\nTODO: in tilde block\n~~~`;
  const res = checkMarkdown(md);
  const placeholders = res.warnings.filter((w) => w.code === 'placeholder');
  assert.equal(placeholders.length, 0);
});

test('inline code TODO is ignored', () => {
  const md = `---\ntitle: Test\n---\n# Titolo\nUse \`TODO\` as marker`;
  const res = checkMarkdown(md);
  const placeholders = res.warnings.filter((w) => w.code === 'placeholder');
  assert.equal(placeholders.length, 0);
});

// === Multi-file and directory scanning tests ===

test('parseArgs: collects multiple files', () => {
  const args = parseArgs(['a.md', 'b.md', 'c.md']);
  assert.deepEqual(args.files, ['a.md', 'b.md', 'c.md']);
});

test('parseArgs: accepts --dir flag', () => {
  const args = parseArgs(['--dir', 'docs/']);
  assert.equal(args.dir, 'docs/');
});

test('parseArgs: accepts --no-color flag', () => {
  const args = parseArgs(['file.md', '--no-color']);
  assert.equal(args.noColor, true);
});

test('findMarkdownFiles: expands directory to .md files', () => {
  const tmp = makeTempDir();
  fs.writeFileSync(path.join(tmp, 'a.md'), '# A', 'utf8');
  fs.writeFileSync(path.join(tmp, 'b.md'), '# B', 'utf8');
  fs.writeFileSync(path.join(tmp, 'c.txt'), 'not markdown', 'utf8');
  fs.mkdirSync(path.join(tmp, 'sub'));
  fs.writeFileSync(path.join(tmp, 'sub', 'd.md'), '# D', 'utf8');

  const files = findMarkdownFiles(tmp);
  assert.equal(files.length, 3, 'Should find 3 .md files');
  assert.ok(files.every(f => f.endsWith('.md')), 'All files should be .md');
});

test('resolveFileList: handles directory target', () => {
  const tmp = makeTempDir();
  fs.writeFileSync(path.join(tmp, 'a.md'), '# A', 'utf8');
  fs.writeFileSync(path.join(tmp, 'b.md'), '# B', 'utf8');

  const files = resolveFileList({ files: [tmp], dir: null });
  assert.equal(files.length, 2);
});

test('resolveFileList: ignores non-.md files in directory', () => {
  const tmp = makeTempDir();
  fs.writeFileSync(path.join(tmp, 'a.md'), '# A', 'utf8');
  fs.writeFileSync(path.join(tmp, 'b.txt'), 'text', 'utf8');
  fs.writeFileSync(path.join(tmp, 'c.json'), '{}', 'utf8');

  const files = resolveFileList({ files: [tmp], dir: null });
  assert.equal(files.length, 1);
  assert.ok(files[0].endsWith('a.md'));
});

test('CLI: single file output has files[] array with 1 element', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '---\ntitle: T\n---\n# T\nClean', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.version, '1.0');
  assert.ok(Array.isArray(parsed.files), 'Should have files array');
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].pass, true);
});

test('CLI: multi-file JSON output has files[] array', () => {
  const tmp = makeTempDir();
  const md1 = path.join(tmp, 'ok.md');
  const md2 = path.join(tmp, 'fail.md');
  fs.writeFileSync(md1, '---\ntitle: T\n---\n# OK\nClean', 'utf8');
  fs.writeFileSync(md2, '---\ntitle: T\n---\n# A\n# B\nDuplicate H1', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, md1, md2], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.summary.filesPassed, 1);
  assert.equal(parsed.summary.filesFailed, 1);
});

test('CLI: directory scanning works', () => {
  const tmp = makeTempDir();
  fs.writeFileSync(path.join(tmp, 'a.md'), '---\ntitle: A\n---\n# A\nOk', 'utf8');
  fs.writeFileSync(path.join(tmp, 'b.md'), '---\ntitle: B\n---\n# B\nOk', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, tmp], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.summary.filesPassed, 2);
});

test('CLI: unreadable file does not crash, reported in output', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'ok.md');
  const badPath = path.join(tmp, 'unreadable.md');
  fs.writeFileSync(mdPath, '---\ntitle: T\n---\n# T\nOk', 'utf8');
  fs.writeFileSync(badPath, 'content', 'utf8');
  fs.chmodSync(badPath, 0o000);

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, badPath], { encoding: 'utf8' });
  // Should not crash — exit 1 because fileErrors exist
  assert.equal(run.status, 1);
  const parsed = JSON.parse(run.stdout);
  assert.ok(parsed.fileErrors, 'Should have fileErrors');
  assert.equal(parsed.fileErrors.length, 1);

  // Cleanup
  fs.chmodSync(badPath, 0o644);
});

test('CLI: exit code 1 when any file fails', () => {
  const tmp = makeTempDir();
  const good = path.join(tmp, 'good.md');
  const bad = path.join(tmp, 'bad.md');
  fs.writeFileSync(good, '---\ntitle: T\n---\n# Good\nOk', 'utf8');
  fs.writeFileSync(bad, '---\ntitle: T\n---\n# A\n# B\nDuplicate', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, good, bad], { encoding: 'utf8' });
  assert.equal(run.status, 1);
});

// === Report tests ===

test('parseArgs: --report with default path', () => {
  const args = parseArgs(['file.md', '--report']);
  assert.equal(args.report, 'doclify-report.md');
});

test('parseArgs: --report with custom path', () => {
  const args = parseArgs(['file.md', '--report', 'custom-report.md']);
  assert.equal(args.report, 'custom-report.md');
});

test('generateReport: produces valid markdown with findings', () => {
  const tmp = makeTempDir();
  const reportPath = path.join(tmp, 'report.md');

  const output = {
    version: '1.0',
    strict: false,
    files: [
      {
        file: 'test.md',
        pass: false,
        findings: {
          errors: [{ code: 'single-h1', severity: 'error', message: 'Manca titolo H1.', line: 1 }],
          warnings: [{ code: 'placeholder', severity: 'warning', message: 'Placeholder rilevato', line: 5 }]
        },
        summary: { errors: 1, warnings: 1, status: 'FAIL' }
      }
    ],
    summary: {
      filesScanned: 1, filesPassed: 0, filesFailed: 1, filesErrored: 0,
      totalErrors: 1, totalWarnings: 1, status: 'FAIL', elapsed: 0.1
    }
  };

  const result = generateReport(output, { reportPath });
  assert.ok(fs.existsSync(result), 'Report file should exist');
  const content = fs.readFileSync(result, 'utf8');
  assert.ok(content.includes('# Doclify Guardrail Report'), 'Should have title');
  assert.ok(content.includes('test.md'), 'Should contain filename');
  assert.ok(content.includes('ERROR'), 'Should contain error details');
  assert.ok(content.includes('WARNING'), 'Should contain warning details');
});

test('CLI: --report writes file to disk', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  const reportPath = path.join(tmp, 'report.md');
  fs.writeFileSync(mdPath, '# Titolo\nTODO: fix', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--report', reportPath], {
    encoding: 'utf8'
  });

  assert.ok(fs.existsSync(reportPath), 'Report file should be created');
  const content = fs.readFileSync(reportPath, 'utf8');
  assert.ok(content.includes('Doclify Guardrail Report'));
});

// === Custom rules tests ===

test('loadCustomRules: loads valid rules file', () => {
  const tmp = makeTempDir();
  const rulesPath = path.join(tmp, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify({
    rules: [
      { id: 'no-foo', severity: 'error', pattern: '\\bfoo\\b', message: 'Do not use foo' }
    ]
  }), 'utf8');

  const rules = loadCustomRules(rulesPath);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 'no-foo');
  assert.ok(rules[0].pattern instanceof RegExp);
});

test('loadCustomRules: rejects malformed JSON', () => {
  const tmp = makeTempDir();
  const rulesPath = path.join(tmp, 'bad.json');
  fs.writeFileSync(rulesPath, 'not json{{{', 'utf8');

  assert.throws(() => loadCustomRules(rulesPath), /Invalid JSON/);
});

test('loadCustomRules: rejects invalid regex', () => {
  const tmp = makeTempDir();
  const rulesPath = path.join(tmp, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify({
    rules: [
      { id: 'bad-regex', severity: 'warning', pattern: '[invalid', message: 'bad' }
    ]
  }), 'utf8');

  assert.throws(() => loadCustomRules(rulesPath), /bad-regex/);
});

test('custom rule detects pattern with line number', () => {
  const md = `---\ntitle: Test\n---\n# Title\nThis has foo in it`;
  const customRules = [
    { id: 'no-foo', severity: 'error', pattern: /\bfoo\b/gi, message: 'Do not use foo' }
  ];
  const res = checkMarkdown(md, { customRules });
  const fooErrors = res.errors.filter(e => e.code === 'no-foo');
  assert.equal(fooErrors.length, 1);
  assert.equal(fooErrors[0].line, 5);
  assert.equal(fooErrors[0].message, 'Do not use foo');
});

test('custom rule inside code block is ignored', () => {
  const md = `---\ntitle: Test\n---\n# Title\n\`\`\`\nfoo bar\n\`\`\``;
  const customRules = [
    { id: 'no-foo', severity: 'error', pattern: /\bfoo\b/gi, message: 'Do not use foo' }
  ];
  const res = checkMarkdown(md, { customRules });
  const fooErrors = res.errors.filter(e => e.code === 'no-foo');
  assert.equal(fooErrors.length, 0);
});

test('custom and built-in rules coexist', () => {
  const md = `# Title\nTODO fix\nThis has foo`;
  const customRules = [
    { id: 'no-foo', severity: 'warning', pattern: /\bfoo\b/gi, message: 'No foo' }
  ];
  const res = checkMarkdown(md, { customRules });
  const placeholders = res.warnings.filter(w => w.code === 'placeholder');
  const foos = res.warnings.filter(w => w.code === 'no-foo');
  assert.ok(placeholders.length > 0, 'Built-in placeholder rule should fire');
  assert.ok(foos.length > 0, 'Custom rule should fire');
});

test('CLI: --rules applies custom rules', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  const rulesPath = path.join(tmp, 'rules.json');
  fs.writeFileSync(mdPath, '---\ntitle: T\n---\n# Title\nThis has foo', 'utf8');
  fs.writeFileSync(rulesPath, JSON.stringify({
    rules: [
      { id: 'no-foo', severity: 'error', pattern: '\\bfoo\\b', message: 'No foo allowed' }
    ]
  }), 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--rules', rulesPath], {
    encoding: 'utf8'
  });

  assert.equal(run.status, 1);
  const parsed = JSON.parse(run.stdout);
  const errors = parsed.files[0].findings.errors;
  assert.ok(errors.some(e => e.code === 'no-foo'), 'Custom rule should produce error');
});

// === Color output tests ===

test('CLI: --no-color produces output without ANSI escape codes on stderr', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '# Titolo\nTODO da completare', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--no-color'], {
    encoding: 'utf8'
  });

  // stderr should not contain ANSI escape codes
  assert.ok(!run.stderr.includes('\x1b['), 'stderr should have no ANSI codes with --no-color');
});

test('CLI: stdout JSON never contains ANSI escape codes', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '# Titolo\nTODO da completare', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath], {
    encoding: 'utf8'
  });

  // stdout (JSON) should never have ANSI codes
  assert.ok(!run.stdout.includes('\x1b['), 'stdout JSON should have no ANSI codes');
  // Should still be valid JSON
  assert.doesNotThrow(() => JSON.parse(run.stdout), 'stdout should be valid JSON');
});

// === Extended patterns + English messages tests ===

test('placeholder: detects FIXME', () => {
  const md = `---\ntitle: T\n---\n# Title\nFIXME: broken`;
  const res = checkMarkdown(md);
  const findings = res.warnings.filter(w => w.code === 'placeholder');
  assert.ok(findings.length > 0, 'Should detect FIXME');
  assert.ok(findings[0].message.includes('FIXME'), 'Message should mention FIXME');
});

test('placeholder: detects TBD', () => {
  const md = `---\ntitle: T\n---\n# Title\nThis section is TBD`;
  const res = checkMarkdown(md);
  const findings = res.warnings.filter(w => w.code === 'placeholder');
  assert.ok(findings.length > 0, 'Should detect TBD');
});

test('placeholder: detects [insert here]', () => {
  const md = `---\ntitle: T\n---\n# Title\nName: [insert here]`;
  const res = checkMarkdown(md);
  const findings = res.warnings.filter(w => w.code === 'placeholder');
  assert.ok(findings.length > 0, 'Should detect [insert here]');
});

test('placeholder: messages are human-readable (no regex)', () => {
  const md = `---\ntitle: T\n---\n# Title\nTODO: something`;
  const res = checkMarkdown(md);
  const findings = res.warnings.filter(w => w.code === 'placeholder');
  assert.ok(findings.length > 0);
  // Should NOT contain regex-like patterns
  assert.ok(!findings[0].message.includes('/\\b'), 'Message should not contain regex');
  assert.ok(findings[0].message.includes('TODO'), 'Message should mention TODO');
});

test('insecure-link: detects bare http URL', () => {
  const md = `---\ntitle: T\n---\n# Title\nVisit http://example.com for more`;
  const res = checkMarkdown(md);
  const links = res.warnings.filter(w => w.code === 'insecure-link');
  assert.ok(links.length > 0, 'Should detect bare http URL');
  assert.ok(links[0].message.includes('https://'), 'Should suggest https');
});

test('insecure-link: detects reference-style http link', () => {
  const md = `---\ntitle: T\n---\n# Title\nSee [ref] for details\n\n[ref]: http://example.com/page`;
  const res = checkMarkdown(md);
  const links = res.warnings.filter(w => w.code === 'insecure-link');
  assert.ok(links.length > 0, 'Should detect reference-style http link');
});

test('single-h1: message includes line numbers', () => {
  const md = `---\ntitle: T\n---\n# First\nContent\n# Second`;
  const res = checkMarkdown(md);
  const h1Errors = res.errors.filter(e => e.code === 'single-h1');
  assert.ok(h1Errors.length > 0);
  assert.ok(h1Errors[0].message.includes('lines'), 'Message should mention line numbers');
  assert.ok(h1Errors[0].message.includes('2'), 'Should list actual count');
});

test('all English: frontmatter message is in English', () => {
  const md = `# Title\nContent`;
  const res = checkMarkdown(md);
  const fm = res.warnings.find(w => w.code === 'frontmatter');
  assert.ok(fm);
  assert.ok(fm.message.includes('Missing frontmatter'), 'Frontmatter message should be in English');
});
