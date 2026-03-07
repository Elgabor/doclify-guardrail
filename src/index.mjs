#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
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
import { getChangedMarkdownFiles } from './diff.mjs';
import { loadHistory, appendHistory, getCurrentCommit, checkRegression, renderTrend } from './trend.mjs';
import { createFileScanContext } from './scan-context.mjs';
import { isMarkdownPath } from './markdown-files.mjs';
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

function buildOutput(fileResults, fileErrors, opts, elapsed, fixSummary, engineSummary = null) {
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
    version: VERSION,
    strict: opts.strict,
    files: fileResults,
    fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
    fix: fixSummary,
    summary,
    engine: {
      schemaVersion: 1,
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

async function runCanonicalScan(args, resolved, filePaths, customRules, opts = {}) {
  const logger = opts.logger || log;
  const shouldLog = opts.logProgress !== false;
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

  return {
    output: buildOutput(fileResults, fileErrors, { strict: resolved.strict }, elapsed, fixSummary, engineSummary),
    fixSummary
  };
}

async function runCli(argv = process.argv.slice(2)) {
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
    printBanner(0, VERSION);
    log(c.dim(icons.info), 'No changed Markdown/MDX files found.');
    console.error('');
    return 0;
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
    log(c.cyan(icons.info), `Watching ${c.bold(watchPath)} for changes... ${c.dim('(Ctrl+C to stop)')}`);
    console.error('');

    let debounceTimer = null;
    const watchState = { selfWrites: new Map() };

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

      const { output } = await runCanonicalScan(args, currentResolved, existingPaths, customRules, {
        watchState
      });
      if (args.format === 'compact') {
        printCompactResults(output);
      } else {
        printResults(output);
      }
    };

    // Initial scan
    await runWatchScan();

    const { watch } = await import('node:fs');
    try {
      watch(watchPath, { recursive: true }, (eventType, filename) => {
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
    } catch (err) {
      console.error(`Watch error: ${err.message}`);
      return 2;
    }

    // Keep process alive
    await new Promise(() => {});
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
  const { output, fixSummary } = await runCanonicalScan(args, resolved, filePaths, customRules);

  if (args.debug) {
    console.error(JSON.stringify({ debug: { args, resolved } }, null, 2));
  }

  if (args.format === 'compact') {
    printCompactResults(output);
  } else {
    printResults(output);
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

  return output.summary.status === 'PASS' ? 0 : 1;
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && fs.realpathSync(process.argv[1]) === __filename) {
  const code = await runCli();
  process.exit(code);
}

export { checkMarkdown, parseArgs, resolveOptions, resolveFileOptions, findParentConfigs, runCli, buildFileResult, buildOutput };
