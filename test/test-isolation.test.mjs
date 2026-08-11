import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runTestProfile } from '../scripts/check-test-isolation.mjs';
import { comparePerformance, generateCorpus, ruleSetMetadata } from '../scripts/perf-corpus.mjs';
import { DEFAULT_RULE_CATALOG } from '../src/rule-catalog.mjs';
import {
  captureRepositoryState,
  cleanupStaleSandboxes,
  compareRepositoryStates,
  createIsolatedEnvironment,
  snapshotTree
} from '../scripts/test-isolation.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ISOLATION_MODULE = path.resolve(TEST_DIRECTORY, '..', 'scripts', 'test-isolation.mjs');
const PERFORMANCE_SCRIPT = path.resolve(TEST_DIRECTORY, '..', 'scripts', 'perf-corpus.mjs');

function makeTempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-isolation-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function initRepository(t) {
  const root = makeTempDir(t);
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  return root;
}

test('correctness profile runs inside one isolated temp and Doclify home', () => {
  const sandbox = process.env.DOCLIFY_TEST_SANDBOX;
  assert.ok(sandbox, 'tests must run through the isolation profile');
  assert.equal(path.resolve(os.tmpdir()), path.resolve(sandbox));
  assert.equal(path.relative(sandbox, process.env.DOCLIFY_HOME).startsWith('..'), false);
  assert.equal(Object.hasOwn(process.env, 'DOCLIFY_TOKEN'), false);
  assert.equal(Object.hasOwn(process.env, 'DOCLIFY_API_KEY'), false);
});

test('repository guard detects writes inside ignored nested Git directories', (t) => {
  const root = initRepository(t);
  fs.writeFileSync(path.join(root, '.gitignore'), '.cache/\n', 'utf8');
  fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
  fs.writeFileSync(path.join(root, '.cache', 'keep'), 'stable\n', 'utf8');
  const before = captureRepositoryState(root);

  const objectDirectory = path.join(root, '.cache', 'corpus', 'fixture', '.git', 'objects');
  fs.mkdirSync(objectDirectory, { recursive: true });
  fs.writeFileSync(path.join(objectDirectory, 'object'), 'new\n', 'utf8');
  const after = captureRepositoryState(root);
  const comparison = compareRepositoryStates(before, after);

  assert.equal(before.gitStatus, after.gitStatus);
  assert.equal(comparison.unchanged, false);
  assert.equal(comparison.treeChanged, true);
  assert.equal(comparison.changes.some((change) => change.includes('.git/objects')), true);
});

test('correctness runner fails when a test writes into its repository', async (t) => {
  const root = initRepository(t);
  const leakedFile = path.join(root, 'leaked.txt');
  const leakingTest = path.join(root, 'leaking.test.mjs');
  fs.writeFileSync(leakingTest, [
    "import fs from 'node:fs';",
    "import test from 'node:test';",
    `test('leak', () => fs.writeFileSync(${JSON.stringify(leakedFile)}, 'leak\\n'));`
  ].join('\n'), 'utf8');
  const messages = [];
  const output = {
    stdout: { write: (message) => messages.push(message) },
    stderr: { write: (message) => messages.push(message) }
  };

  const code = await runTestProfile({
    repositoryRoot: root,
    files: [leakingTest],
    output,
    stdio: 'ignore'
  });

  assert.equal(code, 1);
  assert.equal(fs.existsSync(leakedFile), true);
  assert.match(messages.join(''), /repository state changed/);
});

