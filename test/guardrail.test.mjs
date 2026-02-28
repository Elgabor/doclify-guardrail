import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { checkMarkdown, parseArgs, resolveOptions } from '../src/index.mjs';
import { stripCodeBlocks } from '../src/checker.mjs';
import { resolveFileList, findMarkdownFiles } from '../src/glob.mjs';
import { generateReport } from '../src/report.mjs';
import { loadCustomRules } from '../src/rules-loader.mjs';
import { autoFixInsecureLinks, autoFixFormatting } from '../src/fixer.mjs';
import { checkDeadLinks, extractLinks } from '../src/links.mjs';
import { computeDocHealthScore, checkDocFreshness } from '../src/quality.mjs';
import {
  computeHealthScore,
  generateJUnitXml,
  generateSarifJson,
  generateBadge
} from '../src/ci-output.mjs';

const CLI_PATH = path.resolve('src/index.mjs');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-guardrail-'));
}

// === Core rules tests ===

test('passa con H1 singolo', () => {
  const md = `---\ntitle: Test\n---\n\n# Titolo\n\nContenuto\n`;
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

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--strict', '--json'], {
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

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--json'], {
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

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--config', cfgPath, '--json'], {
    encoding: 'utf8'
  });

  assert.equal(run.status, 1);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.strict, true);
});

// === Line number tests ===

test('frontmatter: finding has line 1 when enabled', () => {
  const md = `# Titolo\nContenuto`;
  const res = checkMarkdown(md, { checkFrontmatter: true });
  const fm = res.warnings.find((w) => w.code === 'frontmatter');
  assert.ok(fm, 'frontmatter warning should exist when enabled');
  assert.equal(fm.line, 1);
});

test('single-h1: duplicate H1s produce one aggregated finding with first line', () => {
  const md = `---\ntitle: Test\n---\n# First\nContent\n# Second\nMore\n# Third`;
  const res = checkMarkdown(md);
  const h1Errors = res.errors.filter((e) => e.code === 'single-h1');
  assert.equal(h1Errors.length, 1);
  assert.equal(h1Errors[0].line, 4);
  assert.ok(h1Errors[0].message.includes('lines 4, 6, 8'));
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

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.version, PKG_VERSION);
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

  const run = spawnSync(process.execPath, [CLI_PATH, md1, md2, '--json'], { encoding: 'utf8' });
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

  const run = spawnSync(process.execPath, [CLI_PATH, tmp, '--json'], { encoding: 'utf8' });
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

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, badPath, '--json'], { encoding: 'utf8' });
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

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--rules', rulesPath, '--json'], {
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

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--json'], {
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

test('all English: frontmatter message is in English when enabled', () => {
  const md = `# Title\nContent`;
  const res = checkMarkdown(md, { checkFrontmatter: true });
  const fm = res.warnings.find(w => w.code === 'frontmatter');
  assert.ok(fm);
  assert.ok(fm.message.includes('Missing frontmatter'), 'Frontmatter message should be in English');
});

// === New features: fix / dry-run / dead links ===

test('parseArgs: --dry-run without --fix throws usage error', () => {
  assert.throws(() => parseArgs(['doc.md', '--dry-run']), /only be used with --fix/);
});

test('autoFixInsecureLinks: upgrades plain http links to https', () => {
  const md = '# Title\nVisit http://example.com and [site](http://example.org/path).';
  const fixed = autoFixInsecureLinks(md);
  assert.equal(fixed.modified, true);
  assert.ok(fixed.content.includes('https://example.com'));
  assert.ok(fixed.content.includes('(https://example.org/path)'));
});

test('autoFixInsecureLinks: skips ambiguous localhost URLs', () => {
  const md = '# Title\nLocal http://localhost:3000/path';
  const fixed = autoFixInsecureLinks(md);
  assert.equal(fixed.modified, false);
  assert.equal(fixed.ambiguous.length, 1);
});

