const COMMAND_USAGE = [
  ['check', 'check [paths...]'],
  ['changed', 'changed (--base <ref> | --staged)'],
  ['explain', 'explain <rule-id>'],
  ['init', 'init --print'],
  ['init', 'init --write']
];
const COMMANDS = new Set(COMMAND_USAGE.map(([command]) => command));
const SCAN_COMMANDS = new Set(['check', 'changed']);
const FORMATS = new Set(['text', 'compact', 'json', 'sarif', 'junit']);
const SCAN_OPTIONS = [
  ['--format', ' <text|compact|json|sarif|junit>'],
  ['--output', ' <path>'],
  ['--all', '                              Show every finding in text/compact output'],
  ['--ignore-rules', ' <id,...>'],
  ['--exclude', ' <path,...>'],
  ['--config', ' <path>'],
  ['--purpose', ' <published|instructions|fragment|plan|changelog|generated>'],
  ['--site-root', ' <path>'],
  ['--external-links', ''],
  ['--link-allow-list', ' <url,...>'],
  ['--link-timeout-ms', ' <n>'],
  ['--link-concurrency', ' <n>'],
  ['--stdin-name', ' <name>                 Required with check -'],
  ['--no-color', '                         Accepted; human output is always color-free']
];
const SCAN_FLAGS = new Set([
  ...SCAN_OPTIONS.map(([flag]) => flag), '--base', '--staged', '--help', '-h'
]);
const FLAGS = new Set([
  ...SCAN_FLAGS, '--print', '--write', '--version', '-v'
]);

function isSupportedCliCommand(value) {
  return COMMANDS.has(value);
}

function isSupportedCliFlag(value) {
  return FLAGS.has(value);
}

export {
  COMMANDS,
  COMMAND_USAGE,
  FLAGS,
  FORMATS,
  SCAN_COMMANDS,
  SCAN_FLAGS,
  SCAN_OPTIONS,
  isSupportedCliCommand,
  isSupportedCliFlag
};
