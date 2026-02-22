#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMarkdown } from './checker.mjs';
import { resolveFileList } from './glob.mjs';
import { generateReport } from './report.mjs';
import { loadCustomRules } from './rules-loader.mjs';
import { initColors, c, log, printBanner, printResults } from './colors.mjs';
import { checkDeadLinks } from './links.mjs';
import { autoFixInsecureLinks } from './fixer.mjs';
import { computeDocHealthScore, checkDocFreshness } from './quality.mjs';
import {
  computeHealthScore,
  generateJUnitReport,
  generateSarifReport,
  generateBadge
} from './ci-output.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
    --dir <path>             Scan .md files recursively in directory
    --strict                 Treat warnings as errors
    --max-line-length <n>    Max line length ${d('(default: 160)')}
    --config <path>          Config file ${d('(default: .doclify-guardrail.json)')}
    --rules <path>           Custom regex rules from JSON file

  ${y('CHECKS')}
    --check-links            Validate HTTP and local links
    --check-freshness        Warn on stale docs ${d('(>180 days)')}

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

  ${y('OTHER')}
    --no-color               Disable colored output
    --debug                  Show debug info
    -h, --help               Show this help

  ${y('EXAMPLES')}
    $ doclify README.md
    $ doclify docs/ --strict --check-links
    $ doclify --dir src/ --report --badge
    $ doclify docs/ --fix --dry-run
    $ doclify . --json > results.json

  ${y('EXIT CODES')}
    0  PASS ${d('— all files clean')}
    1  FAIL ${d('— errors found, or warnings in strict mode')}
    2  Usage error ${d('— invalid input')}