test('CLI: --fix --dry-run does not modify file', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  const original = '# Title\nVisit http://example.com';
  fs.writeFileSync(mdPath, original, 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--fix', '--dry-run', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.equal(fs.readFileSync(mdPath, 'utf8'), original);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.fix.enabled, true);
  assert.equal(parsed.fix.dryRun, true);
  assert.equal(parsed.fix.filesChanged, 1);
});

test('CLI: --fix modifies file on disk', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '# Title\nVisit http://example.com', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--fix'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const updated = fs.readFileSync(mdPath, 'utf8');
  assert.ok(updated.includes('https://example.com'));
});

test('checkDeadLinks: reports missing local file links', async () => {
  const tmp = makeTempDir();
  const source = path.join(tmp, 'doc.md');
  const content = '# Title\nSee [missing](./missing.md)';
  fs.writeFileSync(source, content, 'utf8');

  const findings = await checkDeadLinks(content, { sourceFile: source });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'dead-link');
});

test('CLI: --check-links fails on missing local link', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '# Title\n[missing](./not-found.md)', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--check-links', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  const parsed = JSON.parse(run.stdout);
  const dead = parsed.files[0].findings.errors.find((e) => e.code === 'dead-link');
  assert.ok(dead);
});

// === New features: health score + freshness ===

test('computeDocHealthScore: clamps to 0..100 with diminishing warning penalty', () => {
  assert.equal(computeDocHealthScore({ errors: 0, warnings: 0 }), 100);
  assert.equal(computeDocHealthScore({ errors: 1, warnings: 0 }), 80);
  assert.equal(computeDocHealthScore({ errors: 0, warnings: 2 }), 89);
  assert.equal(computeDocHealthScore({ errors: 10, warnings: 10 }), 0);
  // Many warnings alone should not zero the score
  const manyWarnings = computeDocHealthScore({ errors: 0, warnings: 13 });
  assert.ok(manyWarnings > 40, `13 warnings should score > 40, got ${manyWarnings}`);
});

test('parseArgs: accepts --check-freshness flag', () => {
  const args = parseArgs(['doc.md', '--check-freshness']);
  assert.equal(args.checkFreshness, true);
});

test('checkDocFreshness: warns when missing freshness date', () => {
  const findings = checkDocFreshness('# Title\nBody', {
    now: new Date('2026-02-18T00:00:00Z'),
    sourceFile: 'doc.md'
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'stale-doc');
});

test('checkDocFreshness: passes when recent updated date exists', () => {
  const md = `---\nupdated: 2026-02-10\n---\n# Title`;
  const findings = checkDocFreshness(md, { now: new Date('2026-02-18T00:00:00Z') });
  assert.equal(findings.length, 0);
});

test('CLI: output includes health score fields', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '---\ntitle: T\n---\n# T\nBody', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const parsed = JSON.parse(run.stdout);
  assert.equal(typeof parsed.files[0].summary.healthScore, 'number');
  assert.equal(typeof parsed.summary.avgHealthScore, 'number');
});

test('CLI: --check-freshness adds stale-doc warning for old docs', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '---\nupdated: 2024-01-01\n---\n# Title', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--check-freshness', '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(run.stdout);
  const stale = parsed.files[0].findings.warnings.find((w) => w.code === 'stale-doc');
  assert.ok(stale);
});

// === New features: CI outputs + badge ===

test('parseArgs: --junit, --sarif and --badge default paths', () => {
  const args = parseArgs(['doc.md', '--junit', '--sarif', '--badge']);
  assert.equal(args.junit, 'doclify-junit.xml');
  assert.equal(args.sarif, 'doclify.sarif');
  assert.equal(args.badge, 'doclify-badge.svg');
});

test('parseArgs: --badge-label requires value', () => {
  assert.throws(() => parseArgs(['doc.md', '--badge-label']), /Missing value for --badge-label/);
});

