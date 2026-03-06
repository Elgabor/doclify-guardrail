import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isMarkdownPath } from './markdown-files.mjs';

const FORBIDDEN_BASE_CHARS_RX = /[;|&$><`()\n\r]/;

function assertSafeBaseRef(base) {
  if (typeof base !== 'string' || base.length === 0 || FORBIDDEN_BASE_CHARS_RX.test(base)) {
    throw new Error('Invalid --base value: contains forbidden shell metacharacters');
  }
}

/**
 * Get Markdown/MDX files changed in git relative to a base ref.
 * @param {object} opts
 * @param {string} [opts.base] - Base git ref (default: HEAD)
 * @param {boolean} [opts.staged] - Only staged files
 * @returns {string[]} Array of absolute file paths
 */
function getChangedMarkdownFiles(opts = {}) {
  const { base = 'HEAD', staged = false } = opts;

  let gitArgs;
  if (staged) {
    gitArgs = ['diff', '--cached', '--name-only', '--diff-filter=ACMR'];
  } else {
    assertSafeBaseRef(base);
    gitArgs = ['diff', '--name-only', '--diff-filter=ACMR', base];
  }

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
  return result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && isMarkdownPath(line))
    .map(rel => path.resolve(cwd, rel));
}

export { getChangedMarkdownFiles };
