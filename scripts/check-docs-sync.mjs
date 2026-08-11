#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULE_CATALOG } from '../src/rule-catalog.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ruleCount = DEFAULT_RULE_CATALOG.length;

const checks = [
  {
    file: 'README.md',
    expectations: [
      {
        label: 'integrity rules heading',
        pattern: new RegExp(`## Integrity Rules \\(${ruleCount}\\)`)
      },
      {
        label: 'explain command',
        pattern: /doclify-guardrail explain local-link/
      },
      {
        label: 'stdin command',
        pattern: /check - --stdin-name README\.md/
      },
      {
        label: 'local Action v2 candidate example',
        pattern: /uses: \.\/action/
      },
      {
        label: 'Action v2 offline default',
        pattern: /stays offline unless\s+`external-links: 'true'`/
      }
    ]
  },
  {
    file: '.github/workflows/docs-check.yml',
    expectations: [
      {
        label: 'least-privilege permissions',
        pattern: /permissions:\s*\n\s+contents: read/
      },
      {
        label: 'current checkout action',
        pattern: /uses: actions\/checkout@v5\.0\.1/
      },
      {
        label: 'non-persisted checkout credentials',
        pattern: /persist-credentials: false/
      },
      {
        label: 'current setup-node action',
        pattern: /uses: actions\/setup-node@v6\.4\.0/
      },
      {
        label: 'examples trigger',
        pattern: /'examples\/\*\*'/
      },
      {
        label: 'action npm ci step',
        pattern: /run: npm ci --no-audit --no-fund --ignore-scripts/
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
        label: 'performance baseline trigger',
        pattern: /'bench\/baselines\/perf-300\.json'/
      },
      {
        label: 'enforced performance profile',
        pattern: /- name: Run 300-document performance profile\n\s+run: npm run test:performance/
      },
      {
        label: 'labeled correctness transition gate',
        pattern: /run: npm run test:labeled/
      },
      {
        label: 'local network transition gate',
        pattern: /run: npm run test:network/
      },
      {
        label: 'README-only docs gate',
        pattern: /run: node \.\/src\/index\.mjs check README\.md --format compact/
      }
    ]
  },
  {
    file: 'action/action.yml',
    expectations: [
      {
        label: 'Node 24 action runtime',
        pattern: /using: 'node24'/
      },
      {
        label: 'v2 Action name',
        pattern: /name: 'Doclify Guardrail v2'/
      },
      {
        label: 'changed selection mode',
        pattern: /mode:\s*[\s\S]*?default: 'check'[\s\S]*?base:[\s\S]*?staged:/
      },
      {
        label: 'external links disabled by default',
        pattern: /external-links:\s*[\s\S]*?default: 'false'/
      },
      {
        label: 'v2 status output',
        pattern: /outputs:\s*[\s\S]*?status:/
      }
    ]
  },
  {
    file: '.github/workflows/reliability.yml',
    expectations: [
      {
        label: 'separate correctness job',
        pattern: /\n  correctness:\n/
      },
      {
        label: 'separate network job',
        pattern: /\n  network:\n/
      },
      {
        label: 'separate enforced performance job',
        pattern: /\n  performance:\n[\s\S]*?run: npm run test:performance/
      },
      {
        label: 'labeled correctness gate',
        pattern: /run: npm run test:labeled/
      }
    ]
  }
];

const requiredFiles = [
  'action/action.yml',
  '.github/workflows/reliability.yml'
];

const forbiddenRefs = [];
const forbiddenActionInputs = [
  'doclify-token:',
  'token:',
  'push:',
  'ai-drift:',
  'pr-comment:',
  'min-score:',
  'score:'
];

const failures = [];

function runPublicCommand(args, options = {}) {
  return spawnSync(process.execPath, [path.join(rootDir, 'src', 'index.mjs'), ...args], {
    cwd: options.cwd || rootDir,
    input: options.input,
    encoding: 'utf8',
    env: { LANG: 'C', LC_ALL: 'C', NO_COLOR: '1', PATH: process.env.PATH || '' }
  });
}

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

const actionContent = fs.readFileSync(path.join(rootDir, 'action', 'action.yml'), 'utf8');
for (const forbiddenInput of forbiddenActionInputs) {
  if (actionContent.includes(forbiddenInput)) {
    failures.push(`action/action.yml: removed v1 input still present (${forbiddenInput})`);
  }
}

const initDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'doclify-docs-sync-'));
try {
  const commands = [
    { label: '--help', args: ['--help'], status: 0 },
    { label: 'clean demo', args: ['check', 'examples/evidence-demo/README.md', '--format', 'compact'], status: 0 },
    { label: 'broken demo', args: ['check', 'examples/evidence-demo/fixtures/README.broken.md', '--config', 'examples/evidence-demo/.doclify-guardrail.json', '--format', 'json'], status: 1 },
    { label: 'explain', args: ['explain', 'local-link'], status: 0 },
    { label: 'init --print', args: ['init', '--print'], status: 0 },
    { label: 'init --write', args: ['init', '--write'], status: 0, cwd: initDirectory },
    { label: 'stdin', args: ['check', '-', '--stdin-name', 'README.md', '--format', 'json'], input: '# Notes\n', status: 0, cwd: initDirectory }
  ];
  for (const command of commands) {
    const run = runPublicCommand(command.args, command);
    if (run.status !== command.status) failures.push(`public command failed: ${command.label} (${run.stderr || run.stdout})`);
  }
} finally {
  fs.rmSync(initDirectory, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`Docs sync check failed for RULE_CATALOG.length = ${ruleCount}`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Docs sync check passed (${ruleCount} built-in rules).`);
