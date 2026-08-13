#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { check } from '../src/api.mjs';
import { DEFAULT_RULE_CATALOG } from '../src/rule-catalog.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = path.resolve(SCRIPT_DIR, '..', 'bench', 'precision-cases.json');
const BLOCKING_RULES = DEFAULT_RULE_CATALOG.map((rule) => rule.id);

function loadCorpus() {
  const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));
  if (corpus?.schemaVersion !== 1 || !Array.isArray(corpus.cases) || corpus.cases.length === 0) {
    throw new Error('Labeled correctness corpus is missing or invalid.');
  }
  if (!Number.isFinite(corpus.gate?.minimumCaseAccuracy)
    || corpus.gate.minimumCaseAccuracy < 0 || corpus.gate.minimumCaseAccuracy > 1
    || !Number.isInteger(corpus.gate?.maximumBlockingFalsePositives)
    || corpus.gate.maximumBlockingFalsePositives < 0) {
    throw new Error('Labeled correctness gate is missing or invalid.');
  }
  const ids = new Set();
  for (const fixture of corpus.cases) {
    if (!fixture?.id || ids.has(fixture.id) || typeof fixture.text !== 'string'
      || !Array.isArray(fixture.expected) || new Set(fixture.expected).size !== fixture.expected.length
      || fixture.expected.some((ruleId) => !BLOCKING_RULES.includes(ruleId))) {
      throw new Error(`Invalid labeled case: ${fixture?.id || '<missing id>'}.`);
    }
    ids.add(fixture.id);
  }
  return corpus;
}

function setup(root, fixture) {
  if (!fixture.withoutPackage) {
    fs.mkdirSync(path.join(root, 'packages', 'app'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'fixture-root', workspaces: ['packages/*'], scripts: { test: 'node --test' }
    }), 'utf8');
    fs.writeFileSync(path.join(root, 'packages', 'app', 'package.json'), JSON.stringify({
      name: '@fixture/app', scripts: { build: 'node build.mjs' }
    }), 'utf8');
  }
  if (!fixture.withoutMakefile) {
    const makefiles = fixture.makefiles || { Makefile: 'check:\n\t@true\n' };
    for (const [relativePath, content] of Object.entries(makefiles)) {
      fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
      fs.writeFileSync(path.join(root, relativePath), content, 'utf8');
    }
  }
  fs.writeFileSync(path.join(root, 'guide.md'), '# Guide\n\n## my_section\n', 'utf8');
  const file = fixture.file || 'README.md';
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), `# Fixture\n\n${fixture.text}\n`, 'utf8');
  return file;
}

function emptyMetrics() {
  return Object.fromEntries(BLOCKING_RULES.map((ruleId) => [ruleId, {
    truePositive: 0,
    falsePositive: 0,
    falseNegative: 0
  }]));
}

function updateMetrics(metrics, expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  for (const ruleId of BLOCKING_RULES) {
    if (expectedSet.has(ruleId) && actualSet.has(ruleId)) metrics[ruleId].truePositive += 1;
    if (!expectedSet.has(ruleId) && actualSet.has(ruleId)) metrics[ruleId].falsePositive += 1;
    if (expectedSet.has(ruleId) && !actualSet.has(ruleId)) metrics[ruleId].falseNegative += 1;
  }
}

async function run() {
  const corpus = loadCorpus();
  const metrics = emptyMetrics();
  const mismatches = [];
  const missingEvidence = [];

  for (const fixture of corpus.cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-labeled-'));
    try {
      const file = setup(root, fixture);
      const result = await check({ cwd: root, paths: [file] });
      const blockingFindings = result.findings.filter((finding) => finding.severity === 'blocking');
      const actual = blockingFindings.map((finding) => finding.ruleId).sort();
      const expected = [...fixture.expected].sort();
      updateMetrics(metrics, expected, actual);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        mismatches.push({ id: fixture.id, expected, actual });
      }
      for (const ruleId of expected) {
        const finding = blockingFindings.find((candidate) => candidate.ruleId === ruleId);
        if (!finding?.evidence?.fact || !finding?.evidence?.source) {
          missingEvidence.push({ id: fixture.id, ruleId });
        }
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  const correct = corpus.cases.length - mismatches.length;
  const accuracy = correct / corpus.cases.length;
  const metricRows = BLOCKING_RULES.map((ruleId) => {
    const metric = metrics[ruleId];
    const predicted = metric.truePositive + metric.falsePositive;
    const expected = metric.truePositive + metric.falseNegative;
    return {
      ruleId,
      ...metric,
      predicted,
      expected,
      precision: predicted === 0 ? null : metric.truePositive / predicted
    };
  });

  process.stdout.write('Per-rule metrics count labeled cases, not finding instances.\n');
  for (const metric of metricRows) {
    const precision = metric.precision == null ? 'n/a' : `${(metric.precision * 100).toFixed(1)}%`;
    process.stdout.write(
      `${metric.ruleId}: tp ${metric.truePositive} | fp ${metric.falsePositive} | fn ${metric.falseNegative} | predicted ${metric.predicted} | expected ${metric.expected} | precision ${precision}\n`
    );
  }

  const failures = [];
  if (accuracy < corpus.gate.minimumCaseAccuracy) {
    failures.push(`case accuracy ${(accuracy * 100).toFixed(1)}% is below ${(corpus.gate.minimumCaseAccuracy * 100).toFixed(1)}%`);
  }
  const falsePositives = metricRows.reduce((total, metric) => total + metric.falsePositive, 0);
  if (falsePositives > corpus.gate.maximumBlockingFalsePositives) {
    failures.push(`blocking false positives ${falsePositives} exceed ${corpus.gate.maximumBlockingFalsePositives}`);
  }
  if (missingEvidence.length > 0) failures.push(`${missingEvidence.length} expected finding(s) lack fact/source evidence`);

  if (failures.length > 0) {
    process.stderr.write(`${JSON.stringify({ failures, mismatches, missingEvidence }, null, 2)}\n`);
    return 1;
  }
  process.stdout.write(
    `Labeled correctness passed: ${correct}/${corpus.cases.length} cases (${(accuracy * 100).toFixed(1)}%); 0 blocking false positives.\n`
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`labeled-correctness: ${error.message}\n`);
      process.exitCode = 1;
    }
  );
}

export { loadCorpus, run, updateMetrics };
