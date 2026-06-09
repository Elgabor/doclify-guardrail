# Doclify Guardrail

Doclify Guardrail is a quality gate for Markdown and MDX documentation.

It checks structure, readability signals, links, freshness, inline images,
safe formatting, documentation drift, CI artifacts, and a 0-100 health score.
Use it locally before a commit, in CI on pull requests, or as a library inside
your own tooling.

Works anywhere Node.js 20+ runs.

## What It Does

Doclify is useful when you want documentation to be publishable, not just valid
Markdown.

| Need | Doclify feature |
|------|-----------------|
| Find broken docs before release | `doclify docs/ --strict` |
| Scan only changed docs | `doclify --diff` or `doclify --staged` |
| Catch broken local and remote links | `--check-links` |
| Catch stale pages | `--check-freshness` |
| Keep a minimum quality score | `--min-score 80` |
| Generate CI artifacts | `--junit`, `--sarif`, `--badge`, `--report` |
| Fix safe formatting problems | `--fix` and `--dry-run` |
| Suppress known false positives | Inline `doclify-disable` comments |
| Track docs quality over time | `--track`, `--trend`, `--fail-on-regression` |
| Check docs after code changes | `--ai-drift` or `doclify ai drift` |
| Use it from JavaScript | `import { lint, fix, score }` |

## Why Doclify

Doclify overlaps with Markdown linters, but it is focused on documentation
health and CI release gates.

| Feature | Doclify | markdownlint |
|---------|---------|--------------|
| Built-in rules | 35 total | 59 |
| Content checks | Headings, images, unfinished text, links | No |
| Dead link checker | Built in with `--check-links` | No |
| Freshness check | Built in with `--check-freshness` | No |
| Health score | 0-100 per file and average | No |
| Auto-fix | 14 safe fixers | 31 style fixers |
| Git diff mode | `--diff`, `--staged` | No |
| Watch mode | `--watch` | No |
| CI quality gate | `--strict`, `--min-score`, reports | No |
| Programmatic API | `lint`, `fix`, `score`, `RULE_CATALOG` | No |
| Score trending | `--track`, `--trend` | No |
| Regression gate | `--fail-on-regression` | No |
| GitHub Action | Built in under `action/` | Plugin |
| SARIF, JUnit, badge | Built in | Plugins |
| Runtime dependencies | Zero in the npm package | 50+ |
| Inline suppressions | Line, block, and file scope | Block scope |

## Quick Start

Run a one-off scan:

```bash
npx doclify-guardrail README.md
```

Install the CLI if you use it often:

```bash
npm install -g doclify-guardrail
doclify docs/
```

Run a release-style check:

```bash
doclify docs/ --strict --check-links --check-freshness --min-score 80
```

Preview safe fixes:

```bash
doclify docs/ --fix --dry-run
```

Apply safe fixes:

```bash
doclify docs/ --fix
```

Generate CI artifacts:

```bash
doclify docs/ --strict --junit --sarif --badge --report --ascii
```

Output JSON for another tool:

```bash
doclify docs/ --json 2>/dev/null | jq '.summary'
```

## Common Workflows

### Scan a Project

Use a path to scan a file, directory, or glob target:

```bash
doclify README.md
doclify docs/
doclify "docs/**/*.mdx"
```

If no target is provided, Doclify scans the current directory.

### Scan Only Changed Docs

Use diff mode in pull requests or pre-commit hooks:

```bash
doclify --diff --base origin/main --strict
doclify --staged --strict --ascii
```

When no Markdown or MDX files changed, diff mode exits successfully.

### Fix Safe Issues

Use `--dry-run` first when you want to see what would change:

```bash
doclify docs/ --fix --dry-run
doclify docs/ --fix
```

Doclify skips code blocks and inline code for the format fixes that could
change examples.

### Check Links

Enable link checks only when you want local and remote link validation:

```bash
doclify docs/ --check-links
doclify docs/ --check-links --site-root .
doclify docs/ --check-links --link-allow-list example.com,localhost
```

Remote link checks block private, loopback, link-local, and metadata network
targets by default. Use `--allow-private-links` only in trusted local networks.

Root-relative links such as `/docs/page.md` need `--site-root` or `siteRoot`.
Without that root, Doclify reports `unverifiable-root-relative-link` instead of
guessing and producing a false broken-link result.

### Check Freshness and Frontmatter

Freshness checks look for frontmatter dates such as `updated: YYYY-MM-DD`.