test('computeHealthScore: stays in range 0..100', () => {
  assert.equal(computeHealthScore({ filesScanned: 1, totalErrors: 0, totalWarnings: 0 }), 100);
  const low = computeHealthScore({ filesScanned: 1, totalErrors: 10, totalWarnings: 30 });
  assert.ok(low >= 0 && low <= 100);
});

test('generateJUnitXml: emits testsuite and testcase', () => {
  const output = {
    version: '1.0',
    files: [
      {
        file: 'docs/a.md',
        findings: { errors: [], warnings: [] },
        summary: { errors: 0, warnings: 0, status: 'PASS' }
      }
    ],
    summary: {
      filesScanned: 1,
      filesPassed: 1,
      filesFailed: 0,
      filesErrored: 0,
      totalErrors: 0,
      totalWarnings: 0,
      elapsed: 0.1,
      status: 'PASS'
    }
  };

  const xml = generateJUnitXml(output);
  assert.ok(xml.includes('<testsuite'));
  assert.ok(xml.includes('<testcase'));
});

test('generateSarifJson: emits valid sarif structure', () => {
  const output = {
    version: '1.0',
    files: [
      {
        file: 'docs/a.md',
        findings: {
          errors: [{ code: 'single-h1', severity: 'error', message: 'Missing H1', line: 1 }],
          warnings: []
        },
        summary: { errors: 1, warnings: 0, status: 'FAIL' }
      }
    ],
    summary: {
      filesScanned: 1,
      filesPassed: 0,
      filesFailed: 1,
      filesErrored: 0,
      totalErrors: 1,
      totalWarnings: 0,
      elapsed: 0.2,
      status: 'FAIL'
    }
  };

  const sarif = generateSarifJson(output);
  assert.equal(sarif.version, '2.1.0');
  assert.ok(Array.isArray(sarif.runs));
  assert.ok(sarif.runs[0].results.length >= 1);
});

test('CLI: --junit --sarif --badge writes artifacts', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  const junitPath = path.join(tmp, 'report.xml');
  const sarifPath = path.join(tmp, 'report.sarif');
  const badgePath = path.join(tmp, 'badge.svg');

  fs.writeFileSync(mdPath, '---\ntitle: Test\n---\n# Title\nAll good', 'utf8');

  const run = spawnSync(process.execPath, [
    CLI_PATH,
    mdPath,
    '--junit', junitPath,
    '--sarif', sarifPath,
    '--badge', badgePath,
    '--badge-label', 'docs health',
    '--json'
  ], { encoding: 'utf8' });

  assert.equal(run.status, 0);
  assert.ok(fs.existsSync(junitPath));
  assert.ok(fs.existsSync(sarifPath));
  assert.ok(fs.existsSync(badgePath));

  const parsed = JSON.parse(run.stdout);
  assert.ok(typeof parsed.summary.healthScore === 'number');
});

test('generateBadge: writes SVG with custom label', () => {
  const tmp = makeTempDir();
  const badgePath = path.join(tmp, 'health.svg');
  const output = {
    summary: {
      filesScanned: 2,
      totalErrors: 0,
      totalWarnings: 1
    }
  };

  const badge = generateBadge(output, { badgePath, label: 'quality' });
  assert.ok(fs.existsSync(badge.badgePath));
  const svg = fs.readFileSync(badge.badgePath, 'utf8');
  assert.ok(svg.includes('quality'));
});

// === Regression tests for v1.2 behavior ===

test('frontmatter: disabled by default', () => {
  const md = `# Title\nBody`;
  const res = checkMarkdown(md);
  const fm = res.warnings.find((w) => w.code === 'frontmatter');
  assert.equal(fm, undefined);
});

test('CLI: --version returns package version', () => {
  const run = spawnSync(process.execPath, [CLI_PATH, '--version'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), PKG_VERSION);
});

