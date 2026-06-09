function normalizeMarkdownValue(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeMarkdownText(value) {
  return normalizeMarkdownValue(value)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeMarkdownTableCell(value) {
  return escapeMarkdownText(value);
}

function markdownInlineCode(value) {
  const text = normalizeMarkdownValue(value)
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const longestBacktickRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const delimiter = '`'.repeat(longestBacktickRun + 1);
  const needsPadding = text.startsWith('`') || text.endsWith('`');
  const body = needsPadding ? ` ${text} ` : text;
  return `${delimiter}${body}${delimiter}`;
}

export { escapeMarkdownTableCell, escapeMarkdownText, markdownInlineCode };
