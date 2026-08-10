#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { check } from '../src/api.mjs';

const fixtures = [
  { id: 'known-root-script', text: '`npm run test`', expected: [] },
  { id: 'missing-root-script', text: '`npm run missing`', expected: ['package-script'] },
  { id: 'ordinary-prose', text: 'Run npm run missing after deployment.', expected: [] },
  { id: 'known-workspace', text: '`npm --workspace @fixture/app run build`', expected: [] },
  { id: 'missing-workspace', text: '`npm --workspace @fixture/missing run build`', expected: ['workspace-package'] },
  { id: 'missing-workspace-script', text: '`npm --workspace @fixture/app run missing`', expected: ['package-script'] },
  { id: 'known-make-target', text: '`make check`', expected: [] },
  { id: 'missing-make-target', text: '`make deploy`', expected: ['make-target'] },
  { id: 'unknown-cli-command', text: '`doclify-guardrail review`', expected: ['cli-contract'] },
  { id: 'unknown-cli-flag', text: '`doclify-guardrail check --bogus`', expected: ['cli-contract'] },
  { id: 'known-cli-contract', text: '`doclify-guardrail check --format json`', expected: [] },
  { id: 'known-local-anchor', text: '[guide](guide.md#my_section)', expected: [] },
  { id: 'missing-local-anchor', text: '[guide](guide.md#missing)', expected: ['local-link'] },
  { id: 'missing-local-file', text: '[guide](missing.md)', expected: ['local-link'] },
  { id: 'javascript-fence-is-not-a-command-claim', text: '```js\nconst command = "npm run missing";\n```', expected: [] },
  { id: 'untagged-fence-is-not-a-command-claim', text: '```\nnpm run missing\n```', expected: [] },
  { id: 'shell-fence-is-a-command-claim', text: '```sh\nnpm run missing\n```', expected: ['package-script'] },
  { id: 'fenced-link-is-not-a-claim', text: '```md\n[guide](guide.md#missing)\n```', expected: [] },
  { id: 'no-package-evidence', text: '`npm run missing`', expected: [], withoutPackage: true },
  { id: 'no-make-evidence', text: '`make missing`', expected: [], withoutMakefile: true },
  { id: 'generated-command-is-not-a-claim', file: 'notes.generated.md', text: '`npm run missing`', expected: [] },
  { id: 'guide-purpose-claim', file: 'docs/guide.md', text: '`npm run missing`', expected: ['package-script'] },
  { id: 'plan-purpose-claim', file: 'plan/ROADMAP.md', text: '`npm run missing`', expected: ['package-script'] },
  { id: 'changelog-purpose-claim', file: 'CHANGELOG.md', text: '`npm run missing`', expected: ['package-script'] },
  { id: 'fragment-purpose-claim', file: 'note.md', text: '`npm run missing`', expected: ['package-script'] },
  { id: 'instructions-purpose-claim', file: 'AGENTS.md', text: '`npm run missing`', expected: ['package-script'] }
];

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
  if (!fixture.withoutMakefile) fs.writeFileSync(path.join(root, 'Makefile'), 'check:\n\t@true\n', 'utf8');
  fs.writeFileSync(path.join(root, 'guide.md'), '# Guide\n\n## my_section\n', 'utf8');
  const file = fixture.file || 'README.md';
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), `# Fixture\n\n${fixture.text}\n`, 'utf8');
  return file;
}

const mismatches = [];
for (const fixture of fixtures) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-holdout-'));
  try {
    const file = setup(root, fixture);
    const result = await check({ cwd: root, paths: [file] });
    const actual = result.findings.map((finding) => finding.ruleId).sort();
    const expected = [...fixture.expected].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      mismatches.push({ id: fixture.id, expected, actual });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const correct = fixtures.length - mismatches.length;
const precision = correct / fixtures.length;
assert.ok(precision >= 0.95, `precision holdout below 95%: ${(precision * 100).toFixed(1)}%`);
if (mismatches.length > 0) console.log(JSON.stringify({ mismatches }, null, 2));
console.log(`Precision holdout passed: ${correct}/${fixtures.length} (${(precision * 100).toFixed(1)}%).`);
