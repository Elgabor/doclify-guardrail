import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { isMarkdownPath } from './markdown-files.mjs';

const FORBIDDEN_BASE_CHARS_RX = /[;|&$><`()\n\r]/;
const NOT_A_REPOSITORY_RX = /not a git repository/i;
const UNKNOWN_REVISION_RX = /unknown revision|bad revision|ambiguous argument|invalid object name/i;

class GitSelectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GitSelectionError';
    this.code = code;
  }
}

function gitEnvironment() {
  return {
    ...process.env,
    LANG: 'C',
    LC_ALL: 'C'
  };
}

function runGit(cwd, args) {
  return spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: gitEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function assertSafeBaseRef(base) {
  if (typeof base !== 'string' || base.length === 0 || FORBIDDEN_BASE_CHARS_RX.test(base)) {
    throw new GitSelectionError('invalid-base-ref', 'Invalid --base value: contains forbidden shell metacharacters');
  }
  if (base.startsWith('-')) {
    throw new GitSelectionError('invalid-base-ref', 'Invalid --base value: must not start with "-"');
  }
}

function classifySpawnFailure(result, fallbackCode = 'git-failed') {
  if (result.error?.code === 'ENOENT') {
    return new GitSelectionError('git-unavailable', 'Git is not available.');
  }
  if (result.error) {
    return new GitSelectionError(fallbackCode, 'Git could not be executed.');
  }
  const stderr = String(result.stderr || '');
  if (NOT_A_REPOSITORY_RX.test(stderr)) {
    return new GitSelectionError('not-a-git-repository', 'The selected directory is not inside a Git repository.');
  }
  return new GitSelectionError(fallbackCode, 'Git changed-file discovery failed.');
}

function discoverGitRoot(cwd = process.cwd(), options = {}) {
  const start = path.resolve(cwd);
  const result = runGit(start, ['rev-parse', '--show-toplevel']);
  if (result.error || result.status !== 0) {
    if (options.required === false) return null;
    throw classifySpawnFailure(result);
  }

  const root = String(result.stdout || '').trim();
  if (!root) {
    if (options.required === false) return null;
    throw new GitSelectionError('git-failed', 'Git returned no repository root.');
  }
  return path.resolve(root);
}

function buildGitArgs(base = 'HEAD', staged = false) {
  if (staged) {
    return ['diff', '--no-ext-diff', '--no-textconv', '--cached', '--name-status', '--find-renames', '--diff-filter=ACMR', '-z', '--'];
  }
  assertSafeBaseRef(base);
  return ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '--find-renames', '--diff-filter=ACMR', '-z', base, '--'];
}

function resolveGitPath(root, gitPath) {
  const absolute = path.resolve(root, gitPath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new GitSelectionError('git-failed', 'Git returned a path outside the repository root.');
  }
  return absolute;
}

function parseChangedFiles(stdout, root) {
  const fields = String(stdout || '').split('\0');
  if (fields.at(-1) === '') fields.pop();
  const changed = [];

  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) {
      throw new GitSelectionError('git-failed', 'Git returned malformed changed-file output.');
    }
    if (status.startsWith('R') || status.startsWith('C')) {
      const previousPath = fields[index++];
      const currentPath = fields[index++];
      if (previousPath == null || currentPath == null) {
        throw new GitSelectionError('git-failed', 'Git returned malformed rename output.');
      }
      changed.push({
        status,
        path: resolveGitPath(root, currentPath),
        previousPath: resolveGitPath(root, previousPath)
      });
      continue;
    }

    const currentPath = fields[index++];
    if (currentPath == null) {
      throw new GitSelectionError('git-failed', 'Git returned malformed changed-file output.');
    }
    changed.push({
      status,
      path: resolveGitPath(root, currentPath),
      previousPath: null
    });
  }

  return changed;
}

function getChangedFilesFromRoot(root, opts = {}) {
  const { base = 'HEAD', staged = false, markdownOnly = false } = opts;
  const result = runGit(root, buildGitArgs(base, staged));
  if (result.error || result.status !== 0) {
    const stderr = String(result.stderr || '');
    if (!staged && UNKNOWN_REVISION_RX.test(stderr)) {
      throw new GitSelectionError('unknown-base-ref', `Unknown Git base ref: ${base}`);
    }
    throw classifySpawnFailure(result);
  }

  const changedFiles = parseChangedFiles(result.stdout, root);
  return markdownOnly
    ? changedFiles.filter((entry) => isMarkdownPath(entry.path))
    : changedFiles;
}

/**
 * Get files changed in Git relative to a base ref. Paths are absolute and
 * resolved from the repository root, even when cwd is a subdirectory.
 *
 * @param {object} [opts]
 * @param {string} [opts.base='HEAD']
 * @param {boolean} [opts.staged=false]
 * @param {boolean} [opts.markdownOnly=false]
 * @param {string} [opts.cwd=process.cwd()]
 * @returns {{ status: string, path: string, previousPath: string | null }[]}
 */
function getChangedFiles(opts = {}) {
  const base = Object.hasOwn(opts, 'base') ? opts.base : 'HEAD';
  if (opts.staged !== true) assertSafeBaseRef(base);
  const root = opts.gitRoot || discoverGitRoot(opts.cwd || process.cwd());
  return getChangedFilesFromRoot(root, opts);
}

function getChangedMarkdownFiles(opts = {}) {
  return getChangedFiles({ ...opts, markdownOnly: true }).map((entry) => entry.path);
}

export {
  GitSelectionError,
  discoverGitRoot,
  getChangedFiles,
  getChangedFilesFromRoot,
  getChangedMarkdownFiles
};
