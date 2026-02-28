import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * Get markdown files changed in git relative to a base ref.
 * @param {object} opts
 * @param {string} [opts.base] - Base git ref (default: HEAD)
 * @param {boolean} [opts.staged] - Only staged files
 * @returns {string[]} Array of absolute file paths
 */
function getChangedMarkdownFiles(opts = {}) {
  const { base = 'HEAD', staged = false } = opts;

  let cmd;
  if (staged) {
    cmd = 'git diff --cached --name-only --diff-filter=ACMR';
  } else {
    cmd = `git diff --name-only --diff-filter=ACMR ${base}`;
  }

  let stdout;
  try {
    stdout = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    const msg = err.stderr ? err.stderr.trim() : err.message;
    throw new Error(`Git diff failed: ${msg}`);
  }

  const cwd = process.cwd();
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && /\.md$/i.test(line))
    .map(rel => path.resolve(cwd, rel));
}

export { getChangedMarkdownFiles };
