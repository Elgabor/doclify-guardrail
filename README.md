# Doclify Guardrail

**Quality gate for your Markdown docs. Zero dependencies, catches errors in seconds.**

markdownlint tells you if your Markdown is well-formatted. **Doclify tells you if your documentation is healthy.**
Style + content + links + freshness + score + CI/CD — one single tool.

Works everywhere Node.js 20+ runs.

## Why Doclify

| | Doclify | markdownlint |
|--|---------|-------------|
| Built-in rules | 35 total | 59 |
| Content checks | placeholders, headings, images | No |
| Dead link checker | Built-in (`--check-links`) | No |
| Doc freshness | Built-in (`--check-freshness`) | No |
| Health score | 0-100 per file + average | No |
| Auto-fix | 14 fixers (style + semantic) | 31 (style only) |
| Git diff mode | Built-in (`--diff`, `--staged`) | No |
| Watch mode | Built-in (`--watch`) | No |
| Quality gate | `--min-score` + `--strict` | No |
| Programmatic API | `import { lint, fix, score }` | No |
| Score trending | Built-in (`--track`, `--trend`) | No |
| Regression gate | Built-in (`--fail-on-regression`) | No |
| GitHub Action | Built-in (`action/`) | Plugin |
| SARIF / JUnit / Badge | Built-in | Plugins |
| Dependencies | **Zero** | 50+ |
| Inline suppressions | `disable-next-line`, `disable/enable`, `disable-file` | `disable/enable` |

## Quick Start

```bash
# Install globally
npm install -g doclify-guardrail

# Or use directly with npx
npx doclify-guardrail README.md

# Scan an entire directory
doclify docs/

# Strict mode (warnings = failure)
doclify docs/ --strict

# Check dead links + freshness
doclify docs/ --check-links --check-freshness

# Auto-fix all safe issues
doclify docs/ --fix

# Preview fixes without writing
doclify docs/ --fix --dry-run

# CI pipeline: strict + JUnit + SARIF + badge
doclify docs/ --strict --junit --sarif --badge

# Git diff mode: scan only changed files
doclify --diff --staged --strict

# Quality gate: fail if score below 80
doclify docs/ --min-score 80

# Push score to Doclify Cloud
doclify docs/ --push --project-id my-project

# Watch mode: re-scan on file changes
doclify docs/ --watch

# Compact output (one line per finding)
doclify docs/ --format compact

# Track score history
doclify docs/ --track

# Show score trend graph
doclify --trend

# Fail if score dropped
doclify docs/ --fail-on-regression

# Verify a Doclify Cloud API key
doclify login --key doclify_live_xxx

# Run Drift Guard offline on repo docs
doclify ai drift docs/ --diff --json

# Embed Drift Guard in the standard scan
doclify docs/ --ai-drift --fail-on-drift high --fail-on-drift-scope unmodified

# JSON output for tooling
doclify docs/ --json 2>/dev/null | jq '.summary'
```

## Repository Examples

After cloning this repository, you can use the three public examples under `examples/`:

- [`examples/clean.md`](https://github.com/Elgabor/doclify-guardrail/blob/main/examples/clean.md) — a clean document with frontmatter
- [`examples/with-warnings.md`](https://github.com/Elgabor/doclify-guardrail/blob/main/examples/with-warnings.md) — warning-heavy sample
- [`examples/with-errors.md`](https://github.com/Elgabor/doclify-guardrail/blob/main/examples/with-errors.md) — failing sample

```bash
# Clean example
doclify examples/clean.md --strict --check-frontmatter

# Warnings without failing the run
doclify examples/with-warnings.md

# Failing example in strict mode
doclify examples/with-errors.md --strict
```

## Usage

```bash
doclify <file.md|file.mdx ...> [options]
doclify --dir <path> [options]
```

If no files are specified, scans the current directory.

### CLI Reference

#### Scan

| Flag | Description |
|------|-------------|
| `--dir <path>` | Scan `.md` and `.mdx` files recursively in directory |
| `--diff` | Only scan git-changed `.md` and `.mdx` files (vs HEAD) |
| `--base <ref>` | Base git ref for `--diff` (default: HEAD) |
| `--staged` | Only scan git-staged `.md` and `.mdx` files |
| `--strict` | Treat warnings as errors |
| `--min-score <n>` | Fail if health score is below n (0-100) |
| `--max-line-length <n>` | Max line length (default: 160) |
| `--config <path>` | Config file (default: `.doclify-guardrail.json`) |
| `--rules <path>` | Custom regex rules from JSON file |
| `--ignore-rules <list>` | Disable rules (comma-separated) |
| `--exclude <list>` | Exclude files/patterns (comma-separated) |

#### Checks

| Flag | Description |
|------|-------------|
| `--check-links` | Validate HTTP and local links |
| `--allow-private-links` | Allow private/loopback/link-local remote link checks (opt-in) |
| `--check-freshness` | Warn on stale docs (>180 days) |
| `--freshness-max-days <n>` | Max age threshold for freshness check (default: 180) |
| `--check-frontmatter` | Require YAML frontmatter block |
| `--check-inline-html` | Enable `no-inline-html` rule |
| `--site-root <path>` | Resolve `/root-relative` local links from this filesystem root |
| `--link-allow-list <list>` | Skip URLs/domains for link checks (comma-separated) |
| `--link-timeout-ms <n>` | Timeout per remote link check (default: 8000) |
| `--link-concurrency <n>` | Parallel remote link checks (default: 5) |
| `--ai-drift` | Run Drift Guard against changed code/config files |
| `--ai-mode <mode>` | Drift Guard mode: `offline`, `cloud` |
| `--fail-on-drift <level>` | Fail if drift risk reaches `high` or `medium` |
| `--fail-on-drift-scope <scope>` | Drift gate scope: `unmodified` (default) or `all` |
| `--push` | Push score summary to Doclify Cloud (opt-in) |
| `--project-id <id>` | Set cloud project id for score push |
| `--api-url <url>` | Override Doclify Cloud API base URL |
| `--token <apiKey>` | Override Doclify Cloud API key for this run |

Remote link checks are SSRF-hardened by default:
private, loopback, link-local and metadata destinations are blocked,
including redirects to them.
Use `--allow-private-links` only in trusted environments.

#### Fix

| Flag | Description |
|------|-------------|
| `--fix` | Auto-fix safe issues (see Auto-fix section) |
| `--dry-run` | Preview fixes without writing (requires `--fix`) |

#### Output

| Flag | Description |
|------|-------------|
| `--report [path]` | Markdown report (default: `doclify-report.md`) |
| `--junit [path]` | JUnit XML report (default: `doclify-junit.xml`) |
| `--sarif [path]` | SARIF v2.1.0 report (default: `doclify.sarif`) |
| `--badge [path]` | SVG health badge (default: `doclify-badge.svg`) |
| `--badge-label <text>` | Badge label (default: `docs health`) |
| `--json` | Output raw JSON to stdout |
| `--format <mode>` | Output format: `default`, `compact` |

#### Setup

| Flag | Description |
|------|-------------|
| `init` | Generate a `.doclify-guardrail.json` config |
| `init --force` | Overwrite existing config |
| `login --key <apiKey>` | Verify and persist a Doclify Cloud API key |
| `whoami` | Show stored Doclify Cloud identity |
| `logout` | Remove locally stored Doclify Cloud API key |

#### Other

| Flag | Description |
|------|-------------|
| `--watch` | Watch for file changes and re-scan |
| `--track` | Save score to `.doclify-history.json` |
| `--trend` | Show ASCII score trend graph |
| `--fail-on-regression` | Fail if score dropped vs last tracked run |
| `--list-rules` | List all built-in rules |
| `--no-color` | Disable colored output |
| `--ascii` | Use ASCII icons for CI without UTF-8 |
| `--debug` | Show debug info |
| `-h, --help` | Show help |

#### AI

| Command | Description |
|---------|-------------|
| `ai drift [target]` | Run Drift Guard on candidate docs |
| `ai drift --mode cloud` | Send drift analysis to Doclify Cloud |
| `ai memory export` | Export the local repo memory snapshot |

`ai fix`, `ai prioritize` and `ai coverage` are not available yet and return an explicit roadmap hint.

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | PASS — all files clean |
| `1` | FAIL — errors found, or warnings in strict mode |
| `2` | Usage error / invalid input |

## JSON Output v2

`--json` now emits `schemaVersion: 2` with stable backward compatibility for:

- `summary.healthScore`
- `summary.avgHealthScore`
- `files[]`

New machine-readable fields:

- `scanId`
- `repo`
- `timings`
- `engine.mode`
- `engine.features`
- `ai`

## Configuration

Generate a config file:

```bash
doclify init
```

This creates `.doclify-guardrail.json`:

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

CLI flags override config file values. `DOCLIFY_PROJECT_ID` env var is supported as an alternative to `--project-id`.
Arrays (`exclude`, `ignoreRules`, `linkAllowList`) are merged.
Root-relative local links (`/docs/page.md`) require `siteRoot`
to be verified; otherwise Doclify emits
`unverifiable-root-relative-link`.
If a root-relative route does not map cleanly to a source file under
`siteRoot`, Doclify also keeps it as `unverifiable-root-relative-link`
instead of reporting a false `dead-link`.

## Built-in Rules (35)

### Content Rules

| Rule | Severity | Description |
|------|----------|-------------|
| `frontmatter` | warning | Require YAML frontmatter block (opt-in via `--check-frontmatter`) |
| `single-h1` | error | Exactly one H1 heading per file |
| `heading-hierarchy` | warning | No skipped heading levels (H2 then H4) |
| `duplicate-heading` | warning | No duplicate headings at same level |
| `line-length` | warning | Max line length (default: 160 chars) |
| `placeholder` | warning | No unfinished-work placeholders left in published docs |
| `insecure-link` | warning | No `http://` links (use `https://`) |
| `empty-link` | warning | No empty link text or URL |
| `img-alt` | warning | Images must have alt text |
| `dead-link` | error | No broken links (requires `--check-links`) |
| `unverifiable-root-relative-link` | warning | Root-relative local links need `siteRoot` to be verified |
| `stale-doc` | warning | Warn on stale, invalid or future docs freshness metadata (requires `--check-freshness`) |

### Style Rules (new in v1.4)

| Rule | Severity | Auto-fix |
|------|----------|----------|
| `no-trailing-spaces` | warning | Yes |
| `no-multiple-blanks` | warning | Yes |
| `single-trailing-newline` | warning | Yes |
| `no-missing-space-atx` | warning | Yes |
| `heading-start-left` | warning | Yes |
| `no-trailing-punctuation-heading` | warning | Yes |
| `blanks-around-headings` | warning | Yes |
| `blanks-around-lists` | warning | Yes |
| `blanks-around-fences` | warning | Yes |
| `fenced-code-language` | warning | No |
| `no-bare-urls` | warning | Yes (wraps in `<>`) |
| `no-reversed-links` | warning | Yes |
| `no-space-in-emphasis` | warning | Yes |
| `no-space-in-links` | warning | Yes |
| `no-inline-html` | warning | No (opt-in via `--check-inline-html`) |
| `no-empty-sections` | warning | No |
| `heading-increment` | warning | No |
| `no-duplicate-links` | warning | No |
| `list-marker-consistency` | warning | No |
| `link-title-style` | warning | No |
| `dangling-reference-link` | warning | No |
| `broken-local-anchor` | warning | No |
| `duplicate-section-intent` | warning | No |

All semantic/style rules respect code block exclusion (fenced + inline code). `line-length` intentionally checks raw lines, including code blocks.

## Auto-fix

`doclify --fix` applies 14 safe auto-fixes in a single pass:

| Fix | What it does |
|-----|-------------|
| `http://` to `https://` | Upgrades insecure links (skips localhost/custom ports) |
| Trailing spaces | Removes trailing whitespace |
| Multiple blank lines | Collapses to a single blank line |
| Missing space in heading | `#Heading` becomes `# Heading` |
| Indented heading | Removes leading whitespace |
| Trailing punctuation in heading | Removes `.` `:` `;` `!` `,` |
| Blanks around headings | Ensures blank line before/after |
| Blanks around lists | Ensures blank line before/after |
| Blanks around fences | Ensures blank line before/after |
| Bare URLs | Wraps in `<url>` |
| Reversed links | `(text)[url]` becomes `[text](url)` |
| Emphasis spacing | `** bold **` becomes `**bold**` |
| Link spacing | `[ text ]( url )` becomes `[text](url)` |
| Trailing newline | Ensures file ends with exactly one `\n` |

```bash
# Fix all files in place
doclify docs/ --fix

# Preview changes without writing
doclify docs/ --fix --dry-run
```

## Inline Suppressions

Suppress specific rules per-line, per-block, or per-file:

```markdown
<!-- doclify-disable-next-line placeholder -->
This has a TODO that won't be flagged.

<!-- doclify-disable placeholder,line-length -->
This section is suppressed.
<!-- doclify-enable placeholder,line-length -->

<!-- doclify-disable-file placeholder -->
This entire file ignores placeholder warnings.
```

## Git Diff Mode

Scan only files changed in git, perfect for pre-commit hooks and CI on pull requests:

```bash
# Scan files changed vs HEAD
doclify --diff

# Scan files changed vs a specific branch
doclify --diff --base main

# Scan only staged files (pre-commit hook)
doclify --staged --strict --ascii
```

## Watch Mode

Monitor files and re-scan automatically on save:

```bash
doclify docs/ --watch --strict
```

Watch mode re-runs the canonical scan pipeline on each relevant change with a 300ms debounce.
That means `--watch` now honors the same fix, link, freshness and strict semantics as a normal scan.

## Quality Gate

Fail the scan if the health score drops below a threshold:

```bash
doclify docs/ --min-score 80 --strict
```

Exit code 1 if the average health score is below 80.

## Score Trending

Track your documentation quality over time:

```bash
# Save score after each run
doclify docs/ --track

# View ASCII trend graph
doclify --trend

# Fail CI if score dropped vs last tracked run
doclify docs/ --fail-on-regression
```

Score history is saved to `.doclify-history.json` in the current directory.
Each entry records date, commit hash, average score, errors, warnings,
and files scanned.

## GitHub Action

Use the built-in GitHub Action for automated quality gates on pull requests:

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
      - uses: actions/checkout@v4

      - name: Run Doclify
        uses: Elgabor/doclify-guardrail/action@v1
        with:
          path: 'docs/'
          strict: 'false'
          min-score: '70'
          push: 'true'
          project-id: 'my-project'
          doclify-token: ${{ secrets.DOCLIFY_TOKEN }}
          sarif: 'true'
          pr-comment: 'true'

      - name: Upload SARIF
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: doclify.sarif
```

The action automatically:

- Posts a quality report comment on the PR with file scores
- Generates SARIF for GitHub Code Scanning
- Sets outputs: `score`, `status`, `errors`, `warnings`

`path` accepts a single file, directory or glob target.
Multiline lists are rejected explicitly to keep the contract deterministic.

The action contract lives in `action/action.yml`.
GitHub executes the committed `action/dist/index.mjs`,
which resolves the CLI from both source and bundled layouts through `action/entrypoint.mjs`
and can upsert PR comments via `action/pr-comment.mjs`.

Tag policy for the action:

- Use `@v1` for the supported floating major tag
- Use an immutable `@v1.x.y` tag when you want an exact release
- Do not rely on undocumented minor tags such as `@v1.7`

## Programmatic API

Use doclify as a library in your own tools:

```javascript
import { lint, fix, score, RULE_CATALOG } from 'doclify-guardrail/api';

const result = lint('# Hello\n\nWorld\n');
// { errors: [], warnings: [], healthScore: 100, pass: true }

const fixed = fix('##Bad heading\n\nContent.  \n');
// { content: '## Bad heading\n\nContent.\n', modified: true, changes: [...] }

const s = score({ errors: 0, warnings: 3 });
// 89
```

## Hierarchical Config

Place `.doclify-guardrail.json` in subdirectories for local overrides. Child configs merge with parent configs:

```text
project/
  .doclify-guardrail.json      (base config)
  docs/
    .doclify-guardrail.json    (overrides for docs/)
    api/
      .doclify-guardrail.json  (overrides for docs/api/)
```

Arrays (`ignoreRules`, `exclude`, `linkAllowList`) are merged. Scalar values are overridden.

## Doc Health Score

Each file gets a health score from 0 to 100. The formula uses diminishing returns for warnings:

```text
errorPenalty  = errors * 20
warningPenalty = 5 * sqrt(warnings) + warnings * 2
score = max(0, 100 - errorPenalty - warningPenalty)
```

Example: 0 errors + 13 warnings = 54/100.

Access via JSON output: `summary.healthScore` per file, `summary.avgHealthScore` overall.
CI-facing outputs (badge/report/action summary) reuse these canonical score fields instead of recomputing from aggregate totals.

## Custom Rules

Define regex-based rules in a JSON file:

```json
{
  "rules": [
    {
      "id": "no-internal-urls",
      "severity": "error",
      "pattern": "https://internal\\.company\\.com",
      "message": "Internal URL found — remove before publishing"
    }
  ]
}
```

```bash
doclify docs/ --rules my-rules.json
```

Custom rules are applied after built-in rules and respect code block exclusion.

## CI Integration

### GitHub Actions (recommended: use the built-in action)

See the [GitHub Action](#github-action) section above for the recommended approach with PR comments and SARIF upload.

For manual setup with `npx`:

```yaml
name: Docs Quality Gate
on: [push, pull_request]
jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
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
# .husky/pre-commit or .git/hooks/pre-commit
npx doclify-guardrail $(git diff --cached --name-only --diff-filter=AM -- '*.md' '*.mdx') --strict --ascii
```

## Testing on Another Repository

You can test doclify-guardrail against any project with Markdown or MDX files:

### Quick Test (npx)

```bash
# Clone a target repo
git clone https://github.com/some-org/some-project.git /tmp/test-project

# Run doclify against it
npx doclify-guardrail /tmp/test-project/docs/ --strict --check-links

# With full diagnostics
npx doclify-guardrail /tmp/test-project/ --json 2>/dev/null | jq '.summary'
```

### Local Development Test

```bash
# 1. Clone this repo
git clone https://github.com/Elgabor/doclify-guardrail.git
cd doclify-guardrail

# 2. Link globally
npm link

# 3. Run against any project
cd /path/to/another-project
doclify docs/ --strict --debug

# 4. Test auto-fix (dry-run first!)
doclify docs/ --fix --dry-run
doclify docs/ --fix

# 5. Generate full CI output
doclify docs/ --strict --junit --sarif --badge --report
```

### Run the Test Suite

```bash
# Run all tests
node --test test/guardrail.test.mjs

# Run with verbose output
node --test --test-reporter spec
```

### Verify All Rules Work

```bash
# List all 35 built-in rules
doclify --list-rules

# Scan with all optional checks enabled
doclify docs/ --strict --check-links --check-freshness --check-frontmatter --check-inline-html
```

### Reliability Gate

```bash
# PR sample gate (fast)
npm run reliability:pr

# Nightly deterministic gate (full corpus: small+medium+large)
npm run reliability:nightly:det

# Nightly network gate (network sample subset)
npm run reliability:nightly:net

# Rebuild baseline files
npm run reliability:bootstrap
```

Policy summary:

- `reliability:pr` is the fast gate used on branch and PR changes
- `reliability:nightly:det` is the full deterministic corpus run
- `reliability:nightly:net` is the network sample run
- Baselines live under `bench/baselines/`
- Reports under `bench/out/` are generated artifacts and are not tracked

## Project Architecture

```text
.github/
  workflows/       Public CI workflows
src/
  index.mjs        CLI orchestrator, arg parsing, main flow
  checker.mjs      35-rule lint engine + inline suppressions
  config-resolver.mjs Hierarchical config chain + CLI precedence
  scan-context.mjs Immutable per-file scan context
  fences.mjs       Shared fenced-code parsing helpers (0-3 space indent)
  fixer.mjs        14 auto-fix functions (insecure links + formatting)
  diff.mjs         Git diff integration (--diff, --staged)
  trend.mjs        Score history tracking + ASCII trend graph
  cloud-client.mjs Cloud API client (score push, auth, AI drift)
  repo.mjs         Repo fingerprint, branch detection, scan ID
  api.mjs          Programmatic API (lint, fix, score)
  links.mjs        Dead link checker (HTTP + local file paths)
  quality.mjs      Health score + freshness checker
  colors.mjs       ANSI colors + ASCII mode + compact output
  ci-output.mjs    JUnit XML, SARIF v2.1.0, SVG badge generators
  report.mjs       Markdown report generator
  glob.mjs         File discovery with glob patterns
  rules-loader.mjs Custom rules JSON loader
action/
  action.yml       GitHub Action manifest
  entrypoint.mjs   Action runner (Node.js)
  pr-comment.mjs   PR comment builder + poster
bench/
  corpus.manifest.json        OSS corpus + profiles + pinned commits
  reliability-thresholds.json Reliability hard limits
  waivers.json                Temporary exceptions with expiry
examples/
  clean.md            Public clean example
  with-errors.md      Public failing example
  with-warnings.md    Public warning example
scripts/
  run-corpus.mjs       Corpus runner + deterministic fingerprinting
  compare-baseline.mjs Baseline comparator + report generation
```

## Public Repo Rules

- The tracked public surface is limited to root metadata files, `.github/`, `action/`, `bench/`, `examples/`, `scripts/`, `src/`, and `test/`
- Local planning stays under `docs/plans/` and is intentionally gitignored
- Every public-facing file in the repo stays in English
- Releases use immutable `v1.x.y` tags; the GitHub Action also maintains a floating `v1` tag
- `doclify` is the canonical command in public docs; `doclify-guardrail` stays available for compatibility

## License

MIT