test('CLI: --exclude supports simple directory names via path segments', () => {
  const tmp = makeTempDir();
  fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'spec'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'worklog'), { recursive: true });

  fs.writeFileSync(path.join(tmp, 'docs', 'c.md'), '---\ntitle: C\n---\n# C\nok', 'utf8');
  fs.writeFileSync(path.join(tmp, 'spec', 'a.md'), '---\ntitle: A\n---\n# A\nok', 'utf8');
  fs.writeFileSync(path.join(tmp, 'worklog', 'b.md'), '---\ntitle: B\n---\n# B\nok', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, tmp, '--exclude', 'spec,worklog', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.summary.filesScanned, 1);
  assert.equal(parsed.files.length, 1);
  const onlyFile = parsed.files[0].file;
  assert.ok(onlyFile.endsWith('docs/c.md') || onlyFile.endsWith('docs\\c.md'));
});

test('inline suppression: doclify-disable-next-line suppresses only one TODO line', () => {
  const md = `# Title\n<!-- doclify-disable-next-line placeholder -->\nTODO hidden\nTODO visible`;
  const res = checkMarkdown(md);
  const todoWarnings = res.warnings.filter((w) => w.code === 'placeholder' && w.message.includes('TODO marker'));
  assert.equal(todoWarnings.length, 1);
  assert.equal(todoWarnings[0].line, 4);
});

test('inline suppression: doclify-disable / doclify-enable works for TODO block scope', () => {
  const md = `# Title\n<!-- doclify-disable placeholder -->\nTODO hidden 1\nTODO hidden 2\n<!-- doclify-enable placeholder -->\nTODO visible`;
  const res = checkMarkdown(md);
  const todoWarnings = res.warnings.filter((w) => w.code === 'placeholder' && w.message.includes('TODO marker'));
  assert.equal(todoWarnings.length, 1);
  assert.equal(todoWarnings[0].line, 6);
});

// === autoFixInsecureLinks code block awareness ===

test('autoFixInsecureLinks: does not modify http:// inside fenced code block', () => {
  const md = '# Title\n```bash\ncurl http://internal-server/api\n```\nVisit http://example.com';
  const fixed = autoFixInsecureLinks(md);
  assert.ok(fixed.content.includes('http://internal-server/api'), 'URL inside fenced block must remain unchanged');
  assert.ok(fixed.content.includes('https://example.com'), 'URL outside block must be upgraded');
  assert.equal(fixed.changes.length, 1);
});

test('autoFixInsecureLinks: does not modify http:// inside inline code', () => {
  const md = '# Title\nUse `http://example.com/api` as example\nVisit http://example.com';
  const fixed = autoFixInsecureLinks(md);
  assert.ok(fixed.content.includes('`http://example.com/api`'), 'URL inside inline code must remain unchanged');
  assert.ok(fixed.content.includes('Visit https://example.com'), 'URL outside inline code must be upgraded');
});

test('autoFixInsecureLinks: does not modify http:// inside tilde fenced block', () => {
  const md = '# Title\n~~~\nhttp://example-internal.com\n~~~\nhttp://example.com';
  const fixed = autoFixInsecureLinks(md);
  assert.ok(fixed.content.includes('http://example-internal.com'), 'URL inside tilde block must remain unchanged');
  assert.ok(fixed.content.includes('https://example.com'), 'URL outside block must be upgraded');
});

test('CLI: --json output is valid JSON even for many files', () => {
  const tmp = makeTempDir();
  for (let i = 0; i < 20; i++) {
    fs.writeFileSync(path.join(tmp, `doc${i}.md`), `# Title ${i}\nTODO fix this\n[link](http://example-${i}.com)\n${'x'.repeat(200)}`, 'utf8');
  }
  const run = spawnSync(process.execPath, [CLI_PATH, tmp, '--json'], { encoding: 'utf8' });
  assert.doesNotThrow(() => JSON.parse(run.stdout), 'Large JSON output must be valid and complete');
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.files.length, 20, 'Must include all 20 files');
});

// === P1 UX fixes ===

