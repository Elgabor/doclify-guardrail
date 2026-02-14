#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { checkMarkdown } from './checker.mjs';

function printHelp() {
  console.log(`Doclify Guardrail CLI\n\nUso:\n  doclify-guardrail <file.md> [opzioni]\n\nOpzioni:\n  --strict                 Tratta i warning come failure\n  --max-line-length <n>    Lunghezza massima linea (default: 160)\n  --config <path>          Path file config JSON (default: .doclify-guardrail.json)\n  --debug                  Mostra dettagli runtime\n  -h, --help               Mostra questo help\n\nExit code:\n  0 = pass\n  1 = fail (errori, o warning in strict mode)\n  2 = uso scorretto / input non valido`);
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
    file: null,
    strict: undefined,
    debug: false,
    maxLineLength: undefined,
    configPath: path.resolve('.doclify-guardrail.json'),
    help: false
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

    if (a.startsWith('-')) {
      throw new Error(`Opzione sconosciuta: ${a}`);
    }

    if (!args.file) {
      args.file = a;
      continue;
    }

    throw new Error(`Argomento inatteso: ${a}`);
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

function buildResult(file, analysis, opts) {
  const pass = analysis.errors.length === 0 && (!opts.strict || analysis.warnings.length === 0);
  return {
    version: '0.2',
    file,
    strict: opts.strict,
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

function printHumanSummary(result) {
  console.error(
    `[doclify-guardrail] ${result.summary.status} — errori: ${result.summary.errors}, warning: ${result.summary.warnings}, strict: ${result.strict ? 'on' : 'off'}`
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

  if (!args.file) {
    console.error('Errore: manca <file.md>.');
    console.error('Usa --help per esempi di utilizzo.');
    return 2;
  }

  if (!fs.existsSync(args.file)) {
    console.error(`File non trovato: ${args.file}`);
    return 2;
  }

  let resolved;
  try {
    resolved = resolveOptions(args);
  } catch (err) {
    console.error(err.message);
    return 2;
  }

  const content = fs.readFileSync(args.file, 'utf8');
  const analysis = checkMarkdown(content, { maxLineLength: resolved.maxLineLength });
  const result = buildResult(args.file, analysis, { strict: resolved.strict });

  if (args.debug) {
    console.error(
      JSON.stringify(
        {
          debug: {
            args,
            resolved
          }
        },
        null,
        2
      )
    );
  }

  printHumanSummary(result);
  console.log(JSON.stringify(result, null, 2));
  return result.pass ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(runCli());
}

export { checkMarkdown, parseArgs, resolveOptions, runCli };
