#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkMarkdown, RULE_CATALOG } from './checker.mjs';
import { resolveFileList } from './glob.mjs';
import { generateReport } from './report.mjs';
import { loadCustomRules } from './rules-loader.mjs';
import { initColors, setAsciiMode, icons, c, log, printBanner, printResults, printCompactResults } from './colors.mjs';
import { checkDeadLinksDetailed } from './links.mjs';
import { autoFixInsecureLinks, autoFixFormatting } from './fixer.mjs';
import { computeDocHealthScore, checkDocFreshness } from './quality.mjs';
import { CONFIG_NAME, findParentConfigs, resolveOptions, resolveFileOptions } from './config-resolver.mjs';
import { getChangedFiles, getChangedMarkdownFiles } from './diff.mjs';
import { loadHistory, appendHistory, getCurrentCommit, checkRegression, renderTrend } from './trend.mjs';
import { createFileScanContext } from './scan-context.mjs';
import { isMarkdownPath } from './markdown-files.mjs';
import { clearAuthState, loadAuthState, resolveApiKey, saveAuthState } from './auth-store.mjs';
import { CloudError, normalizeApiUrl, requestAiDrift, verifyApiKey } from './cloud-client.mjs';
import { analyzeDriftOffline, classifyRisk } from './drift.mjs';
import { loadRepoMemory } from './repo-memory.mjs';
import { createScanId, getRepoMetadata } from './repo.mjs';
import {
  generateJUnitReport,
  generateSarifReport,
  generateBadge
} from './ci-output.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function writeJsonToStdout(data) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(data, null, 2) + '\n';
    const flushed = process.stdout.write(json, 'utf8');
    if (flushed) {
      resolve();
    } else {
      process.stdout.once('drain', resolve);
      process.stdout.once('error', reject);
    }
  });
}
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const VERSION = pkg.version;

function printHelp() {
  const b = (t) => c.bold(t);
  const d = (t) => c.dim(t);
  const y = (t) => c.yellow(t);

  console.log(`
  ${b('Doclify Guardrail')} ${d(`v${VERSION}`)}
  Quality gate for Markdown documentation.

  ${y('USAGE')}
    $ doclify [files...] [options]
    $ doclify --dir <path> [options]
    $ doclify login --key <apiKey>
    $ doclify whoami
    $ doclify ai drift [target] [options]

    If no files are specified, scans the current directory.

  ${y('SCAN')}
    --dir <path>             Scan .md/.mdx files recursively in directory
    --diff                   Only scan git-changed .md/.mdx files ${d('(vs HEAD)')}
    --base <ref>             Base git ref for --diff ${d('(default: HEAD)')}
    --staged                 Only scan git-staged .md/.mdx files
    --strict                 Treat warnings as errors
    --min-score <n>          Fail if health score < n ${d('(0-100)')}
    --max-line-length <n>    Max line length ${d('(default: 160)')}
    --config <path>          Config file ${d('(default: .doclify-guardrail.json)')}
    --rules <path>           Custom regex rules from JSON file
    --ignore-rules <list>    Disable rules ${d('(comma-separated)')}
    --exclude <list>         Exclude files/patterns ${d('(comma-separated)')}

  ${y('CHECKS')}
    --check-links            Validate HTTP and local links
    --allow-private-links    Allow private/loopback/link-local remote link checks
    --check-freshness        Warn on stale docs ${d('(>180 days)')}
    --freshness-max-days <n> Max age for freshness check ${d('(default: 180)')}
    --check-frontmatter      Require YAML frontmatter block
    --check-inline-html      Warn on inline HTML tags
    --site-root <path>       Filesystem root used to resolve /root-relative local links
    --link-allow-list <list> Skip URLs/domains for link checks ${d('(comma-separated)')}
    --link-timeout-ms <n>    Timeout per remote link check ${d('(default: 8000)')}
    --link-concurrency <n>   Remote link checks in parallel ${d('(default: 5)')}
    --ai-drift               Run Drift Guard against git/code changes
    --ai-mode <mode>         AI engine mode: ${d('offline, cloud')}
    --fail-on-drift <level>  Fail if drift risk reaches ${d('high or medium')}
    --fail-on-drift-scope <scope>  Drift gate scope: ${d('unmodified, all')}
    --api-url <url>          Override Doclify Cloud API base URL
    --token <apiKey>         Override Doclify Cloud API key for this run

  ${y('FIX')}
    --fix                    Auto-fix safe issues ${d('(http → https)')}
    --dry-run                Preview fixes without writing

  ${y('OUTPUT')}
    --report [path]          Markdown report ${d('(default: doclify-report.md)')}
    --junit [path]           JUnit XML report ${d('(default: doclify-junit.xml)')}
    --sarif [path]           SARIF report ${d('(default: doclify.sarif)')}
    --badge [path]           SVG health badge ${d('(default: doclify-badge.svg)')}
    --badge-label <text>     Badge label ${d('(default: "docs health")')}
    --json                   Output raw JSON to stdout
    --format <mode>          Output format: ${d('default, compact')}

  ${y('SETUP')}
    init                     Generate a .doclify-guardrail.json config
    init --force             Overwrite existing config
    login --key <apiKey>     Verify and persist a Doclify Cloud key
    whoami                   Show stored Doclify Cloud identity
    logout                   Remove locally stored Doclify Cloud key

  ${y('OTHER')}
    --list-rules             List all built-in rules
    --no-color               Disable colored output
    --ascii                  Use ASCII icons ${d('(for CI without UTF-8)')}
    --debug                  Show debug info
    -h, --help               Show this help

  ${y('WATCH')}
    --watch                  Watch for file changes and re-scan

  ${y('TREND')}
    --track                  Save score to .doclify-history.json
    --trend                  Show ASCII score trend graph
    --fail-on-regression     Fail if score dropped vs last tracked run

  ${y('AI')}
    ai drift [target]        Run Drift Guard on candidate docs
    ai drift --mode cloud    Send drift analysis request to Doclify Cloud
    ai memory export         Export current local repo memory snapshot
    ai fix                   Not available yet (planned)
    ai prioritize            Not available yet (planned)
    ai coverage              Not available yet (planned)

  ${y('EXAMPLES')}
    $ doclify README.md
    $ doclify docs/ --strict --check-links
    $ doclify --dir src/ --report --badge
    $ doclify docs/ --fix --dry-run
    $ doclify . --json > results.json
    $ doclify --diff --staged --strict
    $ doclify docs/ --min-score 80
    $ doclify docs/ --track
    $ doclify --trend
    $ doclify docs/ --fail-on-regression
    $ doclify docs/ --ai-drift --fail-on-drift high --fail-on-drift-scope unmodified
    $ doclify ai drift docs/ --diff --base origin/main --json
    $ doclify login --key doclify_live_xxx

  ${y('EXIT CODES')}
    0  PASS ${d('— all files clean')}
    1  FAIL ${d('— errors found, or warnings in strict mode')}
    2  Usage error ${d('— invalid input')}
`);
}

