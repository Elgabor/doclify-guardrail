import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { checkMarkdown, parseArgs, resolveOptions, resolveFileOptions, findParentConfigs } from '../src/index.mjs';
import { stripCodeBlocks } from '../src/checker.mjs';
import { resolveFileList, findMarkdownFiles } from '../src/glob.mjs';
import { generateReport } from '../src/report.mjs';
import { loadCustomRules } from '../src/rules-loader.mjs';
import { autoFixInsecureLinks, autoFixFormatting } from '../src/fixer.mjs';
import { lint, fix, score } from '../src/api.mjs';
import { getChangedFiles, getChangedMarkdownFiles } from '../src/diff.mjs';
import { loadHistory, appendHistory, checkRegression, renderTrend } from '../src/trend.mjs';
import { buildPrCommentBody, postPrComment } from '../action/pr-comment.mjs';
import { checkDeadLinks, checkDeadLinksDetailed, extractLinks } from '../src/links.mjs';
import { computeDocHealthScore, checkDocFreshness } from '../src/quality.mjs';
import { clearAuthState, getAuthFilePath, loadAuthState, saveAuthState } from '../src/auth-store.mjs';
import { analyzeDriftOffline } from '../src/drift.mjs';
import { loadRepoMemory, saveRepoMemory } from '../src/repo-memory.mjs';
import { canonicalizeRemoteUrl, getRepoFingerprint, getRepoMetadata } from '../src/repo.mjs';
import * as cloudClient from '../src/cloud-client.mjs';
import * as repoModule from '../src/repo.mjs';
import {
  parseArgs as parseCorpusArgs,
  assertManifest as assertCorpusManifest,
  selectRepos as selectCorpusRepos,
  normalizeOutputForHash,
  fingerprintOutput,
  withFilesystemLock,
  runCorpus
} from '../scripts/run-corpus.mjs';
import {
  buildWaiverIndex,
  evaluateComparison
} from '../scripts/compare-baseline.mjs';
import {
  computeHealthScore,
  generateJUnitXml,
  generateSarifJson,
  generateBadge
} from '../src/ci-output.mjs';

const CLI_PATH = path.resolve('src/index.mjs');
const ACTION_DIST_PATH = path.resolve('action/dist/index.mjs');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-guardrail-'));
}

function parseGithubOutput(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const entries = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    const multiMatch = line.match(/^([^<]+)<<(.+)$/);
    if (multiMatch) {
      const key = multiMatch[1];
      const delimiter = multiMatch[2];
      const valueLines = [];
      i += 1;
      while (i < lines.length && lines[i] !== delimiter) {
        valueLines.push(lines[i]);
        i += 1;
      }
      entries.push([key, valueLines.join('\n')]);
      continue;
    }

    const idx = line.indexOf('=');
    if (idx >= 0) {
      entries.push([line.slice(0, idx), line.slice(idx + 1)]);
    }
  }

  return Object.fromEntries(entries);
}

async function waitFor(predicate, timeoutMs = 5000, intervalMs = 50) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) <= timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
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

test('findParentConfigs: returns root-to-child config chain', () => {
  const tmp = makeTempDir();
  const root = path.join(tmp, '.doclify-guardrail.json');
  const docsCfg = path.join(tmp, 'docs', '.doclify-guardrail.json');
  const apiDir = path.join(tmp, 'docs', 'api');
  fs.mkdirSync(apiDir, { recursive: true });
  fs.writeFileSync(root, '{}\n', 'utf8');
  fs.writeFileSync(docsCfg, '{}\n', 'utf8');

  const chain = findParentConfigs(apiDir, { baseDir: tmp });
  assert.deepEqual(chain, [fs.realpathSync(root), fs.realpathSync(docsCfg)]);
});

test('resolveFileOptions: merges hierarchical configs parent -> child', () => {
  const tmp = makeTempDir();
  const rootCfg = path.join(tmp, '.doclify-guardrail.json');
  const docsCfg = path.join(tmp, 'docs', '.doclify-guardrail.json');
  const apiCfg = path.join(tmp, 'docs', 'api', '.doclify-guardrail.json');
  const file = path.join(tmp, 'docs', 'api', 'ref.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# Title\n', 'utf8');
  fs.writeFileSync(rootCfg, JSON.stringify({ maxLineLength: 150, ignoreRules: ['line-length'] }) + '\n', 'utf8');
  fs.writeFileSync(docsCfg, JSON.stringify({ maxLineLength: 120, ignoreRules: ['placeholder'] }) + '\n', 'utf8');
  fs.writeFileSync(apiCfg, JSON.stringify({ maxLineLength: 100, ignoreRules: ['img-alt'] }) + '\n', 'utf8');

  const args = parseArgs(['--config', rootCfg, file]);
  const base = resolveOptions(args);
  const resolved = resolveFileOptions(file, base, args);

  assert.equal(resolved.maxLineLength, 100);
  assert.equal(resolved.ignoreRules.has('line-length'), true);
  assert.equal(resolved.ignoreRules.has('placeholder'), true);
  assert.equal(resolved.ignoreRules.has('img-alt'), true);
});

