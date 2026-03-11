import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isMarkdownPath } from './markdown-files.mjs';

const FORBIDDEN_BASE_CHARS_RX = /[;|&$><`()\n\r]/;

function assertSafeBaseRef(base) {
  if (typeof base !== 'string' || base.length === 0 || FORBIDDEN_BASE_CHARS_RX.test(base)) {
    throw new Error('Invalid --base value: contains forbidden shell metacharacters');
  }
}

function buildGitArgs(base = 'HEAD', staged = false) {
  let gitArgs;
  if (staged) {
    gitArgs = ['diff', '--cached', '--name-status', '--find-renames', '--diff-filter=ACMR'];
  } else {
    assertSafeBaseRef(base);
    gitArgs = ['diff', '--name-status', '--find-renames', '--diff-filter=ACMR', base];
  }
  return gitArgs;
}

function parseChangedFiles(stdout, cwd) {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const status = parts[0];
      if (status.startsWith('R')) {
        const previousPath = parts[1];
        const currentPath = parts[2];
        return {
          status,
          path: path.resolve(cwd, currentPath),
          previousPath: path.resolve(cwd, previousPath)
        };
      }
      return {
        status,
        path: path.resolve(cwd, parts[1] || parts[0]),
        previousPath: null
      };
    });
}

/**
 * Get files changed in git relative to a base ref.
 * @param {object} opts
 * @param {string} [opts.base] - Base git ref (default: HEAD)
 * @param {boolean} [opts.staged] - Only staged files
 * @param {boolean} [opts.markdownOnly] - Filter to .md/.mdx files only
 * @returns {{ status: string, path: string, previousPath: string | null }[]}
 */
function getChangedFiles(opts = {}) {
  const { base = 'HEAD', staged = false, markdownOnly = false } = opts;
  const gitArgs = buildGitArgs(base, staged);

  const result = spawnSync('git', gitArgs, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (result.error) {
    throw new Error(`Git diff failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const msg = result.stderr ? result.stderr.trim() : `exit code ${result.status}`;
    throw new Error(`Git diff failed: ${msg}`);
  }

  const cwd = process.cwd();
  const changedFiles = parseChangedFiles(result.stdout, cwd);
  if (!markdownOnly) {
    return changedFiles;
  }

  return changedFiles.filter((entry) => isMarkdownPath(entry.path));
}

/**
 * Get Markdown/MDX files changed in git relative to a base ref.
 * @param {object} opts
 * @param {string} [opts.base] - Base git ref (default: HEAD)
 * @param {boolean} [opts.staged] - Only staged files
 * @returns {string[]} Array of absolute file paths
 */
function getChangedMarkdownFiles(opts = {}) {
  return getChangedFiles({ ...opts, markdownOnly: true }).map((entry) => entry.path);
}

export { getChangedFiles, getChangedMarkdownFiles };
