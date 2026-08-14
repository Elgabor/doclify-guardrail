function normalizeLineEndings(content) {
  return String(content ?? '').replace(/\r\n?/g, '\n');
}

export { normalizeLineEndings };