`);
}

function parseConfigFile(configPath) {
  if (!configPath || !fs.existsSync(configPath)) return {};

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('must be a JSON object');
    }
    return parsed;
  } catch (err) {
    throw new Error(`Invalid config (${configPath}): ${err.message}`);
  }
}

function parseArgs(argv) {
  const args = {
    files: [],
    strict: undefined,
    debug: false,
    maxLineLength: undefined,
    configPath: path.resolve('.doclify-guardrail.json'),
    help: false,
    dir: null,
    report: null,
    rules: null,
    junit: null,
    sarif: null,
    badge: null,
    badgeLabel: 'docs health',
    noColor: false,
    checkLinks: false,
    checkFreshness: false,
    fix: false,
    dryRun: false,
    json: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];

    if (a === '-h' || a === '--help') {
      args.help = true;
      continue;
    }

    if (a === '--debug') {
      args.debug = true;
      continue;
    }

    if (a === '--strict') {
      args.strict = true;
      continue;
    }

    if (a === '--no-color') {
      args.noColor = true;
      continue;
    }

    if (a === '--check-links') {
      args.checkLinks = true;
      continue;
    }

    if (a === '--check-freshness') {
      args.checkFreshness = true;
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

    if (a === '--config') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --config');
      }
      args.configPath = path.resolve(value);
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

function resolveOptions(args) {
  const cfg = parseConfigFile(args.configPath);
  const maxLineLength = Number(args.maxLineLength ?? cfg.maxLineLength ?? 160);
  const strict = Boolean(args.strict ?? cfg.strict ?? false);

  if (!Number.isInteger(maxLineLength) || maxLineLength <= 0) {
    throw new Error(`Invalid maxLineLength in config: ${cfg.maxLineLength}`);
  }

  return {
    maxLineLength,
    strict,
    configPath: args.configPath,
    configLoaded: fs.existsSync(args.configPath)
  };
}

function toRelativePath(filePath) {
  const rel = path.relative(process.cwd(), filePath);
  return rel.startsWith('..') ? filePath : rel || filePath;
}

function buildFileResult(filePath, analysis, opts) {
  const pass = analysis.errors.length === 0 && (!opts.strict || analysis.warnings.length === 0);
  const healthScore = computeDocHealthScore({
    errors: analysis.summary.errors,
    warnings: analysis.summary.warnings
  });

  return {
    file: toRelativePath(filePath),
    pass,
    findings: {
      errors: analysis.errors,
      warnings: analysis.warnings
    },
    summary: {
      errors: analysis.summary.errors,
      warnings: analysis.summary.warnings,
      healthScore,
      status: pass ? 'PASS' : 'FAIL'
    }
  };
}

function buildOutput(fileResults, fileErrors, opts, elapsed, fixSummary) {
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

  summary.avgHealthScore = avgHealthScore;
  summary.healthScore = computeHealthScore(summary);

  return {
    version: VERSION,
    strict: opts.strict,
    files: fileResults,
    fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
    fix: fixSummary,
    summary
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

  initColors(args.noColor);

  let filePaths;
  try {
    filePaths = resolveFileList(args);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    return 2;
  }

  if (filePaths.length === 0) {
    console.error('Error: no markdown files found.');
    return 2;
  }

  let resolved;
  try {
    resolved = resolveOptions(args);
  } catch (err) {
    console.error(err.message);
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

  printBanner(filePaths.length, VERSION);

  if (resolved.configLoaded) {
    log(c.cyan('ℹ'), `Loaded config from ${c.dim(resolved.configPath)}`);
  }

  const startTime = process.hrtime.bigint();
  const fileResults = [];
  const fileErrors = [];
  const fixSummary = {
    enabled: args.fix,
    dryRun: args.dryRun,
    filesChanged: 0,
    replacements: 0,
    ambiguousSkipped: []
  };

  let customRulesCount = customRules.length;
  if (customRulesCount > 0) {
    log(c.cyan('ℹ'), `Loaded ${c.bold(String(customRulesCount))} custom rules from ${c.dim(args.rules)}`);
  }

  console.error('');

  for (const filePath of filePaths) {
    const rel = path.relative(process.cwd(), filePath);
    const shortPath = rel.startsWith('..') ? filePath : rel || filePath;
    log(c.cyan('ℹ'), `Checking ${c.bold(shortPath)}...`);

    try {
      let content = fs.readFileSync(filePath, 'utf8');

      if (args.fix) {
        log(c.dim('  ↳'), c.dim(`Auto-fixing insecure links...`));
        const fixed = autoFixInsecureLinks(content);
        if (fixed.modified) {
          fixSummary.filesChanged += 1;
          fixSummary.replacements += fixed.changes.length;
          for (const change of fixed.changes) {
            if (args.dryRun) {
              log(c.dim('    '), c.yellow('~') + ` ${c.dim(change.from)} ${c.dim('→')} ${c.green(change.to)}`);
            }
          }
          if (!args.dryRun) {
            fs.writeFileSync(filePath, fixed.content, 'utf8');
          }
          content = fixed.content;
        }
        if (fixed.ambiguous.length > 0) {
          fixSummary.ambiguousSkipped.push({
            file: filePath,
            urls: [...new Set(fixed.ambiguous)]
          });
          for (const url of [...new Set(fixed.ambiguous)]) {
            log(c.dim('    '), c.dim(`⊘ skipped ${url} (localhost/custom port)`));
          }
        }
      }

      const relPath = toRelativePath(filePath);
      const analysis = checkMarkdown(content, {
        maxLineLength: resolved.maxLineLength,
        filePath: relPath,
        customRules
      });

      if (args.checkLinks) {
        log(c.dim('  ↳'), c.dim(`Checking links...`));
        const deadLinks = await checkDeadLinks(content, { sourceFile: filePath });
        for (const dl of deadLinks) { dl.source = relPath; }
        analysis.errors.push(...deadLinks);
        analysis.summary.errors = analysis.errors.length;
      }

      if (args.checkFreshness) {
        log(c.dim('  ↳'), c.dim(`Checking freshness...`));
        const freshnessWarnings = checkDocFreshness(content, { sourceFile: relPath });
        analysis.warnings.push(...freshnessWarnings);
        analysis.summary.warnings = analysis.warnings.length;
      }

      fileResults.push(buildFileResult(filePath, analysis, { strict: resolved.strict }));
    } catch (err) {
      fileErrors.push({ file: toRelativePath(filePath), error: err.message });
    }
  }

  const elapsed = Number(process.hrtime.bigint() - startTime) / 1e9;
  const output = buildOutput(fileResults, fileErrors, { strict: resolved.strict }, elapsed, fixSummary);

  if (args.debug) {
    console.error(JSON.stringify({ debug: { args, resolved } }, null, 2));
  }

  printResults(output);

  if (args.fix && fixSummary.replacements > 0) {
    const action = args.dryRun ? 'Would fix' : 'Fixed';
    log(
      args.dryRun ? c.yellow('~') : c.green('✓'),
      `${action} ${c.bold(String(fixSummary.replacements))} insecure link${fixSummary.replacements === 1 ? '' : 's'} in ${c.bold(String(fixSummary.filesChanged))} file${fixSummary.filesChanged === 1 ? '' : 's'}${args.dryRun ? c.dim(' (dry-run, no files changed)') : ''}`
    );
  } else if (args.fix && fixSummary.replacements === 0) {
    log(c.dim('ℹ'), c.dim('No insecure links to fix'));
  }

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  }

  if (args.report) {
    try {
      const reportPath = generateReport(output, { reportPath: args.report });
      log(c.green('✓'), `Report written ${c.dim('→')} ${reportPath}`);
    } catch (err) {
      console.error(`Failed to write report: ${err.message}`);
      return 2;
    }
  }

  if (args.junit) {
    try {
      const junitPath = generateJUnitReport(output, { junitPath: args.junit });
      log(c.green('✓'), `JUnit report written ${c.dim('→')} ${junitPath}`);
    } catch (err) {
      console.error(`Failed to write JUnit report: ${err.message}`);
      return 2;
    }
  }

  if (args.sarif) {
    try {
      const sarifPath = generateSarifReport(output, { sarifPath: args.sarif });
      log(c.green('✓'), `SARIF report written ${c.dim('→')} ${sarifPath}`);
    } catch (err) {
      console.error(`Failed to write SARIF report: ${err.message}`);
      return 2;
    }
  }

  if (args.badge) {
    try {
      const badge = generateBadge(output, { badgePath: args.badge, label: args.badgeLabel });
      log(c.green('✓'), `Badge written ${c.dim('→')} ${badge.badgePath} ${c.dim(`(score ${badge.score})`)}`);
    } catch (err) {
      console.error(`Failed to write badge: ${err.message}`);
      return 2;
    }
  }

  return output.summary.status === 'PASS' ? 0 : 1;
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && fs.realpathSync(process.argv[1]) === __filename) {
  const code = await runCli();
  process.exit(code);
}

export { checkMarkdown, parseArgs, resolveOptions, runCli, buildFileResult, buildOutput };
