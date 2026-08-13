import {
  SCAN_COMMANDS,
  parseCliInvocation,
  renderCommandHelp
} from './cli-contract.mjs';
import { DoclifyUsageError } from './core.mjs';
import { isLegacyToken, migrationMessage } from './legacy-surface.mjs';

function last(options, flag) {
  return options.get(flag)?.at(-1);
}

function list(options, flag) {
  return (options.get(flag) || [])
    .flatMap((raw) => raw.split(',').map((value) => value.trim()).filter(Boolean));
}

// Convert the shared grammar result into the options consumed by the CLI adapter.
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
  const invocation = parseCliInvocation(argv);
  if (!invocation.valid) throw new DoclifyUsageError(invocation.code, invocation.message);
  const { options } = invocation;
  const parsed = {
    command,
    paths: [...invocation.positionals],
    format: last(options, '--format') || 'text',
    output: last(options, '--output') || null,
    all: options.has('--all'),
    help: options.has('--help'),
    ignoreRules: list(options, '--ignore-rules'),
    exclude: list(options, '--exclude'),
    config: last(options, '--config') || null,
    siteRoot: last(options, '--site-root') || null,
    externalLinks: options.has('--external-links') ? true : undefined,
    links: { allowList: list(options, '--link-allow-list') },
    base: last(options, '--base') || null,
    staged: options.has('--staged'),
    stdinName: last(options, '--stdin-name') || null,
    purpose: last(options, '--purpose') || null
  };
  const timeout = last(options, '--link-timeout-ms');
  const concurrency = last(options, '--link-concurrency');
  if (timeout) parsed.links.timeoutMs = Number(timeout);
  if (concurrency) parsed.links.concurrency = Number(concurrency);
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
