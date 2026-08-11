import * as core from '@actions/core';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ACTION_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAX_BUFFER = 16 * 1024 * 1024;
const MAX_ANNOTATIONS = 50;
const VALUE_INPUTS = [
  ['config', '--config'],
  ['ignore-rules', '--ignore-rules'],
  ['exclude', '--exclude'],
  ['site-root', '--site-root'],
  ['link-allow-list', '--link-allow-list'],
  ['link-timeout-ms', '--link-timeout-ms'],
  ['link-concurrency', '--link-concurrency']
];
const ACTION_INPUTS = new Set([
  'mode', 'path', 'base', 'staged', 'external-links',
  ...VALUE_INPUTS.map(([name]) => name)
]);

function resolveCliPath() {
  const candidates = [
    path.resolve(ACTION_DIR, '..', 'src', 'index.mjs'),
    path.resolve(ACTION_DIR, '..', '..', 'src', 'index.mjs')
  ];
  const cli = candidates.find(existsSync);
  if (cli) return cli;
  throw new Error('Doclify Action could not locate the v2 CLI in this immutable checkout.');
}

function appendInput(args, name, flag) {
  const value = core.getInput(name);
  if (value) args.push(flag, value);
}

function buildCliArgs() {
  const cli = resolveCliPath();
  const mode = core.getInput('mode') || 'check';
  let args;
  if (mode === 'check') {
    const target = core.getInput('path') || '.';
    if (/[\r\n]/.test(target)) {
      throw new Error('Action input "path" must be one file, directory, or glob target.');
    }
    args = [cli, 'check', target];
  } else if (mode === 'changed') {
    args = [cli, 'changed'];
    appendInput(args, 'base', '--base');
    const staged = core.getInput('staged');
    if (staged && core.getBooleanInput('staged')) args.push('--staged');
  } else {
    throw new Error('Action input "mode" must be check or changed.');
  }
  args.push('--format', 'json');
  for (const [name, flag] of VALUE_INPUTS) appendInput(args, name, flag);
  const externalLinks = core.getInput('external-links');
  if (externalLinks && core.getBooleanInput('external-links')) args.push('--external-links');
  return args;
}

function runCli(args) {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  return spawnSync(process.execPath, args, {
    cwd: workspace,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    env: {
      PATH: process.env.PATH || '',
      LANG: 'C',
      LC_ALL: 'C',
      NO_COLOR: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function parseResult(run) {
  if (run.error) throw new Error(`Doclify Action could not launch the CLI (${run.error.code || 'UNKNOWN'}).`);
  if (run.signal) throw new Error(`Doclify Action CLI stopped with ${run.signal}.`);
  if (run.status === 2) {
    const detail = String(run.stderr || '').split(/\r?\n/, 1)[0].slice(0, 300) || 'invalid invocation';
    throw new Error(`Doclify could not start the requested scan: ${detail}`);
  }
  let result;
  try {
    result = JSON.parse(run.stdout);
  } catch {
    throw new Error('Doclify Action received an invalid machine result from the CLI.');
  }
  if (result?.schemaVersion !== 3 || !result.summary || !Array.isArray(result.findings)
    || !Array.isArray(result.diagnostics) || ![0, 1].includes(run.status)) {
    throw new Error('Doclify Action received an unsupported machine result from the CLI.');
  }
  return result;
}

function annotationProperties(item, title) {
  const properties = { title };
  if (item.path) properties.file = item.path;
  if (Number.isInteger(item.line) && item.line > 0) properties.startLine = item.line;
  if (properties.startLine && Number.isInteger(item.column) && item.column > 0) {
    properties.startColumn = item.column;
  }
  return properties;
}

function emitAnnotations(result) {
  const annotations = [
    ...result.diagnostics.map((item) => ({ level: 'error', item, title: `Doclify ${item.code}` })),
    ...result.findings.map((item) => ({
      level: item.severity === 'blocking' ? 'error' : 'warning',
      item,
      title: `Doclify ${item.ruleId}`
    }))
  ];
  for (const annotation of annotations.slice(0, MAX_ANNOTATIONS)) {
    core[annotation.level](annotation.item.message, annotationProperties(annotation.item, annotation.title));
  }
  if (annotations.length > MAX_ANNOTATIONS) {
    core.notice(`${MAX_ANNOTATIONS} of ${annotations.length} annotations shown; outputs retain the complete counts.`);
  }
}

function emitOutputs(result) {
  core.setOutput('status', result.status);
  core.setOutput('complete', String(result.complete));
  core.setOutput('files', String(result.summary.filesSelected));
  core.setOutput('blocking', String(result.summary.blocking));
  core.setOutput('advisory', String(result.summary.advisory));
  core.setOutput('diagnostics', String(result.summary.diagnostics));
}

function failForResult(result) {
  if (!result.complete) {
    core.setFailed(`Doclify scan incomplete: ${result.summary.diagnostics} operational diagnostic(s).`);
  } else if (result.status === 'fail') {
    core.setFailed(`Doclify found ${result.summary.blocking} blocking documentation finding(s).`);
  }
}

function run() {
  try {
    const result = parseResult(runCli(buildCliArgs()));
    emitAnnotations(result);
    emitOutputs(result);
    core.info(`Doclify: ${result.status}; ${result.summary.filesScanned}/${result.summary.filesSelected} files scanned; ${result.summary.blocking} blocking; ${result.summary.advisory} advisory.`);
    failForResult(result);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Doclify Action failed.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();

export { ACTION_INPUTS, buildCliArgs, resolveCliPath, run };
