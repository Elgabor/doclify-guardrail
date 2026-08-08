#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { RULE_CATALOG } from '../src/checker.mjs';
import { check } from '../src/api.mjs';
import {
  captureRepositoryState,
  compareRepositoryStates,
  createIsolatedEnvironment,
  createSandbox,
  installCleanupHandlers,
  removeSandbox
} from './test-isolation.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const CLI_PATH = path.join(REPOSITORY_ROOT, 'src', 'index.mjs');
const BASELINE_PATH = path.join(REPOSITORY_ROOT, 'bench', 'baselines', 'perf-300.json');
const DOCUMENT_COUNT = 300;
const GENERATOR_ID = 'doclify-perf-corpus-v1';
const COLD_RUNS = 3;
const WARM_RUNS = 10;

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function generateCorpus(root, options = {}) {
  const count = options.documents || DOCUMENT_COUNT;
  if (!Number.isInteger(count) || count <= 0 || count % 10 !== 0) {
    throw new Error('Performance corpus document count must be a positive multiple of 10.');
  }
  const hasher = crypto.createHash('sha256');
  for (let index = 0; index < count; index += 1) {
    const section = index % 10;
    const next = (index + 10) % count;
    const relative = path.join(`section-${String(section).padStart(2, '0')}`, `doc-${String(index).padStart(3, '0')}.md`);
    const content = [
      `# Document ${String(index).padStart(3, '0')}`,
      '',
      `Deterministic corpus entry ${String(index).padStart(3, '0')}.`,
      '',
      `[Next](doc-${String(next).padStart(3, '0')}.md)`,
      ''
    ].join('\n');
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf8');
    hasher.update(relative.split(path.sep).join('/'));
    hasher.update('\0');
    hasher.update(content);
    hasher.update('\0');
  }
  return {
    generator: GENERATOR_ID,
    seed: 1,
    documents: count,
    contentHash: `sha256:${hasher.digest('hex')}`
  };
}

