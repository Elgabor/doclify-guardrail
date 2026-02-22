#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { checkMarkdown } from './checker.mjs';
import { resolveFileList } from './glob.mjs';
import { generateReport } from './report.mjs';
import { loadCustomRules } from './rules-loader.mjs';
import { initColors, printResults } from './colors.mjs';
import { checkDeadLinks } from './links.mjs';
import { autoFixInsecureLinks } from './fixer.mjs';
import { computeDocHealthScore, checkDocFreshness } from './quality.mjs';
import {
  computeHealthScore,
  generateJUnitReport,
  generateSarifReport,
  generateBadge
} from './ci-output.mjs';

function printHelp() {
  console.log(`Doclify Guardrail CLI v1.0

Usage:
  doclify-guardrail <file.md ...> [options]
  doclify-guardrail --dir <path> [options]

Options:
  --strict                 Treat warnings as failures
  --max-line-length <n>    Maximum line length (default: 160)
  --config <path>          Config file path (default: .doclify-guardrail.json)
  --dir <path>             Scan all .md files in directory (recursive)
  --report [path]          Generate markdown report (default: doclify-report.md)
  --rules <path>           Load custom rules from JSON file
  --check-links            Validate links and fail on dead links
  --check-freshness        Warn on stale docs (default max age: 180 days)
  --junit [path]           Generate JUnit XML report (default: doclify-junit.xml)
  --sarif [path]           Generate SARIF report (default: doclify.sarif)
  --badge [path]           Generate SVG badge (default: doclify-badge.svg)
  --badge-label <text>     Custom label for generated badge (default: docs health)
  --fix                    Auto-fix safe issues (v1: http:// -> https://)
  --dry-run                Preview changes (valid only with --fix)
  --no-color               Disable colored output
  --debug                  Show runtime details
  -h, --help               Show this help

Exit codes:
  0 = PASS (all files clean)
  1 = FAIL (errors found, or warnings in strict mode)
  2 = Usage error / invalid input`);
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
    dryRun: false
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

function buildFileResult(filePath, analysis, opts) {
  const pass = analysis.errors.length === 0 && (!opts.strict || analysis.warnings.length === 0);
  const healthScore = computeDocHealthScore({
    errors: analysis.summary.errors,
    warnings: analysis.summary.warnings
  });

  return {
    file: filePath,
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
    version: '1.0',
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

  for (const filePath of filePaths) {
    try {
      let content = fs.readFileSync(filePath, 'utf8');

      if (args.fix) {
        const fixed = autoFixInsecureLinks(content);
        if (fixed.modified) {
          fixSummary.filesChanged += 1;
          fixSummary.replacements += fixed.changes.length;
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
        }
      }

      const analysis = checkMarkdown(content, {
        maxLineLength: resolved.maxLineLength,
        filePath,
        customRules
      });

      if (args.checkLinks) {
        const deadLinks = await checkDeadLinks(content, { sourceFile: filePath });
        analysis.errors.push(...deadLinks);
        analysis.summary.errors = analysis.errors.length;
      }

      if (args.checkFreshness) {
        const freshnessWarnings = checkDocFreshness(content, { sourceFile: filePath });
        analysis.warnings.push(...freshnessWarnings);
        analysis.summary.warnings = analysis.warnings.length;
      }

      fileResults.push(buildFileResult(filePath, analysis, { strict: resolved.strict }));
    } catch (err) {
      fileErrors.push({ file: filePath, error: err.message });
    }
  }

  const elapsed = Number(process.hrtime.bigint() - startTime) / 1e9;
  const output = buildOutput(fileResults, fileErrors, { strict: resolved.strict }, elapsed, fixSummary);

  if (args.debug) {
    console.error(JSON.stringify({ debug: { args, resolved } }, null, 2));
  }

  printResults(output);
  console.log(JSON.stringify(output, null, 2));

  if (args.report) {
    try {
      const reportPath = generateReport(output, { reportPath: args.report });
      console.error(`Report written to: ${reportPath}`);
    } catch (err) {
      console.error(`Failed to write report: ${err.message}`);
      return 2;
    }
  }

  if (args.junit) {
    try {
      const junitPath = generateJUnitReport(output, { junitPath: args.junit });
      console.error(`JUnit report written to: ${junitPath}`);
    } catch (err) {
      console.error(`Failed to write JUnit report: ${err.message}`);
      return 2;
    }
  }

  if (args.sarif) {
    try {
      const sarifPath = generateSarifReport(output, { sarifPath: args.sarif });
      console.error(`SARIF report written to: ${sarifPath}`);
    } catch (err) {
      console.error(`Failed to write SARIF report: ${err.message}`);
      return 2;
    }
  }

  if (args.badge) {
    try {
      const badge = generateBadge(output, { badgePath: args.badge, label: args.badgeLabel });
      console.error(`Badge written to: ${badge.badgePath} (score ${badge.score})`);
    } catch (err) {
      console.error(`Failed to write badge: ${err.message}`);
      return 2;
    }
  }

  return output.summary.status === 'PASS' ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await runCli();
  process.exit(code);
}

export { checkMarkdown, parseArgs, resolveOptions, runCli, buildFileResult, buildOutput };