test('correctness runner reports a repository made uninspectable by a test', async (t) => {
  if (typeof process.getuid !== 'function' || process.getuid() === 0 || process.platform === 'win32') {
    t.skip('requires Unix ownership permissions');
    return;
  }
  const root = initRepository(t);
  const lockedDirectory = path.join(root, 'locked');
  const leakingTest = path.join(root, 'locking.test.mjs');
  fs.writeFileSync(leakingTest, [
    "import fs from 'node:fs';",
    "import test from 'node:test';",
    `test('lock', () => { fs.mkdirSync(${JSON.stringify(lockedDirectory)}); fs.chmodSync(${JSON.stringify(lockedDirectory)}, 0); });`
  ].join('\n'), 'utf8');

  try {
    await assert.rejects(
      runTestProfile({
        repositoryRoot: root,
        files: [leakingTest],
        stdio: 'ignore'
      }),
      /Repository became uninspectable during the test run: Cannot inspect repository path "locked" \(EACCES\)/
    );
  } finally {
    if (fs.existsSync(lockedDirectory)) fs.chmodSync(lockedDirectory, 0o700);
  }
});

test('repository guard distinguishes metadata-only changes', (t) => {
  const root = makeTempDir(t);
  const file = path.join(root, 'ignored.log');
  fs.writeFileSync(file, 'stable\n', 'utf8');
  const before = snapshotTree(root);
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(file, future, future);
  const after = snapshotTree(root);
  const comparison = compareRepositoryStates(
    { gitStatus: '', tree: before },
    { gitStatus: '', tree: after }
  );
  assert.equal(comparison.unchanged, false);
  assert.match(comparison.changes[0], /^timestamps changed/);
});

test('isolated environment replaces personal Doclify and temp configuration', (t) => {
  const sandbox = makeTempDir(t);
  const environment = createIsolatedEnvironment(sandbox);
  assert.equal(environment.TMPDIR, sandbox);
  assert.equal(path.relative(sandbox, environment.DOCLIFY_HOME).startsWith('..'), false);
  for (const name of [
    'HOME',
    'DOCLIFY_TOKEN',
    'DOCLIFY_API_KEY',
    'DOCLIFY_API_URL',
    'DOCLIFY_PROJECT_ID',
    'DOCLIFY_REPO_ID',
    'NODE_AUTH_TOKEN',
    'NPM_TOKEN'
  ]) {
    assert.equal(Object.hasOwn(environment, name), false, `${name} must not be inherited`);
  }
});

test('stale sandbox cleanup removes only old matching directories', (t) => {
  const root = makeTempDir(t);
  const oldDirectory = path.join(root, 'case-old');
  const recentDirectory = path.join(root, 'case-recent');
  const unrelated = path.join(root, 'other-old');
  fs.mkdirSync(oldDirectory);
  fs.mkdirSync(recentDirectory);
  fs.mkdirSync(unrelated);
  const now = Date.now();
  fs.utimesSync(oldDirectory, new Date(now - 20_000), new Date(now - 20_000));
  fs.utimesSync(unrelated, new Date(now - 20_000), new Date(now - 20_000));

  const removed = cleanupStaleSandboxes(root, { prefix: 'case-', olderThanMs: 10_000, now });
  assert.deepEqual(removed, [oldDirectory]);
  assert.equal(fs.existsSync(oldDirectory), false);
  assert.equal(fs.existsSync(recentDirectory), true);
  assert.equal(fs.existsSync(unrelated), true);
});

for (const [signal, expectedCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`cleanup handler removes its sandbox on ${signal}`, async (t) => {
    const root = makeTempDir(t);
    const sandbox = path.join(root, 'signal-sandbox');
    fs.mkdirSync(sandbox);
    const moduleUrl = pathToFileURL(ISOLATION_MODULE).href;
    const source = [
      `import { installCleanupHandlers, removeSandbox } from ${JSON.stringify(moduleUrl)};`,
      'const sandbox = process.env.DOCLIFY_SIGNAL_SANDBOX;',
      'installCleanupHandlers(() => removeSandbox(sandbox));',
      "process.stdout.write('ready\\n');",
      'setInterval(() => {}, 1000);'
    ].join('\n');
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      env: {
        PATH: process.env.PATH || '',
        DOCLIFY_SIGNAL_SANDBOX: sandbox
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(() => {
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('cleanup child did not become ready')), 3000);
      child.stdout.once('data', () => {
        clearTimeout(timeout);
        resolve();
      });
      child.once('error', reject);
    });
    child.kill(signal);
    const exit = await new Promise((resolve) => child.once('exit', (code, exitSignal) => resolve({ code, signal: exitSignal })));
    assert.deepEqual(exit, { code: expectedCode, signal: null });
    assert.equal(fs.existsSync(sandbox), false);
  });
}