```bash
doclify docs/ --check-freshness
doclify docs/ --check-freshness --freshness-max-days 90
doclify docs/ --check-frontmatter
```

`--check-frontmatter` is opt-in because not every documentation set uses
frontmatter.

### Use a Quality Gate

Use `--strict` to make warnings fail the command. Use `--min-score` to fail on
low average health even if you do not want strict mode.

```bash
doclify docs/ --strict
doclify docs/ --min-score 80
doclify docs/ --strict --min-score 85
```

Exit code `1` means the gate failed.

### Track Score History

Use tracking when you want CI to catch score regressions:

```bash
doclify docs/ --track
doclify --trend
doclify docs/ --fail-on-regression
```

History is saved in `.doclify-history.json`.

### Run Drift Guard

Drift Guard compares changed code or configuration with candidate docs.

```bash
doclify ai drift docs/ --diff --json
doclify docs/ --ai-drift --fail-on-drift high --fail-on-drift-scope unmodified
```

Use `--ai-mode offline` for local heuristic analysis. Use `--ai-mode cloud`
only when you have configured Doclify Cloud credentials.

### Push Scores to Doclify Cloud

Cloud push is opt-in.

```bash
doclify login --key doclify_live_sample_key
doclify whoami
doclify docs/ --push --project-id my-project
doclify logout
```

You can also provide `DOCLIFY_TOKEN`, `DOCLIFY_PROJECT_ID`, `--token`, and
`--project-id` in CI. Debug output redacts secret-like values.

## Repository Examples

After cloning this repository, try the public examples:

- `examples/clean.md`: a clean document with frontmatter.
- `examples/with-warnings.md`: a warning-heavy sample.
- `examples/with-errors.md`: a failing sample.

```bash
doclify examples/clean.md --strict --check-frontmatter
doclify examples/with-warnings.md
doclify examples/with-errors.md --strict
```

## CLI Reference

The canonical command is `doclify`. The compatibility binary
`doclify-guardrail` runs the same CLI.

```bash
doclify [files...] [options]
doclify --dir <path> [options]
doclify login --key <apiKey>
doclify whoami
doclify ai drift [target] [options]
```

### Scan Options

| Flag | Meaning |
|------|---------|
| `--dir <path>` | Scan `.md` and `.mdx` files recursively in a directory. |
| `--diff` | Scan git-changed `.md` and `.mdx` files. Default base is `HEAD`. |
| `--base <ref>` | Base git ref for `--diff`. |
| `--staged` | Scan only staged `.md` and `.mdx` files. |
| `--strict` | Treat warnings as failures. |
| `--min-score <n>` | Fail if the average health score is below `n`. |
| `--max-line-length <n>` | Set the line length rule. Default is `160`. |
| `--config <path>` | Use a config file. Default is `.doclify-guardrail.json`. |
| `--rules <path>` | Load custom regex rules from JSON. |
| `--ignore-rules <list>` | Disable comma-separated rule ids. |
| `--exclude <list>` | Exclude comma-separated files or patterns. |

### Check Options

| Flag | Meaning |
|------|---------|
| `--check-links` | Validate HTTP links and local file links. |
| `--allow-private-links` | Allow private, loopback, and link-local remote link checks. |
| `--check-freshness` | Warn when docs are stale, missing a freshness date, or use invalid dates. |
| `--freshness-max-days <n>` | Set the freshness age limit. Default is `180`. |
| `--check-frontmatter` | Require a YAML frontmatter block. |
| `--check-inline-html` | Enable the inline HTML warning rule. |
| `--site-root <path>` | Resolve root-relative local links from this filesystem root. |
| `--link-allow-list <list>` | Skip comma-separated URLs or domains during link checks. |
| `--link-timeout-ms <n>` | Timeout per remote link check. Default is `8000`. |
| `--link-concurrency <n>` | Remote link checks in parallel. Default is `5`. |
| `--ai-drift` | Run Drift Guard during the normal scan. |
| `--ai-mode <mode>` | Drift mode: `offline` or `cloud`. |
| `--fail-on-drift <level>` | Fail when drift risk reaches `high` or `medium`. |
| `--fail-on-drift-scope <scope>` | Gate `unmodified` docs or `all` docs. Default is `unmodified`. |
| `--api-url <url>` | Override the Doclify Cloud API base URL. |
| `--token <apiKey>` | Use a Doclify Cloud key for this run. |
| `--push` | Push the score summary to Doclify Cloud. |
| `--project-id <id>` | Set the Cloud project id for score push. |

### Fix Options

