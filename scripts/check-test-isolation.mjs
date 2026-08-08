#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  captureRepositoryState,
  compareRepositoryStates,
  createIsolatedEnvironment,
  createSandbox,
  installCleanupHandlers,
  removeSandbox
} from './test-isolation.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '..');
const THIS_FILE = fileURLToPath(import.meta.url);

function testFiles(repositoryRoot = REPOSITORY_ROOT) {
  const directory = path.join(repositoryRoot, 'test');
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.test.mjs'))
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((name) => path.join(directory, name));
}

function waitForChild(child) {
  return new Promise((resolve) => {
    child.once('error', (error) => resolve({ error, status: 1, signal: null }));
    child.once('exit', (status, signal) => resolve({ error: null, status: status ?? 1, signal }));
  });
}

async function runTestProfile(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  const files = options.files || testFiles(repositoryRoot);
  const output = options.output || { stdout: process.stdout, stderr: process.stderr };
  const before = captureRepositoryState(repositoryRoot);
  const sandbox = createSandbox();
  let child = null;
  const cleanup = () => {
    if (child && child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
    removeSandbox(sandbox);
  };
  const disposeHandlers = installCleanupHandlers(cleanup);
  let outcome;

  try {
    const environment = createIsolatedEnvironment(sandbox);
    child = spawn(process.execPath, ['--test', ...files], {
      cwd: sandbox,
      env: environment,
      stdio: options.stdio || 'inherit'
    });
    outcome = await waitForChild(child);
  } finally {
    disposeHandlers();
    removeSandbox(sandbox);
  }

  let after;
  try {
    after = captureRepositoryState(repositoryRoot);
  } catch (error) {
    throw new Error(`Repository became uninspectable during the test run: ${error.message}`);
  }
  const comparison = compareRepositoryStates(before, after);
  if (!comparison.unchanged) {
    output.stderr.write('test-isolation: repository state changed during the test run.\n');
    if (comparison.gitStatusChanged) output.stderr.write('test-isolation: git status changed.\n');
    for (const change of comparison.changes) output.stderr.write(`test-isolation: ${change}.\n`);
    return 1;
  }
  if (outcome.error) {
    output.stderr.write(`test-isolation: unable to launch tests (${outcome.error.code || 'UNKNOWN'}).\n`);
    return 1;
  }
  if (outcome.signal) {
    output.stderr.write(`test-isolation: test process stopped by ${outcome.signal}.\n`);
    return 1;
  }
  if (outcome.status !== 0) return outcome.status;
  output.stdout.write('test-isolation: pass | repository unchanged | sandbox removed\n');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
  runTestProfile().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`test-isolation: ${error.message}\n`);
      process.exitCode = 1;
    }
  );
}

export { runTestProfile };
