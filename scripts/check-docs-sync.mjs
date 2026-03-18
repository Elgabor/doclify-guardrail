#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULE_CATALOG } from '../src/checker.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ruleCount = RULE_CATALOG.length;

const checks = [
  {
    file: 'README.md',
    expectations: [
      {
        label: 'built-in rules heading',
        pattern: new RegExp(`## Built-in Rules \\(${ruleCount}\\)`)
      },
      {
        label: 'comparison table rule count',
        pattern: new RegExp(`\\| Built-in rules \\| ${ruleCount} total \\| 59 \\|`)
      },
      {
        label: 'list-rules example count',
        pattern: new RegExp(`List all ${ruleCount} built-in rules`)
      },
      {
        label: 'architecture rule count',
        pattern: new RegExp(`checker\\.mjs\\s+${ruleCount}-rule lint engine`)
      },
      {
        label: 'action bundle reference',
        pattern: /action\/dist\/index\.mjs/
      },
      {
        label: 'public examples section',
        pattern: /## Repository Examples/
      },
      {
        label: 'clean example reference',
        pattern: /examples\/clean\.md/
      },
      {
        label: 'warning example reference',
        pattern: /examples\/with-warnings\.md/
      },
      {
        label: 'error example reference',
        pattern: /examples\/with-errors\.md/
      },
      {
        label: 'action subpath tag reference',
        pattern: /Elgabor\/doclify-guardrail\/action@v1/
      },
      {
        label: 'action tag policy',
        pattern: /Use `@v1` for the supported floating major tag/
      }
    ]
  },
  {
    file: '.github/workflows/docs-check.yml',
    expectations: [
      {
        label: 'examples trigger',
        pattern: /'examples\/\*\*'/
      },
      {
        label: 'action npm ci step',
        pattern: /run: npm ci --no-audit --no-fund/
      },
      {
        label: 'action bundle parity build step',
        pattern: /npm run build/
      },
      {
        label: 'action bundle parity git diff step',
        pattern: /git diff --exit-code -- dist\/index\.mjs dist\/licenses\.txt/
      },
      {
        label: 'docs sync step',
        pattern: /run: npm run docs:sync-check/
      },
      {
        label: 'npm pack dry run step',
        pattern: /run: npm pack --dry-run/
      },
      {
        label: 'README-only docs gate',
        pattern: /run: node \.\/src\/index\.mjs README\.md --strict --report report\.md/
      }
    ]
  }
];

const requiredFiles = [
  'examples/clean.md',
  'examples/with-errors.md',
  'examples/with-warnings.md',
  'action/action.yml'
];

const forbiddenRefs = [
  'docs/reliability-gate.md',
  'docs/panoramica.md',
  'docs/documentazione-tecnica.md',
  'docs/examples/',
  'Elgabor/doclify-guardrail@v1.7',
  'scripts/demo.sh'
];

const failures = [];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(rootDir, file))) {
    failures.push(`${file}: required public file is missing`);
  }
}

for (const check of checks) {
  const absolutePath = path.join(rootDir, check.file);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`${check.file}: file is missing`);
    continue;
  }

  const content = fs.readFileSync(absolutePath, 'utf8');
  for (const expectation of check.expectations) {
    if (!expectation.pattern.test(content)) {
      failures.push(`${check.file}: missing ${expectation.label}`);
    }
  }
}

const readmeContent = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
for (const forbiddenRef of forbiddenRefs) {
  if (readmeContent.includes(forbiddenRef)) {
    failures.push(`README.md: forbidden reference still present (${forbiddenRef})`);
  }
}

if (failures.length > 0) {
  console.error(`Docs sync check failed for RULE_CATALOG.length = ${ruleCount}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Docs sync check passed (${ruleCount} built-in rules).`);
