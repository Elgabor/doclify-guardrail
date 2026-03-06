#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isMarkdownPath } from '../src/markdown-files.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_MANIFEST = 'bench/corpus.manifest.json';
const DEFAULT_REPEAT = 1;
const DEFAULT_CACHE_ROOT = path.join('.cache', 'corpus');
const DEFAULT_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_LOCK_POLL_MS = 200;
const DEFAULT_STALE_LOCK_MS = 2 * 60 * 60 * 1000;
const ALLOWED_CATEGORIES = new Set(['small', 'medium', 'large']);

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    profile: null,
    tag: null,
    repeat: DEFAULT_REPEAT,
    out: null,
    cacheRoot: DEFAULT_CACHE_ROOT,
    lockTimeoutMs: DEFAULT_LOCK_TIMEOUT_MS,
    staleLockMs: DEFAULT_STALE_LOCK_MS
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--manifest') {
      args.manifest = argv[++i];
      continue;
    }
    if (token === '--profile') {
      args.profile = argv[++i];
      continue;
    }
    if (token === '--tag') {
      args.tag = argv[++i];
      continue;
    }
    if (token === '--repeat') {
      const parsed = Number(argv[++i]);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --repeat: ${parsed}`);
      }
      args.repeat = parsed;
      continue;
    }
    if (token === '--out') {
      args.out = argv[++i];
      continue;
    }
    if (token === '--cache-root') {
      args.cacheRoot = argv[++i];
      continue;
    }
    if (token === '--lock-timeout-ms') {
      const parsed = Number(argv[++i]);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --lock-timeout-ms: ${parsed}`);
      }
      args.lockTimeoutMs = parsed;
      continue;
    }
    if (token === '--stale-lock-ms') {
      const parsed = Number(argv[++i]);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --stale-lock-ms: ${parsed}`);
      }
      args.staleLockMs = parsed;
      continue;
    }
    throw new Error(`Unknown option: ${token}`);
  }

  if (!args.profile) throw new Error('Missing required --profile');
  if (!args.out) throw new Error('Missing required --out');
  return args;
}

function loadJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Unable to parse ${label} (${filePath}): ${err.message}`);
  }
}

function assertManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Manifest must be a JSON object');
  }
  if (manifest.schemaVersion !== 1) {
    throw new Error(`Unsupported manifest schemaVersion: ${manifest.schemaVersion}`);
  }
  if (!manifest.profiles || typeof manifest.profiles !== 'object') {
    throw new Error('Manifest must include "profiles"');
  }
  if (!Array.isArray(manifest.repos) || manifest.repos.length === 0) {
    throw new Error('Manifest must include non-empty "repos"');
  }
  for (const repo of manifest.repos) {
    if (!repo.id || !repo.url || !repo.commit) {
      throw new Error(`Repo entry missing required fields (id/url/commit): ${JSON.stringify(repo)}`);
    }
    if (!ALLOWED_CATEGORIES.has(repo.category)) {
      throw new Error(`Repo "${repo.id}" has invalid category "${repo.category}"`);
    }
    if (!Array.isArray(repo.tags)) {
      throw new Error(`Repo "${repo.id}" must define "tags" array`);
    }
    if (!Array.isArray(repo.extraArgs)) {
      throw new Error(`Repo "${repo.id}" must define "extraArgs" array`);
    }
  }
}

function selectRepos(manifest, tag) {
  if (!tag) return manifest.repos;
  return manifest.repos.filter((repo) => repo.tags.includes(tag));
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }

  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function normalizeOutputForHash(output) {
  const clone = JSON.parse(JSON.stringify(output));
  if (clone.summary) {
    delete clone.summary.elapsed;
  }
  if (clone.engine) {
    delete clone.engine;
  }
  return clone;
}

function fingerprintOutput(output) {
  const normalized = normalizeOutputForHash(output);
  return crypto.createHash('sha256').update(stableStringify(normalized)).digest('hex');
}

