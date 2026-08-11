import { FORMATS, SCAN_COMMANDS, SCAN_OPTIONS } from './cli-contract.mjs';
import { DoclifyUsageError } from './core.mjs';
import { isLegacyToken, migrationMessage } from './legacy-surface.mjs';

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new DoclifyUsageError('invalid-option', `Missing value for ${flag}.`);
  }
  return value;
}

function parsePositiveInteger(raw, flag) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new DoclifyUsageError('invalid-option', `${flag} must be a positive integer.`);
  }
  return value;
}

function appendList(target, raw) {
  target.push(...raw.split(',').map((value) => value.trim()).filter(Boolean));
}

/**
 * Parse only the public command grammar. Keeping this pure lets runtime adapters
 * validate an invocation without touching stdin, the filesystem, or the terminal.
 */
function parseV2Args(argv) {
  const command = argv[0];
  if (!SCAN_COMMANDS.has(command)) {
    throw new DoclifyUsageError('invalid-command', 'Expected check or changed.');
  }
  const parsed = {
    command,
    paths: [],
    format: 'text',
    output: null,
    all: false,
    help: false,
    ignoreRules: [],
    exclude: [],
    config: null,
    siteRoot: null,
    externalLinks: undefined,
    links: { allowList: [] },
    base: null,
    staged: false,
    stdinName: null,
    purpose: null
  };

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '-h' || token === '--help') {
      parsed.help = true;
      continue;
    }
    if (token === '--format') {
      const value = takeValue(argv, index, token);
      if (!FORMATS.has(value)) {
        throw new DoclifyUsageError('invalid-format', `Invalid format: ${value}.`);
      }
      parsed.format = value;
      index += 1;
      continue;
    }
    if (token === '--output') {
      parsed.output = takeValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--all') {
      parsed.all = true;
      continue;
    }
    if (token === '--no-color') continue;
    if (token === '--ignore-rules') {
      appendList(parsed.ignoreRules, takeValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === '--exclude') {
      appendList(parsed.exclude, takeValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === '--site-root') {
      parsed.siteRoot = takeValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--config') {
      parsed.config = takeValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--purpose') {
      parsed.purpose = takeValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--stdin-name') {
      if (command !== 'check') throw new DoclifyUsageError('invalid-option', '--stdin-name is only valid with check.');
      parsed.stdinName = takeValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--external-links') {
      parsed.externalLinks = true;
      continue;
    }
    if (token === '--link-allow-list') {
      appendList(parsed.links.allowList, takeValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === '--link-timeout-ms') {
      parsed.links.timeoutMs = parsePositiveInteger(takeValue(argv, index, token), token);
      index += 1;
      continue;
    }
    if (token === '--link-concurrency') {
      parsed.links.concurrency = parsePositiveInteger(takeValue(argv, index, token), token);
      index += 1;
      continue;
    }
    if (token === '--base') {
      if (command !== 'changed') throw new DoclifyUsageError('invalid-option', '--base is only valid with changed.');
      parsed.base = takeValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--staged') {
      if (command !== 'changed') throw new DoclifyUsageError('invalid-option', '--staged is only valid with changed.');
      parsed.staged = true;
      continue;
    }
    if (token === '--json') {
      throw new DoclifyUsageError('legacy-option', 'Use --format json with the v2 command grammar.');
    }
    if (isLegacyToken(token)) throw new DoclifyUsageError('legacy-option', migrationMessage(token));
    if (token !== '-' && token.startsWith('-')) {
      throw new DoclifyUsageError('unknown-option', `Unknown option: ${token}.`);
    }
    if (command === 'changed') {
      throw new DoclifyUsageError('unexpected-target', 'changed does not accept positional paths.');
    }
    parsed.paths.push(token);
  }

  if (command === 'changed' && !parsed.help) {
    const selectors = Number(parsed.base != null) + Number(parsed.staged);
    if (selectors !== 1) {
      throw new DoclifyUsageError('invalid-changed-selector', 'changed requires exactly one of --base or --staged.');
    }
  }
  if (command === 'check' && parsed.paths.includes('-')) {
    if (parsed.paths.length !== 1 || !parsed.stdinName) {
      throw new DoclifyUsageError('invalid-stdin', 'check - requires --stdin-name <workspace-relative name>.');
    }
  } else if (parsed.stdinName) {
    throw new DoclifyUsageError('invalid-stdin', '--stdin-name requires check - as its only target.');
  }
  if (command === 'check' && parsed.paths.length === 0) parsed.paths.push('.');
  return parsed;
}

function renderV2Help(command) {
  const common = SCAN_OPTIONS.map(([flag, detail]) => `  ${flag}${detail}`);
  const usage = command === 'changed'
    ? 'doclify-guardrail changed (--base <ref> | --staged) [options]'
    : 'doclify-guardrail check [paths...] [options]';
  return `${usage}\n\nOptions:\n${common.join('\n')}\n`;
}

function isV2Command(argv) {
  return SCAN_COMMANDS.has(argv[0]);
}

export { isV2Command, parseV2Args, renderV2Help };