| Flag | Meaning |
|------|---------|
| `--fix` | Apply safe fixes in place. |
| `--dry-run` | Preview fixes without writing. Requires `--fix`. |

### Output Options

| Flag | Meaning |
|------|---------|
| `--report [path]` | Write a Markdown report. Default is `doclify-report.md`. |
| `--junit [path]` | Write a JUnit XML report. Default is `doclify-junit.xml`. |
| `--sarif [path]` | Write a SARIF v2.1.0 report. Default is `doclify.sarif`. |
| `--badge [path]` | Write an SVG health badge. Default is `doclify-badge.svg`. |
| `--badge-label <text>` | Set the badge label. Default is `docs health`. |
| `--json` | Print raw JSON to stdout. |
| `--format <mode>` | Output mode: `default` or `compact`. |

### Setup Commands

| Command | Meaning |
|---------|---------|
| `init` | Generate `.doclify-guardrail.json`. |
| `init --force` | Replace an existing config file. |
| `login --key <apiKey>` | Verify and persist a Doclify Cloud key. |
| `whoami` | Show the stored Doclify Cloud identity. |
| `logout` | Remove locally stored Doclify Cloud credentials. |

### Other Options

| Flag | Meaning |
|------|---------|
| `--watch` | Watch for file changes and re-scan. |
| `--track` | Save score history to `.doclify-history.json`. |
| `--trend` | Show an ASCII score trend graph. |
| `--fail-on-regression` | Fail if the score dropped from the last tracked run. |
| `--list-rules` | List all 35 built-in rules. |
| `--no-color` | Disable colored terminal output. |
| `--ascii` | Use ASCII icons for CI logs without UTF-8 support. |
| `--debug` | Show debug information with secrets redacted. |
| `-h`, `--help` | Show CLI help. |

### AI Commands

| Command | Meaning |
|---------|---------|
| `ai drift [target]` | Run Drift Guard on candidate docs. |
| `ai drift --mode cloud` | Send drift analysis to Doclify Cloud. |
| `ai memory export` | Export the current local repo memory snapshot. |

`ai fix`, `ai prioritize`, and `ai coverage` are reserved roadmap commands.
They currently return an explicit "not available yet" message.

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Pass. |
| `1` | Findings failed the gate, or warnings failed in strict mode. |
| `2` | Usage error or invalid input. |

## Configuration

Generate the default config:

```bash
doclify init
```

The generated `.doclify-guardrail.json` looks like this:

```json
{
  "maxLineLength": 160,
  "strict": false,
  "exclude": ["node_modules/**", "vendor/**"],
  "ignoreRules": [],
  "push": false,
  "projectId": null,
  "checkLinks": false,
  "checkFreshness": false,
  "checkFrontmatter": false,
  "checkInlineHtml": false,
  "freshnessMaxDays": 180,
  "linkTimeoutMs": 8000,
  "linkConcurrency": 5,
  "siteRoot": null,
  "linkAllowList": []
}
```

CLI flags override scalar config values. Arrays such as `exclude`,
`ignoreRules`, and `linkAllowList` are merged.

You can place `.doclify-guardrail.json` files in subdirectories. Parent configs
are loaded first, then child configs override or extend them.

```text
project/
  .doclify-guardrail.json
  docs/
    .doclify-guardrail.json
    api/
      .doclify-guardrail.json
```

Root-relative local links, such as `/docs/page.md`, need `siteRoot`. Without
it, Doclify reports `unverifiable-root-relative-link` instead of guessing.

## Built-in Rules (35)

Rules marked "Opt-in" only run when the matching flag or config value is set.

