#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULES_BY_ID } from './rule-catalog.mjs';
import { COMMAND_USAGE } from './cli-contract.mjs';
import { isLegacyToken, migrationMessage } from './legacy-surface.mjs';
import { isV2Command, runV2Cli } from './v2-cli.mjs';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(sourceDir, '..', 'package.json'), 'utf8'));

function isEntrypoint(argvPath) {
  if (!argvPath) return false;
  try {
    return fs.realpathSync(argvPath) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(argvPath) === fileURLToPath(import.meta.url);
  }
}

function topLevelHelp() {
  return [
    `Doclify Guardrail ${packageJson.version}`,
    '',
    'Usage:',
    ...COMMAND_USAGE.map(([, usage]) => `  doclify-guardrail ${usage}`),
    '',
    'Run a command with --help for its options.',
    ''
  ].join('\n');
}

function runExplain(argv) {
  if (argv.length !== 1 || argv[0].startsWith('-')) {
    process.stderr.write('invalid-explain: explain requires exactly one rule id.\n');
    return 2;
  }
  const rule = RULES_BY_ID.get(argv[0]);
  if (!rule) {
    process.stderr.write(`unknown-rule: Unknown rule id: ${argv[0]}.\n`);
    return 2;
  }
  process.stdout.write(`${rule.id}\nPurpose: ${rule.purpose}\nEvidence: ${rule.evidence}\nSafe remedy: ${rule.remediation}\n`);
  return 0;
}

function runInit(argv) {
  const template = '{\n  "ignoreRules": []\n}\n';
  if (argv.length !== 1 || !['--print', '--write'].includes(argv[0])) {
    process.stderr.write('invalid-init: Use init --print or init --write.\n');
    return 2;
  }
  if (argv[0] === '--print') {
    process.stdout.write(template);
    return 0;
  }
  const target = path.resolve(process.cwd(), '.doclify-guardrail.json');
  if (fs.existsSync(target)) {
    process.stderr.write('config-exists: Refusing to overwrite existing .doclify-guardrail.json.\n');
    return 2;
  }
  fs.writeFileSync(target, template, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write('.doclify-guardrail.json created.\n');
  return 0;
}

async function runCli(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(topLevelHelp());
    return 0;
  }
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v')) {
    process.stdout.write(`${packageJson.version}\n`);
    return 0;
  }
  if (isV2Command(argv)) return runV2Cli(argv);
  if (argv[0] === 'explain') return runExplain(argv.slice(1));
  if (argv[0] === 'init') return runInit(argv.slice(1));
  const legacy = argv.find(isLegacyToken);
  process.stderr.write(legacy ? `legacy-option: ${migrationMessage(legacy)}\n` : 'invalid-command: Expected check, changed, explain, or init.\n');
  return 2;
}

if (isEntrypoint(process.argv[1])) {
  runCli().then((code) => { process.exitCode = code; });
}

export { runCli };