function parseArgs(argv) {
  const args = {
    files: [],
    strict: undefined,
    debug: false,
    maxLineLength: undefined,
    freshnessMaxDays: null,
    linkTimeoutMs: null,
    linkConcurrency: null,
    siteRoot: null,
    configPath: path.resolve('.doclify-guardrail.json'),
    configExplicit: false,
    help: false,
    version: false,
    listRules: false,
    init: false,
    dir: null,
    report: null,
    rules: null,
    junit: null,
    sarif: null,
    badge: null,
    badgeLabel: 'docs health',
    noColor: false,
    ignoreRules: [],
    exclude: [],
    checkLinks: false,
    checkFreshness: false,
    checkFrontmatter: false,
    checkInlineHtml: false,
    allowPrivateLinks: false,
    linkAllowList: [],
    fix: false,
    dryRun: false,
    json: false,
    force: false,
    ascii: false,
    diff: false,
    base: 'HEAD',
    staged: false,
    minScore: null,
    format: 'default',
    watch: false,
    track: false,
    trend: false,
    failOnRegression: false,
    aiDrift: false,
    aiMode: 'offline',
    failOnDrift: null,
    failOnDriftScope: 'unmodified',
    apiUrl: null,
    token: null,
    cliFlags: {
      strict: false,
      checkLinks: false,
      checkFreshness: false,
      checkFrontmatter: false,
      checkInlineHtml: false
    }
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];

    if (a === '-h' || a === '--help') {
      args.help = true;
      continue;
    }

    if (a === '-v' || a === '--version') {
      args.version = true;
      continue;
    }

    if (a === '--list-rules') {
      args.listRules = true;
      continue;
    }

    if (a === '--debug') {
      args.debug = true;
      continue;
    }

    if (a === '--strict') {
      args.strict = true;
      args.cliFlags.strict = true;
      continue;
    }

    if (a === '--no-color') {
      args.noColor = true;
      continue;
    }

    if (a === '--ignore-rules') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --ignore-rules');
      }
      args.ignoreRules.push(...value.split(',').map(s => s.trim()).filter(Boolean));
      i += 1;
      continue;
    }

    if (a === '--exclude') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --exclude');
      }
      args.exclude.push(...value.split(',').map(s => s.trim()).filter(Boolean));
      i += 1;
      continue;
    }

    if (a === '--check-links') {
      args.checkLinks = true;
      args.cliFlags.checkLinks = true;
      continue;
    }

    if (a === '--allow-private-links') {
      args.allowPrivateLinks = true;
      continue;
    }

    if (a === '--check-freshness') {
      args.checkFreshness = true;
      args.cliFlags.checkFreshness = true;
      continue;
    }

    if (a === '--check-frontmatter') {
      args.checkFrontmatter = true;
      args.cliFlags.checkFrontmatter = true;
      continue;
    }

    if (a === '--check-inline-html') {
      args.checkInlineHtml = true;
      args.cliFlags.checkInlineHtml = true;
      continue;
    }

    if (a === '--site-root') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --site-root');
      }
      args.siteRoot = path.resolve(value);
      i += 1;
      continue;
    }

    if (a === '--link-allow-list') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --link-allow-list');
      }
      args.linkAllowList.push(...value.split(',').map(s => s.trim()).filter(Boolean));
      i += 1;
      continue;
    }

    if (a === '--freshness-max-days') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --freshness-max-days');
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --freshness-max-days: ${value}`);
      }
      args.freshnessMaxDays = parsed;
      i += 1;
      continue;
    }

    if (a === '--link-timeout-ms') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --link-timeout-ms');
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --link-timeout-ms: ${value}`);
      }
      args.linkTimeoutMs = parsed;
      i += 1;
      continue;
    }

    if (a === '--link-concurrency') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --link-concurrency');
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --link-concurrency: ${value}`);
      }
      args.linkConcurrency = parsed;
      i += 1;
      continue;
    }

    if (a === '--fix') {
      args.fix = true;
      continue;
    }

    if (a === '--json') {
      args.json = true;
      continue;
    }

    if (a === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (a === '--force') {
      args.force = true;
      continue;
    }

    if (a === '--ascii') {
      args.ascii = true;
      continue;
    }

    if (a === '--diff') {
      args.diff = true;
      continue;
    }

    if (a === '--base') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --base');
      }
      args.base = value;
      i += 1;
      continue;
    }

    if (a === '--staged') {
      args.staged = true;
      continue;
    }

    if (a === '--min-score') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --min-score');
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
        throw new Error(`Invalid --min-score: ${value} (must be 0-100)`);
      }
      args.minScore = parsed;
      i += 1;
      continue;
    }

    if (a === '--format') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --format');
      }
      if (!['default', 'compact'].includes(value)) {
        throw new Error(`Invalid --format: ${value} (must be: default, compact)`);
      }
      args.format = value;
      i += 1;
      continue;
    }

    if (a === '--watch') {
      args.watch = true;
      continue;
    }

    if (a === '--track') {
      args.track = true;
      continue;
    }

    if (a === '--trend') {
      args.trend = true;
      continue;
    }

    if (a === '--fail-on-regression') {
      args.failOnRegression = true;
      continue;
    }

    if (a === '--ai-drift') {
      args.aiDrift = true;
      continue;
    }

    if (a === '--ai-mode') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --ai-mode');
      }
      if (!['offline', 'cloud'].includes(value)) {
        throw new Error(`Invalid --ai-mode: ${value} (must be: offline, cloud)`);
      }
      args.aiMode = value;
      i += 1;
      continue;
    }

    if (a === '--fail-on-drift') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --fail-on-drift');
      }
      if (!['high', 'medium'].includes(value)) {
        throw new Error(`Invalid --fail-on-drift: ${value} (must be: high, medium)`);
      }
      args.failOnDrift = value;
      i += 1;
      continue;
    }

    if (a === '--fail-on-drift-scope') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --fail-on-drift-scope');
      }
      if (!['unmodified', 'all'].includes(value)) {
        throw new Error(`Invalid --fail-on-drift-scope: ${value} (must be: unmodified, all)`);
      }
      args.failOnDriftScope = value;
      i += 1;
      continue;
    }

    if (a === '--api-url') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --api-url');
      }
      args.apiUrl = value;
      i += 1;
      continue;
    }

    if (a === '--token') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --token');
      }
      args.token = value;
      i += 1;
      continue;
    }

    if (a === '--config') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --config');
      }
      args.configPath = path.resolve(value);
      args.configExplicit = true;
      i += 1;
      continue;
    }

    if (a === '--max-line-length') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --max-line-length');
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --max-line-length: ${value}`);
      }
      args.maxLineLength = parsed;
      i += 1;
      continue;
    }

    if (a === '--dir') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --dir');
      }
      args.dir = value;
      i += 1;
      continue;
    }

    if (a === '--report') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        args.report = 'doclify-report.md';
      } else {
        args.report = value;
        i += 1;
      }
      continue;
    }

    if (a === '--rules') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --rules');
      }
      args.rules = value;
      i += 1;
      continue;
    }

    if (a === '--junit') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        args.junit = 'doclify-junit.xml';
      } else {
        args.junit = value;
        i += 1;
      }
      continue;
    }

    if (a === '--sarif') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        args.sarif = 'doclify.sarif';
      } else {
        args.sarif = value;
        i += 1;
      }
      continue;
    }

    if (a === '--badge') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        args.badge = 'doclify-badge.svg';
      } else {
        args.badge = value;
        i += 1;
      }
      continue;
    }

    if (a === '--badge-label') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --badge-label');
      }
      args.badgeLabel = value;
      i += 1;
      continue;
    }

    if (a === 'init') {
      args.init = true;
      continue;
    }

    if (a.startsWith('-')) {
      throw new Error(`Unknown option: ${a}`);
    }

    args.files.push(a);
  }

  if (args.dryRun && !args.fix) {
    throw new Error('--dry-run can only be used with --fix');
  }

  return args;
}

