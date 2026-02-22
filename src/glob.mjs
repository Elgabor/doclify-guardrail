import fs from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'Pods',
  '.symlinks',
  'vendor',
  'build',
  'dist',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '__pycache__',
  '.venv',
  'venv'
]);

function isIgnoredPath(filePath) {
  const parts = filePath.split(path.sep);
  return parts.some(p => IGNORED_DIRS.has(p));
}

/**
 * Find all .md files recursively in a directory.
 */
function findMarkdownFiles(dirPath) {
  const resolved = path.resolve(dirPath);
  const entries = fs.readdirSync(resolved, { recursive: true, withFileTypes: true });
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => path.join(e.parentPath || e.path, e.name))
    .filter(f => !isIgnoredPath(path.relative(resolved, f)));
}

/**
 * Minimal glob expander. Supports patterns like:
 *   "docs/*.md"       — .md files in docs/
 *   "docs/**\/*.md"   — .md files recursively under docs/
 *   "**\/*.md"        — .md files recursively from cwd
 */
function miniGlob(pattern, basePath) {
  const resolved = path.resolve(basePath || '.');
  const hasRecursive = pattern.includes('**');

  // Split pattern into directory prefix and filename pattern
  // e.g. "docs/**/*.md" → prefix="docs", filePattern="*.md"
  const parts = pattern.split('/');
  const prefixParts = [];
  let filePattern = '';
  let foundGlob = false;

  for (const part of parts) {
    if (part === '**' || part.includes('*')) {
      if (part !== '**') {
        filePattern = part;
      }
      foundGlob = true;
    } else if (!foundGlob) {
      prefixParts.push(part);
    } else {
      filePattern = part;
    }
  }

  if (!filePattern) filePattern = '*.md';

  const searchDir = prefixParts.length > 0
    ? path.resolve(resolved, prefixParts.join('/'))
    : resolved;

  if (!fs.existsSync(searchDir)) return [];

  const stat = fs.statSync(searchDir);
  if (!stat.isDirectory()) return [];

  const entries = fs.readdirSync(searchDir, { recursive: hasRecursive, withFileTypes: true });

  // Convert filePattern to regex: *.md → /^.*\.md$/
  const regexStr = '^' + filePattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*') + '$';
  const fileRx = new RegExp(regexStr);

  return entries
    .filter(e => e.isFile() && fileRx.test(e.name))
    .map(e => path.join(e.parentPath || e.path, e.name))
    .filter(f => !isIgnoredPath(path.relative(searchDir, f)));
}

/**
 * Resolve a list of file paths from CLI arguments.
 * Handles: explicit files, directories (recursive .md scan), glob patterns, --dir flag.
 */
function resolveFileList(args) {
  const targets = [...(args.files || [])];
  if (args.dir) targets.push(args.dir);

  if (targets.length === 0) {
    targets.push('.');
  }

  const result = [];
  const errors = [];

  for (const target of targets) {
    if (target.includes('*')) {
      // Glob pattern
      const matches = miniGlob(target, process.cwd());
      if (matches.length === 0) {
        errors.push(`No files matched pattern: ${target}`);
      }
      result.push(...matches);
    } else {
      const resolved = path.resolve(target);
      try {
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          const mdFiles = findMarkdownFiles(resolved);
          if (mdFiles.length === 0) {
            errors.push(`No .md files found in directory: ${target}`);
          }
          result.push(...mdFiles);
        } else if (stat.isFile()) {
          result.push(resolved);
        } else {
          errors.push(`Not a file or directory: ${target}`);
        }
      } catch {
        // File doesn't exist — will be reported as unreadable later
        result.push(resolved);
      }
    }
  }

  // Deduplicate by resolved path
  const unique = [...new Set(result)];

  if (unique.length === 0 && errors.length > 0) {
    throw new Error(errors[0]);
  }

  return unique;
}

export { resolveFileList, miniGlob, findMarkdownFiles };
