const FORMATS = new Set(['text', 'compact', 'json', 'sarif', 'junit']);
const PURPOSES = new Set(['published', 'instructions', 'fragment', 'plan', 'changelog', 'generated']);

const HELP_OPTION = ['--help', '', { aliases: ['-h'] }];
const COMMON_SCAN_OPTIONS = [
  ['--format', ' <text|compact|json|sarif|junit>', { values: FORMATS }],
  ['--output', ' <path>', { value: true }],
  ['--all', '                              Show every finding in text/compact output'],
  ['--ignore-rules', ' <id,...>', { value: true }],
  ['--exclude', ' <path,...>', { value: true }],
  ['--config', ' <path>', { value: true }],
  ['--purpose', ' <published|instructions|fragment|plan|changelog|generated>', { values: PURPOSES }],
  ['--site-root', ' <path>', { value: true }],
  ['--external-links', ''],
  ['--link-allow-list', ' <url,...>', { value: true }],
  ['--link-timeout-ms', ' <n>', { positiveInteger: true }],
  ['--link-concurrency', ' <n>', { positiveInteger: true }],
  ['--no-color', '                         Accepted; human output is always color-free']
];

function optionMap(options) {
  const result = new Map();
  for (const [flag, , settings = {}] of options) {
    const option = {
      flag,
      takesValue: settings.value === true || settings.values instanceof Set || settings.positiveInteger === true,
      values: settings.values,
      positiveInteger: settings.positiveInteger === true
    };
    result.set(flag, option);
    for (const alias of settings.aliases || []) result.set(alias, option);
  }
  return result;
}

function defineCommand(definition) {
  return { ...definition, optionMap: optionMap(definition.options) };
}

const COMMAND_DEFINITIONS = new Map([
  ['check', defineCommand({
    usage: ['check [paths...]'],
    options: [
      ...COMMON_SCAN_OPTIONS,
      ['--stdin-name', ' <name>                 Required with check -', { value: true }],
      HELP_OPTION
    ],
    positionals: { maximum: Infinity }
  })],
  ['changed', defineCommand({
    usage: ['changed (--base <ref> | --staged)'],
    options: [
      ...COMMON_SCAN_OPTIONS,
      ['--base', ' <ref>', { value: true }],
      ['--staged', ''],
      HELP_OPTION
    ],
    positionals: { maximum: 0 },
    exactlyOne: ['--base', '--staged']
  })],
  ['explain', defineCommand({
    usage: ['explain <rule-id>'],
    options: [HELP_OPTION],
    positionals: { minimum: 1, maximum: 1 }
  })],
  ['init', defineCommand({
    usage: ['init --print', 'init --write'],
    options: [
      ['--print', ''],
      ['--write', ''],
      HELP_OPTION
    ],
    positionals: { maximum: 0 },
    exactlyOne: ['--print', '--write']
  })]
]);

const COMMAND_USAGE = [...COMMAND_DEFINITIONS.entries()]
  .flatMap(([command, definition]) => definition.usage.map((usage) => [command, usage]));
const COMMANDS = new Set(COMMAND_DEFINITIONS.keys());
const SCAN_COMMANDS = new Set(['check', 'changed']);
const SCAN_FLAGS = new Set([...SCAN_COMMANDS]
  .flatMap((command) => [...COMMAND_DEFINITIONS.get(command).optionMap.keys()]));
const FLAGS = new Set([
  ...[...COMMAND_DEFINITIONS.values()].flatMap((definition) => [...definition.optionMap.keys()]),
  '--version', '-v'
]);

function invalid(code, message) {
  return { valid: false, code, message };
}

function parseCliInvocation(argv) {
  const command = argv[0];
  if (['--help', '-h'].includes(command)) {
    return { valid: true, command, positionals: [], options: new Map() };
  }
  if (argv.length === 1 && ['--version', '-v'].includes(command)) {
    return { valid: true, command, positionals: [], options: new Map() };
  }
  const definition = COMMAND_DEFINITIONS.get(command);
  if (!definition) return invalid('invalid-command', `Unknown Doclify Guardrail command: ${command || '<missing>'}.`);

  const options = new Map();
  const positionals = [];
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '-' && command === 'check') {
      positionals.push(token);
      continue;
    }
    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }
    const option = definition.optionMap.get(token);
    if (!option) {
      return FLAGS.has(token)
        ? invalid('invalid-option', `${token} is not valid with ${command}.`)
        : invalid('unknown-option', `Unknown option: ${token}.`);
    }
    let value = true;
    if (option.takesValue) {
      value = argv[index + 1];
      if (!value || value.startsWith('-')) return invalid('invalid-option', `Missing value for ${token}.`);
      if (option.values && !option.values.has(value)) {
        return invalid(option.flag === '--format' ? 'invalid-format' : 'invalid-option', `Invalid value for ${token}: ${value}.`);
      }
      if (option.positiveInteger && (!Number.isInteger(Number(value)) || Number(value) <= 0)) {
        return invalid('invalid-option', `${token} must be a positive integer.`);
      }
      index += 1;
    }
    const values = options.get(option.flag) || [];
    values.push(value);
    options.set(option.flag, values);
  }

  const help = options.has('--help');
  const minimum = definition.positionals.minimum || 0;
  const maximum = definition.positionals.maximum;
  if (positionals.length < minimum && !help) return invalid(`invalid-${command}`, `${command} requires a positional argument.`);
  if (positionals.length > maximum) {
    return invalid(command === 'changed' ? 'unexpected-target' : `invalid-${command}`, `${command} accepts at most ${maximum} positional argument(s).`);
  }
  if (definition.exactlyOne && !help) {
    const count = definition.exactlyOne.filter((flag) => options.has(flag)).length;
    if (count !== 1) {
      return invalid(command === 'changed' ? 'invalid-changed-selector' : `invalid-${command}`, `${command} requires exactly one of ${definition.exactlyOne.join(' or ')}.`);
    }
  }
  if (command === 'check') {
    const stdin = positionals.includes('-');
    const stdinName = options.has('--stdin-name');
    if ((stdin && (positionals.length !== 1 || !stdinName)) || (!stdin && stdinName)) {
      return invalid('invalid-stdin', 'check - and --stdin-name must be used together as the only target.');
    }
  }
  return { valid: true, command, positionals, options };
}

function renderCommandHelp(command) {
  const definition = COMMAND_DEFINITIONS.get(command);
  if (!definition) return '';
  const usage = definition.usage
    .map((value) => `doclify-guardrail ${value}${SCAN_COMMANDS.has(command) ? ' [options]' : ''}`)
    .join('\n');
  const options = definition.options.map(([flag, detail]) => `  ${flag}${detail}`);
  return `${usage}\n\nOptions:\n${options.join('\n')}\n`;
}

export {
  COMMANDS,
  COMMAND_USAGE,
  FLAGS,
  SCAN_COMMANDS,
  SCAN_FLAGS,
  parseCliInvocation,
  renderCommandHelp
};