test('resolveFileOptions: resolves siteRoot relative to the config that declares it', () => {
  const tmp = makeTempDir();
  const rootCfg = path.join(tmp, '.doclify-guardrail.json');
  const docsDir = path.join(tmp, 'docs');
  const docsCfg = path.join(docsDir, '.doclify-guardrail.json');
  const file = path.join(docsDir, 'guide', 'ref.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.join(docsDir, 'public'), { recursive: true });
  fs.writeFileSync(rootCfg, '{}\n', 'utf8');
  fs.writeFileSync(docsCfg, JSON.stringify({ siteRoot: './public' }) + '\n', 'utf8');
  fs.writeFileSync(file, '# Title\n', 'utf8');

  const args = parseArgs(['--config', rootCfg, file]);
  const base = resolveOptions(args);
  const resolved = resolveFileOptions(file, base, args);

  assert.equal(resolved.siteRoot, fs.realpathSync(path.join(docsDir, 'public')));
});

test('resolveFileOptions: discovers full parent config chain outside cwd via git root', () => {
  const repo = makeTempDir();
  const docsDir = path.join(repo, 'docs', 'api');
  const rootCfg = path.join(repo, '.doclify-guardrail.json');
  const docsCfg = path.join(repo, 'docs', '.doclify-guardrail.json');
  const file = path.join(docsDir, 'ref.md');

  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(rootCfg, JSON.stringify({ strict: true, ignoreRules: ['placeholder'] }) + '\n', 'utf8');
  fs.writeFileSync(docsCfg, JSON.stringify({ maxLineLength: 90 }) + '\n', 'utf8');
  fs.writeFileSync(file, '# Title\n', 'utf8');
  spawnSync('git', ['init', '-b', 'main', repo], { encoding: 'utf8' });

  const args = parseArgs([file]);
  const base = resolveOptions(args);
  const resolved = resolveFileOptions(file, base, args);

  assert.equal(resolved.strict, true);
  assert.equal(resolved.maxLineLength, 90);
  assert.equal(resolved.ignoreRules.has('placeholder'), true);
  assert.deepEqual(resolved.configChain, [fs.realpathSync(rootCfg), fs.realpathSync(docsCfg)]);
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

test('CLI: --strict overrides local config strict=false', () => {
  const tmp = makeTempDir();
  const rootCfg = path.join(tmp, '.doclify-guardrail.json');
  const localDir = path.join(tmp, 'docs', 'api');
  const localCfg = path.join(localDir, '.doclify-guardrail.json');
  const mdPath = path.join(localDir, 'doc.md');
  fs.mkdirSync(localDir, { recursive: true });

  fs.writeFileSync(rootCfg, JSON.stringify({ strict: false }) + '\n', 'utf8');
  fs.writeFileSync(localCfg, JSON.stringify({ strict: false }) + '\n', 'utf8');
  fs.writeFileSync(mdPath, '# Titolo\nTODO da completare\n', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--config', rootCfg, '--strict', '--json'], {
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

test('frontmatter: CRLF frontmatter is accepted when enabled', () => {
  const md = '---\r\ntitle: Test\r\n---\r\n# Title\r\n';
  const res = checkMarkdown(md, { checkFrontmatter: true });
  const fm = res.warnings.find((w) => w.code === 'frontmatter');
  assert.equal(fm, undefined);
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

test('indented fenced code block (<=3 spaces) is treated as code', () => {
  const md = `# Titolo\n\n  \`\`\`\nTODO hidden in code\n  \`\`\`\n`;
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

test('findMarkdownFiles: expands directory to .md/.mdx files', () => {
  const tmp = makeTempDir();
  fs.writeFileSync(path.join(tmp, 'a.md'), '# A', 'utf8');
  fs.writeFileSync(path.join(tmp, 'b.md'), '# B', 'utf8');
  fs.writeFileSync(path.join(tmp, 'c.mdx'), '# C', 'utf8');
  fs.writeFileSync(path.join(tmp, 'c.txt'), 'not markdown', 'utf8');
  fs.mkdirSync(path.join(tmp, 'sub'));
  fs.writeFileSync(path.join(tmp, 'sub', 'd.md'), '# D', 'utf8');
  fs.writeFileSync(path.join(tmp, 'sub', 'e.mdx'), '# E', 'utf8');

  const files = findMarkdownFiles(tmp);
  assert.equal(files.length, 5, 'Should find 5 Markdown files');
  assert.ok(files.some(f => f.endsWith('c.mdx')), 'Should include top-level .mdx files');
  assert.ok(files.some(f => f.endsWith(path.join('sub', 'e.mdx'))), 'Should include nested .mdx files');
});

test('resolveFileList: handles directory target', () => {
  const tmp = makeTempDir();
  fs.writeFileSync(path.join(tmp, 'a.md'), '# A', 'utf8');
  fs.writeFileSync(path.join(tmp, 'b.md'), '# B', 'utf8');
  fs.writeFileSync(path.join(tmp, 'c.mdx'), '# C', 'utf8');

  const files = resolveFileList({ files: [tmp], dir: null });
  assert.equal(files.length, 3);
});

test('resolveFileList: ignores non-Markdown files in directory', () => {
  const tmp = makeTempDir();
  fs.writeFileSync(path.join(tmp, 'a.md'), '# A', 'utf8');
  fs.writeFileSync(path.join(tmp, 'b.mdx'), '# B', 'utf8');
  fs.writeFileSync(path.join(tmp, 'b.txt'), 'text', 'utf8');
  fs.writeFileSync(path.join(tmp, 'c.json'), '{}', 'utf8');

  const files = resolveFileList({ files: [tmp], dir: null });
  assert.equal(files.length, 2);
  assert.ok(files.some(file => file.endsWith('a.md')));
  assert.ok(files.some(file => file.endsWith('b.mdx')));
});

test('CLI: directory scan succeeds when directory only contains .mdx files', () => {
  const tmp = makeTempDir();
  const docsDir = path.join(tmp, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'guide.mdx'), '# Guide\n\nClean docs.\n', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, docsDir, '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].file.endsWith('guide.mdx'), true);
  assert.equal(parsed.summary.filesPassed, 1);
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
  const previousCwd = process.cwd();
  const reportPath = 'report.md';

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

  try {
    process.chdir(tmp);
    const result = generateReport(output, { reportPath });
    assert.ok(fs.existsSync(result), 'Report file should exist');
    const content = fs.readFileSync(result, 'utf8');
    assert.ok(content.includes('# Doclify Guardrail Report'), 'Should have title');
    assert.ok(content.includes('test.md'), 'Should contain filename');
    assert.ok(content.includes('ERROR'), 'Should contain error details');
    assert.ok(content.includes('WARNING'), 'Should contain warning details');
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('generateReport: rejects report path outside workspace', () => {
  const tmp = makeTempDir();
  const previousCwd = process.cwd();

  const output = {
    version: '1.0',
    strict: false,
    files: [],
    summary: {
      filesScanned: 0,
      filesPassed: 0,
      filesFailed: 0,
      filesErrored: 0,
      totalErrors: 0,
      totalWarnings: 0,
      status: 'PASS',
      elapsed: 0.01
    }
  };

  try {
    process.chdir(tmp);
    assert.throws(
      () => generateReport(output, { reportPath: '../outside.md' }),
      /inside workspace/i
    );
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: --report writes file to disk', () => {
  const tmp = makeTempDir();
  const mdPath = 'doc.md';
  const reportPath = 'doclify-report.md';
  fs.writeFileSync(path.join(tmp, mdPath), '# Titolo\nTODO: fix', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--report', reportPath], {
    cwd: tmp,
    encoding: 'utf8'
  });

  assert.equal(run.status, 0);
  assert.ok(fs.existsSync(path.join(tmp, reportPath)), 'Report file should be created');
  const content = fs.readFileSync(path.join(tmp, reportPath), 'utf8');
  assert.ok(content.includes('Doclify Guardrail Report'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('CLI: --report rejects path traversal outside workspace', () => {
  const tmp = makeTempDir();
  const mdPath = 'doc.md';
  const outsideName = `outside-${Date.now()}-${Math.round(Math.random() * 1e9)}.md`;
  const traversalTarget = `../${outsideName}`;
  const absoluteOutside = path.resolve(tmp, traversalTarget);
  fs.writeFileSync(path.join(tmp, mdPath), '# Titolo\nTODO: fix', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--report', traversalTarget], {
    cwd: tmp,
    encoding: 'utf8'
  });

  assert.equal(run.status, 2);
  assert.ok(run.stderr.includes('Failed to write report:'), 'stderr should include report failure prefix');
  assert.ok(run.stderr.match(/inside workspace/i), 'stderr should include workspace boundary reason');
  assert.equal(fs.existsSync(absoluteOutside), false, 'outside file must not be created');
  fs.rmSync(tmp, { recursive: true, force: true });
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

test('loadCustomRules: rejects unsafe nested quantifier regex', () => {
  const tmp = makeTempDir();
  const rulesPath = path.join(tmp, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify({
    rules: [
      { id: 'redos-risk', severity: 'warning', pattern: '(a+)+$', message: 'bad' }
    ]
  }), 'utf8');

  assert.throws(() => loadCustomRules(rulesPath), /redos-risk.*ReDoS/i);
});

test('loadCustomRules: allows grouped fixed quantifiers', () => {
  const tmp = makeTempDir();
  const rulesPath = path.join(tmp, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify({
    rules: [
      { id: 'fixed-group', severity: 'warning', pattern: '([a-z]{2})+', message: 'ok' }
    ]
  }), 'utf8');

  const rules = loadCustomRules(rulesPath);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 'fixed-group');
  assert.ok(rules[0].pattern instanceof RegExp);
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

test('CLI: --rules rejects unsafe nested quantifier pattern', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  const rulesPath = path.join(tmp, 'rules.json');
  fs.writeFileSync(mdPath, '# Title\ntext', 'utf8');
  fs.writeFileSync(rulesPath, JSON.stringify({
    rules: [
      { id: 'redos-risk', severity: 'warning', pattern: '(a+)+$', message: 'bad' }
    ]
  }), 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--rules', rulesPath], {
    encoding: 'utf8'
  });

  assert.equal(run.status, 2);
  assert.ok(run.stderr.includes('Custom rules error:'), 'stderr should include custom-rules error prefix');
  assert.ok(run.stderr.match(/redos-risk.*ReDoS/i), 'stderr should include unsafe regex details');
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

test('CLI: --fix reports user-friendly error when file write fails', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'readonly.md');
  fs.writeFileSync(mdPath, '# Title\nVisit http://example.com', 'utf8');
  fs.chmodSync(mdPath, 0o444);

  try {
    const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--fix', '--json'], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    const parsed = JSON.parse(run.stdout);
    assert.ok(Array.isArray(parsed.fileErrors), 'Should expose fileErrors in JSON output');
    assert.equal(parsed.fileErrors.length, 1);
    assert.ok(parsed.fileErrors[0].error.includes('Unable to write fixed file'), 'Should contain user-facing write prefix');
    assert.ok(parsed.fileErrors[0].error.includes('readonly.md'), 'Should contain target filename');
  } finally {
    fs.chmodSync(mdPath, 0o644);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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

test('checkDeadLinksDetailed: reports cache hit statistics', async () => {
  const tmp = makeTempDir();
  const source = path.join(tmp, 'doc.md');
  const content = '# Title\nSee [cached](https://example.com/path)\nSee [cached-2](https://example.com/path)\n';
  fs.writeFileSync(source, content, 'utf8');
  const cache = new Map([['https://example.com/path', null]]);

  const result = await checkDeadLinksDetailed(content, {
    sourceFile: source,
    remoteCache: cache
  });

  assert.equal(result.findings.length, 0);
  assert.equal(result.stats.remoteLinksChecked, 1);
  assert.equal(result.stats.remoteCacheHits, 1);
  assert.equal(result.stats.remoteCacheMisses, 0);
  assert.equal(result.stats.remoteTimeouts, 0);
});

test('checkDeadLinksDetailed: tracks timeout on cache miss', async () => {
  const tmp = makeTempDir();
  const source = path.join(tmp, 'doc.md');
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    }, 250);
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/slow`;
  const content = `# Title\n\n[slow](${url})\n`;
  fs.writeFileSync(source, content, 'utf8');

  const result = await checkDeadLinksDetailed(content, {
    sourceFile: source,
    allowPrivateLinks: true,
    timeoutMs: 50,
    concurrency: 1,
    remoteCache: new Map()
  });

  await new Promise((resolve) => server.close(resolve));

  assert.equal(result.stats.remoteLinksChecked, 1);
  assert.equal(result.stats.remoteCacheHits, 0);
  assert.equal(result.stats.remoteCacheMisses, 1);
  assert.equal(result.stats.remoteTimeouts, 1);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].code, 'dead-link');
});

test('checkDeadLinksDetailed: blocks loopback URLs by default', async () => {
  const tmp = makeTempDir();
  const source = path.join(tmp, 'doc.md');
  const content = '# Title\n[loopback](http://127.0.0.1:8080/private)\n';
  fs.writeFileSync(source, content, 'utf8');

  const result = await checkDeadLinksDetailed(content, {
    sourceFile: source,
    remoteCache: new Map()
  });

  assert.equal(result.stats.remoteLinksChecked, 0);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].code, 'dead-link');
  assert.ok(result.findings[0].message.includes('Blocked private host/IP'));
});

test('checkDeadLinksDetailed: allowPrivateLinks opt-in enables loopback checks', async () => {
  const tmp = makeTempDir();
  const source = path.join(tmp, 'doc.md');
  let hits = 0;
  const server = http.createServer((_, res) => {
    hits += 1;
    res.statusCode = 200;
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address();
  const content = `# Title\n[loopback](http://127.0.0.1:${port}/ok)\n`;
  fs.writeFileSync(source, content, 'utf8');

  try {
    const result = await checkDeadLinksDetailed(content, {
      sourceFile: source,
      allowPrivateLinks: true,
      remoteCache: new Map()
    });

    assert.equal(result.stats.remoteLinksChecked, 1);
    assert.equal(result.findings.length, 0);
    assert.ok(hits >= 1, 'Expected at least one remote request');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('checkDeadLinksDetailed: falls back from HEAD to GET for method-limited statuses', async () => {
  for (const status of [403, 404, 405, 501]) {
    const tmp = makeTempDir();
    const source = path.join(tmp, `doc-${status}.md`);
    let headHits = 0;
    let getHits = 0;
    const server = http.createServer((req, res) => {
      if (req.method === 'HEAD') {
        headHits += 1;
        res.statusCode = status;
        res.end();
        return;
      }
      getHits += 1;
      res.statusCode = 200;
      res.end('ok');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const { port } = server.address();
      const content = `# Title\n[fallback](http://127.0.0.1:${port}/ok)\n`;
      fs.writeFileSync(source, content, 'utf8');
      const result = await checkDeadLinksDetailed(content, {
        sourceFile: source,
        allowPrivateLinks: true,
        remoteCache: new Map()
      });

      assert.equal(result.findings.length, 0);
      assert.equal(headHits, 1);
      assert.equal(getHits, 1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test('checkDeadLinksDetailed: blocks redirects to private hosts', async () => {
  const tmp = makeTempDir();
  const source = path.join(tmp, 'doc.md');
  const content = '# Title\n[redir](https://public.example.com/start)\n';
  fs.writeFileSync(source, content, 'utf8');

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private' }
    });
  };

  try {
    const result = await checkDeadLinksDetailed(content, {
      sourceFile: source,
      remoteCache: new Map()
    });

    assert.equal(result.stats.remoteLinksChecked, 1);
    assert.equal(result.findings.length, 1);
    assert.ok(result.findings[0].message.includes('Blocked private host/IP'));
    assert.equal(calls.length, 1, 'Should not fetch private redirect target');
    assert.ok(calls[0].includes('https://public.example.com/start'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('checkDeadLinksDetailed: private SSRF block takes precedence over linkAllowList', async () => {
  const tmp = makeTempDir();
  const source = path.join(tmp, 'doc.md');
  const content = '# Title\n[loopback](http://127.0.0.1:8080/private)\n';
  fs.writeFileSync(source, content, 'utf8');

  const result = await checkDeadLinksDetailed(content, {
    sourceFile: source,
    linkAllowList: ['127.0.0.1'],
    remoteCache: new Map()
  });

  assert.equal(result.stats.remoteLinksChecked, 0);
  assert.equal(result.findings.length, 1);
  assert.ok(result.findings[0].message.includes('Blocked private host/IP'));
});

test('checkDeadLinksDetailed: warns on root-relative links without siteRoot', async () => {
  const tmp = makeTempDir();
  const source = path.join(tmp, 'doc.md');
  const content = '# Title\n[root](/missing.md)\n';
  fs.writeFileSync(source, content, 'utf8');

  const result = await checkDeadLinksDetailed(content, {
    sourceFile: source,
    remoteCache: new Map()
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].code, 'unverifiable-root-relative-link');
  assert.equal(result.findings[0].severity, 'warning');
});

test('checkDeadLinksDetailed: resolves root-relative links against siteRoot', async () => {
  const tmp = makeTempDir();
  const siteRoot = path.join(tmp, 'public');
  const source = path.join(tmp, 'docs', 'doc.md');
  const content = '# Title\n[root](/existing.md)\n';
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(siteRoot, { recursive: true });
  fs.writeFileSync(source, content, 'utf8');
  fs.writeFileSync(path.join(siteRoot, 'existing.md'), '# Existing\n', 'utf8');

  const result = await checkDeadLinksDetailed(content, {
    sourceFile: source,
    siteRoot,
    remoteCache: new Map()
  });

  assert.equal(result.findings.length, 0);
});

test('checkDeadLinksDetailed: reports missing root-relative target when siteRoot is configured', async () => {
  const tmp = makeTempDir();
  const siteRoot = path.join(tmp, 'public');
  const source = path.join(tmp, 'docs', 'doc.md');
  const content = '# Title\n[root](/missing.md)\n';
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(siteRoot, { recursive: true });
  fs.writeFileSync(source, content, 'utf8');

  const result = await checkDeadLinksDetailed(content, {
    sourceFile: source,
    siteRoot,
    remoteCache: new Map()
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].code, 'dead-link');
  assert.equal(result.findings[0].severity, 'error');
});

test('checkDeadLinksDetailed: resolves route-like root-relative links to index.mdx candidates', async () => {
  const tmp = makeTempDir();
  const siteRoot = path.join(tmp, 'public');
  const source = path.join(tmp, 'docs', 'doc.md');
  const content = '# Title\n[root](/guides/getting-started)\n';
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.join(siteRoot, 'guides', 'getting-started'), { recursive: true });
  fs.writeFileSync(source, content, 'utf8');
  fs.writeFileSync(path.join(siteRoot, 'guides', 'getting-started', 'index.mdx'), '# Getting Started\n', 'utf8');

  const result = await checkDeadLinksDetailed(content, {
    sourceFile: source,
    siteRoot,
    remoteCache: new Map()
  });

  assert.equal(result.findings.length, 0);
});

test('checkDeadLinksDetailed: warns for route-like root-relative links that do not map to source files', async () => {
  const tmp = makeTempDir();
  const siteRoot = path.join(tmp, 'public');
  const source = path.join(tmp, 'docs', 'doc.md');
  const content = '# Title\n[root](/guides/missing-route)\n';
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(siteRoot, { recursive: true });
  fs.writeFileSync(source, content, 'utf8');

  const result = await checkDeadLinksDetailed(content, {
    sourceFile: source,
    siteRoot,
    remoteCache: new Map()
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].code, 'unverifiable-root-relative-link');
  assert.equal(result.findings[0].severity, 'warning');
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

test('CLI: --check-links warns on root-relative local link without siteRoot', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '# Title\n\n[root](/not-found.md)', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--check-links', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const parsed = JSON.parse(run.stdout);
  const warning = parsed.files[0].findings.warnings.find((w) => w.code === 'unverifiable-root-relative-link');
  assert.ok(warning);
  assert.equal(parsed.files[0].findings.errors.length, 0);
});

test('CLI: --site-root enables root-relative local link validation', () => {
  const tmp = makeTempDir();
  const siteRoot = path.join(tmp, 'public');
  const mdPath = path.join(tmp, 'docs', 'doc.md');
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.mkdirSync(siteRoot, { recursive: true });
  fs.writeFileSync(mdPath, '# Title\n\n[root](/not-found.md)', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--check-links', '--site-root', siteRoot, '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  const parsed = JSON.parse(run.stdout);
  const dead = parsed.files[0].findings.errors.find((e) => e.code === 'dead-link');
  assert.ok(dead);
});

test('CLI: --site-root downgrades unresolved route-like root-relative links to warnings', () => {
  const tmp = makeTempDir();
  const siteRoot = path.join(tmp, 'public');
  const mdPath = path.join(tmp, 'docs', 'doc.md');
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.mkdirSync(siteRoot, { recursive: true });
  fs.writeFileSync(mdPath, '# Title\n\n[root](/guides/getting-started)', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--check-links', '--site-root', siteRoot, '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const parsed = JSON.parse(run.stdout);
  const warning = parsed.files[0].findings.warnings.find((w) => w.code === 'unverifiable-root-relative-link');
  assert.ok(warning);
  assert.equal(parsed.files[0].findings.errors.length, 0);
});

test('CLI: checkLinks from config enables dead-link checks without CLI flag', () => {
  const tmp = makeTempDir();
  const cfgPath = path.join(tmp, '.doclify-guardrail.json');
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(cfgPath, JSON.stringify({ checkLinks: true }) + '\n', 'utf8');
  fs.writeFileSync(mdPath, '# Title\n[missing](./not-found.md)', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--config', cfgPath, '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  const parsed = JSON.parse(run.stdout);
  const dead = parsed.files[0].findings.errors.find((e) => e.code === 'dead-link');
  assert.ok(dead);
});

test('CLI: siteRoot from config resolves relative to config directory', () => {
  const tmp = makeTempDir();
  const configDir = path.join(tmp, 'config');
  const siteRootDir = path.join(configDir, 'public');
  const cfgPath = path.join(configDir, '.doclify-guardrail.json');
  const mdPath = path.join(configDir, 'docs', 'doc.md');
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.mkdirSync(siteRootDir, { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify({ checkLinks: true, siteRoot: './public' }) + '\n', 'utf8');
  fs.writeFileSync(mdPath, '# Title\n\n[root](/missing.md)', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--config', cfgPath, '--json'], { encoding: 'utf8' });
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

test('checkDocFreshness: accepts CRLF frontmatter', () => {
  const md = '---\r\nupdated: 2026-02-10\r\n---\r\n# Title\r\n';
  const findings = checkDocFreshness(md, { now: new Date('2026-02-18T00:00:00Z') });
  assert.equal(findings.length, 0);
});

test('checkDocFreshness: rejects impossible calendar dates', () => {
  const md = `---\nupdated: 2026-02-31\n---\n# Title`;
  const findings = checkDocFreshness(md, { now: new Date('2026-02-18T00:00:00Z') });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'stale-doc');
  assert.ok(findings[0].message.includes('Invalid freshness date'));
  assert.equal(findings[0].line, 2);
});

test('checkDocFreshness: rejects future dates with explicit message', () => {
  const md = `---\nupdated: 2026-03-01\n---\n# Title`;
  const findings = checkDocFreshness(md, { now: new Date('2026-02-18T00:00:00Z') });
  assert.equal(findings.length, 1);
  assert.ok(findings[0].message.includes('future'));
  assert.equal(findings[0].line, 2);
});

test('CLI: checkFreshness from config enables stale-doc checks without CLI flag', () => {
  const tmp = makeTempDir();
  const cfgPath = path.join(tmp, '.doclify-guardrail.json');
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(cfgPath, JSON.stringify({ checkFreshness: true, freshnessMaxDays: 10 }) + '\n', 'utf8');
  fs.writeFileSync(mdPath, '# Title\n\nlast updated: 2020-01-01\n', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--config', cfgPath, '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const parsed = JSON.parse(run.stdout);
  const stale = parsed.files[0].findings.warnings.find((w) => w.code === 'stale-doc');
  assert.ok(stale);
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
  assert.equal(typeof parsed.engine, 'object');
  assert.equal(typeof parsed.engine.scanMs, 'number');
  assert.equal(typeof parsed.engine.peakMemoryMb, 'number');
  assert.equal(typeof parsed.engine.remoteLinksChecked, 'number');
  assert.equal(typeof parsed.engine.cacheHitRate, 'number');
  assert.equal(typeof parsed.engine.timeoutRate, 'number');
});

test('CLI: JSON output includes schemaVersion 2 metadata', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '---\ntitle: T\n---\n# T\nBody', 'utf8');

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(typeof parsed.scanId, 'string');
  assert.equal(typeof parsed.repo, 'object');
  assert.equal(typeof parsed.repo.fingerprint, 'string');
  assert.equal(typeof parsed.timings.elapsedMs, 'number');
  assert.equal(parsed.engine.schemaVersion, 2);
  assert.equal(parsed.engine.mode, 'scan');
});

test('parseArgs: supports ai drift flags', () => {
  const args = parseArgs(['docs', '--ai-drift', '--ai-mode', 'cloud', '--fail-on-drift', 'medium', '--fail-on-drift-scope', 'all', '--api-url', 'https://example.com', '--token', 'secret']);
  assert.equal(args.aiDrift, true);
  assert.equal(args.aiMode, 'cloud');
  assert.equal(args.failOnDrift, 'medium');
  assert.equal(args.failOnDriftScope, 'all');
  assert.equal(args.apiUrl, 'https://example.com');
  assert.equal(args.token, 'secret');
});

test('parseArgs: validates --fail-on-drift-scope', () => {
  assert.throws(
    () => parseArgs(['docs', '--ai-drift', '--fail-on-drift-scope', 'invalid']),
    /Invalid --fail-on-drift-scope/
  );
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

test('computeHealthScore: reuses canonical project score semantics', () => {
  assert.equal(computeHealthScore({ healthScore: 91 }), 91);
  assert.equal(computeHealthScore({ avgHealthScore: 87 }), 87);
  assert.equal(
    computeHealthScore({
      files: [
        { summary: { healthScore: 100 } },
        { summary: { healthScore: 80 } }
      ]
    }),
    90
  );
  assert.equal(
    computeHealthScore({ filesScanned: 1, totalErrors: 1, totalWarnings: 2 }),
    computeDocHealthScore({ errors: 1, warnings: 2 })
  );
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

test('generateJUnitXml: warning-only strict failure is emitted as failure', () => {
  const output = {
    version: '1.0',
    files: [
      {
        file: 'docs/a.md',
        pass: false,
        findings: {
          errors: [],
          warnings: [{ code: 'placeholder', severity: 'warning', message: 'TODO marker found', line: 3 }]
        },
        summary: { errors: 0, warnings: 1, status: 'FAIL' }
      }
    ],
    summary: {
      filesScanned: 1,
      filesPassed: 0,
      filesFailed: 1,
      filesErrored: 0,
      totalErrors: 0,
      totalWarnings: 1,
      elapsed: 0.1,
      status: 'FAIL'
    }
  };

  const xml = generateJUnitXml(output);
  assert.ok(xml.includes('<failure'));
  assert.ok(xml.includes('promoted to failure'));
  assert.ok(xml.includes('<system-out>'));
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
      healthScore: 90,
      filesScanned: 2,
      totalErrors: 10,
      totalWarnings: 30
    }
  };

  const badge = generateBadge(output, { badgePath, label: 'quality' });
  assert.ok(fs.existsSync(badge.badgePath));
  assert.equal(badge.score, 90);
  const svg = fs.readFileSync(badge.badgePath, 'utf8');
  assert.ok(svg.includes('quality'));
  assert.ok(svg.includes('90/100'));
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

test('inline suppression: comma-separated rule ids are supported', () => {
  const md = `# Title\n<!-- doclify-disable placeholder,line-length -->\nTODO hidden\n${'x'.repeat(220)}\n<!-- doclify-enable placeholder,line-length -->\nTODO visible`;
  const res = checkMarkdown(md, { maxLineLength: 120 });
  const placeholder = res.warnings.filter((w) => w.code === 'placeholder');
  const lineLength = res.warnings.filter((w) => w.code === 'line-length');
  assert.equal(placeholder.length, 1);
  assert.equal(placeholder[0].line, 6);
  assert.equal(lineLength.length, 0);
});

test('inline suppression: doclify-enable without rules re-enables global block suppressions', () => {
  const md = `# Title\n<!-- doclify-disable -->\nTODO hidden\n<!-- doclify-enable -->\nTODO visible`;
  const res = checkMarkdown(md);
  const todoWarnings = res.warnings.filter((w) => w.code === 'placeholder' && w.message.includes('TODO marker'));
  assert.equal(todoWarnings.length, 1);
  assert.equal(todoWarnings[0].line, 5);
});

test('inline suppression: doclify-enable without rules keeps specific disables active', () => {
  const md = `# Title\n<!-- doclify-disable placeholder -->\nTODO hidden specific\n<!-- doclify-disable -->\nTODO hidden global\n<!-- doclify-enable -->\nTODO still hidden specific`;
  const res = checkMarkdown(md);
  const todoWarnings = res.warnings.filter((w) => w.code === 'placeholder' && w.message.includes('TODO marker'));
  assert.equal(todoWarnings.length, 0);
});

test('inline suppression directives do not trigger placeholder warnings', () => {
  const md = `# Title\n<!-- doclify-disable placeholder -->\nBody\n`;
  const res = checkMarkdown(md);
  const placeholder = res.warnings.filter((w) => w.code === 'placeholder');
  assert.equal(placeholder.length, 0);
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

test('autoFixInsecureLinks: respects indented fenced blocks', () => {
  const md = '# Title\n  ```\nhttp://internal.example\n  ```\nhttp://example.com';
  const fixed = autoFixInsecureLinks(md);
  assert.ok(fixed.content.includes('http://internal.example'));
  assert.ok(fixed.content.includes('https://example.com'));
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

test('extractLinks: trims trailing markdown emphasis around inline links', () => {
  const md = 'Refer to **[Crowdin documentation](https://support.crowdin.com/)** for help.';
  const links = extractLinks(md);
  const inlineLinks = links.filter(l => l.kind === 'inline');
  assert.equal(inlineLinks.length, 1);
  assert.equal(inlineLinks[0].url, 'https://support.crowdin.com/');
});

test('empty-link: ignores inline-code link text', () => {
  const md = '# Title\n\n[`http://localhost:3000/fr/`](http://localhost:3000/fr/)\n';
  const result = checkMarkdown(md);
  assert.equal(result.warnings.some((w) => w.code === 'empty-link'), false);
});

test('CLI: --link-allow-list does not bypass private-link SSRF guard', async () => {
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

    const runAllowOnly = spawnSync(process.execPath, [
      CLI_PATH,
      mdPath,
      '--check-links',
      '--link-allow-list', '127.0.0.1',
      '--json'
    ], { encoding: 'utf8' });

    assert.equal(runAllowOnly.status, 1);
    const parsedAllowOnly = JSON.parse(runAllowOnly.stdout);
    const deadAllowOnly = parsedAllowOnly.files[0].findings.errors.filter((e) => e.code === 'dead-link');
    assert.equal(deadAllowOnly.length, 1);
    assert.ok(deadAllowOnly[0].message.includes('Blocked private host/IP'));

    const runAllowPrivate = spawnSync(process.execPath, [
      CLI_PATH,
      mdPath,
      '--check-links',
      '--allow-private-links',
      '--link-allow-list', '127.0.0.1',
      '--json'
    ], { encoding: 'utf8' });

    assert.equal(runAllowPrivate.status, 0);
    const parsedAllowPrivate = JSON.parse(runAllowPrivate.stdout);
    assert.equal(parsedAllowPrivate.files[0].findings.errors.filter((e) => e.code === 'dead-link').length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('CLI: local config linkAllowList cannot bypass private-link SSRF guard', async () => {
  const server = http.createServer((_, res) => {
    res.statusCode = 500;
    res.end('fail');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address();
  const tmp = makeTempDir();
  const rootCfg = path.join(tmp, '.doclify-guardrail.json');
  const localDir = path.join(tmp, 'docs');
  const localCfg = path.join(localDir, '.doclify-guardrail.json');
  const mdPath = path.join(localDir, 'doc.md');
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(rootCfg, JSON.stringify({ checkLinks: true }) + '\n', 'utf8');
  fs.writeFileSync(localCfg, JSON.stringify({ linkAllowList: ['127.0.0.1'] }) + '\n', 'utf8');
  fs.writeFileSync(mdPath, `# T\n[bad](http://127.0.0.1:${port}/broken)`, 'utf8');

  try {
    const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--config', rootCfg, '--json'], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    const parsed = JSON.parse(run.stdout);
    const dead = parsed.files[0].findings.errors.filter((e) => e.code === 'dead-link');
    assert.equal(dead.length, 1);
    assert.ok(dead[0].message.includes('Blocked private host/IP'));
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

  assert.deepStrictEqual([...resolved.exclude].sort(), ['spec', 'vendor', 'worklog']);
  fs.rmSync(tmpDir, { recursive: true });
});

test('score-api: resolveOptions supports push/projectId from config and CLI override', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-score-api-config-'));
  const configPath = path.join(tmpDir, '.doclify-guardrail.json');
  const mdPath = path.join(tmpDir, 'doc.md');
  fs.writeFileSync(configPath, JSON.stringify({ push: true, projectId: 'cfg-proj' }), 'utf8');
  fs.writeFileSync(mdPath, '# Title\n', 'utf8');

  const argsFromConfig = parseArgs(['--config', configPath, mdPath]);
  const resolvedFromConfig = resolveOptions(argsFromConfig);
  assert.equal(resolvedFromConfig.push, true);
  assert.equal(resolvedFromConfig.projectId, 'cfg-proj');

  const argsWithOverride = parseArgs(['--config', configPath, mdPath, '--project-id', 'cli-proj']);
  const resolvedWithOverride = resolveOptions(argsWithOverride);
  assert.equal(resolvedWithOverride.projectId, 'cli-proj');

  fs.rmSync(tmpDir, { recursive: true, force: true });
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

test('doclify-disable-file inside fenced code block does not suppress the file', () => {
  const content = '# Title\n\n```md\n<!-- doclify-disable-file -->\n```\n\nTODO keep me\n';
  const result = checkMarkdown(content);
  assert.equal(result.warnings.some((w) => w.code === 'placeholder'), true);
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

test('autoFixFormatting: inserts blank line after closing code fence', () => {
  const md = '# Title\n\n```js\ncode\n```\nAfter\n';
  const result = autoFixFormatting(md);
  assert.ok(result.modified);
  assert.ok(result.content.includes('```\n\nAfter\n'));
});

// ─── v1.5 Tests ───────────────────────────────────────────────────────────────

// New rules
test('no-empty-sections: warns on heading with no content before next heading', () => {
  const md = '# Title\n\nIntro paragraph.\n\n## Section A\n\n## Section B\n\nContent here.\n';
  const result = checkMarkdown(md, { filePath: 'test.md' });
  const w = result.warnings.filter(f => f.code === 'no-empty-sections');
  assert.equal(w.length, 1);
  assert.ok(w[0].message.includes('Empty section'));
});

test('no-empty-sections: no warning when all sections have content', () => {
  const md = '# Title\n\nIntro.\n\n## Section A\n\nContent A.\n\n## Section B\n\nContent B.\n';
  const result = checkMarkdown(md, { filePath: 'test.md' });
  const w = result.warnings.filter(f => f.code === 'no-empty-sections');
  assert.equal(w.length, 0);
});

test('no-empty-sections: warns when last heading is empty at EOF', () => {
  const md = '# Title\n\n## Empty Last\n';
  const result = checkMarkdown(md, { filePath: 'test.md' });
  const w = result.warnings.filter(f => f.code === 'no-empty-sections');
  assert.equal(w.length, 1);
});

test('heading-increment: avoids duplicate warning when heading-hierarchy already reports jump', () => {
  const md = '# Title\n\n### Skipped H2\n\nContent.\n';
  const result = checkMarkdown(md, { filePath: 'test.md' });
  const w = result.warnings.filter(f => f.code === 'heading-increment');
  const hierarchy = result.warnings.filter(f => f.code === 'heading-hierarchy');
  assert.equal(w.length, 0);
  assert.equal(hierarchy.length, 1);
});

test('heading-increment: no warning for sequential headings', () => {
  const md = '# Title\n\n## Section\n\n### Subsection\n\nContent.\n';
  const result = checkMarkdown(md, { filePath: 'test.md' });
  const w = result.warnings.filter(f => f.code === 'heading-increment');
  assert.equal(w.length, 0);
});

test('dangling-reference-link: warns when a reference link has no definition', () => {
  const md = '# Title\n\nSee [API guide][api-guide].\n';
  const result = checkMarkdown(md, { filePath: 'test.md' });
  const w = result.warnings.filter(f => f.code === 'dangling-reference-link');
  assert.equal(w.length, 1);
  assert.ok(w[0].message.includes('no matching definition'));
});

test('dangling-reference-link: no warning when reference definition exists', () => {
  const md = '# Title\n\nSee [API guide][api-guide].\n\n[api-guide]: ./api.md\n';
  const result = checkMarkdown(md, { filePath: 'test.md' });
  const w = result.warnings.filter(f => f.code === 'dangling-reference-link');
  assert.equal(w.length, 0);
});

test('broken-local-anchor: warns on missing same-file heading anchor', () => {
  const md = '# Title\n\n## Existing Section\n\nJump to [missing](#missing-section).\n';
  const result = checkMarkdown(md, { filePath: 'test.md' });
  const w = result.warnings.filter(f => f.code === 'broken-local-anchor');
  assert.equal(w.length, 1);
  assert.ok(w[0].message.includes('#missing-section'));
});

test('broken-local-anchor: resolves anchors in referenced local markdown file', () => {
  const tmp = makeTempDir();
  const sourcePath = path.join(tmp, 'docs', 'index.md');
  const targetPath = path.join(tmp, 'docs', 'guide.md');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(targetPath, '# Guide\n\n## Install Steps\n\nDone.\n', 'utf8');
  fs.writeFileSync(sourcePath, '# Home\n\nSee [install](./guide.md#install-steps).\n', 'utf8');

  const content = fs.readFileSync(sourcePath, 'utf8');
  const result = checkMarkdown(content, {
    filePath: 'docs/index.md',
    absoluteFilePath: sourcePath
  });
  const w = result.warnings.filter(f => f.code === 'broken-local-anchor');
  assert.equal(w.length, 0);
  fs.rmSync(tmp, { recursive: true });
});

test('duplicate-section-intent: warns on near-duplicate heading intent', () => {
  const md = '# Title\n\n## API Overview\n\nText.\n\n## Overview of APIs\n\nMore text.\n';
  const result = checkMarkdown(md, { filePath: 'test.md' });
  const w = result.warnings.filter(f => f.code === 'duplicate-section-intent');
  assert.equal(w.length, 1);
});

test('no-duplicate-links: warns on same URL appearing twice', () => {
  const md = '# Title\n\n[Link1](https://example.com)\n\n[Link2](https://example.com)\n';
  const result = checkMarkdown(md, { filePath: 'test.md' });
  const w = result.warnings.filter(f => f.code === 'no-duplicate-links');
  assert.equal(w.length, 1);
});

test('list-marker-consistency: warns on mixed list markers', () => {
  const md = '# Title\n\n- Item A\n* Item B\n- Item C\n';
  const result = checkMarkdown(md, { filePath: 'test.md' });
  const w = result.warnings.filter(f => f.code === 'list-marker-consistency');
  assert.equal(w.length, 1); // * is the outlier
});

test('list-marker-consistency: no warning for consistent markers', () => {
  const md = '# Title\n\n- Item A\n- Item B\n- Item C\n';
  const result = checkMarkdown(md, { filePath: 'test.md' });
  const w = result.warnings.filter(f => f.code === 'list-marker-consistency');
  assert.equal(w.length, 0);
});

// --min-score quality gate
test('CLI: --min-score fails when score is below threshold', () => {
  const tmpDir = makeTempDir();
  const file = path.join(tmpDir, 'low.md');
  // Many issues to get a low score
  fs.writeFileSync(file, '# Title\n\nTODO fix this\n\nFIXME broken\n\nWIP section\n\nTBD later\n\nHACK workaround\n\nhttp://insecure.com\n\nCHANGEME placeholder\n', 'utf8');
  const r = spawnSync('node', [CLI_PATH, file, '--min-score', '95', '--ascii'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  fs.rmSync(tmpDir, { recursive: true });
});

test('CLI: --min-score passes when score is above threshold', () => {
  const tmpDir = makeTempDir();
  const file = path.join(tmpDir, 'good.md');
  fs.writeFileSync(file, '# Title\n\nGood content here.\n', 'utf8');
  const r = spawnSync('node', [CLI_PATH, file, '--min-score', '50', '--ascii'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  fs.rmSync(tmpDir, { recursive: true });
});

// --format compact
test('CLI: --format compact produces single-line output', () => {
  const tmpDir = makeTempDir();
  const file = path.join(tmpDir, 'test.md');
  fs.writeFileSync(file, '# Title\n\nTODO fix.\n', 'utf8');
  const r = spawnSync('node', [CLI_PATH, file, '--format', 'compact', '--ascii'], { encoding: 'utf8' });
  assert.ok(r.stderr.includes('warning'));
  assert.ok(r.stderr.includes('[placeholder]'));
  fs.rmSync(tmpDir, { recursive: true });
});

// --diff (tests in a git repo context)
test('CLI: --diff flag is accepted without error', () => {
  const r = spawnSync('node', [CLI_PATH, '--diff', '--ascii'], { encoding: 'utf8' });
  // Should not return exit code 2 (usage error)
  assert.notEqual(r.status, 2);
});

test('CLI: --staged flag is accepted without error', () => {
  const r = spawnSync('node', [CLI_PATH, '--staged', '--ascii'], { encoding: 'utf8' });
  // Exit 2 is OK if no changed Markdown/MDX files are found, but not if it's an unknown option error.
  assert.ok(!r.stderr.includes('Unknown option'), '--staged should be recognized');
});

// parseArgs: new flags
test('parseArgs: --diff, --base, --staged, --min-score, --format, --watch', () => {
  const args = parseArgs(['--diff', '--base', 'main', '--min-score', '80', '--format', 'compact']);
  assert.equal(args.diff, true);
  assert.equal(args.base, 'main');
  assert.equal(args.minScore, 80);
  assert.equal(args.format, 'compact');
});

test('parseArgs: freshness/link tuning flags are parsed', () => {
  const args = parseArgs(['doc.md', '--freshness-max-days', '30', '--link-timeout-ms', '2500', '--link-concurrency', '9']);
  assert.equal(args.freshnessMaxDays, 30);
  assert.equal(args.linkTimeoutMs, 2500);
  assert.equal(args.linkConcurrency, 9);
});

test('parseArgs: --site-root is parsed as an absolute path', () => {
  const args = parseArgs(['doc.md', '--site-root', 'public']);
  assert.equal(args.siteRoot, path.resolve('public'));
});

test('parseArgs: --allow-private-links is parsed', () => {
  const args = parseArgs(['doc.md', '--allow-private-links']);
  assert.equal(args.allowPrivateLinks, true);
});

test('parseArgs: --min-score rejects invalid values', () => {
  assert.throws(() => parseArgs(['--min-score', '150']), /must be 0-100/);
  assert.throws(() => parseArgs(['--min-score', 'abc']), /Invalid --min-score/);
});

test('parseArgs: --format rejects invalid values', () => {
  assert.throws(() => parseArgs(['--format', 'invalid']), /must be: default, compact/);
});

// Programmatic API
test('API: lint() returns findings and score', () => {
  const result = lint('# Title\n\nTODO fix this.\n');
  assert.ok(result.warnings.length > 0);
  assert.ok(result.healthScore <= 100);
  assert.equal(typeof result.pass, 'boolean');
});

test('API: lint() respects ignoreRules', () => {
  const result = lint('# Title\n\nTODO fix this.\n', { ignoreRules: ['placeholder'] });
  const placeholders = result.warnings.filter(w => w.code === 'placeholder');
  assert.equal(placeholders.length, 0);
});

test('API: fix() fixes formatting issues', () => {
  const result = fix('##Bad heading\n\nContent.  \n');
  assert.ok(result.modified);
  assert.ok(result.content.includes('## Bad heading'));
});

test('API: score() computes health score', () => {
  assert.equal(score({ errors: 0, warnings: 0 }), 100);
  assert.ok(score({ errors: 5, warnings: 0 }) === 0);
});

// getChangedMarkdownFiles
test('diff: getChangedMarkdownFiles returns array', () => {
  // This test runs in a git repo, so it should work
  const files = getChangedMarkdownFiles({ base: 'HEAD' });
  assert.ok(Array.isArray(files));
});

test('diff: getChangedMarkdownFiles includes .mdx files', () => {
  const tmp = makeTempDir();
  const previousCwd = process.cwd();

  try {
    process.chdir(tmp);
    assert.equal(spawnSync('git', ['init'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Doclify Test'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'doclify@example.com'], { encoding: 'utf8' }).status, 0);

    fs.writeFileSync(path.join(tmp, 'guide.mdx'), '# Guide\n', 'utf8');
    assert.equal(spawnSync('git', ['add', 'guide.mdx'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'seed'], { encoding: 'utf8' }).status, 0);

    fs.writeFileSync(path.join(tmp, 'guide.mdx'), '# Guide\n\nUpdated.\n', 'utf8');

    const files = getChangedMarkdownFiles({ base: 'HEAD' });
    assert.equal(files.length, 1);
    assert.ok(files[0].endsWith('guide.mdx'));
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('diff: getChangedFiles rejects base refs starting with "-"', () => {
  const tmp = makeTempDir();
  const previousCwd = process.cwd();

  try {
    process.chdir(tmp);
    assert.throws(
      () => getChangedFiles({ base: '--force' }),
      /Invalid --base value: must not start with "-"/
    );
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('diff: getChangedMarkdownFiles rejects base refs starting with "-"', () => {
  const tmp = makeTempDir();
  const previousCwd = process.cwd();

  try {
    process.chdir(tmp);
    assert.throws(
      () => getChangedMarkdownFiles({ base: '--force' }),
      /Invalid --base value: must not start with "-"/
    );
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: --diff rejects --base with shell metacharacters', () => {
  const tmpDir = makeTempDir();
  const sentinelPath = path.join(tmpDir, 'cmdinj-sentinel.txt');
  const payload = `HEAD; echo injected > ${sentinelPath}`;

  const run = spawnSync(process.execPath, [CLI_PATH, '--diff', '--base', payload, '--ascii'], {
    encoding: 'utf8'
  });

  assert.equal(run.status, 2);
  assert.match(run.stderr, /Invalid --base value: contains forbidden shell metacharacters/);
  assert.equal(fs.existsSync(sentinelPath), false);
  fs.rmSync(tmpDir, { recursive: true });
});

test('diff: getChangedFiles preserves rename metadata', () => {
  const tmp = makeTempDir();
  const previousCwd = process.cwd();

  try {
    process.chdir(tmp);
    assert.equal(spawnSync('git', ['init'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Doclify Test'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'doclify@example.com'], { encoding: 'utf8' }).status, 0);

    fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'docs', 'old.md'), '# Old\n', 'utf8');
    assert.equal(spawnSync('git', ['add', '.'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'seed'], { encoding: 'utf8' }).status, 0);

    assert.equal(spawnSync('git', ['mv', 'docs/old.md', 'docs/new.md'], { encoding: 'utf8' }).status, 0);

    const files = getChangedFiles({ base: 'HEAD' });
    assert.equal(files.length, 1);
    assert.ok(files[0].status.startsWith('R'));
    assert.ok(files[0].path.endsWith(path.join('docs', 'new.md')));
    assert.ok(files[0].previousPath.endsWith(path.join('docs', 'old.md')));
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('repo: canonicalizeRemoteUrl normalizes git ssh remotes', () => {
  assert.equal(canonicalizeRemoteUrl('git@github.com:owner/repo.git'), 'https://github.com/owner/repo');
});

test('repo: getRepoFingerprint honors DOCLIFY_REPO_ID override', () => {
  const previous = process.env.DOCLIFY_REPO_ID;
  process.env.DOCLIFY_REPO_ID = 'repo-test-id';
  try {
    assert.equal(getRepoFingerprint(), 'repo-test-id');
    const metadata = getRepoMetadata();
    assert.equal(metadata.fingerprint, 'repo-test-id');
    assert.equal(metadata.source, 'override');
  } finally {
    if (previous === undefined) delete process.env.DOCLIFY_REPO_ID;
    else process.env.DOCLIFY_REPO_ID = previous;
  }
});

test('score-api: repo getCurrentBranch resolves git branch and detached HEAD', () => {
  assert.equal(typeof repoModule.getCurrentBranch, 'function');

  const tmp = makeTempDir();
  const previousCwd = process.cwd();
  try {
    process.chdir(tmp);
    assert.equal(spawnSync('git', ['init'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Doclify Test'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'doclify@example.com'], { encoding: 'utf8' }).status, 0);
    fs.writeFileSync(path.join(tmp, 'README.md'), '# Title\n', 'utf8');
    assert.equal(spawnSync('git', ['add', '.'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'seed'], { encoding: 'utf8' }).status, 0);

    const branch = repoModule.getCurrentBranch({ cwd: tmp });
    assert.ok(branch && branch !== 'unknown' && branch !== 'HEAD');

    assert.equal(spawnSync('git', ['checkout', '--detach', 'HEAD'], { encoding: 'utf8' }).status, 0);
    const detached = repoModule.getCurrentBranch({ cwd: tmp });
    assert.equal(detached, 'HEAD');
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('score-api: repo getCurrentBranch returns unknown outside git repo', () => {
  assert.equal(typeof repoModule.getCurrentBranch, 'function');
  const tmp = makeTempDir();
  const branch = repoModule.getCurrentBranch({ cwd: tmp });
  assert.equal(branch, 'unknown');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('auth-store: save/load/clear persists auth state in DOCLIFY_HOME', () => {
  const tmp = makeTempDir();
  const previous = process.env.DOCLIFY_HOME;
  process.env.DOCLIFY_HOME = tmp;

  try {
    saveAuthState({
      apiKey: 'doclify_test_key',
      apiUrl: 'https://api.example.test',
      verifiedAt: '2026-03-07T12:00:00.000Z'
    });

    const filePath = getAuthFilePath();
    assert.ok(fs.existsSync(filePath));
    const loaded = loadAuthState();
    assert.equal(loaded.apiKey, 'doclify_test_key');
    clearAuthState();
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    if (previous === undefined) delete process.env.DOCLIFY_HOME;
    else process.env.DOCLIFY_HOME = previous;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('repo-memory: save/load roundtrip uses repo fingerprint namespace', () => {
  const tmp = makeTempDir();
  const previous = process.env.DOCLIFY_HOME;
  process.env.DOCLIFY_HOME = tmp;

  try {
    const repo = { fingerprint: 'repo-123' };
    saveRepoMemory(repo, {
      terms: ['Doclify'],
      acceptedFixes: ['insecure-link']
    });
    const loaded = loadRepoMemory(repo);
    assert.deepEqual(loaded.terms, ['Doclify']);
    assert.deepEqual(loaded.acceptedFixes, ['insecure-link']);
  } finally {
    if (previous === undefined) delete process.env.DOCLIFY_HOME;
    else process.env.DOCLIFY_HOME = previous;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('drift: analyzeDriftOffline detects docs related to changed CLI flags', () => {
  const tmp = makeTempDir();
  const docsPath = path.join(tmp, 'docs', 'cli.md');
  const codePath = path.join(tmp, 'src', 'cli.mjs');
  fs.mkdirSync(path.dirname(docsPath), { recursive: true });
  fs.mkdirSync(path.dirname(codePath), { recursive: true });
  fs.writeFileSync(docsPath, '# CLI\n\nUse `--fail-on-drift` to fail the build.\n', 'utf8');
  fs.writeFileSync(codePath, 'export const HELP = "--fail-on-drift";\n', 'utf8');

  const result = analyzeDriftOffline({
    changedFiles: [{ status: 'M', path: codePath, previousPath: null }],
    targetFiles: [docsPath],
    repoMetadata: { fingerprint: 'repo-test', root: tmp }
  });

  assert.equal(result.mode, 'offline');
  assert.equal(result.summary.alerts >= 1, true);
  assert.equal(result.alerts[0].doc, path.join('docs', 'cli.md'));
  assert.ok(['high', 'medium'].includes(result.alerts[0].risk));
  assert.equal(result.alerts[0].scope, 'unmodified');
  assert.equal(typeof result.alerts[0].confidence, 'number');
  assert.equal(typeof result.alerts[0].scoreBreakdown, 'object');
  assert.ok(result.alerts[0].matchedTokens.includes('--fail-on-drift') || result.alerts[0].reasons.some((reason) => reason.includes('shared flag')));
});

test('drift: generic token overlap is capped to low risk without strong signals', () => {
  const tmp = makeTempDir();
  const docsPath = path.join(tmp, 'docs', 'adapter-engine.md');
  const codePath = path.join(tmp, 'src', 'adapter-engine.mjs');
  fs.mkdirSync(path.dirname(docsPath), { recursive: true });
  fs.mkdirSync(path.dirname(codePath), { recursive: true });
  fs.writeFileSync(
    docsPath,
    '# Adapter Engine\n\nThis adapter engine orchestrates renderer pipelines.\n',
    'utf8'
  );
  fs.writeFileSync(
    codePath,
    'export function buildAdapterEngine(rendererPipeline) { return rendererPipeline; }\n',
    'utf8'
  );

  const result = analyzeDriftOffline({
    changedFiles: [{ status: 'M', path: codePath, previousPath: null }],
    targetFiles: [docsPath],
    repoMetadata: { fingerprint: 'repo-test', root: tmp }
  });

  assert.equal(result.summary.alerts >= 1, true);
  assert.equal(result.alerts.some((alert) => alert.risk === 'high' || alert.risk === 'medium'), false);
});

test('drift: markdown file changed in diff reduces severity and marks scope as modified', () => {
  const tmp = makeTempDir();
  const docsPath = path.join(tmp, 'docs', 'cli.md');
  const codePath = path.join(tmp, 'src', 'cli.mjs');
  fs.mkdirSync(path.dirname(docsPath), { recursive: true });
  fs.mkdirSync(path.dirname(codePath), { recursive: true });
  fs.writeFileSync(
    docsPath,
    '# CLI\n\nUse `--fail-on-drift` and `/v1/auth/verify-key` from `src/cli.mjs`.\n',
    'utf8'
  );
  fs.writeFileSync(
    codePath,
    'export const HELP = "--fail-on-drift";\nexport const VERIFY = "/v1/auth/verify-key";\n',
    'utf8'
  );

  const baseline = analyzeDriftOffline({
    changedFiles: [{ status: 'M', path: codePath, previousPath: null }],
    targetFiles: [docsPath],
    repoMetadata: { fingerprint: 'repo-test', root: tmp }
  });
  const withDocChanged = analyzeDriftOffline({
    changedFiles: [
      { status: 'M', path: codePath, previousPath: null },
      { status: 'M', path: docsPath, previousPath: null }
    ],
    targetFiles: [docsPath],
    repoMetadata: { fingerprint: 'repo-test', root: tmp }
  });

  assert.equal(baseline.summary.alerts >= 1, true);
  assert.equal(withDocChanged.summary.alerts >= 1, true);
  assert.ok(withDocChanged.alerts[0].score <= baseline.alerts[0].score - 20);
  const riskRank = { high: 3, medium: 2, low: 1 };
  assert.ok(riskRank[withDocChanged.alerts[0].risk] <= riskRank[baseline.alerts[0].risk]);
  assert.equal(withDocChanged.alerts[0].scope, 'modified');
});

test('score-api: buildScorePayload maps output fields to cloud payload', () => {
  assert.equal(typeof cloudClient.buildScorePayload, 'function');
  const payload = cloudClient.buildScorePayload({
    output: {
      version: '1.7.2',
      scanId: 'scan-1',
      summary: {
        avgHealthScore: 82,
        totalErrors: 2,
        totalWarnings: 5,
        filesScanned: 12,
        filesPassed: 10,
        filesFailed: 2,
        status: 'FAIL'
      },
      repo: {
        fingerprint: 'git:abc123',
        remote: 'https://github.com/acme/docs'
      }
    },
    projectId: 'proj-1',
    commit: 'abc1234',
    branch: 'feat/docs-update',
    version: '1.7.2',
    gate: { minScore: 80, result: 'PASS' },
    meta: { ci: 'github-actions' }
  });

  assert.deepEqual(payload, {
    projectId: 'proj-1',
    scanId: 'scan-1',
    commit: 'abc1234',
    branch: 'feat/docs-update',
    version: '1.7.2',
    score: 82,
    errors: 2,
    warnings: 5,
    filesScanned: 12,
    filesPassed: 10,
    filesFailed: 2,
    status: 'FAIL',
    repo: {
      fingerprint: 'git:abc123',
      remote: 'https://github.com/acme/docs'
    },
    gate: { minScore: 80, result: 'PASS' },
    meta: { ci: 'github-actions' }
  });
});

test('score-api: pushScoreReport posts payload and returns id with optional delta', async () => {
  assert.equal(typeof cloudClient.pushScoreReport, 'function');

  let firstRequest = null;
  let requestCount = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url !== '/v1/scores' || req.method !== 'POST') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    requestCount += 1;
    let raw = '';
    req.setEncoding('utf8');
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (!firstRequest) {
      firstRequest = {
        headers: req.headers,
        body
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'rpt-1', delta: 3 }));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'rpt-2' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const resultWithDelta = await cloudClient.pushScoreReport({
      apiUrl: `http://127.0.0.1:${port}`,
      apiKey: 'doclify_live_test',
      payload: { scanId: 'scan-1', score: 80 },
      retries: 0,
      timeoutMs: 1000
    });
    assert.equal(resultWithDelta.id, 'rpt-1');
    assert.equal(resultWithDelta.delta, 3);
    assert.equal(firstRequest.headers.authorization, 'Bearer doclify_live_test');
    assert.equal(firstRequest.body.scanId, 'scan-1');
    assert.equal(firstRequest.body.score, 80);

    const resultWithoutDelta = await cloudClient.pushScoreReport({
      apiUrl: `http://127.0.0.1:${port}`,
      apiKey: 'doclify_live_test',
      payload: { scanId: 'scan-2', score: 88 },
      retries: 0,
      timeoutMs: 1000
    });
    assert.equal(resultWithoutDelta.id, 'rpt-2');
    assert.equal(resultWithoutDelta.delta, undefined);
    assert.equal(requestCount, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('score-api: pushScoreReport throws CloudError on non-2xx responses', async () => {
  assert.equal(typeof cloudClient.pushScoreReport, 'function');

  const server = http.createServer((req, res) => {
    if (req.url === '/v1/scores' && req.method === 'POST') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid token' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await assert.rejects(
      () => cloudClient.pushScoreReport({
        apiUrl: `http://127.0.0.1:${port}`,
        apiKey: 'doclify_live_test',
        payload: { scanId: 'scan-1', score: 80 },
        retries: 0
      }),
      (error) => error instanceof cloudClient.CloudError && error.status === 401
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('CLI: login/whoami/logout use local auth store and verification endpoint', async () => {
  const tmp = makeTempDir();
  const previousHome = process.env.DOCLIFY_HOME;
  const previousApiUrl = process.env.DOCLIFY_API_URL;
  const runCliAsync = (args, env) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf8',
      env
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ status: code, stdout, stderr });
    });
  });
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/auth/verify-key' && req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) {
        body += chunk;
      }
      const parsed = JSON.parse(body);
      if (req.headers.authorization === 'Bearer doclify_live_test' && parsed.apiKey === 'doclify_live_test') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ account: { name: 'Acme Docs' } }));
        return;
      }
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid key' }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  process.env.DOCLIFY_HOME = tmp;
  process.env.DOCLIFY_API_URL = `http://127.0.0.1:${port}`;

  try {
    const login = await runCliAsync(['login', '--key', 'doclify_live_test', '--json'], process.env);
    assert.equal(login.status, 0, login.stderr);
    const loginPayload = JSON.parse(login.stdout);
    assert.equal(loginPayload.account.name, 'Acme Docs');

    const whoami = await runCliAsync(['whoami', '--json'], process.env);
    assert.equal(whoami.status, 0, whoami.stderr);
    const whoamiPayload = JSON.parse(whoami.stdout);
    assert.equal(whoamiPayload.account.name, 'Acme Docs');

    const logout = await runCliAsync(['logout'], process.env);
    assert.equal(logout.status, 0, logout.stderr);
    assert.equal(fs.existsSync(path.join(tmp, 'auth.json')), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousHome === undefined) delete process.env.DOCLIFY_HOME;
    else process.env.DOCLIFY_HOME = previousHome;
    if (previousApiUrl === undefined) delete process.env.DOCLIFY_API_URL;
    else process.env.DOCLIFY_API_URL = previousApiUrl;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('score-api: CLI --push sends score payload and projectId uses CLI > env > config precedence', async () => {
  const tmp = makeTempDir();
  const configPath = path.join(tmp, '.doclify-guardrail.json');
  fs.writeFileSync(configPath, JSON.stringify({ push: true, projectId: 'cfg-proj' }) + '\n', 'utf8');
  fs.writeFileSync(path.join(tmp, 'doc.md'), '# Title\n\nHealthy content.\n', 'utf8');

  assert.equal(spawnSync('git', ['init'], { cwd: tmp, encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['config', 'user.name', 'Doclify Test'], { cwd: tmp, encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['config', 'user.email', 'doclify@example.com'], { cwd: tmp, encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['add', '.'], { cwd: tmp, encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['commit', '-m', 'seed'], { cwd: tmp, encoding: 'utf8' }).status, 0);

  let receivedPayload = null;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/scores' && req.method === 'POST') {
      let raw = '';
      req.setEncoding('utf8');
      for await (const chunk of req) raw += chunk;
      receivedPayload = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'report-1', delta: 2 }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const run = spawnSync(process.execPath, [
      CLI_PATH,
      path.join(tmp, 'doc.md'),
      '--push',
      '--project-id',
      'cli-proj',
      '--api-url',
      `http://127.0.0.1:${port}`,
      '--ascii'
    ], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        ...process.env,
        DOCLIFY_PROJECT_ID: 'env-proj',
        DOCLIFY_TOKEN: 'doclify_live_test'
      }
    });

    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stderr.includes('Score pushed'), run.stderr);
    assert.ok(receivedPayload, 'Score payload should be sent');
    assert.equal(receivedPayload.projectId, 'cli-proj');
    assert.equal(receivedPayload.score, 100);
    assert.equal(receivedPayload.filesScanned, 1);
    assert.equal(receivedPayload.filesPassed, 1);
    assert.equal(receivedPayload.filesFailed, 0);
    assert.equal(receivedPayload.status, 'PASS');
    assert.equal(typeof receivedPayload.scanId, 'string');
    assert.equal(typeof receivedPayload.branch, 'string');
    assert.equal(typeof receivedPayload.commit, 'string');
    assert.equal(receivedPayload.repo.fingerprint.startsWith('git:'), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('score-api: CLI --push without token logs clear error and keeps lint exit code', () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '# Title\n\nClean content.\n', 'utf8');

  const env = { ...process.env };
  delete env.DOCLIFY_TOKEN;

  const run = spawnSync(process.execPath, [CLI_PATH, mdPath, '--push', '--ascii'], {
    cwd: tmp,
    encoding: 'utf8',
    env
  });

  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stderr.includes('Cannot push: no API token configured'), run.stderr);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('score-api: CLI --push cloud errors do not change lint exit code', async () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '# Title\n\nClean content.\n', 'utf8');

  const server = http.createServer((req, res) => {
    if (req.url === '/v1/scores' && req.method === 'POST') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const run = spawnSync(process.execPath, [
      CLI_PATH,
      mdPath,
      '--push',
      '--api-url',
      `http://127.0.0.1:${port}`,
      '--ascii'
    ], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        ...process.env,
        DOCLIFY_TOKEN: 'doclify_live_test'
      }
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stderr, /score push failed|push failed|Cloud/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('score-api: CLI skips push when --diff has no changed markdown files', async () => {
  const tmp = makeTempDir();
  fs.writeFileSync(path.join(tmp, 'doc.md'), '# Title\n', 'utf8');
  assert.equal(spawnSync('git', ['init'], { cwd: tmp, encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['config', 'user.name', 'Doclify Test'], { cwd: tmp, encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['config', 'user.email', 'doclify@example.com'], { cwd: tmp, encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['add', '.'], { cwd: tmp, encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['commit', '-m', 'seed'], { cwd: tmp, encoding: 'utf8' }).status, 0);

  let scoreCalls = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/scores' && req.method === 'POST') {
      scoreCalls += 1;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'report' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const run = spawnSync(process.execPath, [
      CLI_PATH,
      '--diff',
      '--push',
      '--api-url',
      `http://127.0.0.1:${port}`,
      '--ascii'
    ], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        ...process.env,
        DOCLIFY_TOKEN: 'doclify_live_test'
      }
    });

    assert.equal(run.status, 0, run.stderr);
    assert.equal(scoreCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: ai drift reports alerts for changed code related to docs', () => {
  const tmp = makeTempDir();
  const previousCwd = process.cwd();

  try {
    process.chdir(tmp);
    assert.equal(spawnSync('git', ['init'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Doclify Test'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'doclify@example.com'], { encoding: 'utf8' }).status, 0);

    fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'docs', 'cli.md'), '# CLI\n\nUse `--fail-on-drift` in CI.\n', 'utf8');
    fs.writeFileSync(path.join(tmp, 'src', 'cli.mjs'), 'export const HELP = "--fail-on-drift";\n', 'utf8');
    assert.equal(spawnSync('git', ['add', '.'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'seed'], { encoding: 'utf8' }).status, 0);

    fs.writeFileSync(path.join(tmp, 'src', 'cli.mjs'), 'export const HELP = "--fail-on-drift";\nexport const EXTRA = "/v1/auth/verify-key";\n', 'utf8');

    const run = spawnSync(process.execPath, [CLI_PATH, 'ai', 'drift', 'docs', '--diff', '--json'], {
      cwd: tmp,
      encoding: 'utf8'
    });
    assert.equal(run.status, 0, run.stderr);
    const parsed = JSON.parse(run.stdout);
    assert.equal(parsed.schemaVersion, 2);
    assert.equal(parsed.engine.mode, 'ai');
    assert.equal(parsed.ai.drift.summary.alerts >= 1, true);
    assert.equal(parsed.ai.drift.alerts[0].doc, path.join('docs', 'cli.md'));
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: --ai-drift embeds drift summary in scan JSON output', () => {
  const tmp = makeTempDir();
  const previousCwd = process.cwd();

  try {
    process.chdir(tmp);
    assert.equal(spawnSync('git', ['init'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Doclify Test'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'doclify@example.com'], { encoding: 'utf8' }).status, 0);

    fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'docs', 'cli.md'), '# CLI\n\nUse `--fail-on-drift` in CI.\n', 'utf8');
    fs.writeFileSync(path.join(tmp, 'src', 'cli.mjs'), 'export const HELP = "--fail-on-drift";\n', 'utf8');
    assert.equal(spawnSync('git', ['add', '.'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'seed'], { encoding: 'utf8' }).status, 0);

    fs.writeFileSync(path.join(tmp, 'src', 'cli.mjs'), 'export const HELP = "--fail-on-drift";\nexport const EXTRA = "/v1/auth/verify-key";\n', 'utf8');

    const run = spawnSync(process.execPath, [CLI_PATH, 'docs/cli.md', '--json', '--ai-drift'], {
      cwd: tmp,
      encoding: 'utf8'
    });
    assert.equal(run.status, 0, run.stderr);
    const parsed = JSON.parse(run.stdout);
    assert.equal(typeof parsed.ai, 'object');
    assert.equal(parsed.ai.drift.summary.alerts >= 1, true);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: drift gating with unmodified scope ignores modified docs', () => {
  const tmp = makeTempDir();
  const previousCwd = process.cwd();

  try {
    process.chdir(tmp);
    assert.equal(spawnSync('git', ['init'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Doclify Test'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'doclify@example.com'], { encoding: 'utf8' }).status, 0);

    fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    const docsPath = path.join(tmp, 'docs', 'cli.md');
    const codePath = path.join(tmp, 'src', 'cli.mjs');
    fs.writeFileSync(docsPath, '# CLI\n\nUse `--fail-on-drift` and `/v1/auth/verify-key` from `src/cli.mjs`.\n', 'utf8');
    fs.writeFileSync(codePath, 'export const HELP = "--fail-on-drift";\nexport const VERIFY = "/v1/auth/verify-key";\n', 'utf8');
    assert.equal(spawnSync('git', ['add', '.'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'seed'], { encoding: 'utf8' }).status, 0);

    fs.writeFileSync(codePath, 'export const HELP = "--fail-on-drift";\nexport const VERIFY = "/v1/auth/verify-key";\nexport const VERSION = "2.0.0";\n', 'utf8');
    const runUnmodified = spawnSync(process.execPath, [
      CLI_PATH,
      'docs/cli.md',
      '--json',
      '--ai-drift',
      '--fail-on-drift',
      'high',
      '--fail-on-drift-scope',
      'unmodified'
    ], {
      cwd: tmp,
      encoding: 'utf8'
    });
    assert.equal(runUnmodified.status, 1, runUnmodified.stderr);
    const parsedUnmodified = JSON.parse(runUnmodified.stdout);
    assert.equal(parsedUnmodified.ai.drift.summary.gatingScope, 'unmodified');
    assert.ok(parsedUnmodified.ai.drift.summary.alertsByScope.unmodified >= 1);

    fs.writeFileSync(
      docsPath,
      '# CLI\n\nUse `--fail-on-drift` and `/v1/auth/verify-key` from `src/cli.mjs`.\n\nUpdated for v2.\n',
      'utf8'
    );
    const runModified = spawnSync(process.execPath, [
      CLI_PATH,
      'docs/cli.md',
      '--json',
      '--ai-drift',
      '--fail-on-drift',
      'high',
      '--fail-on-drift-scope',
      'unmodified'
    ], {
      cwd: tmp,
      encoding: 'utf8'
    });
    assert.equal(runModified.status, 0, runModified.stderr);
    const parsedModified = JSON.parse(runModified.stdout);
    assert.equal(parsedModified.ai.drift.summary.gatingScope, 'unmodified');
    assert.equal(parsedModified.ai.drift.summary.alertsByScope.unmodified, 0);
    assert.ok(parsedModified.ai.drift.summary.alertsByScope.modified >= 1);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: diff fallback with ai drift limits targets to README/CHANGELOG/docs', () => {
  const tmp = makeTempDir();
  const previousCwd = process.cwd();

  try {
    process.chdir(tmp);
    assert.equal(spawnSync('git', ['init'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Doclify Test'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'doclify@example.com'], { encoding: 'utf8' }).status, 0);

    fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'README.md'), '# Root\n', 'utf8');
    fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
    fs.writeFileSync(path.join(tmp, 'notes.md'), '# Notes\n', 'utf8');
    fs.writeFileSync(path.join(tmp, 'docs', 'guide.md'), '# Guide\n', 'utf8');
    fs.writeFileSync(path.join(tmp, 'src', 'index.mjs'), 'export const VERSION = "1.0.0";\n', 'utf8');
    assert.equal(spawnSync('git', ['add', '.'], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-m', 'seed'], { encoding: 'utf8' }).status, 0);

    fs.writeFileSync(path.join(tmp, 'src', 'index.mjs'), 'export const VERSION = "1.1.0";\n', 'utf8');
    const run = spawnSync(process.execPath, [CLI_PATH, '--diff', '--ai-drift', '--json'], {
      cwd: tmp,
      encoding: 'utf8'
    });

    assert.equal(run.status, 0, run.stderr);
    const parsed = JSON.parse(run.stdout);
    const scanned = parsed.files.map((file) => file.file);
    assert.equal(scanned.includes('notes.md'), false);
    assert.equal(scanned.includes('README.md'), true);
    assert.equal(scanned.includes('CHANGELOG.md'), true);
    assert.equal(scanned.includes(path.join('docs', 'guide.md')), true);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: ai fix is explicitly unavailable in v1 surface', () => {
  const run = spawnSync(process.execPath, [CLI_PATH, 'ai', 'fix'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.ok(`${run.stdout}\n${run.stderr}`.includes('not available yet'));
});

// --list-rules shows all current built-in rules
test('CLI: --list-rules shows all 35 rules', () => {
  const r = spawnSync('node', [CLI_PATH, '--list-rules', '--ascii'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  // Count rule lines (each has an ID padded to 22 chars)
  const ruleLines = r.stdout.split('\n').filter(l => l.includes('warning') || l.includes('error'));
  assert.ok(ruleLines.length >= 35, `Expected >=35 rules, got ${ruleLines.length}`);
});

// ===== Reliability Gate scripts =====

test('run-corpus: parseArgs supports cache and lock options', () => {
  const args = parseCorpusArgs([
    '--profile', 'deterministic',
    '--out', 'bench/out/test.json',
    '--cache-root', '.cache/custom-corpus',
    '--lock-timeout-ms', '12345',
    '--stale-lock-ms', '67890'
  ]);

  assert.equal(args.cacheRoot, '.cache/custom-corpus');
  assert.equal(args.lockTimeoutMs, 12345);
  assert.equal(args.staleLockMs, 67890);
});

test('run-corpus: filesystem lock serializes concurrent access', async () => {
  const tmp = makeTempDir();
  const lockDir = path.join(tmp, 'repo.lock');
  const events = [];

  const first = withFilesystemLock(lockDir, { timeoutMs: 2000, staleLockMs: 2000 }, async () => {
    events.push('first:start');
    await new Promise((resolve) => setTimeout(resolve, 140));
    events.push('first:end');
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  const waitStartedAt = Date.now();

  const second = withFilesystemLock(lockDir, { timeoutMs: 2000, staleLockMs: 2000 }, async () => {
    events.push('second:start');
    events.push(`second:waited:${Date.now() - waitStartedAt}`);
  });

  await Promise.all([first, second]);

  const firstEndIndex = events.indexOf('first:end');
  const secondStartIndex = events.indexOf('second:start');
  assert.ok(firstEndIndex >= 0);
  assert.ok(secondStartIndex > firstEndIndex, 'second lock holder should start only after first releases');

  const waitedEntry = events.find((entry) => entry.startsWith('second:waited:'));
  assert.ok(waitedEntry, 'expected waited timing entry');
  const waitedMs = Number(waitedEntry.split(':')[2]);
  assert.ok(waitedMs >= 80, `second holder should wait, got ${waitedMs}ms`);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('run-corpus: manifest validation and tag selection', () => {
  const manifest = {
    schemaVersion: 1,
    profiles: {
      deterministic: { args: ['--json'], checkLinks: false }
    },
    repos: [
      { id: 'a', url: 'https://example.com/a.git', commit: 'abc', category: 'small', scanPath: '.', tags: ['pr-sample'], extraArgs: [] },
      { id: 'b', url: 'https://example.com/b.git', commit: 'def', category: 'small', scanPath: '.', tags: ['nightly-full'], extraArgs: [] }
    ]
  };
  assert.doesNotThrow(() => assertCorpusManifest(manifest));
  assert.throws(
    () => assertCorpusManifest({ schemaVersion: 1, profiles: {}, repos: [{ id: 'broken' }] }),
    /missing required fields/i
  );
  const selected = selectCorpusRepos(manifest, 'pr-sample');
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, 'a');
});

test('run-corpus: fingerprint ignores runtime engine/elapsed fields', () => {
  const base = {
    version: '1.6.0',
    strict: true,
    files: [
      { file: 'README.md', pass: true, findings: { errors: [], warnings: [] }, summary: { errors: 0, warnings: 0, healthScore: 100, status: 'PASS' } }
    ],
    summary: { filesScanned: 1, filesPassed: 1, filesFailed: 0, totalErrors: 0, totalWarnings: 0, status: 'PASS', elapsed: 0.11, avgHealthScore: 100 },
    engine: { schemaVersion: 1, scanMs: 100, peakMemoryMb: 20.1, remoteLinksChecked: 0, remoteCacheHits: 0, remoteCacheMisses: 0, cacheHitRate: 0, remoteTimeouts: 0, timeoutRate: 0 }
  };
  const variant = JSON.parse(JSON.stringify(base));
  variant.summary.elapsed = 42.42;
  variant.engine.scanMs = 9876;
  variant.engine.peakMemoryMb = 777;

  const normA = normalizeOutputForHash(base);
  const normB = normalizeOutputForHash(variant);
  assert.deepEqual(normA, normB);
  assert.equal(fingerprintOutput(base), fingerprintOutput(variant));
});

test('run-corpus: executes deterministic repeated runs on local git fixture', async () => {
  const tmp = makeTempDir();
  const seedRepo = path.join(tmp, 'seed-repo');
  const manifestPath = path.join(tmp, 'manifest.json');
  const outPath = path.join(tmp, 'out.json');

  fs.mkdirSync(seedRepo, { recursive: true });
  fs.writeFileSync(path.join(seedRepo, 'README.md'), '# Fixture\n\nDeterministic content.\n', 'utf8');
  spawnSync('git', ['init', '-b', 'main', seedRepo], { encoding: 'utf8' });
  spawnSync('git', ['-C', seedRepo, 'config', 'user.email', 'ci@example.com'], { encoding: 'utf8' });
  spawnSync('git', ['-C', seedRepo, 'config', 'user.name', 'CI Bot'], { encoding: 'utf8' });
  spawnSync('git', ['-C', seedRepo, 'add', '.'], { encoding: 'utf8' });
  spawnSync('git', ['-C', seedRepo, 'commit', '-m', 'fixture'], { encoding: 'utf8' });
  const rev = spawnSync('git', ['-C', seedRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const commit = rev.stdout.trim();
  assert.ok(commit.length > 10);

  const manifest = {
    schemaVersion: 1,
    profiles: {
      deterministic: {
        args: ['--strict', '--json', '--ascii', '--no-color'],
        checkLinks: false
      }
    },
    repos: [
      {
        id: 'local-fixture',
        url: seedRepo,
        commit,
        category: 'small',
        scanPath: '.',
        tags: ['local'],
        extraArgs: []
      }
    ]
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const code = await runCorpus([
    '--manifest', manifestPath,
    '--profile', 'deterministic',
    '--tag', 'local',
    '--repeat', '2',
    '--out', outPath
  ]);
  assert.equal(code, 0);
  const parsed = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(parsed.repos.length, 1);
  assert.equal(parsed.repos[0].runs.length, 2);
  assert.equal(parsed.repos[0].aggregate.deterministic, true);
  assert.equal(parsed.repos[0].aggregate.uniqueFingerprintCount, 1);
  fs.rmSync(tmp, { recursive: true });
});

test('run-corpus: executes scans from checkout cwd so parent config is applied', async () => {
  const tmp = makeTempDir();
  const seedRepo = path.join(tmp, 'seed-repo');
  const docsDir = path.join(seedRepo, 'docs');
  const manifestPath = path.join(tmp, 'manifest.json');
  const outPath = path.join(tmp, 'out.json');

  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(seedRepo, '.doclify-guardrail.json'), JSON.stringify({
    checkFreshness: true,
    freshnessMaxDays: 1
  }) + '\n', 'utf8');
  fs.writeFileSync(path.join(docsDir, 'guide.md'), '---\nupdated: 2020-01-01\n---\n# Guide\n', 'utf8');
  spawnSync('git', ['init', '-b', 'main', seedRepo], { encoding: 'utf8' });
  spawnSync('git', ['-C', seedRepo, 'config', 'user.email', 'ci@example.com'], { encoding: 'utf8' });
  spawnSync('git', ['-C', seedRepo, 'config', 'user.name', 'CI Bot'], { encoding: 'utf8' });
  spawnSync('git', ['-C', seedRepo, 'add', '.'], { encoding: 'utf8' });
  spawnSync('git', ['-C', seedRepo, 'commit', '-m', 'fixture'], { encoding: 'utf8' });
  const commit = spawnSync('git', ['-C', seedRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    profiles: {
      deterministic: {
        args: ['--json', '--ascii', '--no-color'],
        checkLinks: false
      }
    },
    repos: [
      {
        id: 'local-config-fixture',
        url: seedRepo,
        commit,
        category: 'small',
        scanPath: 'docs',
        tags: ['local-config'],
        extraArgs: []
      }
    ]
  }, null, 2) + '\n', 'utf8');

  const code = await runCorpus([
    '--manifest', manifestPath,
    '--profile', 'deterministic',
    '--tag', 'local-config',
    '--repeat', '1',
    '--out', outPath
  ]);

  assert.equal(code, 0);
  const parsed = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.ok(parsed.repos[0].runs[0].summary.totalWarnings >= 1);
  fs.rmSync(tmp, { recursive: true });
});

test('compare-baseline: fails when p95 regression exceeds thresholds', () => {
  const current = {
    profile: 'deterministic',
    repos: [{ id: 'repo-a', category: 'small', aggregate: { crashRatePct: 0, deterministic: true, p95ScanMs: 5000, peakMemoryMb: 100, findingsCount: 10 } }]
  };
  const baseline = {
    profile: 'deterministic',
    repos: [{ id: 'repo-a', category: 'small', aggregate: { crashRatePct: 0, deterministic: true, p95ScanMs: 1000, peakMemoryMb: 100, findingsCount: 10 } }]
  };
  const thresholds = {
    schemaVersion: 1,
    deterministic: {
      requireDeterminism: true,
      maxCrashRatePct: 0,
      maxP95RegressionPct: 20,
      maxP95RegressionMs: 2500,
      maxPeakMemoryRegressionPct: 25,
      maxNewFindingsDelta: 0,
      categoryP95BudgetMs: { small: 10000, medium: 45000, large: 180000 }
    },
    network: { maxCrashRatePct: 0, maxTimeoutRatePct: 1.0 }
  };
  const waivers = buildWaiverIndex({ schemaVersion: 1, waivers: [] }, new Date('2026-03-01T00:00:00Z'));
  const result = evaluateComparison(current, baseline, thresholds, waivers);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.effectiveFailures.some((v) => v.metric === 'p95ScanMs'));
});

test('compare-baseline: valid waiver suppresses blocking failure', () => {
  const current = {
    profile: 'deterministic',
    repos: [{ id: 'repo-a', category: 'small', aggregate: { crashRatePct: 0, deterministic: true, p95ScanMs: 5000, peakMemoryMb: 100, findingsCount: 10 } }]
  };
  const baseline = {
    profile: 'deterministic',
    repos: [{ id: 'repo-a', category: 'small', aggregate: { crashRatePct: 0, deterministic: true, p95ScanMs: 1000, peakMemoryMb: 100, findingsCount: 10 } }]
  };
  const thresholds = {
    schemaVersion: 1,
    deterministic: {
      requireDeterminism: true,
      maxCrashRatePct: 0,
      maxP95RegressionPct: 20,
      maxP95RegressionMs: 2500,
      maxPeakMemoryRegressionPct: 25,
      maxNewFindingsDelta: 0,
      categoryP95BudgetMs: { small: 10000, medium: 45000, large: 180000 }
    },
    network: { maxCrashRatePct: 0, maxTimeoutRatePct: 1.0 }
  };
  const waivers = buildWaiverIndex({
    schemaVersion: 1,
    waivers: [
      {
        id: 'WAIVER-001',
        repoId: 'repo-a',
        metric: 'p95ScanMs',
        expiresOn: '2026-12-31',
        reason: 'temporary perf drift under investigation',
        owner: 'team-doclify'
      }
    ]
  }, new Date('2026-03-01T00:00:00Z'));

  const result = evaluateComparison(current, baseline, thresholds, waivers);
  assert.equal(result.status, 'PASS');
  assert.equal(result.effectiveFailures.length, 0);
  assert.ok(result.violations.some((v) => v.waived && v.metric === 'p95ScanMs'));
});

test('compare-baseline: ignores pct-only p95 regressions when baseline is below min threshold', () => {
  const current = {
    profile: 'deterministic',
    repos: [{ id: 'repo-a', category: 'small', aggregate: { crashRatePct: 0, deterministic: true, p95ScanMs: 75, peakMemoryMb: 100, findingsCount: 10 } }]
  };
  const baseline = {
    profile: 'deterministic',
    repos: [{ id: 'repo-a', category: 'small', aggregate: { crashRatePct: 0, deterministic: true, p95ScanMs: 35, peakMemoryMb: 100, findingsCount: 10 } }]
  };
  const thresholds = {
    schemaVersion: 1,
    deterministic: {
      requireDeterminism: true,
      maxCrashRatePct: 0,
      maxP95RegressionPct: 20,
      maxP95RegressionMs: 2500,
      minBaselineP95ForPctMs: 1000,
      maxPeakMemoryRegressionPct: 25,
      maxNewFindingsDelta: 0,
      categoryP95BudgetMs: { small: 10000, medium: 45000, large: 180000 }
    },
    network: { maxCrashRatePct: 0, maxTimeoutRatePct: 1.0 }
  };

  const waivers = buildWaiverIndex({ schemaVersion: 1, waivers: [] }, new Date('2026-03-01T00:00:00Z'));
  const result = evaluateComparison(current, baseline, thresholds, waivers);
  assert.equal(result.status, 'PASS');
  assert.equal(result.effectiveFailures.length, 0);
});

test('compare-baseline: expired waiver does not suppress failure', () => {
  const current = {
    profile: 'deterministic',
    repos: [{ id: 'repo-a', category: 'small', aggregate: { crashRatePct: 0, deterministic: true, p95ScanMs: 5000, peakMemoryMb: 100, findingsCount: 10 } }]
  };
  const baseline = {
    profile: 'deterministic',
    repos: [{ id: 'repo-a', category: 'small', aggregate: { crashRatePct: 0, deterministic: true, p95ScanMs: 1000, peakMemoryMb: 100, findingsCount: 10 } }]
  };
  const thresholds = {
    schemaVersion: 1,
    deterministic: {
      requireDeterminism: true,
      maxCrashRatePct: 0,
      maxP95RegressionPct: 20,
      maxP95RegressionMs: 2500,
      maxPeakMemoryRegressionPct: 25,
      maxNewFindingsDelta: 0,
      categoryP95BudgetMs: { small: 10000, medium: 45000, large: 180000 }
    },
    network: { maxCrashRatePct: 0, maxTimeoutRatePct: 1.0 }
  };
  const waivers = buildWaiverIndex({
    schemaVersion: 1,
    waivers: [
      {
        id: 'WAIVER-001',
        repoId: 'repo-a',
        metric: 'p95ScanMs',
        expiresOn: '2026-01-01',
        reason: 'expired exception',
        owner: 'team-doclify'
      }
    ]
  }, new Date('2026-03-01T00:00:00Z'));

  const result = evaluateComparison(current, baseline, thresholds, waivers);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.effectiveFailures.some((v) => v.metric === 'p95ScanMs'));
});

// ===== v1.6 — Trend & Score Tracking =====

// trend.mjs unit tests
test('trend: loadHistory returns [] if file does not exist', () => {
  const tmpDir = makeTempDir();
  const historyPath = path.join(tmpDir, '.doclify-history.json');
  const result = loadHistory(historyPath);
  assert.deepEqual(result, []);
  fs.rmSync(tmpDir, { recursive: true });
});

test('trend: appendHistory creates file and adds entry', () => {
  const tmpDir = makeTempDir();
  const historyPath = path.join(tmpDir, '.doclify-history.json');
  const entry = { date: '2026-02-28T10:00:00Z', commit: 'abc1234', avgScore: 85, errors: 1, warnings: 3, filesScanned: 5 };
  appendHistory(entry, historyPath);
  const history = loadHistory(historyPath);
  assert.equal(history.length, 1);
  assert.equal(history[0].avgScore, 85);
  assert.equal(history[0].commit, 'abc1234');
  fs.rmSync(tmpDir, { recursive: true });
});

test('trend: appendHistory appends to existing history', () => {
  const tmpDir = makeTempDir();
  const historyPath = path.join(tmpDir, '.doclify-history.json');
  appendHistory({ date: '2026-01-01T00:00:00Z', commit: 'aaa', avgScore: 80, errors: 0, warnings: 0, filesScanned: 1 }, historyPath);
  appendHistory({ date: '2026-02-01T00:00:00Z', commit: 'bbb', avgScore: 90, errors: 0, warnings: 0, filesScanned: 1 }, historyPath);
  const history = loadHistory(historyPath);
  assert.equal(history.length, 2);
  assert.equal(history[0].avgScore, 80);
  assert.equal(history[1].avgScore, 90);
  fs.rmSync(tmpDir, { recursive: true });
});

test('trend: checkRegression detects score drop', () => {
  const history = [
    { avgScore: 90 },
    { avgScore: 85 }
  ];
  const result = checkRegression(history, 80);
  assert.equal(result.regression, true);
  assert.equal(result.delta, -5);
  assert.equal(result.prev, 85);
  assert.equal(result.current, 80);
});

test('trend: checkRegression passes when score improves', () => {
  const history = [{ avgScore: 80 }];
  const result = checkRegression(history, 90);
  assert.equal(result.regression, false);
  assert.equal(result.delta, 10);
});

test('trend: checkRegression passes with empty history', () => {
  const result = checkRegression([], 85);
  assert.equal(result.regression, false);
});

test('trend: renderTrend produces output with entries', () => {
  const history = [
    { date: '2026-01-01T00:00:00Z', avgScore: 70 },
    { date: '2026-01-15T00:00:00Z', avgScore: 80 },
    { date: '2026-02-01T00:00:00Z', avgScore: 90 }
  ];
  const output = renderTrend(history);
  assert.ok(output.includes('Score Trend'));
  assert.ok(output.includes('Latest:'));
  assert.ok(output.includes('90/100'));
});

test('trend: renderTrend handles single entry', () => {
  const output = renderTrend([{ date: '2026-01-01T00:00:00Z', avgScore: 85 }]);
  assert.ok(output.includes('85/100'));
});

test('trend: renderTrend handles empty history', () => {
  const output = renderTrend([]);
  assert.ok(output.includes('No data'));
});

// CLI: --track flag
test('CLI: --track creates .doclify-history.json', () => {
  const tmpDir = makeTempDir();
  const mdFile = path.join(tmpDir, 'test.md');
  fs.writeFileSync(mdFile, '# Title\n\nContent here.\n');
  const r = spawnSync('node', [CLI_PATH, mdFile, '--track', '--ascii'], {
    encoding: 'utf8',
    cwd: tmpDir
  });
  assert.equal(r.status, 0, `Expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
  const historyPath = path.join(tmpDir, '.doclify-history.json');
  assert.ok(fs.existsSync(historyPath), 'History file should be created');
  const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  assert.equal(history.length, 1);
  assert.ok(history[0].avgScore >= 0);
  fs.rmSync(tmpDir, { recursive: true });
});

// CLI: --trend with no history
test('CLI: --trend exits 1 when no history exists', () => {
  const tmpDir = makeTempDir();
  const r = spawnSync('node', [CLI_PATH, '--trend', '--ascii'], {
    encoding: 'utf8',
    cwd: tmpDir
  });
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('No history'));
  fs.rmSync(tmpDir, { recursive: true });
});

// CLI: --trend with history
test('CLI: --trend shows graph when history exists', () => {
  const tmpDir = makeTempDir();
  const historyPath = path.join(tmpDir, '.doclify-history.json');
  fs.writeFileSync(historyPath, JSON.stringify([
    { date: '2026-01-01T00:00:00Z', avgScore: 80 },
    { date: '2026-02-01T00:00:00Z', avgScore: 90 }
  ]));
  const r = spawnSync('node', [CLI_PATH, '--trend', '--ascii'], {
    encoding: 'utf8',
    cwd: tmpDir
  });
  assert.equal(r.status, 0);
  assert.ok(r.stderr.includes('Score Trend'));
  fs.rmSync(tmpDir, { recursive: true });
});

// parseArgs: new trend flags
test('parseArgs: --track, --trend, --fail-on-regression flags', () => {
  const args = parseArgs(['--track', '--fail-on-regression']);
  assert.equal(args.track, true);
  assert.equal(args.failOnRegression, true);
  const args2 = parseArgs(['--trend']);
  assert.equal(args2.trend, true);
});

test('score-api: parseArgs supports --push and --project-id', () => {
  const args = parseArgs(['docs/', '--push', '--project-id', 'my-proj']);
  assert.equal(args.push, true);
  assert.equal(args.projectId, 'my-proj');

  const defaults = parseArgs(['docs/']);
  assert.equal(defaults.push, false);
  assert.equal(defaults.projectId, null);
});

// PR comment body
test('PR comment: buildPrCommentBody generates markdown table', () => {
  const output = {
    version: '1.6.0',
    files: [
      { file: 'README.md', pass: true, findings: { errors: [], warnings: [] }, summary: { errors: 0, warnings: 1, healthScore: 95, status: 'PASS' } },
      { file: 'docs/api.md', pass: false, findings: { errors: [{}], warnings: [] }, summary: { errors: 1, warnings: 0, healthScore: 80, status: 'FAIL' } }
    ],
    summary: { filesScanned: 2, filesPassed: 1, filesFailed: 1, totalErrors: 1, totalWarnings: 1, status: 'FAIL', elapsed: '0.12', avgHealthScore: 87 }
  };
  const body = buildPrCommentBody(output);
  assert.ok(body.includes('Doclify Quality Report'));
  assert.ok(body.includes('README.md'));
  assert.ok(body.includes('docs/api.md'));
  assert.ok(body.includes('87/100'));
  assert.ok(body.includes('FAIL'));
});

test('PR comment: buildPrCommentBody includes delta when baseScore provided', () => {
  const output = {
    version: '1.6.0',
    files: [],
    summary: { filesScanned: 0, filesPassed: 0, filesFailed: 0, totalErrors: 0, totalWarnings: 0, status: 'PASS', elapsed: '0.01', avgHealthScore: 90 }
  };
  const body = buildPrCommentBody(output, { baseScore: 80 });
  assert.ok(body.includes('+10 vs base'));
});

test('PR comment: includes drift scope counts and top high alerts', () => {
  const output = {
    version: '1.7.1',
    files: [],
    summary: { filesScanned: 0, filesPassed: 0, filesFailed: 0, totalErrors: 0, totalWarnings: 0, status: 'PASS', elapsed: '0.01', avgHealthScore: 100 },
    ai: {
      drift: {
        summary: {
          alerts: 3,
          high: 2,
          medium: 1,
          low: 0,
          gatingScope: 'unmodified',
          alertsByScope: {
            unmodified: 2,
            modified: 1
          }
        },
        alerts: [
          { doc: 'README.md', score: 92, risk: 'high', scope: 'unmodified', reasons: ['shared flag: --x'] },
          { doc: 'docs/api.md', score: 85, risk: 'high', scope: 'unmodified', reasons: ['shared endpoint: /v1/test'] },
          { doc: 'docs/changelog.md', score: 62, risk: 'medium', scope: 'modified', reasons: ['shared tokens'] }
        ]
      }
    }
  };

  const body = buildPrCommentBody(output);
  assert.ok(body.includes('scope unmodified (2 unmodified, 1 modified)'));
  assert.ok(body.includes('Top high alerts (gate scope)'));
  assert.ok(body.includes('README.md'));
  assert.ok(body.includes('docs/api.md'));
});

test('PR comment: postPrComment paginates before updating marker comment', async () => {
  const calls = [];
  const octokit = {
    paginate: async () => ([
      { id: 1, body: 'other comment' },
      { id: 55, body: '<!-- doclify-guardrail-comment -->\nold body' }
    ]),
    rest: {
      issues: {
        listComments: async () => ({ data: [] }),
        updateComment: async (params) => { calls.push({ type: 'update', params }); },
        createComment: async (params) => { calls.push({ type: 'create', params }); }
      }
    }
  };
  const output = {
    version: '1.7.0',
    files: [],
    summary: { filesScanned: 0, filesPassed: 0, filesFailed: 0, totalErrors: 0, totalWarnings: 0, status: 'PASS', elapsed: '0.01', avgHealthScore: 100 }
  };

  await postPrComment(octokit, { owner: 'o', repo: 'r', prNumber: 12 }, output);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'update');
  assert.equal(calls[0].params.comment_id, 55);
});

test('Action dist smoke: supports single file, directory and glob targets', () => {
  const tmp = makeTempDir();
  const docsDir = path.join(tmp, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'README.md'), '# Root\n', 'utf8');
  fs.writeFileSync(path.join(docsDir, 'guide.md'), '# Guide\n', 'utf8');

  for (const target of ['README.md', 'docs', 'docs/*.md']) {
    const githubOutput = path.join(tmp, `github-${target.replace(/[^\w]/g, '_')}.txt`);
    fs.writeFileSync(githubOutput, '', 'utf8');
    const run = spawnSync(process.execPath, [ACTION_DIST_PATH], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        ...process.env,
        INPUT_PATH: target,
        GITHUB_OUTPUT: githubOutput
      }
    });

    assert.equal(run.status, 0, run.stdout || run.stderr);
    const outputs = parseGithubOutput(githubOutput);
    assert.equal(outputs.status, 'PASS');
    assert.ok(Number(outputs.score) >= 90);
    assert.ok(fs.existsSync(path.join(tmp, 'doclify.sarif')));
    fs.rmSync(path.join(tmp, 'doclify.sarif'), { force: true });
  }
});

test('Action dist smoke: rejects multiline path input', () => {
  const tmp = makeTempDir();
  fs.writeFileSync(path.join(tmp, 'a.md'), '# A\n', 'utf8');
  fs.writeFileSync(path.join(tmp, 'b.md'), '# B\n', 'utf8');
  const githubOutput = path.join(tmp, 'github-output.txt');
  fs.writeFileSync(githubOutput, '', 'utf8');
  const run = spawnSync(process.execPath, [ACTION_DIST_PATH], {
    cwd: tmp,
    encoding: 'utf8',
    env: {
      ...process.env,
      INPUT_PATH: 'a.md\nb.md',
      GITHUB_OUTPUT: githubOutput
    }
  });

  assert.equal(run.status, 1);
  assert.ok(`${run.stdout}\n${run.stderr}`.includes('single file, directory, or glob target'));
});

test('Action dist smoke: accepts fail-on-drift-scope input', () => {
  const tmp = makeTempDir();
  const docsDir = path.join(tmp, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'guide.md'), '# Guide\n', 'utf8');
  const githubOutput = path.join(tmp, 'github-output-drift-scope.txt');
  fs.writeFileSync(githubOutput, '', 'utf8');

  const run = spawnSync(process.execPath, [ACTION_DIST_PATH], {
    cwd: tmp,
    encoding: 'utf8',
    env: {
      ...process.env,
      INPUT_PATH: 'docs',
      INPUT_AI_DRIFT: 'true',
      INPUT_FAIL_ON_DRIFT_SCOPE: 'all',
      GITHUB_OUTPUT: githubOutput
    }
  });

  assert.equal(run.status, 0, run.stdout || run.stderr);
  const outputs = parseGithubOutput(githubOutput);
  assert.equal(outputs.status, 'PASS');
});

test('score-api: Action dist forwards --push and --project-id when INPUT_PUSH=true', async () => {
  const tmp = makeTempDir();
  fs.writeFileSync(path.join(tmp, 'doc.md'), '# Title\n\nHealthy content.\n', 'utf8');
  const githubOutput = path.join(tmp, 'github-output-score-api.txt');
  fs.writeFileSync(githubOutput, '', 'utf8');

  let pushedPayload = null;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/scores' && req.method === 'POST') {
      let raw = '';
      req.setEncoding('utf8');
      for await (const chunk of req) raw += chunk;
      pushedPayload = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'action-report', delta: 1 }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const run = spawnSync(process.execPath, [ACTION_DIST_PATH], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        ...process.env,
        INPUT_PATH: 'doc.md',
        INPUT_PUSH: 'true',
        INPUT_PROJECT_ID: 'action-proj',
        INPUT_DOCLIFY_TOKEN: 'doclify_live_test',
        INPUT_API_URL: `http://127.0.0.1:${port}`,
        INPUT_PR_COMMENT: 'false',
        INPUT_SARIF: 'false',
        GITHUB_OUTPUT: githubOutput
      }
    });

    assert.equal(run.status, 0, run.stdout || run.stderr);
    assert.ok(pushedPayload, 'Action should push score payload when INPUT_PUSH=true');
    assert.equal(pushedPayload.projectId, 'action-proj');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('score-api: Action dist does not push when INPUT_PUSH=false', async () => {
  const tmp = makeTempDir();
  fs.writeFileSync(path.join(tmp, 'doc.md'), '# Title\n\nHealthy content.\n', 'utf8');
  const githubOutput = path.join(tmp, 'github-output-score-api-no-push.txt');
  fs.writeFileSync(githubOutput, '', 'utf8');

  let pushCalls = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/scores' && req.method === 'POST') {
      pushCalls += 1;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'ok' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const run = spawnSync(process.execPath, [ACTION_DIST_PATH], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        ...process.env,
        INPUT_PATH: 'doc.md',
        INPUT_PUSH: 'false',
        INPUT_DOCLIFY_TOKEN: 'doclify_live_test',
        INPUT_API_URL: `http://127.0.0.1:${port}`,
        INPUT_PR_COMMENT: 'false',
        INPUT_SARIF: 'false',
        GITHUB_OUTPUT: githubOutput
      }
    });

    assert.equal(run.status, 0, run.stdout || run.stderr);
    assert.equal(pushCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: --watch --fix applies canonical scan without self-loop storm', async () => {
  const tmp = makeTempDir();
  const mdPath = path.join(tmp, 'doc.md');
  fs.writeFileSync(mdPath, '# Title\n\nClean.\n', 'utf8');

  const child = spawn(process.execPath, [CLI_PATH, tmp, '--watch', '--fix', '--ascii', '--no-color'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  try {
    await waitFor(() => stderr.includes('Watching'));
    fs.writeFileSync(mdPath, '# Title\n\nVisit http://example.com\n', 'utf8');
    await waitFor(() => fs.readFileSync(mdPath, 'utf8').includes('https://example.com'), 4000);
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }

  const changedEvents = (stderr.match(/Changed:/g) || []).length;
  assert.match(fs.readFileSync(mdPath, 'utf8'), /https:\/\/example\.com/);
  assert.ok(changedEvents <= 3, stderr);
});
