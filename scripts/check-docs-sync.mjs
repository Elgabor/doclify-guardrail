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
        label: 'Git metadata output refusal',
        pattern: /output inside\s+Git metadata is refused/
      },
      {
        label: 'release-specific Action v2 example',
        pattern: /uses: Elgabor\/doclify-guardrail\/action@v2\.0\.1/
      },
      {
        label: 'Action v2 offline default',
        pattern: /stays offline unless\s+`external-links: 'true'`/
      },
      {
        label: 'stable npm release',
        pattern: /Version `2\.0\.1` is the current stable npm release/
      },
      {
        label: 'changed Markdown-only boundary',
        pattern: /`changed` selects only tracked Markdown and MDX[\s\S]*?does not select unchanged documents/
      },
      {
        label: 'clean result coverage boundary',
        pattern: /A clean\s+result means no supported claim[\s\S]*?does not mean that every sentence was verified/
      },
      {
        label: 'external validation protocol link',
        pattern: /\[External validation protocol\]\(https:\/\/github\.com\/Elgabor\/doclify-guardrail\/blob\/main\/docs\/validation-protocol\.md\)/
      }
    ]
  },
  {
    file: 'CONTRIBUTING.md',
    expectations: [
      {
        label: 'issue-first behavior changes',
        pattern: /Open one focused issue before changing behavior/
      },
      {
        label: 'locked Action dependency install',
        pattern: /npm --prefix action ci --no-audit --no-fund --ignore-scripts/
      },
      {
        label: 'full correctness suite',
        pattern: /npm test/
      }
    ]
  },
  {
    file: 'SECURITY.md',
    expectations: [
      {
        label: 'supported stable release line',
        pattern: /Latest `2\.0\.x` release \| Supported/
      },
      {
        label: 'private vulnerability reporting',
        pattern: /security\/advisories\/new/
      },
      {
        label: 'untrusted input boundary',
        pattern: /treated as untrusted input/
      }
    ]
  },
  {
    file: 'docs/validation-protocol.md',
    expectations: [
      {
        label: 'real change-set denominator',
        pattern: /at least 20 real change sets/
      },
      {
        label: 'controlled challenge denominator',
        pattern: /at least 30 expected contradictions and 30 valid or ambiguous negative/
      },
      {
        label: 'per-rule precision gate',
        pattern: /at least 95% per rule/
      }
    ]
  },
  {
    file: '.github/ISSUE_TEMPLATE/bug_report.yml',
    expectations: [
      {
        label: 'required version field',
        pattern: /id: version[\s\S]*?required: true/
      },
      {
        label: 'required reproduction field',
        pattern: /id: reproduction[\s\S]*?required: true/
      },
      {
        label: 'required environment field',
        pattern: /id: environment[\s\S]*?required: true/
      }
    ]
  },
  {
    file: '.github/ISSUE_TEMPLATE/feature_request.yml',
    expectations: [
      {
        label: 'required user evidence',
        pattern: /id: evidence[\s\S]*?required: true/
      },
      {
        label: 'required success criteria',
        pattern: /id: success[\s\S]*?required: true/
      }
    ]
  },
  {
    file: 'MIGRATION.md',
    expectations: [
      {
        label: 'stable migration release',
        pattern: /Version `2\.0\.1` is the current stable npm release/
      }
    ]
  },
  {
    file: 'package.json',
    expectations: [
      {
        label: 'stable package version',
        pattern: /"version": "2\.0\.1"/
      }
    ]
  },
  {
    file: 'action/package.json',
    expectations: [
      {
        label: 'stable Action package version',
        pattern: /"version": "2\.0\.1"/
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
        label: 'public docs trigger',
        pattern: /'docs\/\*\*'/
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
        label: 'real local Action smoke step',
        pattern: /uses: \.\/action[\s\S]*?path: examples\/evidence-demo\/README\.md/
      },
      {
        label: 'Action smoke output assertions',
        pattern: /DOCLIFY_STATUS[\s\S]*?DOCLIFY_COMPLETE[\s\S]*?DOCLIFY_BLOCKING/
      },
      {
        label: 'immutable Action release pin',
        pattern: /uses: Elgabor\/doclify-guardrail\/action@ad98fb4efc0744360c305747767070d0549c764f/
      },
      {
        label: 'immutable Action caller-workspace proof',
        pattern: /path: docs\/validation-protocol\.md[\s\S]*?DOCLIFY_FILES/
      },
      {
        label: 'Action v2 major reference smoke',
        pattern: /uses: Elgabor\/doclify-guardrail\/action@v2\s/
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
        label: 'explicit catastrophic performance regression gate',
        pattern: /- name: Reject catastrophic performance regressions\n\s+run: npm run test:performance/
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
    file: 'CHANGELOG.md',
    expectations: [
      {
        label: 'patch release entry',
        pattern: /## \[2\.0\.1\] - 2026-08-14/
      },
      {
        label: 'Action major release policy',
        pattern: /`2\.0\.1` is published on npm's `latest` tag and in a GitHub Release[\s\S]*?Action tag `v2` points to the same commit/
      },
      {
        label: 'stable release entry',
        pattern: /## \[2\.0\.0\] - 2026-08-14/
      },
      {
        label: 'stable release artifacts',
        pattern: /`2\.0\.0` is published on npm's `latest` tag and in a GitHub Release backed by the signed `v2\.0\.0` tag/
      },
      {
        label: 'beta.3 release entry',
        pattern: /## \[2\.0\.0-beta\.3\] - 2026-08-11/
      },
      {
        label: 'prerelease channel boundary',
        pattern: /`2\.0\.0-beta\.3` is published on npm's `next` tag with a signed GitHub prerelease; `latest` remains on the stable v1 line/
      },
      {
        label: 'open external validation gate',
        pattern: /external validation still awaits qualifying real-user sessions/
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
  '.github/workflows/reliability.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/PULL_REQUEST_TEMPLATE.md'
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
    { label: 'check --help', args: ['check', '--help'], status: 0 },
    { label: 'changed --help', args: ['changed', '--help'], status: 0 },
    { label: 'explain --help', args: ['explain', '--help'], status: 0 },
    { label: 'init --help', args: ['init', '--help'], status: 0 },
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
