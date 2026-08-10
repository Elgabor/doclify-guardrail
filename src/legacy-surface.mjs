const LEGACY_TOKENS = new Set([
  '--strict', '--min-score', '--max-line-length', '--rules', '--check-links', '--allow-private-links',
  '--check-freshness', '--freshness-max-days', '--check-frontmatter', '--check-inline-html', '--fix', '--dry-run',
  '--report', '--junit', '--sarif', '--badge', '--badge-label', '--json', '--ascii', '--debug', '--list-rules',
  '--watch', '--track', '--trend', '--fail-on-regression', '--push', '--project-id', '--api-url', '--token',
  '--ai-drift', '--ai-mode', '--fail-on-drift', '--fail-on-drift-scope'
]);

const LEGACY_COMMANDS = new Set(['login', 'logout', 'whoami', 'ai']);

function isLegacyToken(token) {
  return LEGACY_TOKENS.has(token) || LEGACY_COMMANDS.has(token);
}

function migrationMessage(token) {
  return `${token} was removed in v2; see MIGRATION.md for the supported command.`;
}

export { isLegacyToken, migrationMessage };
