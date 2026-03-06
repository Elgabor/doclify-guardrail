import path from 'node:path';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx']);

function isMarkdownPath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return false;
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export { MARKDOWN_EXTENSIONS, isMarkdownPath };
