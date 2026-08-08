import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SANDBOX_PREFIX = 'doclify-test-run-';
const STALE_SANDBOX_MS = 6 * 60 * 60 * 1000;

function portablePath(value) {
  return value.split(path.sep).join('/');
}

function entryKind(stat) {
  if (stat.isDirectory()) return 'directory';
  if (stat.isFile()) return 'file';
  if (stat.isSymbolicLink()) return 'symlink';
  return 'other';
}

function snapshotTree(root) {
  const resolvedRoot = path.resolve(root);
  const entries = [];
  const pending = [resolvedRoot];

  while (pending.length > 0) {
    const directory = pending.pop();
    let children;
    try {
      children = fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    } catch (error) {
      const relative = portablePath(path.relative(resolvedRoot, directory)) || '.';
      throw new Error(`Cannot inspect repository path ${JSON.stringify(relative)} (${error.code || 'UNKNOWN'}).`);
    }
    for (const child of children) {
      if (directory === resolvedRoot && child.name === '.git') continue;
      const absolute = path.join(directory, child.name);
      const relative = portablePath(path.relative(resolvedRoot, absolute));
      let stat;
      try {
        stat = fs.lstatSync(absolute, { bigint: true });
      } catch (error) {
        throw new Error(`Cannot inspect repository path ${JSON.stringify(relative)} (${error.code || 'UNKNOWN'}).`);
      }
      const kind = entryKind(stat);
      entries.push({
        path: relative,
        kind,
        mode: Number(stat.mode),
        size: stat.size.toString(),
        mtimeNs: stat.mtimeNs.toString(),
        ctimeNs: stat.ctimeNs.toString()
      });
      if (kind === 'directory') pending.push(absolute);
    }
  }

  entries.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  return { entries, fingerprint };
}

function captureGitStatus(root) {
  const result = spawnSync('git', [
    '-c',
    'core.fsmonitor=false',
    '-C',
    path.resolve(root),
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--ignored=matching'
  ], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH || '',
      LANG: 'C',
      LC_ALL: 'C',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error || result.status !== 0) {
    throw new Error('Unable to capture repository status for the test-isolation guard.');
  }
  return result.stdout;
}

function captureRepositoryState(root) {
  return {
    gitStatus: captureGitStatus(root),
    tree: snapshotTree(root)
  };
}

function describeTreeChanges(beforeEntries, afterEntries, limit = 12) {
  const before = new Map(beforeEntries.map((entry) => [entry.path, entry]));
  const after = new Map(afterEntries.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort((left, right) => left.localeCompare(right, 'en'));
  const changes = [];

  for (const entryPath of paths) {
    const previous = before.get(entryPath);
    const current = after.get(entryPath);
    if (!previous) {
      changes.push(`added ${JSON.stringify(entryPath)}`);
    } else if (!current) {
      changes.push(`removed ${JSON.stringify(entryPath)}`);
    } else {
      const structuralKeys = ['kind', 'mode', 'size'];
      const structural = structuralKeys.some((key) => previous[key] !== current[key]);
      if (structural) {
        changes.push(`size, type, or mode changed ${JSON.stringify(entryPath)}`);
      } else if (previous.mtimeNs !== current.mtimeNs || previous.ctimeNs !== current.ctimeNs) {
        changes.push(`timestamps changed ${JSON.stringify(entryPath)}`);
      }
    }
    if (changes.length >= limit) break;
  }
  return changes;
}

function compareRepositoryStates(before, after) {
  const gitStatusChanged = before.gitStatus !== after.gitStatus;
  const treeChanged = before.tree.fingerprint !== after.tree.fingerprint;
  return {
    unchanged: !gitStatusChanged && !treeChanged,
    gitStatusChanged,
    treeChanged,
    changes: treeChanged ? describeTreeChanges(before.tree.entries, after.tree.entries) : []
  };
}

function cleanupStaleSandboxes(baseDirectory = os.tmpdir(), options = {}) {
  const prefix = options.prefix || SANDBOX_PREFIX;
  const olderThanMs = options.olderThanMs ?? STALE_SANDBOX_MS;
  const now = options.now ?? Date.now();
  const removed = [];
  let entries = [];
  try {
    entries = fs.readdirSync(baseDirectory, { withFileTypes: true });
  } catch {
    return removed;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const candidate = path.join(baseDirectory, entry.name);
    let stat;
    try {
      stat = fs.lstatSync(candidate);
    } catch {
      continue;
    }
    if (now - stat.mtimeMs <= olderThanMs) continue;
    try {
      fs.rmSync(candidate, { recursive: true, force: true });
      removed.push(candidate);
    } catch {
      // Stale cleanup is best-effort; the new run gets its own unique sandbox.
    }
  }
  return removed;
}

function createSandbox(options = {}) {
  const baseDirectory = path.resolve(options.baseDirectory || os.tmpdir());
  const prefix = options.prefix || SANDBOX_PREFIX;
  cleanupStaleSandboxes(baseDirectory, { prefix });
  return fs.mkdtempSync(path.join(baseDirectory, prefix));
}

function createIsolatedEnvironment(sandbox) {
  const resolvedSandbox = path.resolve(sandbox);
  const doclifyHome = path.join(resolvedSandbox, 'doclify-home');
  const cacheHome = path.join(resolvedSandbox, 'cache-home');
  const configHome = path.join(resolvedSandbox, 'config-home');
  fs.mkdirSync(doclifyHome, { recursive: true });
  fs.mkdirSync(cacheHome, { recursive: true });
  fs.mkdirSync(configHome, { recursive: true });

  const environment = {
    PATH: process.env.PATH || '',
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    NO_COLOR: '1',
    TMPDIR: resolvedSandbox,
    TMP: resolvedSandbox,
    TEMP: resolvedSandbox,
    XDG_CACHE_HOME: cacheHome,
    XDG_CONFIG_HOME: configHome,
    DOCLIFY_HOME: doclifyHome,
    DOCLIFY_TEST_SANDBOX: resolvedSandbox,
    GIT_CONFIG_GLOBAL: path.join(configHome, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0'
  };
  if (process.env.CI === 'true') environment.CI = 'true';
  return environment;
}

function removeSandbox(sandbox) {
  fs.rmSync(path.resolve(sandbox), { recursive: true, force: true });
}

function installCleanupHandlers(cleanup) {
  let cleaned = false;
  const runCleanup = () => {
    if (cleaned) return;
    cleaned = true;
    cleanup();
  };
  const onSigint = () => {
    runCleanup();
    process.exit(130);
  };
  const onSigterm = () => {
    runCleanup();
    process.exit(143);
  };
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  process.once('exit', runCleanup);
  return () => {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    process.removeListener('exit', runCleanup);
  };
}

export {
  captureRepositoryState,
  cleanupStaleSandboxes,
  compareRepositoryStates,
  createIsolatedEnvironment,
  createSandbox,
  installCleanupHandlers,
  removeSandbox,
  snapshotTree
};
