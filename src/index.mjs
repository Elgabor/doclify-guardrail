#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { checkMarkdown } from './checker.mjs';
import { resolveFileList } from './glob.mjs';
import { generateReport } from './report.mjs';
import { loadCustomRules } from './rules-loader.mjs';

function printHelp() {
  console.log(`Doclify Guardrail CLI\n\nUso:\n  doclify-guardrail <file.md ...> [opzioni]\n  doclify-guardrail --dir <path> [opzioni]\n\nOpzioni:\n  --strict                 Tratta i warning come failure\n  --max-line-length <n>    Lunghezza massima linea (default: 160)\n  --config <path>          Path file config JSON (default: .doclify-guardrail.json)\n  --dir <path>             Scansiona ricorsivamente i .md in una directory\n  --report [path]          Genera report markdown (default: doclify-report.md)\n  --rules <path>           Carica regole custom da file JSON\n  --no-color               Disabilita output colorato\n  --debug                  Mostra dettagli runtime\n  -h, --help               Mostra questo help\n\nExit code:\n  0 = pass\n  1 = fail (errori, o warning in strict mode)\n  2 = uso scorretto / input non valido`);
}

function parseConfigFile(configPath) {
  if (!configPath || !fs.existsSync(configPath)) return {};

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('deve essere un oggetto JSON');
    }
    return parsed;
  } catch (err) {
    throw new Error(`Config non valida (${configPath}): ${err.message}`);
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
    noColor: false
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

    if (a === '--config') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Valore mancante per --config');
      }
      args.configPath = path.resolve(value);
      i += 1;
      continue;
    }

    if (a === '--max-line-length') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Valore mancante per --max-line-length');
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--max-line-length non valido: ${value}`);
      }
      args.maxLineLength = parsed;
      i += 1;
      continue;
    }

    if (a === '--dir') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Valore mancante per --dir');
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
        throw new Error('Valore mancante per --rules');
      }
      args.rules = value;
      i += 1;
      continue;
    }

    if (a.startsWith('-')) {
      throw new Error(`Opzione sconosciuta: ${a}`);
    }

    args.files.push(a);
  }

  return args;
}

function resolveOptions(args) {
  const cfg = parseConfigFile(args.configPath);
  const maxLineLength = Number(args.maxLineLength ?? cfg.maxLineLength ?? 160);
  const strict = Boolean(args.strict ?? cfg.strict ?? false);

  if (!Number.isInteger(maxLineLength) || maxLineLength <= 0) {
    throw new Error(`maxLineLength non valido in config: ${cfg.maxLineLength}`);
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
      status: pass ? 'PASS' : 'FAIL'
    }
  };
}

function buildOutput(fileResults, fileErrors, opts, elapsed) {
  const totalErrors = fileResults.reduce((s, r) => s + r.summary.errors, 0);
  const totalWarnings = fileResults.reduce((s, r) => s + r.summary.warnings, 0);
  const passed = fileResults.filter(r => r.pass).length;
  const failed = fileResults.filter(r => !r.pass).length;
  const overallPass = failed === 0 && fileErrors.length === 0;

  return {
    version: '1.0',
    strict: opts.strict,
    files: fileResults,
    fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
    summary: {
      filesScanned: fileResults.length + fileErrors.length,
      filesPassed: passed,
      filesFailed: failed,
      filesErrored: fileErrors.length,
      totalErrors,
      totalWarnings,
      status: overallPass ? 'PASS' : 'FAIL',
      elapsed: Math.round(elapsed * 1000) / 1000
    }
  };
}

function printHumanSummary(output) {
  const s = output.summary;
  const parts = [];
  if (s.filesPassed > 0) parts.push(`\u2713 ${s.filesPassed} passed`);
  if (s.filesFailed > 0) parts.push(`\u2717 ${s.filesFailed} failed`);
  if (s.filesErrored > 0) parts.push(`${s.filesErrored} errored`);
  console.error(
    `${parts.join(' \u00B7 ')} \u00B7 ${s.filesScanned} files scanned in ${s.elapsed}s`
  );
}

function runCli(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`Errore argomenti: ${err.message}`);
    console.error('Usa --help per vedere le opzioni disponibili.');
    return 2;
  }

  if (args.help) {
    printHelp();
    return 0;
  }

  // Resolve file list
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

  // Load custom rules if specified
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

  for (const filePath of filePaths) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const analysis = checkMarkdown(content, {
        maxLineLength: resolved.maxLineLength,
        filePath,
        customRules
      });
      fileResults.push(buildFileResult(filePath, analysis, { strict: resolved.strict }));
    } catch (err) {
      fileErrors.push({ file: filePath, error: err.message });
    }
  }

  const elapsed = Number(process.hrtime.bigint() - startTime) / 1e9;
  const output = buildOutput(fileResults, fileErrors, { strict: resolved.strict }, elapsed);

  if (args.debug) {
    console.error(JSON.stringify({ debug: { args, resolved } }, null, 2));
  }

  printHumanSummary(output);
  console.log(JSON.stringify(output, null, 2));

  // Generate report if requested
  if (args.report) {
    try {
      const reportPath = generateReport(output, { reportPath: args.report });
      console.error(`Report written to: ${reportPath}`);
    } catch (err) {
      console.error(`Failed to write report: ${err.message}`);
      return 2;
    }
  }

  return output.summary.status === 'PASS' ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(runCli());
}

export { checkMarkdown, parseArgs, resolveOptions, runCli, buildFileResult, buildOutput };
