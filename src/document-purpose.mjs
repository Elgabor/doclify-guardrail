import path from 'node:path';

const PURPOSES = new Set(['published', 'instructions', 'fragment', 'plan', 'changelog', 'generated']);

function configuredPurpose(value) {
  return PURPOSES.has(value) ? value : null;
}

function inferDocumentPurpose(filePath, content = '') {
  const normalized = String(filePath).split(path.sep).join('/').toLowerCase();
  const basename = path.posix.basename(normalized);
  if (/(^|\/)(generated|dist|build)\//.test(normalized) || /\.generated\.(md|mdx)$/.test(basename)
    || /<!--\s*doclify-generated\s*-->/i.test(content)) return 'generated';
  if (basename.endsWith('.mdx')) return 'fragment';
  if (/^(changelog|changes|release-notes)(\.|$)/.test(basename)) return 'changelog';
  if (/(^|\/)(plan|roadmap|todo)(?:[./_-]|$)/.test(normalized)) return 'plan';
  if (/^(agents|claude|contributing|instructions)(\.|[-_])/.test(basename)) return 'instructions';
  if (basename === 'readme.md' || basename === 'readme.mdx' || normalized.startsWith('docs/')) return 'published';
  return 'fragment';
}

function resolveDocumentPurpose(filePath, content, configPurpose) {
  return configuredPurpose(configPurpose) || inferDocumentPurpose(filePath, content);
}

function allowsRepositoryClaims(purpose) {
  return purpose !== 'generated';
}

export { PURPOSES, allowsRepositoryClaims, inferDocumentPurpose, resolveDocumentPurpose };