function toRelativePath(filePath) {
  const rel = path.relative(process.cwd(), filePath);
  return rel.startsWith('..') ? filePath : rel || filePath;
}

function isDescendantOrSamePath(candidatePath, basePath) {
  const rel = path.relative(basePath, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isExcludedFile(filePath, patterns = []) {
  if (!patterns || patterns.length === 0) return false;
  const rel = path.relative(process.cwd(), filePath);
  return patterns.some(pattern => {
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^'
        + pattern.replace(/\./g, '\\.').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')
        + '$'
      );
      return regex.test(rel);
    }
    const segments = rel.split(path.sep);
    return segments.includes(pattern);
  });
}

function buildFileResult(filePath, analysis, opts) {
  const ignore = opts.ignoreRules || new Set();
  const errors = ignore.size > 0 ? analysis.errors.filter(f => !ignore.has(f.code)) : analysis.errors;
  const warnings = ignore.size > 0 ? analysis.warnings.filter(f => !ignore.has(f.code)) : analysis.warnings;
  const pass = errors.length === 0 && (!opts.strict || warnings.length === 0);
  const healthScore = computeDocHealthScore({
    errors: errors.length,
    warnings: warnings.length
  });

  return {
    file: toRelativePath(filePath),
    pass,
    findings: { errors, warnings },
    summary: {
      errors: errors.length,
      warnings: warnings.length,
      healthScore,
      status: pass ? 'PASS' : 'FAIL'
    }
  };
}

function buildOutput(fileResults, fileErrors, opts, elapsed, fixSummary, engineSummary = null, meta = {}) {
  const totalErrors = fileResults.reduce((s, r) => s + r.summary.errors, 0);
  const totalWarnings = fileResults.reduce((s, r) => s + r.summary.warnings, 0);
  const passed = fileResults.filter(r => r.pass).length;
  const failed = fileResults.filter(r => !r.pass).length;
  const overallPass = failed === 0 && fileErrors.length === 0;
  const avgHealthScore = fileResults.length > 0
    ? Math.round(fileResults.reduce((s, r) => s + r.summary.healthScore, 0) / fileResults.length)
    : 0;

  const summary = {
    filesScanned: fileResults.length + fileErrors.length,
    filesPassed: passed,
    filesFailed: failed,
    filesErrored: fileErrors.length,
    totalErrors,
    totalWarnings,
    status: overallPass ? 'PASS' : 'FAIL',
    elapsed: Math.round(elapsed * 1000) / 1000
  };

  summary.healthScore = avgHealthScore;
  summary.avgHealthScore = avgHealthScore; // Backward-compatible alias for existing integrations/tests

  const remoteLinksChecked = Number(engineSummary?.remoteLinksChecked || 0);
  const remoteCacheHits = Number(engineSummary?.remoteCacheHits || 0);
  const remoteCacheMisses = Number(engineSummary?.remoteCacheMisses || 0);
  const remoteTimeouts = Number(engineSummary?.remoteTimeouts || 0);
  const cacheHitRate = remoteLinksChecked > 0
    ? Number(((remoteCacheHits / remoteLinksChecked) * 100).toFixed(4))
    : 0;
  const timeoutRate = remoteLinksChecked > 0
    ? Number(((remoteTimeouts / remoteLinksChecked) * 100).toFixed(4))
    : 0;

  return {
    schemaVersion: 2,
    version: VERSION,
    scanId: meta.scanId || createScanId(),
    strict: opts.strict,
    files: fileResults,
    fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
    fix: fixSummary,
    summary,
    repo: meta.repo || undefined,
    timings: {
      elapsedMs: Math.round(elapsed * 1000),
      scanMs: Number(engineSummary?.scanMs ?? Math.round(elapsed * 1000))
    },
    ai: meta.ai || {},
    engine: {
      schemaVersion: 2,
      mode: meta.mode || 'scan',
      features: meta.features || [],
      scanMs: Number(engineSummary?.scanMs ?? Math.round(elapsed * 1000)),
      peakMemoryMb: Number(engineSummary?.peakMemoryMb ?? 0),
      remoteLinksChecked,
      remoteCacheHits,
      remoteCacheMisses,
      cacheHitRate: Number(engineSummary?.cacheHitRate ?? cacheHitRate),
      remoteTimeouts,
      timeoutRate: Number(engineSummary?.timeoutRate ?? timeoutRate)
    }
  };
}

function createFixSummary(args) {
  return {
    enabled: args.fix,
    dryRun: args.dryRun,
    filesChanged: 0,
    linkReplacements: 0,
    formatFixes: 0,
    ambiguousSkipped: []
  };
}

function createLinkEngineStats() {
  return {
    remoteLinksChecked: 0,
    remoteCacheHits: 0,
    remoteCacheMisses: 0,
    remoteTimeouts: 0
  };
}

function resolveScanFilePaths(args, resolved) {
  let filePaths;
  if (args.diff || args.staged) {
    filePaths = getChangedMarkdownFiles({ base: args.base, staged: args.staged });
  } else {
    filePaths = resolveFileList(args);
  }

  if (resolved.exclude.length > 0) {
    filePaths = filePaths.filter(fp => !isExcludedFile(fp, resolved.exclude));
  }

  return filePaths;
}

function recordSelfWrite(watchState, filePath) {
  if (!watchState) return;
  watchState.selfWrites.set(path.resolve(filePath), Date.now() + 1500);
}

function shouldIgnoreWatchPath(watchState, filePath) {
  if (!watchState) return false;
  const now = Date.now();
  for (const [candidate, expiresAt] of watchState.selfWrites.entries()) {
    if (expiresAt <= now) {
      watchState.selfWrites.delete(candidate);
    }
  }
  const resolved = path.resolve(filePath);
  const expiresAt = watchState.selfWrites.get(resolved);
  if (!expiresAt) return false;
  if (expiresAt <= now) {
    watchState.selfWrites.delete(resolved);
    return false;
  }
  return true;
}

function getWatchPath(args) {
  const watchTargets = [];
  if (args.dir) {
    watchTargets.push(path.resolve(args.dir));
  } else if (args.files.length > 0) {
    for (const target of args.files) {
      if (target.includes('*')) {
        return process.cwd();
      }
      watchTargets.push(path.resolve(target));
    }
  } else {
    watchTargets.push(process.cwd());
  }

  let current = watchTargets[0] || process.cwd();
  for (const candidate of watchTargets.slice(1)) {
    while (!isDescendantOrSamePath(candidate, current) && current !== path.dirname(current)) {
      current = path.dirname(current);
    }
  }
  return current;
}