| Rule | Severity | When it runs | Auto-fix | Meaning |
|------|----------|--------------|----------|---------|
| `frontmatter` | warning | Opt-in | No | Require YAML frontmatter. |
| `single-h1` | error | Always | No | Exactly one H1 per file. |
| `heading-hierarchy` | warning | Always | No | Do not skip heading levels. |
| `duplicate-heading` | warning | Always | No | Avoid duplicate headings at the same level. |
| `line-length` | warning | Always | No | Keep lines under the configured limit. |
| `placeholder` | warning | Always | No | Remove unfinished-work markers before publishing. |
| `insecure-link` | warning | Always | Yes | Prefer `https://` links. |
| `empty-link` | warning | Always | No | Link text and URL must not be empty. |
| `img-alt` | warning | Always | No | Images need alt text. |
| `dead-link` | error | `--check-links` | No | Broken local or remote link. |
| `unverifiable-root-relative-link` | warning | `--check-links` | No | Root-relative link needs `siteRoot`. |
| `stale-doc` | warning | `--check-freshness` | No | Missing, invalid, future, or old freshness date. |
| `no-trailing-spaces` | warning | Always | Yes | Remove trailing whitespace. |
| `no-multiple-blanks` | warning | Always | Yes | Collapse repeated blank lines. |
| `single-trailing-newline` | warning | Always | Yes | End files with one newline. |
| `no-missing-space-atx` | warning | Always | Yes | Require a space after heading markers. |
| `heading-start-left` | warning | Always | Yes | Do not indent headings. |
| `no-trailing-punctuation-heading` | warning | Always | Yes | Remove punctuation at the end of headings. |
| `blanks-around-headings` | warning | Always | Yes | Add blank lines around headings. |
| `blanks-around-lists` | warning | Always | Yes | Add blank lines around lists. |
| `blanks-around-fences` | warning | Always | Yes | Add blank lines around fenced code blocks. |
| `fenced-code-language` | warning | Always | No | Fenced code blocks should name a language. |
| `no-bare-urls` | warning | Always | Yes | Wrap bare URLs in angle brackets. |
| `no-reversed-links` | warning | Always | Yes | Fix reversed Markdown link syntax. |
| `no-space-in-emphasis` | warning | Always | Yes | Remove spaces inside emphasis markers. |
| `no-space-in-links` | warning | Always | Yes | Remove spaces inside link brackets and URLs. |
| `no-inline-html` | warning | Opt-in | No | Warn on inline HTML. |
| `no-empty-sections` | warning | Always | No | Headings should have content. |
| `heading-increment` | warning | Always | No | Heading levels should move one level at a time. |
| `no-duplicate-links` | warning | Always | No | Avoid repeating the same link in one section. |
| `list-marker-consistency` | warning | Always | No | Use consistent list markers. |
| `link-title-style` | warning | Always | No | Use consistent quote style for link titles. |
| `dangling-reference-link` | warning | Always | No | Reference links need matching definitions. |
| `broken-local-anchor` | warning | Always | No | Local heading anchors must exist. |
| `duplicate-section-intent` | warning | Always | No | Avoid near-duplicate section headings. |

All semantic and style rules ignore fenced code blocks and inline code where
changing or flagging examples would be misleading. The `line-length` rule checks
raw lines.

## Auto-fix Reference

`doclify --fix` applies 14 safe fixes:

| Fix | Result |
|-----|--------|
| Insecure links | Changes clear `http://` links to `https://`. |
| Trailing spaces | Removes trailing whitespace. |
| Multiple blank lines | Collapses repeated blank lines. |
| Missing heading space | Changes `#Heading` to `# Heading`. |
| Indented heading | Moves headings to the left edge. |
| Heading punctuation | Removes trailing `.`, `:`, `;`, `!`, and `,`. |
| Heading spacing | Adds blank lines around headings. |
| List spacing | Adds blank lines around lists. |
| Fence spacing | Adds blank lines around fenced code blocks. |
| Bare URLs | Wraps URLs in `<url>`. |
| Reversed links | Changes `(text)[url]` to `[text](url)`. |
| Emphasis spacing | Changes `** bold **` to `**bold**`. |
| Link spacing | Changes `[ text ]( url )` to `[text](url)`. |
| Final newline | Keeps exactly one trailing newline. |

Ambiguous `http://` URLs, such as localhost or custom-port URLs, are not
rewritten automatically.

## Suppressions

Use suppressions when a finding is intentional.

```markdown
<!-- doclify-disable-next-line placeholder -->
This line can keep its marker.

<!-- doclify-disable placeholder,line-length -->
This block is ignored for the listed rules.
<!-- doclify-enable placeholder,line-length -->

<!-- doclify-disable-file line-length -->
The whole file ignores one rule.
```

When no rule id is provided, the suppression applies to all rules in that
scope.

## JSON Output

Use `--json` when another tool needs structured results.

```bash
doclify docs/ --json 2>/dev/null | jq '.summary'
```

The JSON envelope uses schema version 2 and includes:

- `schemaVersion`
- `scanId`
- `repo`
- `summary`
- `files`
- `timings`
- `engine`
- `ai`, when Drift Guard is enabled

Important score fields:

- `summary.healthScore`
- `summary.avgHealthScore`
- `files[].healthScore`

## GitHub Action

Use the bundled action when you want PR comments, outputs, and SARIF in one
step.

