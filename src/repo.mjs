import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function runGit(args, cwd = process.cwd()) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  const value = result.stdout.trim();
  return value || null;
}

function stripGitSuffix(pathname) {
  return pathname.replace(/\.git$/i, '').replace(/\/+$/, '');
}

function canonicalizeRemoteUrl(remoteUrl) {
  if (typeof remoteUrl !== 'string' || remoteUrl.trim().length === 0) {
    return null;
  }

  const trimmed = remoteUrl.trim();
  const scpLike = trimmed.match(/^git@([^:]+):(.+)$/);
  if (scpLike) {
    return `https://${scpLike[1]}/${stripGitSuffix(scpLike[2])}`;
  }

  try {
    const parsed = new URL(trimmed);
    const pathname = stripGitSuffix(parsed.pathname || '/');
    return `https://${parsed.hostname}${pathname}`;
  } catch {
    return trimmed;
  }
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function getDoclifyHome() {
  const override = process.env.DOCLIFY_HOME;
  if (override && override.trim().length > 0) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), '.doclify');
}

function ensureDir(dirPath, mode = 0o700) {
  fs.mkdirSync(dirPath, { recursive: true, mode });
  return dirPath;
}

function findGitRoot(cwd = process.cwd()) {
  const root = runGit(['rev-parse', '--show-toplevel'], cwd);
  return root ? path.resolve(root) : null;
}

function getCanonicalRemoteUrl(cwd = process.cwd()) {
  const root = findGitRoot(cwd) || cwd;
  const remote = runGit(['config', '--get', 'remote.origin.url'], root);
  return canonicalizeRemoteUrl(remote);
}

function getCurrentBranch(opts = {}) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return branch || 'unknown';
}

function getRepoFingerprint(opts = {}) {
  const repoId = typeof opts.repoId === 'string' && opts.repoId.trim().length > 0
    ? opts.repoId.trim()
    : (typeof process.env.DOCLIFY_REPO_ID === 'string' && process.env.DOCLIFY_REPO_ID.trim().length > 0
        ? process.env.DOCLIFY_REPO_ID.trim()
        : null);

  if (repoId) {
    return repoId;
  }

  const cwd = path.resolve(opts.cwd || process.cwd());
  const root = findGitRoot(cwd) || cwd;
  const remote = getCanonicalRemoteUrl(root);
  if (remote) {
    return `git:${hashText(remote)}`;
  }

  return `cwd:${hashText(root)}`;
}

function getRepoMetadata(opts = {}) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  const root = findGitRoot(cwd) || cwd;
  const override = typeof opts.repoId === 'string' && opts.repoId.trim().length > 0
    ? opts.repoId.trim()
    : (typeof process.env.DOCLIFY_REPO_ID === 'string' && process.env.DOCLIFY_REPO_ID.trim().length > 0
        ? process.env.DOCLIFY_REPO_ID.trim()
        : null);

  if (override) {
    return {
      fingerprint: override,
      root,
      remote: null,
      source: 'override'
    };
  }

  const remote = getCanonicalRemoteUrl(root);
  if (remote) {
    return {
      fingerprint: `git:${hashText(remote)}`,
      root,
      remote,
      source: 'git-remote'
    };
  }

  return {
    fingerprint: `cwd:${hashText(root)}`,
    root,
    remote: null,
    source: 'cwd-hash'
  };
}

function createScanId() {
  return crypto.randomUUID();
}

export {
  canonicalizeRemoteUrl,
  createScanId,
  ensureDir,
  findGitRoot,
  getCurrentBranch,
  getCanonicalRemoteUrl,
  getDoclifyHome,
  getRepoFingerprint,
  getRepoMetadata
};