test('CLI: --strict promotes warning labels to "error [strict]" on stderr', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '# Title\nTODO fix this\n', 'utf8');
  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--strict'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.ok(run.stderr.includes('error [strict]'), 'stderr should show "error [strict]" for promoted warnings');
  assert.ok(!run.stderr.includes('\u26A0 warning'), 'stderr should not show "warning" label in strict mode');
});

test('CLI: --ignore-rules warns for unknown rule IDs on stderr', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '# Title\n', 'utf8');
  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--ignore-rules', 'nonexistent-rule'], { encoding: 'utf8' });
  assert.ok(run.stderr.includes('Unknown rule'), 'stderr should warn about unknown rule ID');
  assert.ok(run.stderr.includes('nonexistent-rule'), 'stderr should include the unknown rule name');
});

test('extractLinks: handles Wikipedia-style URLs with nested parentheses', () => {
  const md = '# Title\n[Rust](https://en.wikipedia.org/wiki/Rust_(programming_language))';
  const links = extractLinks(md);
  const inlineLinks = links.filter(l => l.kind === 'inline');
  assert.equal(inlineLinks.length, 1);
  assert.equal(inlineLinks[0].url, 'https://en.wikipedia.org/wiki/Rust_(programming_language)');
});

test('CLI: --link-allow-list skips dead-link errors for allow-listed domains', async () => {
  const server = http.createServer((_, res) => {
    res.statusCode = 500;
    res.end('fail');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address();
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, `---\ntitle: T\n---\n# T\n[bad](http://127.0.0.1:${port}/broken)`, 'utf8');

  try {
    const runNoAllow = spawnSync(process.execPath, [CLI_PATH, mdPath, '--check-links', '--json'], { encoding: 'utf8' });
    assert.equal(runNoAllow.status, 1);
    const parsedNoAllow = JSON.parse(runNoAllow.stdout);
    assert.ok(parsedNoAllow.files[0].findings.errors.some((e) => e.code === 'dead-link'));

    const runAllow = spawnSync(process.execPath, [
      CLI_PATH,
      mdPath,
      '--check-links',
      '--link-allow-list', '127.0.0.1',
      '--json'
    ], { encoding: 'utf8' });

    assert.equal(runAllow.status, 0);
    const parsedAllow = JSON.parse(runAllow.stdout);
    assert.equal(parsedAllow.files[0].findings.errors.filter((e) => e.code === 'dead-link').length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ─── P2: init --force ──────────────────────────────────────────────────────

test('init --force overwrites existing config', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-init-'));
  const configPath = path.join(tmpDir, '.doclify-guardrail.json');
  fs.writeFileSync(configPath, '{"strict": true}\n', 'utf8');

  // Without --force → error
  const r1 = spawnSync(process.execPath, [CLI_PATH, 'init'], { cwd: tmpDir, encoding: 'utf8' });
  assert.equal(r1.status, 1);
  assert.ok(r1.stderr.includes('--force'));

  // With --force → success
  const r2 = spawnSync(process.execPath, [CLI_PATH, 'init', '--force'], { cwd: tmpDir, encoding: 'utf8' });
  assert.equal(r2.status, 0);
  assert.ok(r2.stderr.includes('Overwrote'));

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.strict, false); // reset to default
  fs.rmSync(tmpDir, { recursive: true });
});

// ─── P2: exclude in config ─────────────────────────────────────────────────

test('resolveOptions merges exclude from config and CLI', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-excl-'));
  const configPath = path.join(tmpDir, '.doclify-guardrail.json');
  fs.writeFileSync(configPath, JSON.stringify({ exclude: ['spec', 'worklog'] }), 'utf8');

  const args = parseArgs(['docs/', '--exclude', 'vendor']);
  args.configPath = configPath;
  const resolved = resolveOptions(args);

  assert.deepStrictEqual(resolved.exclude, ['vendor', 'spec', 'worklog']);
  fs.rmSync(tmpDir, { recursive: true });
});

// ─── P2: disable-file suppression ──────────────────────────────────────────

test('doclify-disable-file suppresses all rules', () => {
  const content = '<!-- doclify-disable-file -->\nno heading here\nTODO something\n';
  const result = checkMarkdown(content);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('doclify-disable-file with specific rules only suppresses those', () => {
  const content = '<!-- doclify-disable-file line-length -->\n# Title\n' + 'x'.repeat(200) + '\n';
  const result = checkMarkdown(content);
  // single-h1 should NOT be suppressed (it passes), line-length SHOULD be suppressed
  assert.equal(result.warnings.filter(w => w.code === 'line-length').length, 0);
  assert.equal(result.errors.length, 0); // single-h1 passes (1 H1)
});

// ─── P2: --ascii output mode ───────────────────────────────────────────────

test('--ascii flag replaces Unicode icons with ASCII labels', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-ascii-'));
  const mdPath = path.join(tmpDir, 'test.md');
  fs.writeFileSync(mdPath, '# Title\nSome content\n', 'utf8');

  const result = spawnSync(process.execPath, [CLI_PATH, mdPath, '--ascii', '--no-color'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.ok(result.stderr.includes('[PASS]'), 'should contain [PASS]');
  assert.ok(result.stderr.includes('[INFO]'), 'should contain [INFO]');
  assert.ok(!result.stderr.includes('\u2713'), 'should not contain Unicode checkmark');

  fs.rmSync(tmpDir, { recursive: true });
});

// ─── P2: init generates config with exclude field ──────────────────────────

test('init generates config with exclude field', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-init2-'));
  const r = spawnSync(process.execPath, [CLI_PATH, 'init'], { cwd: tmpDir, encoding: 'utf8' });
  assert.equal(r.status, 0);

  const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.doclify-guardrail.json'), 'utf8'));
  assert.ok(Array.isArray(config.exclude));
  assert.equal(config.exclude.length, 0);
  fs.rmSync(tmpDir, { recursive: true });
});

// ─── v1.4: New rules tests ─────────────────────────────────────────────────

test('no-trailing-spaces: detects trailing whitespace', () => {
  const md = '# Title\n\nLine with spaces   \n';
  const res = checkMarkdown(md);
  assert.ok(res.warnings.some(w => w.code === 'no-trailing-spaces'));
});

test('no-multiple-blanks: detects consecutive blank lines', () => {
  const md = '# Title\n\n\n\nContent\n';
  const res = checkMarkdown(md);
  assert.ok(res.warnings.some(w => w.code === 'no-multiple-blanks'));
});

test('single-trailing-newline: detects missing trailing newline', () => {
  const md = '# Title\n\nContent';
  const res = checkMarkdown(md);
  assert.ok(res.warnings.some(w => w.code === 'single-trailing-newline'));
});

test('no-missing-space-atx: detects #Heading without space', () => {
  const md = '#Title\n\nContent\n';
  const res = checkMarkdown(md);
  assert.ok(res.warnings.some(w => w.code === 'no-missing-space-atx'));
});

test('heading-start-left: detects indented heading', () => {
  const md = '  # Title\n\nContent\n';
  const res = checkMarkdown(md);
  assert.ok(res.warnings.some(w => w.code === 'heading-start-left'));
});

test('no-trailing-punctuation-heading: detects trailing dot', () => {
  const md = '# Title.\n\nContent\n';
  const res = checkMarkdown(md);
  assert.ok(res.warnings.some(w => w.code === 'no-trailing-punctuation-heading'));
});

test('blanks-around-headings: detects missing blank around heading', () => {
  const md = '# Title\nContent right after heading\n';
  const res = checkMarkdown(md);
  assert.ok(res.warnings.some(w => w.code === 'blanks-around-headings'));
});

test('blanks-around-lists: detects missing blank before list', () => {
  const md = '# Title\n\nSome text\n- item 1\n- item 2\n';
  const res = checkMarkdown(md);
  assert.ok(res.warnings.some(w => w.code === 'blanks-around-lists'));
});

test('blanks-around-fences: detects missing blank before code block', () => {
  const md = '# Title\n\nSome text\n```js\ncode\n```\n';
  const res = checkMarkdown(md);
  assert.ok(res.warnings.some(w => w.code === 'blanks-around-fences'));
});

test('fenced-code-language: detects code block without language', () => {
  const md = '# Title\n\n```\ncode\n```\n';
  const res = checkMarkdown(md);
  assert.ok(res.warnings.some(w => w.code === 'fenced-code-language'));
});

test('no-bare-urls: detects bare URL', () => {
  const md = '# Title\n\nVisit https://example.com for info.\n';
  const res = checkMarkdown(md);
  assert.ok(res.warnings.some(w => w.code === 'no-bare-urls'));
});

test('no-bare-urls: allows URLs inside markdown links', () => {
  const md = '# Title\n\nVisit [example](https://example.com) for info.\n';
  const res = checkMarkdown(md);
  assert.ok(!res.warnings.some(w => w.code === 'no-bare-urls'));
});

test('no-reversed-links: detects (text)[url]', () => {
  const md = '# Title\n\n(click here)[https://example.com]\n';
  const res = checkMarkdown(md);
  assert.ok(res.warnings.some(w => w.code === 'no-reversed-links'));
});

test('no-space-in-emphasis: detects ** text **', () => {
  const md = '# Title\n\nThis is ** bold ** text.\n';
  const res = checkMarkdown(md);
  assert.ok(res.warnings.some(w => w.code === 'no-space-in-emphasis'));
});

test('no-space-in-links: detects [ text ](url)', () => {
  const md = '# Title\n\n[ click here ](https://example.com)\n';
  const res = checkMarkdown(md);
  assert.ok(res.warnings.some(w => w.code === 'no-space-in-links'));
});

test('no-inline-html: detects HTML when opt-in', () => {
  const md = '# Title\n\n<div>content</div>\n';
  const res = checkMarkdown(md, { checkInlineHtml: true });
  assert.ok(res.warnings.some(w => w.code === 'no-inline-html'));
});

test('no-inline-html: silent when not opt-in', () => {
  const md = '# Title\n\n<div>content</div>\n';
  const res = checkMarkdown(md);
  assert.ok(!res.warnings.some(w => w.code === 'no-inline-html'));
});

test('--list-rules shows 26+ rules', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, '--list-rules'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const ruleLines = result.stdout.split('\n').filter(l => l.includes('error') || l.includes('warning'));
  assert.ok(ruleLines.length >= 26, `Expected >= 26 rules, got ${ruleLines.length}`);
});

// ─── v1.4: Auto-fix formatting tests ───────────────────────────────────────

test('autoFixFormatting: fixes trailing spaces', () => {
  const result = autoFixFormatting('# Title\n\nLine with spaces   \n');
  assert.ok(result.modified);
  assert.ok(!result.content.includes('   \n'));
});

test('autoFixFormatting: fixes multiple blanks', () => {
  const result = autoFixFormatting('# Title\n\n\n\nContent\n');
  assert.ok(result.modified);
  assert.ok(!result.content.includes('\n\n\n'));
});

test('autoFixFormatting: fixes missing space after #', () => {
  const result = autoFixFormatting('#Title\n\nContent\n');
  assert.ok(result.modified);
  assert.ok(result.content.startsWith('# Title'));
});

test('autoFixFormatting: fixes reversed links', () => {
  const result = autoFixFormatting('# Title\n\n(click)[url]\n');
  assert.ok(result.modified);
  assert.ok(result.content.includes('[click](url)'));
});

test('autoFixFormatting: wraps bare URLs in <>', () => {
  const result = autoFixFormatting('# Title\n\nVisit https://example.com today.\n');
  assert.ok(result.modified);
  assert.ok(result.content.includes('<https://example.com>'));
});