function createRepoOutput(repoMetadata) {
  return {
    fingerprint: repoMetadata.fingerprint,
    root: repoMetadata.root,
    remote: repoMetadata.remote,
    source: repoMetadata.source
  };
}

function riskRank(risk) {
  if (risk === 'high') return 3;
  if (risk === 'medium') return 2;
  if (risk === 'low') return 1;
  return 0;
}

function shouldFailForRisk(highestRisk, threshold) {
  if (!threshold) return false;
  return riskRank(highestRisk) >= riskRank(threshold);
}

function normalizePathKey(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function enrichDriftResultScope(result, changedFiles = [], gatingScope = 'unmodified') {
  if (!result || !Array.isArray(result.alerts)) return result;
  const scope = gatingScope === 'all' ? 'all' : 'unmodified';
  const changedMarkdownKeys = new Set();
  for (const entry of changedFiles) {
    if (!entry) continue;
    for (const candidate of [entry.path, entry.previousPath]) {
      if (!candidate || !isMarkdownPath(candidate)) continue;
      changedMarkdownKeys.add(normalizePathKey(candidate));
      changedMarkdownKeys.add(normalizePathKey(toRelativePath(candidate)));
    }
  }

  const alerts = result.alerts.map((alert) => {
    const existingScope = alert?.scope;
    if (existingScope === 'modified' || existingScope === 'unmodified') {
      return alert;
    }
    const key = normalizePathKey(alert?.doc);
    const derivedScope = changedMarkdownKeys.has(key) ? 'modified' : 'unmodified';
    return {
      ...alert,
      scope: derivedScope
    };
  });

  const highestRisk = alerts.reduce(
    (current, alert) => riskRank(alert.risk) > riskRank(current) ? alert.risk : current,
    null
  );
  const alertsByScope = {
    modified: alerts.filter((alert) => alert.scope === 'modified').length,
    unmodified: alerts.filter((alert) => alert.scope === 'unmodified').length
  };
  const highestRiskByScope = {
    modified: alerts
      .filter((alert) => alert.scope === 'modified')
      .reduce((current, alert) => riskRank(alert.risk) > riskRank(current) ? alert.risk : current, null),
    unmodified: alerts
      .filter((alert) => alert.scope === 'unmodified')
      .reduce((current, alert) => riskRank(alert.risk) > riskRank(current) ? alert.risk : current, null)
  };
  const gatingRisk = scope === 'all' ? highestRisk : highestRiskByScope.unmodified;

  return {
    ...result,
    alerts,
    summary: {
      ...(result.summary || {}),
      alerts: alerts.length,
      high: alerts.filter((alert) => alert.risk === 'high').length,
      medium: alerts.filter((alert) => alert.risk === 'medium').length,
      low: alerts.filter((alert) => alert.risk === 'low').length,
      highestRisk,
      alertsByScope,
      highestRiskByScope,
      gatingScope: scope,
      gatingRisk
    }
  };
}

function getDriftGateRisk(summary, gatingScope = 'unmodified') {
  if (!summary) return null;
  if (gatingScope === 'all') return summary.highestRisk || null;
  return summary.highestRiskByScope?.unmodified || null;
}

function printDriftSummary(result) {
  const summary = result.summary || {};
  const alertsByScope = summary.alertsByScope || {
    modified: 0,
    unmodified: summary.alerts || 0
  };
  const gatingScope = summary.gatingScope || 'all';
  const gatingRisk = summary.gatingRisk || summary.highestRisk || null;
  if (!summary.alerts) {
    log(c.green(icons.pass), `Drift Guard: no likely doc drift across ${c.bold(String(summary.changedCodeFiles || 0))} changed code file${summary.changedCodeFiles === 1 ? '' : 's'}`);
    return;
  }

  const highestRisk = gatingRisk || summary.highestRisk || 'low';
  const color = highestRisk === 'high' ? c.red : highestRisk === 'medium' ? c.yellow : c.cyan;
  log(
    color(highestRisk === 'high' ? icons.fail : highestRisk === 'medium' ? icons.warn : icons.info),
    `Drift Guard: ${c.bold(String(summary.alerts))} alert${summary.alerts === 1 ? '' : 's'} (${summary.high || 0} high, ${summary.medium || 0} medium, ${summary.low || 0} low) · scope ${gatingScope} (${alertsByScope.unmodified || 0} unmodified, ${alertsByScope.modified || 0} modified)`
  );

  const orderedAlerts = (result.alerts || [])
    .filter((alert) => gatingScope === 'all' || alert.scope === 'unmodified')
    .slice(0, 5);
  for (const alert of orderedAlerts) {
    const severity = alert.risk === 'high' ? c.red(alert.risk.toUpperCase()) : alert.risk === 'medium' ? c.yellow(alert.risk.toUpperCase()) : c.cyan(alert.risk.toUpperCase());
    const reasons = alert.reasons.slice(0, 2).join(' | ');
    console.error(`      ${severity} ${c.bold(alert.doc)} ${c.dim(`[${alert.score}/100]`)} ${c.dim(`(${alert.scope})`)} ${c.dim(reasons)}`);
  }
}

function resolveDriftFallbackTargets() {
  const targets = [];
  const rootFiles = fs.readdirSync(process.cwd(), { withFileTypes: true });
  for (const entry of rootFiles) {
    if (!entry.isFile()) continue;
    if (!/^(readme|changelog)/i.test(entry.name)) continue;
    const candidate = path.resolve(process.cwd(), entry.name);
    if (isMarkdownPath(candidate)) targets.push(candidate);
  }

  const docsDir = path.join(process.cwd(), 'docs');
  if (fs.existsSync(docsDir)) {
    const docsTargets = resolveFileList({ files: [], dir: docsDir });
    targets.push(...docsTargets.filter((candidate) => isMarkdownPath(candidate)));
  }

  return [...new Set(targets)];
}

function resolveTargetFiles(target) {
  if (!target) {
    return resolveFileList({ files: [process.cwd()], dir: null });
  }
  return resolveFileList({ files: [target], dir: null });
}

function parseLoginArgs(argv) {
  const args = { key: null, apiUrl: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--key') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --key');
      args.key = value;
      i += 1;
      continue;
    }
    if (current === '--api-url') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --api-url');
      args.apiUrl = value;
      i += 1;
      continue;
    }
    if (current === '--json') {
      args.json = true;
      continue;
    }
    throw new Error(`Unknown option for login: ${current}`);
  }
  return args;
}

function parseWhoamiArgs(argv) {
  const args = { json: false };
  for (const current of argv) {
    if (current === '--json') {
      args.json = true;
      continue;
    }
    throw new Error(`Unknown option for whoami: ${current}`);
  }
  return args;
}