test('performance corpus is deterministic and comparison enforces rule hash and tolerance', (t) => {
  const firstRoot = makeTempDir(t);
  const secondRoot = makeTempDir(t);
  const first = generateCorpus(firstRoot, { documents: 20 });
  const second = generateCorpus(secondRoot, { documents: 20 });
  assert.deepEqual(first, second);
  assert.throws(
    () => generateCorpus(firstRoot, { documents: 11 }),
    /positive multiple of 10/
  );

  const ruleSet = ruleSetMetadata();
  const ruleMetadata = DEFAULT_RULE_CATALOG.map((rule) => ({
    id: rule.id,
    severity: rule.severity,
    purpose: rule.purpose,
    evidence: rule.evidence,
    remediation: rule.remediation
  }));
  const expectedRuleHash = `sha256:${crypto.createHash('sha256')
    .update(JSON.stringify(ruleMetadata)).digest('hex')}`;
  assert.deepEqual(ruleSet, { count: ruleMetadata.length, hash: expectedRuleHash });
  const observation = {
    corpus: first,
    ruleSet,
    environment: { class: 'fixture', ci: false },
    cold: { p95Ms: 120 },
    warm: { p95Ms: 80 }
  };
  const baseline = {
    schemaVersion: 1,
    corpus: first,
    ruleSet,
    environments: {
      fixture: {
        cold: { p95Ms: 100 },
        warm: { p95Ms: 70 }
      }
    },
    tolerance: { localPct: 10, ciPct: 100, absoluteFloorMs: 25 }
  };
  assert.equal(comparePerformance(observation, baseline).pass, true);

  const ciObservation = structuredClone(observation);
  ciObservation.environment.ci = true;
  ciObservation.cold.p95Ms = 180;
  ciObservation.warm.p95Ms = 120;
  assert.equal(comparePerformance(ciObservation, baseline).pass, true);
  ciObservation.environment.ci = false;
  assert.equal(comparePerformance(ciObservation, baseline).pass, false);

  const unrecorded = structuredClone(observation);
  unrecorded.environment.class = 'unrecorded-environment';
  assert.deepEqual(comparePerformance(unrecorded, baseline), {
    pass: true,
    status: 'unrecorded',
    failures: [],
    limits: null
  });

  const slow = structuredClone(observation);
  slow.warm.p95Ms = 200;
  assert.equal(comparePerformance(slow, baseline).pass, false);

  const changedRules = structuredClone(observation);
  changedRules.ruleSet.hash = 'sha256:different';
  assert.equal(comparePerformance(changedRules, baseline).pass, false);

  for (const mutate of [
    (candidate) => { candidate.tolerance.absoluteFloorMs = 'not-a-number'; },
    (candidate) => { candidate.environments.fixture.cold.p95Ms = Number.NaN; },
    (candidate) => { candidate.environments.fixture.warm.p95Ms = -1; }
  ]) {
    const malformed = structuredClone(baseline);
    mutate(malformed);
    assert.deepEqual(comparePerformance(observation, malformed), {
      pass: false,
      status: 'fail',
      failures: ['Performance baseline tolerance is invalid.'],
      limits: null
    });
  }
});

test('performance profile rejects unknown options before creating a corpus', (t) => {
  const root = makeTempDir(t);
  const result = spawnSync(process.execPath, [PERFORMANCE_SCRIPT, '--bogus'], {
    cwd: root,
    env: process.env,
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option: --bogus/);
  assert.equal(fs.existsSync(path.join(root, 'corpus')), false);
});
