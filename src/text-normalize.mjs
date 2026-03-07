function normalizeLineEndings(content) {
  return String(content ?? '').replace(/\r\n?/g, '\n');
}

function extractFrontmatter(content) {
  const normalized = normalizeLineEndings(content);
  if (!normalized.startsWith('---\n')) return null;
  const endIdx = normalized.indexOf('\n---\n', 4);
  if (endIdx === -1) return null;
  return {
    body: normalized.slice(4, endIdx),
    startLine: 2
  };
}

function hasFrontmatter(content) {
  return extractFrontmatter(content) !== null;
}

export { normalizeLineEndings, extractFrontmatter, hasFrontmatter };