function parseAiDriftArgs(argv) {
  const args = {
    target: null,
    diff: false,
    staged: false,
    base: 'HEAD',
    mode: 'offline',
    json: false,
    failOnDrift: null,
    failOnDriftScope: 'unmodified',
    apiUrl: null,
    token: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--diff') {
      args.diff = true;
      continue;
    }
    if (current === '--staged') {
      args.staged = true;
      continue;
    }
    if (current === '--base') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --base');
      args.base = value;
      i += 1;
      continue;
    }
    if (current === '--mode') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --mode');
      if (!['offline', 'cloud'].includes(value)) throw new Error(`Invalid --mode: ${value}`);
      args.mode = value;
      i += 1;
      continue;
    }
    if (current === '--json') {
      args.json = true;
      continue;
    }
    if (current === '--fail-on-drift') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --fail-on-drift');
      if (!['high', 'medium'].includes(value)) throw new Error(`Invalid --fail-on-drift: ${value}`);
      args.failOnDrift = value;
      i += 1;
      continue;
    }
    if (current === '--fail-on-drift-scope') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --fail-on-drift-scope');
      if (!['unmodified', 'all'].includes(value)) throw new Error(`Invalid --fail-on-drift-scope: ${value}`);
      args.failOnDriftScope = value;
      i += 1;
      continue;
    }
    if (current === '--api-url') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --api-url');
      args.apiUrl = value;
      i += 1;
      continue;
    }
    if (current === '--token') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --token');
      args.token = value;
      i += 1;
      continue;
    }
    if (current.startsWith('-')) {
      throw new Error(`Unknown option for ai drift: ${current}`);
    }
    if (args.target) {
      throw new Error(`Unexpected extra target: ${current}`);
    }
    args.target = current;
  }

  if (!args.diff && !args.staged) {
    args.diff = true;
  }

  return args;
}

function parseAiMemoryArgs(argv) {
  const args = { json: false };
  for (const current of argv) {
    if (current === '--json') {
      args.json = true;
      continue;
    }
    throw new Error(`Unknown option for ai memory export: ${current}`);
  }
  return args;
}

function buildAiEnvelope(command, feature, result, repoMetadata) {
  return {
    schemaVersion: 2,
    version: VERSION,
    scanId: createScanId(),
    command,
    repo: createRepoOutput(repoMetadata),
    summary: result.summary,
    ai: {
      [feature]: result
    },
    engine: {
      schemaVersion: 2,
      mode: 'ai',
      features: [feature]
    }
  };
}

async function runDriftGuard(options = {}) {
  const repoMetadata = options.repoMetadata || getRepoMetadata();
  const changedFiles = getChangedFiles({
    base: options.base || 'HEAD',
    staged: Boolean(options.staged)
  });
  const gatingScope = options.failOnDriftScope === 'all' ? 'all' : 'unmodified';

  if (options.mode === 'cloud') {
    const payload = {
      repo: createRepoOutput(repoMetadata),
      threshold: options.threshold || null,
      gatingScope,
      targets: options.targetFiles.map((filePath) => toRelativePath(filePath)),
      changedFiles: changedFiles.map((entry) => ({
        status: entry.status,
        path: toRelativePath(entry.path),
        previousPath: entry.previousPath ? toRelativePath(entry.previousPath) : null
      }))
    };
    const response = await requestAiDrift({
      apiUrl: options.apiUrl,
      apiKey: options.apiKey,
      payload
    });
    return enrichDriftResultScope({
      ...response,
      mode: 'cloud'
    }, changedFiles, gatingScope);
  }

  const offline = analyzeDriftOffline({
    changedFiles,
    targetFiles: options.targetFiles,
    repoMetadata,
    threshold: options.threshold || null,
    gatingScope
  });
  return enrichDriftResultScope(offline, changedFiles, gatingScope);
}

async function handleLogin(argv) {
  const args = parseLoginArgs(argv);
  const apiKey = resolveApiKey(args.key);
  if (!apiKey) {
    console.error('Missing API key. Use `doclify login --key <apiKey>` or DOCLIFY_TOKEN.');
    return 2;
  }

  const verification = await verifyApiKey({
    apiKey,
    apiUrl: args.apiUrl
  });
  const state = {
    apiKey,
    apiUrl: normalizeApiUrl(args.apiUrl),
    verifiedAt: new Date().toISOString(),
    account: verification.account || verification.user || verification.customer || null
  };
  const filePath = saveAuthState(state);

  if (args.json) {
    await writeJsonToStdout({
      ok: true,
      apiUrl: state.apiUrl,
      authFile: filePath,
      account: state.account
    });
    return 0;
  }

  log(c.green(icons.pass), `Stored Doclify Cloud credentials in ${c.dim(filePath)}`);
  if (state.account?.name) {
    log(c.cyan(icons.info), `Authenticated as ${c.bold(state.account.name)}`);
  }
  return 0;
}

async function handleWhoami(argv) {
  const args = parseWhoamiArgs(argv);
  const authState = loadAuthState();
  if (!authState) {
    console.error('No Doclify Cloud credentials found. Run `doclify login --key <apiKey>` first.');
    return 1;
  }

  const payload = {
    apiUrl: authState.apiUrl,
    verifiedAt: authState.verifiedAt,
    account: authState.account || null
  };

  if (args.json) {
    await writeJsonToStdout(payload);
    return 0;
  }

  log(c.cyan(icons.info), `API URL: ${c.bold(authState.apiUrl)}`);
  log(c.cyan(icons.info), `Verified at: ${c.bold(authState.verifiedAt || 'unknown')}`);
  if (authState.account?.name) {
    log(c.cyan(icons.info), `Account: ${c.bold(authState.account.name)}`);
  }
  return 0;
}

async function handleLogout() {
  const filePath = clearAuthState();
  log(c.green(icons.pass), `Removed Doclify Cloud credentials from ${c.dim(filePath)}`);
  return 0;
}

async function handleAiDrift(argv) {
  const args = parseAiDriftArgs(argv);
  const repoMetadata = getRepoMetadata();
  const targetFiles = resolveTargetFiles(args.target);
  if (targetFiles.length === 0) {
    console.error('Error: no Markdown/MDX files found.');
    return 2;
  }

  const result = await runDriftGuard({
    targetFiles,
    mode: args.mode,
    threshold: args.failOnDrift,
    failOnDriftScope: args.failOnDriftScope,
    base: args.base,
    staged: args.staged,
    apiUrl: args.apiUrl,
    apiKey: args.token,
    repoMetadata
  });
  const envelope = buildAiEnvelope('ai drift', 'drift', result, repoMetadata);

  if (args.json) {
    await writeJsonToStdout(envelope);
  } else {
    printBanner(targetFiles.length, VERSION);
    printDriftSummary(result);
  }

  return shouldFailForRisk(getDriftGateRisk(result.summary, args.failOnDriftScope), args.failOnDrift) ? 1 : 0;
}

