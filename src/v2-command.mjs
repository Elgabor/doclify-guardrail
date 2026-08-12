import {
  FORMATS,
  SCAN_COMMANDS,
  renderCommandHelp,
  validateCliInvocation
} from './cli-contract.mjs';
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
  const legacy = argv.slice(1).find((token) => token === '--json' || isLegacyToken(token));
  if (legacy === '--json') {
    throw new DoclifyUsageError('legacy-option', 'Use --format json with the v2 command grammar.');
  }
  if (legacy) throw new DoclifyUsageError('legacy-option', migrationMessage(legacy));
  const validation = validateCliInvocation(argv);
  if (!validation.valid) throw new DoclifyUsageError(validation.code, validation.message);
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
      parsed.base = takeValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--staged') {
      parsed.staged = true;
      continue;
    }
    if (token !== '-' && token.startsWith('-')) {
      throw new DoclifyUsageError('unknown-option', `Unknown option: ${token}.`);
    }
    if (command === 'changed') {
      throw new DoclifyUsageError('unexpected-target', 'changed does not accept positional paths.');
    }
    parsed.paths.push(token);
  }

  if (command === 'check' && parsed.paths.length === 0) parsed.paths.push('.');
  return parsed;
}

function renderV2Help(command) {
  return renderCommandHelp(command);
}

function isV2Command(argv) {
  return SCAN_COMMANDS.has(argv[0]);
}

export { isV2Command, parseV2Args, renderV2Help };