```yaml
name: Docs Quality Gate
on: [pull_request]

jobs:
  docs:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      security-events: write

    steps:
      - uses: actions/checkout@v5.0.1
        with:
          persist-credentials: false

      - name: Run Doclify
        uses: Elgabor/doclify-guardrail/action@v1
        with:
          path: 'docs/'
          strict: 'true'
          min-score: '80'
          check-links: 'true'
          sarif: 'true'
          pr-comment: 'true'

      - name: Upload SARIF
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: doclify.sarif
```

The action runs on `node24`. The npm package still supports Node.js 20+.

### Action Inputs

All action inputs are strings because GitHub passes action inputs as strings.

| Input | Default | Meaning |
|-------|---------|---------|
| `path` | `.` | File, directory, or glob to scan. Multiline lists are rejected. |
| `strict` | `false` | Treat warnings as failures. |
| `min-score` | empty | Fail below this average health score. |
| `check-links` | `false` | Validate HTTP and local links. |
| `check-freshness` | `false` | Check frontmatter freshness dates. |
| `check-frontmatter` | `false` | Require frontmatter. |
| `ai-drift` | `false` | Run Drift Guard with the scan. |
| `ai-mode` | `offline` | Drift mode: `offline` or `cloud`. |
| `fail-on-drift` | empty | Fail on `high` or `medium` drift risk. |
| `fail-on-drift-scope` | `unmodified` | Gate `unmodified` docs or `all` docs. |
| `api-url` | empty | Override Doclify Cloud API base URL. |
| `doclify-token` | empty | Doclify Cloud API key. Masked by the action. |
| `push` | `false` | Push score summary to Doclify Cloud. |
| `project-id` | empty | Cloud project id used for score push. |
| `format` | `compact` | CLI output format: `default` or `compact`. |
| `sarif` | `true` | Generate SARIF. |
| `sarif-file` | `doclify.sarif` | SARIF output path. |
| `pr-comment` | `true` | Post or update a PR comment. |
| `token` | `${{ github.token }}` | GitHub token for PR comments. |

### Action Outputs

| Output | Meaning |
|--------|---------|
| `score` | Average health score. |
| `status` | `PASS` or `FAIL`. |
| `errors` | Total error count. |
| `warnings` | Total warning count. |

### Action Tags

- Use `@v1` for the supported floating major tag.
- Use an immutable `@v1.x.y` tag when you want an exact release.
- Do not rely on undocumented minor tags such as `@v1.7`.

The action contract lives in `action/action.yml`. GitHub executes the committed
`action/dist/index.mjs` bundle.

## Manual CI Recipes

### GitHub Workflow With Npx

Use this when you do not need PR comments from the bundled action.

```yaml
name: Docs Check
on: [push, pull_request]

jobs:
  docs:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write

    steps:
      - uses: actions/checkout@v5.0.1
        with:
          persist-credentials: false

      - uses: actions/setup-node@v6.4.0
        with:
          node-version: 20

      - run: npx doclify-guardrail docs/ --strict --junit --sarif --badge --ascii

      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: doclify.sarif
```

### GitLab CI

```yaml
docs-check:
  image: node:20-alpine
  script:
    - npx doclify-guardrail docs/ --strict --junit --ascii
  artifacts:
    reports:
      junit: doclify-junit.xml
```

### Pre-commit Hook

```bash
npx doclify-guardrail $(git diff --cached --name-only --diff-filter=AM -- '*.md' '*.mdx') --strict --ascii
```

## Programmatic API

Import the API from `doclify-guardrail/api`.

```javascript
import { lint, fix, score, RULE_CATALOG } from 'doclify-guardrail/api';

const result = lint('# Hello\n\nWorld\n');
const fixed = fix('##Bad heading\n\nContent.  \n');
const currentScore = score({ errors: 0, warnings: 3 });

console.log(result.pass, fixed.modified, currentScore, RULE_CATALOG.length);
```

### `lint(content, options)`

Returns:

```javascript
{
  errors: [],
  warnings: [],
  healthScore: 100,
  pass: true
}
```

Supported options include `maxLineLength`, `filePath`, `absoluteFilePath`,
`checkFrontmatter`, `checkInlineHtml`, `customRules`, `ignoreRules`, and
`strict`.

### `fix(content)`

Returns fixed Markdown content plus a list of changes:

```javascript
{
  content: '# Title\n\nContent.\n',
  modified: true,
  changes: []
}
```

### `score(counts)`

Computes the same 0-100 health score used by the CLI.

```javascript
score({ errors: 0, warnings: 3 });
```

