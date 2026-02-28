# Doclify Guardrail

**Quality gate for your Markdown docs. Zero dependencies, catches errors in seconds.**

markdownlint tells you if your Markdown is well-formatted. **Doclify tells you if your documentation is healthy.**
Style + content + links + freshness + score + CI/CD — one single tool.

Works everywhere Node.js 20+ runs.

## Why Doclify

| | Doclify | markdownlint |
|--|---------|-------------|
| Style rules | 31 built-in | 59 |
| Content checks | placeholders, headings, images | No |
| Dead link checker | Built-in (`--check-links`) | No |
| Doc freshness | Built-in (`--check-freshness`) | No |
| Health score | 0-100 per file + average | No |
| Auto-fix | 13 fixers (style + semantic) | 31 (style only) |
| Git diff mode | Built-in (`--diff`, `--staged`) | No |
| Watch mode | Built-in (`--watch`) | No |
| Quality gate | `--min-score` + `--strict` | No |
| Programmatic API | `import { lint, fix, score }` | No |
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

# Watch mode: re-scan on file changes
doclify docs/ --watch

# Compact output (one line per finding)
doclify docs/ --format compact

# JSON output for tooling
doclify docs/ --json 2>/dev/null | jq '.summary'
```

## Usage

```bash
doclify <file.md ...> [options]
doclify --dir <path> [options]
```

If no files are specified, scans the current directory.

### CLI Reference

#### Scan

| Flag | Description |
|------|-------------|
| `--dir <path>` | Scan `.md` files recursively in directory |
| `--diff` | Only scan git-changed `.md` files (vs HEAD) |
| `--base <ref>` | Base git ref for `--diff` (default: HEAD) |
| `--staged` | Only scan git-staged `.md` files |
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
| `--check-freshness` | Warn on stale docs (>180 days) |
| `--check-frontmatter` | Require YAML frontmatter block |
| `--check-inline-html` | Enable `no-inline-html` rule |
| `--link-allow-list <list>` | Skip URLs/domains for link checks (comma-separated) |

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

#### Other

| Flag | Description |
|------|-------------|
| `--watch` | Watch for file changes and re-scan |
| `--list-rules` | List all built-in rules |
| `--no-color` | Disable colored output |
| `--ascii` | Use ASCII icons for CI without UTF-8 |
| `--debug` | Show debug info |
| `-h, --help` | Show help |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | PASS — all files clean |
| `1` | FAIL — errors found, or warnings in strict mode |
| `2` | Usage error / invalid input |

## Configuration

Generate a config file:

```bash
doclify init
```

This creates `.doclify-guardrail.json`:

```json
{
  "maxLineLength": 120,
  "strict": true,
  "exclude": ["node_modules/**", "vendor/**"],
  "ignoreRules": [],
  "linkAllowList": []
}
```

CLI flags override config file values. Arrays (`exclude`, `ignoreRules`, `linkAllowList`) are merged.

## Built-in Rules (31)

### Content Rules

| Rule | Severity | Description |
|------|----------|-------------|
| `frontmatter` | warning | Require YAML frontmatter block (opt-in via `--check-frontmatter`) |
| `single-h1` | error | Exactly one H1 heading per file |
| `heading-hierarchy` | warning | No skipped heading levels (H2 then H4) |
| `duplicate-heading` | warning | No duplicate headings at same level |
| `line-length` | warning | Max line length (default: 160 chars) |
| `placeholder` | warning | No TODO/FIXME/WIP/TBD/HACK/CHANGEME markers |
| `insecure-link` | warning | No `http://` links (use `https://`) |
| `empty-link` | warning | No empty link text or URL |
| `img-alt` | warning | Images must have alt text |
| `dead-link` | error | No broken links (requires `--check-links`) |
| `stale-doc` | warning | Warn on stale docs (requires `--check-freshness`) |

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

All rules respect code block exclusion — content inside fenced code blocks and inline code is never flagged.

## Auto-fix

`doclify --fix` applies 13 safe auto-fixes in a single pass:

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

Output is incremental: only changed files are re-scanned with a 300ms debounce.

## Quality Gate

Fail the scan if the health score drops below a threshold:

```bash
doclify docs/ --min-score 80 --strict
```

Exit code 1 if the average health score is below 80.

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

### GitHub Actions

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
npx doclify-guardrail $(git diff --cached --name-only --diff-filter=AM -- '*.md') --strict --ascii
```

## Testing on Another Repository

You can test doclify-guardrail against any project with Markdown files:

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
# Run all 137 tests
node --test

# Run with verbose output
node --test --test-reporter spec
```

### Verify All Rules Work

```bash
# List all 31 built-in rules
doclify --list-rules

# Scan with all optional checks enabled
doclify docs/ --strict --check-links --check-freshness --check-frontmatter --check-inline-html
```

## Project Architecture

```text
src/
  index.mjs        CLI orchestrator, arg parsing, main flow
  checker.mjs      31-rule lint engine + inline suppressions
  fixer.mjs        13 auto-fix functions (insecure links + formatting)
  diff.mjs         Git diff integration (--diff, --staged)
  api.mjs          Programmatic API (lint, fix, score)
  links.mjs        Dead link checker (HTTP + local file paths)
  quality.mjs      Health score + freshness checker
  colors.mjs       ANSI colors + ASCII mode + compact output
  ci-output.mjs    JUnit XML, SARIF v2.1.0, SVG badge generators
  report.mjs       Markdown report generator
  glob.mjs         File discovery with glob patterns
  rules-loader.mjs Custom rules JSON loader
```

## License

MIT