async function handleAiMemory(argv) {
  if (argv[0] !== 'export') {
    throw new Error(`Unknown ai memory command: ${argv[0] || '(missing)'}`);
  }
  const args = parseAiMemoryArgs(argv.slice(1));
  const repoMetadata = getRepoMetadata();
  const memory = loadRepoMemory(repoMetadata);
  const payload = {
    schemaVersion: 2,
    version: VERSION,
    repo: createRepoOutput(repoMetadata),
    memory
  };

  if (args.json || process.stdout.isTTY === false) {
    await writeJsonToStdout(payload);
  } else {
    log(c.cyan(icons.info), `Repo memory path fingerprint ${c.bold(repoMetadata.fingerprint)}`);
    console.error(JSON.stringify(payload, null, 2));
  }
  return 0;
}

async function runScan(args, resolved, filePaths, customRules, opts = {}) {
  const logger = opts.logger || log;
  const shouldLog = opts.logProgress !== false;
  const repoMetadata = opts.repoMetadata || getRepoMetadata();
  const fixSummary = createFixSummary(args);
  const fileResults = [];
  const fileErrors = [];
  const remoteLinkCache = new Map();
  const linkEngineStats = createLinkEngineStats();
  let peakRssBytes = process.memoryUsage().rss;
  const updatePeakRss = () => {
    const rss = process.memoryUsage().rss;
    if (rss > peakRssBytes) peakRssBytes = rss;
  };

  const startTime = process.hrtime.bigint();
  for (const filePath of filePaths) {
    const rel = path.relative(process.cwd(), filePath);
    const shortPath = rel.startsWith('..') ? filePath : rel || filePath;
    if (shouldLog) {
      logger(c.cyan(icons.info), `Checking ${c.bold(shortPath)}...`);
    }

    try {
      const fileOpts = resolveFileOptions(filePath, resolved, args);
      if (isExcludedFile(filePath, fileOpts.exclude)) {
        if (shouldLog) {
          logger(c.dim(icons.info), c.dim('Skipped by exclude rules'));
        }
        continue;
      }

      const relPath = toRelativePath(filePath);
      const scanContext = createFileScanContext({
        absolutePath: filePath,
        relativePath: relPath,
        fileOptions: fileOpts,
        customRules
      });
      let content = fs.readFileSync(filePath, 'utf8');
      updatePeakRss();

      if (args.fix) {
        if (shouldLog) {
          logger(c.dim('  ↳'), c.dim('Auto-fixing insecure links...'));
        }
        const fixed = autoFixInsecureLinks(content);
        if (fixed.modified) {
          fixSummary.filesChanged += 1;
          fixSummary.linkReplacements += fixed.changes.length;
          for (const change of fixed.changes) {
            if (args.dryRun && shouldLog) {
              logger(c.dim('    '), c.yellow('~') + ` ${c.dim(change.from)} ${c.dim('→')} ${c.green(change.to)}`);
            }
          }
          if (!args.dryRun) {
            content = fixed.content;
          }
        }
        if (fixed.ambiguous.length > 0) {
          fixSummary.ambiguousSkipped.push({
            file: filePath,
            urls: [...new Set(fixed.ambiguous)]
          });
          if (shouldLog) {
            for (const url of [...new Set(fixed.ambiguous)]) {
              logger(c.dim('    '), c.dim(`⊘ skipped ${url} (localhost/custom port)`));
            }
          }
        }

        const formatted = autoFixFormatting(content);
        if (formatted.modified) {
          fixSummary.formatFixes += formatted.changes.length;
          if (!args.dryRun) {
            content = formatted.content;
          }
          if (shouldLog) {
            const ruleSet = new Set(formatted.changes.map(ch => ch.rule));
            logger(c.dim('  ↳'), c.dim(`Formatting: ${formatted.changes.length} fix${formatted.changes.length === 1 ? '' : 'es'} (${[...ruleSet].join(', ')})${args.dryRun ? ' [dry-run]' : ''}`));
          }
        }

        if (!args.dryRun && (fixed.modified || formatted.modified)) {
          fs.writeFileSync(filePath, content, 'utf8');
          recordSelfWrite(opts.watchState, filePath);
        }
      }

      const analysis = checkMarkdown(content, {
        maxLineLength: scanContext.options.maxLineLength,
        filePath: scanContext.relativePath,
        absoluteFilePath: scanContext.absolutePath,
        customRules: scanContext.customRules,
        checkFrontmatter: scanContext.options.checkFrontmatter,
        checkInlineHtml: scanContext.options.checkInlineHtml
      });

      if (scanContext.options.checkLinks) {
        if (shouldLog) {
          logger(c.dim('  ↳'), c.dim('Checking links...'));
        }
        const { findings: deadLinks, stats: linkStats } = await checkDeadLinksDetailed(content, {
          sourceFile: filePath,
          siteRoot: scanContext.options.siteRoot,
          linkAllowList: scanContext.options.linkAllowList,
          allowPrivateLinks: args.allowPrivateLinks,
          timeoutMs: scanContext.options.linkTimeoutMs,
          concurrency: scanContext.options.linkConcurrency,
          remoteCache: remoteLinkCache
        });
        linkEngineStats.remoteLinksChecked += Number(linkStats.remoteLinksChecked || 0);
        linkEngineStats.remoteCacheHits += Number(linkStats.remoteCacheHits || 0);
        linkEngineStats.remoteCacheMisses += Number(linkStats.remoteCacheMisses || 0);
        linkEngineStats.remoteTimeouts += Number(linkStats.remoteTimeouts || 0);
        const deadLinkErrors = [];
        const deadLinkWarnings = [];
        for (const finding of deadLinks) {
          finding.source = scanContext.relativePath;
          if (finding.severity === 'warning') {
            deadLinkWarnings.push(finding);
          } else {
            deadLinkErrors.push(finding);
          }
        }
        analysis.errors.push(...deadLinkErrors);
        analysis.warnings.push(...deadLinkWarnings);
        analysis.summary.errors = analysis.errors.length;
        analysis.summary.warnings = analysis.warnings.length;
        updatePeakRss();
      }

      if (scanContext.options.checkFreshness) {
        if (shouldLog) {
          logger(c.dim('  ↳'), c.dim('Checking freshness...'));
        }
        const freshnessWarnings = checkDocFreshness(content, {
          sourceFile: scanContext.relativePath,
          maxAgeDays: scanContext.options.freshnessMaxDays
        });
        analysis.warnings.push(...freshnessWarnings);
        analysis.summary.warnings = analysis.warnings.length;
      }

      fileResults.push(buildFileResult(filePath, analysis, {
        strict: scanContext.options.strict,
        ignoreRules: scanContext.options.ignoreRules
      }));
      updatePeakRss();
    } catch (err) {
      fileErrors.push({ file: toRelativePath(filePath), error: err.message });
    }
  }

  const elapsed = Number(process.hrtime.bigint() - startTime) / 1e9;
  const engineSummary = {
    scanMs: Math.round(elapsed * 1000),
    peakMemoryMb: Number((peakRssBytes / (1024 * 1024)).toFixed(3)),
    remoteLinksChecked: linkEngineStats.remoteLinksChecked,
    remoteCacheHits: linkEngineStats.remoteCacheHits,
    remoteCacheMisses: linkEngineStats.remoteCacheMisses,
    remoteTimeouts: linkEngineStats.remoteTimeouts
  };
  const features = [];
  if (args.checkLinks) features.push('check-links');
  if (args.checkFreshness) features.push('check-freshness');
  if (args.fix) features.push('fix');
  if (args.aiDrift) features.push(`drift:${args.aiMode}`);

  return {
    output: buildOutput(fileResults, fileErrors, { strict: resolved.strict }, elapsed, fixSummary, engineSummary, {
      repo: createRepoOutput(repoMetadata),
      scanId: opts.scanId || createScanId(),
      mode: 'scan',
      features,
      ai: opts.ai || {}
    }),
    fixSummary
  };
}

