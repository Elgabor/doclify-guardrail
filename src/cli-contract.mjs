const COMMANDS = new Set(['check', 'changed', 'explain', 'init']);
const FLAGS = new Set([
  '--format', '--output', '--all', '--ignore-rules', '--exclude', '--config', '--purpose',
  '--site-root', '--external-links', '--link-allow-list', '--link-timeout-ms', '--link-concurrency',
  '--stdin-name', '--base', '--staged', '--print', '--write', '--no-color', '--help', '-h', '--version', '-v'
]);

function isSupportedCliCommand(value) {
  return COMMANDS.has(value);
}

function isSupportedCliFlag(value) {
  return FLAGS.has(value);
}

export { COMMANDS, FLAGS, isSupportedCliCommand, isSupportedCliFlag };
