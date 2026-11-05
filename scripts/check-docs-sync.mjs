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
        pattern: /uses: Elgabor\/doclify-guardrail\/action@v2\.0\.3/
      },
      {
        label: 'Action v2 offline default',
        pattern: /stays offline unless\s+`external-links: 'true'`/
      },
      {
        label: 'stable release version',
        pattern: /Version `2\.0\.3` is the current stable release/
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
        label: 'documented migration version',
        pattern: /This guide covers version `2\.0\.3`/
      },
      {
        label: 'release-specific Action example',
        pattern: /uses: Elgabor\/doclify-guardrail\/action@v2\.0\.3/
      }
    ]
  },
  {
    file: 'package.json',
    expectations: [
      {
        label: 'stable package version',
        pattern: /"version": "2\.0\.3"/
      }
    ]
  },
  {
    file: 'action/package.json',
    expectations: [
      {
        label: 'stable Action package version',
        pattern: /"version": "2\.0\.3"/
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
        label: 'immutable checkout action',
        pattern: /uses: actions\/checkout@[a-f0-9]{40}(?=\s|$)/
      },
      {
        label: 'non-persisted checkout credentials',
        pattern: /persist-credentials: false/
      },
      {
        label: 'immutable setup-node action',
        pattern: /uses: actions\/setup-node@[a-f0-9]{40}(?=\s|$)/
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
        label: 'release verifier trigger and regression gate',
        pattern: /'\.github\/scripts\/\*\*'[\s\S]*?run: node --test \.github\/scripts\/verify-release\.test\.mjs/
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
        label: 'immutable security-fixed Action pin',
        pattern: /uses: Elgabor\/doclify-guardrail\/action@[a-f0-9]{40}(?=\s|$)/
      },
      {
        label: 'immutable Action caller-workspace proof',
        pattern: /path: docs\/validation-protocol\.md[\s\S]*?DOCLIFY_FILES/
      },
      {
        label: 'patched CI Node runtime',
        pattern: /node-version: '24\.22\.2'\n\s+check-latest: true/
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
        label: 'benchmark and performance baseline trigger',
        pattern: /'bench\/\*\*'/
      },
      {
        label: 'explicit catastrophic performance regression gate',
        pattern: /- name: Reject catastrophic performance regressions\n\s+run: \|\n\s+npm run test:performance \|\| \{[\s\S]*?node scripts\/perf-corpus\.mjs --measure[\s\S]*?exit "\$status"/
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
    file: '.github/workflows/release.yml',
    expectations: [
      {
        label: 'manual dispatch with explicit tag',
        pattern: /on:\n  workflow_dispatch:\n    inputs:\n      tag:/
      },
      {
        label: 'test job without publishing privileges',
        pattern: /  test:\n[\s\S]*?permissions:\n      contents: read\n    outputs:/
      },
      {
        label: 'protected publish job with scoped OIDC permission',
        pattern: /  publish:\n    needs: test\n    if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'\n[\s\S]*?environment: npm\n    permissions:\n      contents: read\n      id-token: write/
      },
      {
        label: 'revalidation of tested commit and annotated tag',
        pattern: /EXPECTED_COMMIT: \$\{\{ needs\.test\.outputs\.commit \}\}[\s\S]*?EXPECTED_TAG_OBJECT: \$\{\{ needs\.test\.outputs\.tag-object \}\}[\s\S]*?run: node \.github\/scripts\/verify-release\.mjs/
      },
      {
        label: 'exact publishing runtime and npm minimum',
        pattern: /node-version: '26\.13\.0'[\s\S]*?npm >= 11\.5\.1/
      },
      {
        label: 'test and package inspection before publish',
        pattern: /npm test[\s\S]*?npm pack --dry-run --json --ignore-scripts[\s\S]*?npm publish --access public --ignore-scripts --registry https:\/\/registry\.npmjs\.org/
      }
    ]
  },
  {
    file: 'CHANGELOG.md',
    expectations: [
      {
        label: '2.0.3 precision, JUnit and performance entry',
        pattern: /## \[2\.0\.3\] - 2026-11-05\n[\s\S]*?### Fixed[\s\S]*?JUnit[\s\S]*?### Changed[\s\S]*?filesystem resolution[\s\S]*?### Notes/
      },
      {
        label: 'first npm release of the post-2.0.1 precision changes',
        pattern: /2\.0\.2 is the first npm release to include the precision changes developed after\s+2\.0\.1:/
      },
      {
        label: '2.0.2 security, fixes and maintenance entry',
        pattern: /## \[2\.0\.2\] - 2026-11-05\n[\s\S]*?### Security[\s\S]*?XML 1\.0[\s\S]*?### Fixed[\s\S]*?### Changed[\s\S]*?### Notes/
      },
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
        label: 'per-URL Action timeout description',
        pattern: /Per-URL milliseconds from worker start, including DNS, redirects and HEAD-to-GET fallback/
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
        label: 'labeled correctness gate',
        pattern: /run: npm run test:labeled/
      },
      {
        label: 'compatibility runtimes complementary to Docs Check Node 24',
        pattern: /correctness:\n[\s\S]*?node: \['20\.20\.2', '22\.23\.4', '26\.13\.0'\][\s\S]*?node-version: \$\{\{ matrix\.node \}\}\n\s+check-latest: true/
      },
      {
        label: 'Node 26 network gate also runs after correctness failures',
        pattern: /if: \$\{\{ !cancelled\(\) && matrix\.node == '26\.13\.0' \}\}\n\s+run: npm run test:network/
      }
    ]
  }
];

for (const file of ['README.md', 'MIGRATION.md']) {
  checks.push({
    file,
    expectations: [
      {
        label: 'versioned host-route abstention with Markdown source companions',
        pattern: /Missing local routes with an available `\.md` or `\.mdx` source companion[\s\S]*?`migrating-to-5\.0\.0`[\s\S]*?does not verify that the generated site\s+serves the route/
      },
      {
        label: 'route companions respect containment, readability, type and exclusions',
        pattern: /A companion must be a contained, readable regular file[\s\S]*?canonical symlink source[\s\S]*?Excluded or unreadable\s+companions produce operational diagnostics; directories and absent companions\s+do not establish route evidence/
      },
      {
        label: 'possible emphasis and HTML heading anchors with incomplete fallback',
        pattern: /underscore emphasis delimiters\s+removed[\s\S]*?`snake_case`[\s\S]*?Static single-line HTML headings[\s\S]*?multiline text, encoded entities, dynamic expressions, or nested or\s+malformed headings leave anchor evidence incomplete/
      },
      {
        label: 'JUnit totals and diagnostic error precedence',
        pattern: /JUnit emits an error[\s\S]*?takes precedence over a blocking finding[\s\S]*?totals count the elements actually emitted/
      },
      {
        label: 'generated anchor and command exemption with local paths preserved',
        pattern: /Generated documents skip\s+anchor and command claims; local path checks still\s+apply\./
      },
      {
        label: 'per-URL deadline starts after the worker queue',
        pattern: /The timeout\s+starts when a URL leaves\s+the worker queue and covers DNS preflight, redirects,\s+and HEAD-to-GET fallback\./
      },
      {
        label: 'canonical symlink evidence and directory boundary',
        pattern: /Markdown file symlinks are checked through contained canonical targets,\s+respecting exclusions\. Unavailable symlink evidence makes a requested anchor\s+check incomplete\. Directory symlinks are not traversed\./
      },
      {
        label: 'Node 20 EOL compatibility boundary and maintained LTS recommendation',
        pattern: /`engines: >=20`[\s\S]*?Node\.js 20 reached end of life on\s+2026-04-30 and is still accepted for compatibility[\s\S]*?Node\.js 22, 24, or 26/
      },
      {
        label: 'tested exact Node runtime matrix',
        pattern: /20\.20\.2,\s+22\.23\.4, 24\.22\.2,\s+and 26\.13\.0/
      }
    ]
  });
}

const requiredFiles = [
  'action/action.yml',
  '.github/workflows/reliability.yml',
  '.github/workflows/release.yml',
  '.github/scripts/verify-release.mjs',
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

const packageVersion = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version;
const actionLock = JSON.parse(fs.readFileSync(path.join(rootDir, 'action', 'package-lock.json'), 'utf8'));
if (actionLock.version !== packageVersion || actionLock.packages?.['']?.version !== packageVersion) {
  failures.push('action/package-lock.json: package and root lock versions must match the release version');
}

const remoteActions = new Set(['actions/checkout', 'actions/setup-node', 'Elgabor/doclify-guardrail/action']);
for (const file of fs.readdirSync(path.join(rootDir, '.github', 'workflows'))) {
  if (!/\.ya?ml$/.test(file)) continue;
  const content = fs.readFileSync(path.join(rootDir, '.github', 'workflows', file), 'utf8');
  if (file === 'release.yml') {
    const testJob = content.split('\n  test:\n')[1]?.split('\n  publish:\n')[0] || '';
    if (/id-token:|environment:/.test(testJob) || (content.match(/id-token: write/g) || []).length !== 1
      || /^\s*(?:push|pull_request|pull_request_target):/m.test(content)
      || /(?:NODE_AUTH_TOKEN|NPM_TOKEN|secrets\.)/.test(content)) {
      failures.push('release.yml: publishing privileges must remain isolated, manual and token-free');
    }
  }
  for (const [, reference] of content.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
    if (reference === './action') continue;
    const [, repository, revision] = /^([^@]+)@([^@]+)$/.exec(reference) || [];
    if (!remoteActions.has(repository) || !/^[a-f0-9]{40}$/.test(revision || '')) {
      failures.push(`.github/workflows/${file}: unreviewed owner/repository or non-SHA Action reference (${reference})`);
    }
  }
}

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
    if (command.label === 'check --help' && !/Per URL: DNS, redirects and HEAD\/GET/.test(run.stdout)) {
      failures.push('check --help: per-URL timeout contract is missing');
    }
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