async function runCli(argv = process.argv.slice(2)) {
  const topLevel = argv[0];
  try {
    if (topLevel === 'login') {
      initColors(false);
      return await handleLogin(argv.slice(1));
    }
    if (topLevel === 'whoami') {
      initColors(false);
      return await handleWhoami(argv.slice(1));
    }
    if (topLevel === 'logout') {
      initColors(false);
      return await handleLogout();
    }
    if (topLevel === 'ai') {
      initColors(false);
      const aiCommand = argv[1];
      if (aiCommand === 'drift') {
        return await handleAiDrift(argv.slice(2));
      }
      if (aiCommand === 'memory') {
        return await handleAiMemory(argv.slice(2));
      }
      if (['fix', 'prioritize', 'coverage'].includes(aiCommand)) {
        console.error(`ai ${aiCommand} is not available yet. See roadmap for rollout timing.`);
        return 2;
      }
      console.error(`Unknown ai command: ${aiCommand || '(missing)'}`);
      return 2;
    }
  } catch (err) {
    if (err instanceof CloudError) {
      console.error(`Cloud error${err.status ? ` (${err.status})` : ''}: ${err.message}`);
      return err.status === 401 ? 1 : 2;
    }
    console.error(err.message);
    return 2;
  }

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`Argument error: ${err.message}`);
    console.error('Use --help for usage information.');
    return 2;
  }

  if (args.help) {
    printHelp();
    return 0;
  }

  if (args.version) {
    console.log(VERSION);
    return 0;
  }

  if (args.listRules) {
    initColors(args.noColor);
    setAsciiMode(args.ascii);
    console.log('');
    console.log(`  ${c.bold('Built-in rules')}`);
    console.log('');
    for (const rule of RULE_CATALOG) {
      const sev = rule.severity === 'error' ? c.red('error  ') : c.yellow('warning');
      console.log(`  ${c.cyan(rule.id.padEnd(22))} ${sev}  ${c.dim(rule.description)}`);
    }
    console.log('');
    return 0;
  }

  if (args.init) {
    initColors(args.noColor);
    setAsciiMode(args.ascii);
    const configFile = CONFIG_NAME;
    const configPath = path.resolve(configFile);

    const configExists = fs.existsSync(configPath);
    if (configExists && !args.force) {
      console.error(`  ${c.yellow(icons.warn)} ${c.bold(configFile)} already exists. Use ${c.bold('--force')} to overwrite.`);
      return 1;
    }

    const defaultConfig = {
      strict: false,
      maxLineLength: 160,
      ignoreRules: [],
      exclude: [],
      checkLinks: false,
      checkFreshness: false,
      checkFrontmatter: false,
      checkInlineHtml: false,
      freshnessMaxDays: 180,
      linkTimeoutMs: 8000,
      linkConcurrency: 5,
      siteRoot: null,
      linkAllowList: []
    };

    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf8');
    console.error('');
    console.error(`  ${c.green(icons.pass)} ${configExists ? 'Overwrote' : 'Created'} ${c.bold(configFile)}`);
    console.error('');
    console.error(`  ${c.dim('Edit the file to customise rules, then run:')}`)
    console.error(`  ${c.dim('$')} ${c.cyan('doclify .')}`);
    console.error('');
    return 0;
  }

  initColors(args.noColor);
  setAsciiMode(args.ascii);
  const repoMetadata = getRepoMetadata();

  // --trend: show score history graph and exit
  if (args.trend) {
    const history = loadHistory();
    if (history.length === 0) {
      console.error('No history found. Run with --track to start recording.');
      return 1;
    }
    console.error(renderTrend(history, { ascii: args.ascii }));
    return 0;
  }

  let filePaths;

  let resolved;
  try {
    resolved = resolveOptions(args);
  } catch (err) {
    console.error(err.message);
    return 2;
  }

  try {
    filePaths = resolveScanFilePaths(args, resolved);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    return 2;
  }

  // In diff/staged mode, zero changed files is a valid success (not an error)
  if ((args.diff || args.staged) && filePaths.length === 0) {
    if (args.aiDrift) {
      const fallbackTargets = resolveDriftFallbackTargets();
      filePaths = fallbackTargets.filter((candidate) => !isExcludedFile(candidate, resolved.exclude));
    } else {
      printBanner(0, VERSION);
      log(c.dim(icons.info), 'No changed Markdown/MDX files found.');
      console.error('');
      return 0;
    }
  }

  if (filePaths.length === 0) {
    console.error('Error: no Markdown/MDX files found.');
    return 2;
  }

  let customRules = [];
  if (args.rules) {
    try {
      customRules = loadCustomRules(args.rules);
    } catch (err) {
      console.error(`Custom rules error: ${err.message}`);
      return 2;
    }
  }

  // Watch mode: monitor files and re-scan on change
  if (args.watch) {
    const watchPath = getWatchPath(args);
    console.error('');
    console.error(`  ${c.bold('Doclify Guardrail')} ${c.dim(`v${VERSION}`)}`);
    console.error('');

    let debounceTimer = null;
    const watchState = { selfWrites: new Map() };
    let stopWatching = null;

    const runWatchScan = async () => {
      let currentResolved;
      try {
        currentResolved = resolveOptions(args);
        filePaths = resolveScanFilePaths(args, currentResolved);
      } catch (err) {
        console.error(`Watch error: ${err.message}`);
        return;
      }

      if ((args.diff || args.staged) && filePaths.length === 0) {
        log(c.dim(icons.info), 'No changed Markdown/MDX files found.');
        return;
      }

      const existingPaths = filePaths.filter((candidate) => fs.existsSync(candidate));
      if (existingPaths.length === 0) {
        log(c.dim(icons.info), 'No Markdown/MDX files found.');
        return;
      }

      const { output } = await runScan(args, currentResolved, existingPaths, customRules, {
        watchState,
        repoMetadata
      });
      if (args.aiDrift) {
        try {
          const drift = await runDriftGuard({
            targetFiles: existingPaths,
            mode: args.aiMode,
            threshold: args.failOnDrift,
            failOnDriftScope: args.failOnDriftScope,
            base: args.base,
            staged: args.staged,
            apiUrl: args.apiUrl,
            apiKey: args.token,
            repoMetadata
          });
          output.ai = { ...(output.ai || {}), drift };
        } catch (err) {
          log(c.yellow(icons.warn), `Drift Guard skipped: ${err.message}`);
        }
      }
      if (args.format === 'compact') {
        printCompactResults(output);
      } else {
        printResults(output);
      }
    };

    const { watch } = await import('node:fs');
    try {
      const watcher = watch(watchPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = path.resolve(watchPath, filename);
        const isConfigChange = path.basename(filename) === CONFIG_NAME;
        const isMarkdownChange = isMarkdownPath(filename);
        if (!isConfigChange && !isMarkdownChange) return;
        if (isMarkdownChange && shouldIgnoreWatchPath(watchState, fullPath)) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          log(c.dim(icons.info), c.dim(`Changed: ${filename}`));
          runWatchScan();
        }, 300);
      });
      stopWatching = () => watcher.close();
    } catch (err) {
      console.error(`Watch error: ${err.message}`);
      return 2;
    }

    log(c.cyan(icons.info), `Watching ${c.bold(watchPath)} for changes... ${c.dim('(Ctrl+C to stop)')}`);
    console.error('');

    // Initial scan after the watcher is subscribed, so immediate edits are not lost.
    await runWatchScan();

    // Keep process alive
    await new Promise((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
    if (stopWatching) stopWatching();
    return 0;
  }

  printBanner(filePaths.length, VERSION);

  if (resolved.configLoaded) {
    log(c.cyan(icons.info), `Loaded config from ${c.dim(resolved.configPath)}`);
  }

  let customRulesCount = customRules.length;
  if (customRulesCount > 0) {
    log(c.cyan(icons.info), `Loaded ${c.bold(String(customRulesCount))} custom rules from ${c.dim(args.rules)}`);
  }

  if (resolved.ignoreRules.size > 0) {
    const knownIds = new Set(RULE_CATALOG.map(r => r.id));
    for (const id of customRules) knownIds.add(id.id);
    for (const id of resolved.ignoreRules) {
      if (!knownIds.has(id)) {
        log(c.yellow(icons.warn), `Unknown rule "${c.bold(id)}" in --ignore-rules (ignored)`);
      }
    }
  }

  console.error('');
  const { output, fixSummary } = await runScan(args, resolved, filePaths, customRules, {
    repoMetadata
  });
  let driftResult = null;
  if (args.aiDrift) {
    try {
      driftResult = await runDriftGuard({
        targetFiles: filePaths,
        mode: args.aiMode,
        threshold: args.failOnDrift,
        failOnDriftScope: args.failOnDriftScope,
        base: args.base,
        staged: args.staged,
        apiUrl: args.apiUrl,
        apiKey: args.token,
        repoMetadata
      });
      output.ai = { ...(output.ai || {}), drift: driftResult };
    } catch (err) {
      if (err instanceof CloudError) {
        console.error(`Cloud error${err.status ? ` (${err.status})` : ''}: ${err.message}`);
        return err.status === 401 ? 1 : 2;
      }
      log(c.yellow(icons.warn), `Drift Guard skipped: ${err.message}`);
    }
  }

  if (args.debug) {
    console.error(JSON.stringify({ debug: { args, resolved } }, null, 2));
  }

  if (args.format === 'compact') {
    printCompactResults(output);
  } else {
    printResults(output);
  }

  if (driftResult) {
    printDriftSummary(driftResult);
  }

  if (args.fix) {
    const action = args.dryRun ? 'Would fix' : 'Fixed';
    const totalFixes = fixSummary.linkReplacements + fixSummary.formatFixes;
    if (totalFixes > 0) {
      log(
        args.dryRun ? c.yellow('~') : c.green(icons.pass),
        `${action} ${c.bold(String(totalFixes))} fix${totalFixes === 1 ? '' : 'es'} (${fixSummary.linkReplacements} links, ${fixSummary.formatFixes} formatting) in ${c.bold(String(fixSummary.filesChanged))} file${fixSummary.filesChanged === 1 ? '' : 's'}${args.dryRun ? c.dim(' (dry-run, no files changed)') : ''}`
      );
    } else {
      log(c.dim(icons.info), c.dim('No fixable issues found'));
    }
  }

  if (args.json) {
    await writeJsonToStdout(output);
  }

  if (args.report) {
    try {
      const reportPath = generateReport(output, { reportPath: args.report });
      log(c.green(icons.pass), `Report written ${c.dim('→')} ${reportPath}`);
    } catch (err) {
      console.error(`Failed to write report: ${err.message}`);
      return 2;
    }
  }

  if (args.junit) {
    try {
      const junitPath = generateJUnitReport(output, { junitPath: args.junit });
      log(c.green(icons.pass), `JUnit report written ${c.dim('→')} ${junitPath}`);
    } catch (err) {
      console.error(`Failed to write JUnit report: ${err.message}`);
      return 2;
    }
  }

  if (args.sarif) {
    try {
      const sarifPath = generateSarifReport(output, { sarifPath: args.sarif });
      log(c.green(icons.pass), `SARIF report written ${c.dim('→')} ${sarifPath}`);
    } catch (err) {
      console.error(`Failed to write SARIF report: ${err.message}`);
      return 2;
    }
  }

  if (args.badge) {
    try {
      const badge = generateBadge(output, { badgePath: args.badge, label: args.badgeLabel });
      log(c.green(icons.pass), `Badge written ${c.dim('→')} ${badge.badgePath} ${c.dim(`(score ${badge.score})`)}`);
    } catch (err) {
      console.error(`Failed to write badge: ${err.message}`);
      return 2;
    }
  }

  // Score tracking: --track
  if (args.track) {
    const commit = getCurrentCommit();
    appendHistory({
      date: new Date().toISOString(),
      commit,
      avgScore: output.summary.avgHealthScore,
      errors: output.summary.totalErrors,
      warnings: output.summary.totalWarnings,
      filesScanned: output.summary.filesScanned
    });
    log(c.green(icons.pass), `Score tracked ${c.dim('→')} .doclify-history.json`);
  }

  // Regression check: --fail-on-regression
  if (args.failOnRegression) {
    const history = loadHistory();
    const { regression, delta, prev, current } = checkRegression(history, output.summary.avgHealthScore);
    if (regression) {
      log(c.red(icons.fail), `Score regression: ${c.bold(String(prev))} → ${c.bold(String(current))} (${delta})`);
      return 1;
    }
  }

  // Quality gate: --min-score
  if (args.minScore !== null && output.summary.avgHealthScore < args.minScore) {
    log(c.red(icons.fail), `Health score ${c.bold(String(output.summary.avgHealthScore))} is below minimum ${c.bold(String(args.minScore))}`);
    return 1;
  }

  if (driftResult && shouldFailForRisk(getDriftGateRisk(driftResult.summary, args.failOnDriftScope), args.failOnDrift)) {
    const gatingRisk = getDriftGateRisk(driftResult.summary, args.failOnDriftScope) || 'none';
    log(c.red(icons.fail), `Drift Guard threshold reached (${args.failOnDriftScope}): ${c.bold(gatingRisk)} >= ${c.bold(args.failOnDrift)}`);
    return 1;
  }

  return output.summary.status === 'PASS' ? 0 : 1;
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && fs.realpathSync(process.argv[1]) === __filename) {
  const code = await runCli();
  process.exit(code);
}

export { checkMarkdown, parseArgs, resolveOptions, resolveFileOptions, findParentConfigs, runCli, buildFileResult, buildOutput };