### `RULE_CATALOG`

Exports the built-in rule metadata used by the CLI and reports.

## Health Score

Each scanned file gets a 0-100 score. Errors are expensive. Warnings use a
diminishing penalty so one noisy document does not dominate the whole repo.

```text
errorPenalty = errors * 20
warningPenalty = 5 * sqrt(warnings) + warnings * 2
score = max(0, 100 - errorPenalty - warningPenalty)
```

The average score appears in CLI output, JSON output, reports, badges, and
GitHub Action outputs.

## Custom Rules

Custom rules are regex-based and loaded from JSON.

```json
{
  "rules": [
    {
      "id": "no-internal-urls",
      "severity": "error",
      "pattern": "https://internal\\.company\\.com",
      "message": "Internal URL found. Remove it before publishing."
    }
  ]
}
```

```bash
doclify docs/ --rules custom-rules.json
```

Custom rules run after built-in rules and respect fenced code block exclusion.

## Development and Verification

Use these commands when working on this repository:

```bash
npm test
npm run docs:sync-check
npm run reliability:pr
npm pack --dry-run --json
```

Action bundle checks:

```bash
cd action
npm ci --no-audit --no-fund --ignore-scripts
npm run build
npm audit --omit=dev
```

## Project Architecture

```text
.github/
  workflows/       Public CI workflows
src/
  index.mjs        CLI parsing, commands, scan orchestration
  checker.mjs      35-rule lint engine + inline suppressions
  config-resolver.mjs Hierarchical config chain and CLI precedence
  scan-context.mjs Per-file scan context
  fences.mjs       Shared fenced-code parsing helpers
  fixer.mjs        14 auto-fix functions
  diff.mjs         Git diff integration
  trend.mjs        Score history tracking and ASCII trend graph
  cloud-client.mjs Cloud API client for auth, score push, and AI drift
  network-guard.mjs Private-network guard for remote requests
  workspace-path.mjs Workspace-contained output path helper
  repo.mjs         Repo fingerprint, branch detection, scan ID
  api.mjs          Programmatic API
  links.mjs        HTTP and local link checker
  quality.mjs      Health score and freshness checker
  colors.mjs       Terminal colors, ASCII mode, compact output
  ci-output.mjs    JUnit XML, SARIF v2.1.0, SVG badge generators
  report.mjs       Markdown report generator
  glob.mjs         File discovery with glob patterns
  rules-loader.mjs Custom rules JSON loader
action/
  action.yml       GitHub Action manifest
  entrypoint.mjs   Action runner
  pr-comment.mjs   PR comment builder and poster
  dist/index.mjs   Committed action bundle
bench/
  corpus.manifest.json        Reliability corpus manifest
  reliability-thresholds.json Reliability limits
  waivers.json                Temporary reliability exceptions
examples/
  clean.md
  with-errors.md
  with-warnings.md
scripts/
  run-corpus.mjs       Corpus runner
  compare-baseline.mjs Baseline comparator
```

## Security Defaults

- The npm package has zero runtime dependencies.
- Remote link checks block private, loopback, link-local, and metadata targets unless `--allow-private-links` is used.
- Cloud API overrides require HTTPS except localhost local testing.
- Cloud requests and link checks validate connection-time DNS lookups.
- Report, JUnit, SARIF, and badge output paths are contained inside the current workspace.
- The GitHub Action masks `doclify-token` and forwards it through environment, not as a CLI argument.

## Troubleshooting

| Problem | What to do |
|---------|------------|
| CI fails only on warnings | Remove `--strict`, fix warnings, or suppress intentional findings. |
| Root-relative links cannot be verified | Set `siteRoot` in config or pass `--site-root .`. |
| External link checks are flaky | Use `--link-allow-list`, raise `--link-timeout-ms`, or keep network checks advisory. |
| A private internal link is blocked | Use `--allow-private-links` only in trusted local or CI networks. |
| A finding is intentional | Add a line, block, or file suppression for the exact rule id. |
| Cloud commands cannot authenticate | Run `doclify login --key <apiKey>` or set `DOCLIFY_TOKEN`. |
| JSON output looks empty in a shell pipeline | Remember that human logs go to stderr; redirect stderr when using `jq`. |

## Public Repo Rules

- Public docs stay in English.
- `doclify` is the canonical command in documentation.
- `doclify-guardrail` remains available as a compatibility binary.
- Releases use immutable `v1.x.y` tags.
- The GitHub Action also uses a floating `v1` tag for the supported major version.

## License

MIT
