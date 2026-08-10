import fs from 'node:fs';
import path from 'node:path';

import { DoclifyUsageError, runCheck } from './core.mjs';
import { isLegacyToken, migrationMessage } from './legacy-surface.mjs';
import { renderResult, terminalText } from './result-renderers.mjs';
import { resolveWorkspacePath } from './workspace-path.mjs';

const COMMANDS = new Set(['check', 'changed']);
const FORMATS = new Set(['text', 'compact', 'json', 'sarif', 'junit']);
const MAX_STDIN_BYTES = 4 * 1024 * 1024;

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

function parseV2Args(argv) {
  const command = argv[0];
  if (!COMMANDS.has(command)) {
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
    if (token === '--no-color') {
      continue;
    }
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
      if (command !== 'changed') {
        throw new DoclifyUsageError('invalid-option', '--base is only valid with changed.');
      }
      parsed.base = takeValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--staged') {
      if (command !== 'changed') {
        throw new DoclifyUsageError('invalid-option', '--staged is only valid with changed.');
      }
      parsed.staged = true;
      continue;
    }
    if (token === '--json') {
      throw new DoclifyUsageError('legacy-option', 'Use --format json with the v2 command grammar.');
    }
    if (isLegacyToken(token)) {
      throw new DoclifyUsageError('legacy-option', migrationMessage(token));
    }
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
  const common = [
    '  --format <text|compact|json|sarif|junit>',
    '  --output <path>',
    '  --all                              Show every finding in text/compact output',
    '  --ignore-rules <id,...>',
    '  --exclude <path,...>',
    '  --config <path>',
    '  --purpose <published|instructions|fragment|plan|changelog|generated>',
    '  --site-root <path>',
    '  --external-links',
    '  --link-allow-list <url,...>',
    '  --link-timeout-ms <n>',
    '  --link-concurrency <n>',
    '  --stdin-name <name>                 Required with check -',
    '  --no-color                         Accepted; human output is always color-free'
  ];
  const usage = command === 'changed'
    ? 'doclify-guardrail changed (--base <ref> | --staged) [options]'
    : 'doclify-guardrail check [paths...] [options]';
  return `${usage}\n\nOptions:\n${common.join('\n')}\n`;
}

function safeDiagnostic(error) {
  const code = error?.code || 'internal-error';
  const message = error instanceof DoclifyUsageError
    ? error.message
    : 'The command could not complete.';
  return `${terminalText(code)}: ${terminalText(message)}\n`;
}

function writeOperationalDiagnostics(result) {
  for (const diagnostic of result.diagnostics) {
    process.stderr.write(`${terminalText(diagnostic.path)}: error [${terminalText(diagnostic.code)}] ${terminalText(diagnostic.message)}\n`);
  }
}

function assertOutputDoesNotOverwriteInput(outputPath, result, workspace) {
  const canonical = (candidate) => {
    try {
      return fs.realpathSync(candidate);
    } catch {
      return path.resolve(candidate);
    }
  };
  const canonicalOutput = canonical(outputPath);
  let outputIdentity = null;
  try {
    const outputStat = fs.statSync(outputPath, { bigint: true });
    outputIdentity = `${outputStat.dev}:${outputStat.ino}`;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const file of result.files) {
    const inputPath = path.resolve(workspace, file.path);
    const canonicalInput = canonical(inputPath);
    let inputIdentity = null;
    try {
      const inputStat = fs.statSync(inputPath, { bigint: true });
      inputIdentity = `${inputStat.dev}:${inputStat.ino}`;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (canonicalOutput === canonicalInput || (outputIdentity != null && outputIdentity === inputIdentity)) {
      throw new DoclifyUsageError('output-overwrites-input', 'Output path must not overwrite a scanned document.');
    }
  }
}

async function runV2Cli(argv) {
  let parsed;
  try {
    parsed = parseV2Args(argv);
    if (parsed.help) {
      process.stdout.write(renderV2Help(parsed.command));
      return 0;
    }

    const checkOptions = {
      command: parsed.command,
      cwd: process.cwd(),
      ignoreRules: parsed.ignoreRules,
      exclude: parsed.exclude,
      links: parsed.links
    };
    if (parsed.command === 'changed') {
      checkOptions.changed = parsed.staged ? { staged: true } : { base: parsed.base };
    } else {
      checkOptions.paths = parsed.paths;
    }
    if (parsed.config != null) checkOptions.config = parsed.config;
    if (parsed.purpose != null) checkOptions.purpose = parsed.purpose;
    if (parsed.siteRoot != null) checkOptions.siteRoot = parsed.siteRoot;
    if (parsed.externalLinks === true) checkOptions.externalLinks = true;
    if (parsed.stdinName != null) {
      const chunks = [];
      let size = 0;
      for await (const chunk of process.stdin) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_STDIN_BYTES) {
          throw new DoclifyUsageError('stdin-too-large', `stdin exceeds the ${MAX_STDIN_BYTES}-byte limit.`);
        }
        chunks.push(buffer);
      }
      checkOptions.stdin = { content: Buffer.concat(chunks).toString('utf8'), name: parsed.stdinName };
    }

    const { result, workspace } = await runCheck(checkOptions);
    const rendered = renderResult(result, { format: parsed.format, all: parsed.all });

    if (parsed.output) {
      let outputPath;
      try {
        outputPath = resolveWorkspacePath(path.resolve(process.cwd(), parsed.output), {
          workspace,
          label: 'Output path'
        });
      } catch {
        throw new DoclifyUsageError('output-outside-workspace', 'Output path must stay inside the workspace.');
      }
      assertOutputDoesNotOverwriteInput(outputPath, result, workspace);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, rendered, 'utf8');
    } else {
      process.stdout.write(rendered);
    }
    writeOperationalDiagnostics(result);
    return result.status === 'pass' ? 0 : 1;
  } catch (error) {
    process.stderr.write(safeDiagnostic(error));
    return 2;
  }
}

function isV2Command(argv) {
  return COMMANDS.has(argv[0]);
}

export {
  isV2Command,
  runV2Cli
};
