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
      }
    ]
  },
  {
    file: 'docs/panoramica.md',
    expectations: [
      {
        label: 'panoramica rule count',
        pattern: new RegExp(`\\*\\*${ruleCount} regole built-in\\*\\*`)
      },
      {
        label: 'siteRoot mention',
        pattern: /`siteRoot`/
      },
      {
        label: 'root-relative warning mention',
        pattern: /`unverifiable-root-relative-link`/
      }
    ]
  },
  {
    file: 'docs/documentazione-tecnica.md',
    expectations: [
      {
        label: 'technical doc rule count',
        pattern: new RegExp(`\\*\\*${ruleCount} regole built-in\\*\\*`)
      },
      {
        label: 'action manifest reference',
        pattern: /`action\/action\.yml`/
      },
      {
        label: 'action entrypoint reference',
        pattern: /`action\/entrypoint\.mjs`/
      },
      {
        label: 'action PR comment reference',
        pattern: /`action\/pr-comment\.mjs`/
      },
      {
        label: 'action bundle reference',
        pattern: /`action\/dist\/index\.mjs`/
      }
    ]
  }
];

const failures = [];

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

if (failures.length > 0) {
  console.error(`Docs sync check failed for RULE_CATALOG.length = ${ruleCount}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Docs sync check passed (${ruleCount} built-in rules).`);