function percentile(values, p) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const weight = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * weight;
}

function countMarkdownFiles(rootDir) {
  let total = 0;
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && isMarkdownPath(entry.name)) {
        total += 1;
      }
    }
  }

  return total;
}

function inferCategory(markdownCount) {
  if (markdownCount <= 500) return 'small';
  if (markdownCount <= 5000) return 'medium';
  return 'large';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    cwd: options.cwd || process.cwd(),
    maxBuffer: 1024 * 1024 * 100
  });
  if (result.error) throw result.error;
  return result;
}

function runGit(args, cwd) {
  const result = runCommand('git', args, { cwd });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.stdout}`);
  }
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function readLockOwner(lockDir) {
  const ownerPath = path.join(lockDir, 'owner.json');
  if (!fs.existsSync(ownerPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function isLockStale(lockDir, staleLockMs) {
  const owner = readLockOwner(lockDir);
  if (owner && Number.isInteger(owner.pid) && owner.pid > 0) {
    return !isProcessAlive(owner.pid);
  }

  try {
    const stat = fs.statSync(lockDir);
    return (Date.now() - stat.mtimeMs) > staleLockMs;
  } catch {
    return true;
  }
}

function removeLockDir(lockDir) {
  fs.rmSync(lockDir, { recursive: true, force: true });
}

async function acquireFilesystemLock(lockDir, opts = {}) {
  const timeoutMs = Number.isInteger(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_LOCK_TIMEOUT_MS;
  const staleLockMs = Number.isInteger(opts.staleLockMs) ? opts.staleLockMs : DEFAULT_STALE_LOCK_MS;
  const startedAt = Date.now();
  const ownerToken = crypto.randomUUID();
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });

  while ((Date.now() - startedAt) <= timeoutMs) {
    try {
      fs.mkdirSync(lockDir);
      const owner = {
        pid: process.pid,
        token: ownerToken,
        createdAt: new Date().toISOString(),
        cwd: process.cwd()
      };
      fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify(owner), 'utf8');
      return { lockDir, token: ownerToken };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (isLockStale(lockDir, staleLockMs)) {
        removeLockDir(lockDir);
        continue;
      }
      await sleep(DEFAULT_LOCK_POLL_MS);
    }
  }

  throw new Error(`Timed out acquiring lock for ${lockDir} after ${timeoutMs}ms`);
}

function releaseFilesystemLock(lockHandle) {
  if (!lockHandle || !lockHandle.lockDir) return;
  const owner = readLockOwner(lockHandle.lockDir);
  if (owner?.token && owner.token !== lockHandle.token) {
    return;
  }
  removeLockDir(lockHandle.lockDir);
}

async function withFilesystemLock(lockDir, opts, fn) {
  const lockHandle = await acquireFilesystemLock(lockDir, opts);
  try {
    return await fn();
  } finally {
    releaseFilesystemLock(lockHandle);
  }
}

function ensureRepository(repo, checkoutDir) {
  if (!fs.existsSync(checkoutDir)) {
    fs.mkdirSync(path.dirname(checkoutDir), { recursive: true });
    runGit(['clone', '--no-tags', repo.url, checkoutDir], process.cwd());
    return;
  }
  if (!fs.existsSync(path.join(checkoutDir, '.git'))) {
    throw new Error(`Checkout dir exists but is not a git repository: ${checkoutDir}`);
  }
  runGit(['remote', 'set-url', 'origin', repo.url], checkoutDir);
  runGit(['fetch', '--prune', 'origin'], checkoutDir);
}

function checkoutPinnedCommit(repo, checkoutDir) {
  runGit(['fetch', '--depth', '1', 'origin', repo.commit], checkoutDir);
  runGit(['checkout', '--detach', 'FETCH_HEAD'], checkoutDir);
  runGit(['reset', '--hard', 'FETCH_HEAD'], checkoutDir);
  runGit(['clean', '-fdx'], checkoutDir);

  const rev = runCommand('git', ['rev-parse', 'HEAD'], { cwd: checkoutDir });
  const head = String(rev.stdout || '').trim();
  if (!head.startsWith(repo.commit.slice(0, 12))) {
    throw new Error(`Pinned commit mismatch for ${repo.id}: expected ${repo.commit}, got ${head}`);
  }
}

function buildAggregate(runs) {
  const crashCount = runs.filter((r) => r.crashed).length;
  const successful = runs.filter((r) => !r.crashed && r.summary);
  const fingerprints = successful.map((r) => r.fingerprint);
  const uniqueFingerprints = new Set(fingerprints);
  const scanMsSeries = successful.map((r) => Number(r.engine?.scanMs ?? r.durationMs)).filter(Number.isFinite);
  const peakMemorySeries = successful.map((r) => Number(r.engine?.peakMemoryMb ?? 0)).filter(Number.isFinite);
  const findingsSeries = successful.map((r) => {
    const s = r.summary || {};
    return Number(s.totalErrors || 0) + Number(s.totalWarnings || 0);
  }).filter(Number.isFinite);

  const remoteLinksChecked = successful.reduce((acc, r) => acc + Number(r.engine?.remoteLinksChecked || 0), 0);
  const remoteTimeouts = successful.reduce((acc, r) => acc + Number(r.engine?.remoteTimeouts || 0), 0);
  const remoteCacheHits = successful.reduce((acc, r) => acc + Number(r.engine?.remoteCacheHits || 0), 0);
  const remoteCacheMisses = successful.reduce((acc, r) => acc + Number(r.engine?.remoteCacheMisses || 0), 0);
  const timeoutRate = remoteLinksChecked > 0 ? (remoteTimeouts / remoteLinksChecked) * 100 : 0;

  return {
    runCount: runs.length,
    crashCount,
    crashRatePct: runs.length > 0 ? (crashCount / runs.length) * 100 : 0,
    deterministic: successful.length === runs.length && uniqueFingerprints.size <= 1,
    uniqueFingerprintCount: uniqueFingerprints.size,
    p95ScanMs: Number(percentile(scanMsSeries, 95).toFixed(3)),
    peakMemoryMb: Number(percentile(peakMemorySeries, 95).toFixed(3)),
    findingsCount: Number(percentile(findingsSeries, 50).toFixed(3)),
    remoteLinksChecked,
    remoteTimeouts,
    remoteCacheHits,
    remoteCacheMisses,
    timeoutRate: Number(timeoutRate.toFixed(4))
  };
}

function runDoclify(cliPath, targetPath, cliArgs) {
  const startedAt = new Date().toISOString();
  const t0 = process.hrtime.bigint();
  const proc = runCommand(process.execPath, [cliPath, targetPath, ...cliArgs], { cwd: process.cwd() });
  const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;

  let output = null;
  let parseError = null;
  if (proc.stdout && proc.stdout.trim().length > 0) {
    try {
      output = JSON.parse(proc.stdout);
    } catch (err) {
      parseError = err.message;
    }
  }

  const exitCode = typeof proc.status === 'number' ? proc.status : 1;
  const crashed = exitCode > 1 || Boolean(proc.error) || Boolean(parseError) || !output;
  const fingerprint = output ? fingerprintOutput(output) : null;
  const summary = output?.summary || null;
  const engine = output?.engine || null;

  return {
    startedAt,
    durationMs: Number(durationMs.toFixed(3)),
    exitCode,
    signal: proc.signal || null,
    crashed,
    qualityFailed: exitCode === 1,
    parseError,
    fingerprint,
    stderr: proc.stderr ? proc.stderr.slice(0, 2000) : '',
    summary,
    engine
  };
}

async function runCorpus(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const manifestPath = path.resolve(args.manifest);
  const outPath = path.resolve(args.out);
  const cliPath = path.resolve('src/index.mjs');

  if (!fs.existsSync(cliPath)) {
    throw new Error(`Cannot find doclify CLI entrypoint: ${cliPath}`);
  }

  const manifest = loadJson(manifestPath, 'manifest');
  assertManifest(manifest);
  const profile = manifest.profiles[args.profile];
  if (!profile) throw new Error(`Profile "${args.profile}" not found in manifest`);
  if (!Array.isArray(profile.args) || profile.args.length === 0) {
    throw new Error(`Profile "${args.profile}" must define non-empty args[]`);
  }

  const selectedRepos = selectRepos(manifest, args.tag);
  if (selectedRepos.length === 0) {
    throw new Error(`No repositories selected for tag "${args.tag}"`);
  }

  const cacheRoot = path.resolve(args.cacheRoot);
  const repoResults = [];

  for (const repo of selectedRepos) {
    const checkoutDir = path.join(cacheRoot, repo.id);
    const lockDir = `${checkoutDir}.lock`;
    const repoResult = await withFilesystemLock(lockDir, {
      timeoutMs: args.lockTimeoutMs,
      staleLockMs: args.staleLockMs
    }, async () => {
      ensureRepository(repo, checkoutDir);
      checkoutPinnedCommit(repo, checkoutDir);

      const scanRoot = path.resolve(checkoutDir, repo.scanPath || '.');
      if (!fs.existsSync(scanRoot)) {
        throw new Error(`scanPath "${repo.scanPath}" does not exist for repo "${repo.id}"`);
      }

      const markdownCount = countMarkdownFiles(scanRoot);
      const inferredCategory = inferCategory(markdownCount);
      if (inferredCategory !== repo.category) {
        throw new Error(
          `Category mismatch for "${repo.id}": manifest="${repo.category}", inferred="${inferredCategory}" (markdown files: ${markdownCount})`
        );
      }

      const runs = [];
      for (let n = 1; n <= args.repeat; n += 1) {
        checkoutPinnedCommit(repo, checkoutDir);
        const mergedArgs = [...profile.args, ...repo.extraArgs];
        runs.push({
          run: n,
          ...runDoclify(cliPath, scanRoot, mergedArgs)
        });
      }

      return {
        id: repo.id,
        url: repo.url,
        commit: repo.commit,
        category: repo.category,
        inferredCategory,
        markdownCount,
        scanPath: repo.scanPath,
        tags: repo.tags,
        runs,
        aggregate: buildAggregate(runs)
      };
    });

    repoResults.push(repoResult);
  }

  const totalRuns = repoResults.reduce((sum, repo) => sum + repo.aggregate.runCount, 0);
  const totalCrashes = repoResults.reduce((sum, repo) => sum + repo.aggregate.crashCount, 0);
  const deterministicRepoCount = repoResults.filter((repo) => repo.aggregate.deterministic).length;
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    manifestPath: path.relative(process.cwd(), manifestPath),
    profile: args.profile,
    tag: args.tag,
    repeat: args.repeat,
    repos: repoResults,
    summary: {
      repoCount: repoResults.length,
      runCount: totalRuns,
      crashCount: totalCrashes,
      crashRatePct: totalRuns > 0 ? Number(((totalCrashes / totalRuns) * 100).toFixed(4)) : 0,
      deterministicRepoCount,
      determinismRatePct: repoResults.length > 0
        ? Number(((deterministicRepoCount / repoResults.length) * 100).toFixed(4))
        : 0
    }
  };

  ensureParentDir(outPath);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

  const hasCrashes = totalCrashes > 0;
  return hasCrashes ? 1 : 0;
}

const THIS_FILE = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
  runCorpus().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`run-corpus error: ${err.message}`);
      process.exit(2);
    }
  );
}

export {
  parseArgs,
  loadJson,
  assertManifest,
  selectRepos,
  normalizeOutputForHash,
  fingerprintOutput,
  countMarkdownFiles,
  inferCategory,
  percentile,
  acquireFilesystemLock,
  releaseFilesystemLock,
  withFilesystemLock,
  runCorpus
};