function ruleSetMetadata() {
  const rules = RULE_CATALOG.map(({ id, severity, description }) => ({ id, severity, description }));
  return {
    count: rules.length,
    hash: digest(JSON.stringify(rules))
  };
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (percentileValue / 100) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function summarize(samples) {
  return {
    runs: samples.length,
    samplesMs: samples.map((value) => Number(value.toFixed(3))),
    p50Ms: Number(percentile(samples, 50).toFixed(3)),
    p95Ms: Number(percentile(samples, 95).toFixed(3))
  };
}

function filesystemType(target) {
  try {
    return fs.statfsSync(target, { bigint: true }).type.toString();
  } catch {
    return 'unknown';
  }
}

function environmentMetadata(target) {
  const cpus = os.cpus();
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const fsType = filesystemType(target);
  return {
    class: `${process.platform}-${process.arch}-node${nodeMajor}-fs${fsType}`,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    filesystemType: fsType,
    cpuModel: cpus[0]?.model || 'unknown',
    cpuCount: cpus.length,
    totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
    ci: process.env.CI === 'true'
  };
}

function validateResult(result) {
  if (result?.schemaVersion !== 3 || result?.status !== 'pass'
    || result?.complete !== true || result?.files?.length !== DOCUMENT_COUNT) {
    throw new Error('Performance corpus did not produce the expected complete 300-document result.');
  }
}

async function runWorker() {
  const workspace = process.cwd();
  const corpusRoot = path.join(workspace, 'corpus');
  const corpus = generateCorpus(corpusRoot);
  const coldSamples = [];
  let coldFingerprint = null;

  for (let run = 0; run < COLD_RUNS; run += 1) {
    const started = performance.now();
    const child = spawnSync(process.execPath, [CLI_PATH, 'check', 'corpus', '--format', 'json'], {
      cwd: workspace,
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    coldSamples.push(performance.now() - started);
    if (child.error || child.status !== 0) {
      throw new Error(`Cold performance run failed (${child.error?.code || child.status || 'UNKNOWN'}).`);
    }
    const parsed = JSON.parse(child.stdout);
    validateResult(parsed);
    const fingerprint = digest(JSON.stringify(parsed));
    if (coldFingerprint && coldFingerprint !== fingerprint) {
      throw new Error('Cold performance runs produced non-deterministic results.');
    }
    coldFingerprint = fingerprint;
  }

  validateResult(await check({ cwd: workspace, paths: ['corpus'] }));
  const warmSamples = [];
  let warmFingerprint = null;
  for (let run = 0; run < WARM_RUNS; run += 1) {
    const started = performance.now();
    const result = await check({ cwd: workspace, paths: ['corpus'] });
    warmSamples.push(performance.now() - started);
    validateResult(result);
    const fingerprint = digest(JSON.stringify(result));
    if (warmFingerprint && warmFingerprint !== fingerprint) {
      throw new Error('Warm performance runs produced non-deterministic results.');
    }
    warmFingerprint = fingerprint;
  }
  if (coldFingerprint !== warmFingerprint) {
    throw new Error('CLI and API performance runs produced different results.');
  }

  return {
    schemaVersion: 1,
    corpus,
    ruleSet: ruleSetMetadata(),
    environment: environmentMetadata(workspace),
    cold: summarize(coldSamples),
    warm: summarize(warmSamples),
    deterministic: true
  };
}

function comparePerformance(observation, baseline) {
  const failures = [];
  if (baseline?.schemaVersion !== 1) failures.push('Unsupported performance baseline schema.');
  for (const key of ['generator', 'seed', 'documents', 'contentHash']) {
    if (observation.corpus?.[key] !== baseline?.corpus?.[key]) {
      failures.push(`Corpus ${key} does not match the recorded baseline.`);
    }
  }
  if (observation.ruleSet?.count !== baseline?.ruleSet?.count
    || observation.ruleSet?.hash !== baseline?.ruleSet?.hash) {
    failures.push('Rule-set hash does not match; record a reviewed baseline for the new rule set.');
  }

  const recorded = baseline?.environments?.[observation.environment?.class];
  if (!recorded) {
    if (failures.length > 0) return { pass: false, status: 'fail', failures, limits: null };
    return {
      pass: true,
      status: 'unrecorded',
      failures: [],
      limits: null
    };
  }
  const tolerance = baseline.tolerance || {};
  const percentage = observation.environment.ci ? tolerance.ciPct : tolerance.localPct;
  const floor = Number(tolerance.absoluteFloorMs || 0);
  if (!Number.isFinite(percentage) || percentage < 0) {
    failures.push('Performance baseline tolerance is invalid.');
    return { pass: false, status: 'fail', failures, limits: null };
  }
  const limitFor = (value) => Number((value + Math.max((value * percentage) / 100, floor)).toFixed(3));
  const limits = {
    coldP95Ms: limitFor(recorded.cold.p95Ms),
    warmP95Ms: limitFor(recorded.warm.p95Ms)
  };
  if (observation.cold.p95Ms > limits.coldP95Ms) {
    failures.push(`Cold p95 ${observation.cold.p95Ms}ms exceeded ${limits.coldP95Ms}ms.`);
  }
  if (observation.warm.p95Ms > limits.warmP95Ms) {
    failures.push(`Warm p95 ${observation.warm.p95Ms}ms exceeded ${limits.warmP95Ms}ms.`);
  }
  return {
    pass: failures.length === 0,
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
    limits
  };
}

function loadBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch {
    throw new Error(`Performance baseline is missing or invalid: ${BASELINE_PATH}`);
  }
}

function measureIsolated() {
  const before = captureRepositoryState(REPOSITORY_ROOT);
  const sandbox = createSandbox();
  const disposeHandlers = installCleanupHandlers(() => removeSandbox(sandbox));
  let child;
  try {
    child = spawnSync(process.execPath, [THIS_FILE, '--worker'], {
      cwd: sandbox,
      env: createIsolatedEnvironment(sandbox),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } finally {
    disposeHandlers();
    removeSandbox(sandbox);
  }
  let after;
  try {
    after = captureRepositoryState(REPOSITORY_ROOT);
  } catch (error) {
    throw new Error(`Repository became uninspectable during the performance profile: ${error.message}`);
  }
  const repositoryComparison = compareRepositoryStates(before, after);
  if (!repositoryComparison.unchanged) {
    throw new Error('Performance profile changed repository state.');
  }
  if (child.error || child.status !== 0) {
    throw new Error(`Performance worker failed: ${child.stderr || child.error?.message || child.status}`);
  }
  return JSON.parse(child.stdout);
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv.length === 1 && !['--worker', '--measure'].includes(argv[0]))) {
    throw new Error(`Unknown option: ${argv[0]}`);
  }
  if (argv[0] === '--worker') {
    process.stdout.write(`${JSON.stringify(await runWorker())}\n`);
    return 0;
  }
  const observation = measureIsolated();
  if (argv[0] === '--measure') {
    process.stdout.write(`${JSON.stringify(observation, null, 2)}\n`);
    return 0;
  }

  const comparison = comparePerformance(observation, loadBaseline());
  if (comparison.status === 'unrecorded') {
    process.stdout.write(
      `performance: unrecorded | ${observation.environment.class} | cold p95 ${observation.cold.p95Ms}ms | warm p95 ${observation.warm.p95Ms}ms\n`
    );
    return 0;
  }
  if (!comparison.pass) {
    process.stderr.write(
      `performance: measured ${observation.environment.class} | cold p95 ${observation.cold.p95Ms}ms | warm p95 ${observation.warm.p95Ms}ms\n`
    );
    for (const failure of comparison.failures) process.stderr.write(`performance: ${failure}\n`);
    return 1;
  }
  process.stdout.write(
    `performance: pass | ${observation.environment.class} | 300 docs | cold p95 ${observation.cold.p95Ms}ms | warm p95 ${observation.warm.p95Ms}ms\n`
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`performance: ${error.message}\n`);
      process.exitCode = 1;
    }
  );
}

export {
  comparePerformance,
  generateCorpus,
  ruleSetMetadata
};
