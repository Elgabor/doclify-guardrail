# Doclify Guardrail

**Quality gate for your Markdown docs. Catches errors in seconds.**

Zero dependencies. Node.js built-in only. Works everywhere Node 20+ runs.

## Features

- Multi-file and directory scanning with glob support
- Line numbers in every finding
- Code block exclusion (no false positives on code examples)
- Markdown report generation for CI
- Custom regex-based rules via JSON
- Colored terminal output
- Extended placeholder detection (TODO, FIXME, TBD, WIP, and more)
- Insecure link detection (inline, bare URLs, reference-style)
- Optional dead link checker (`--check-links`)
- Optional safe auto-fix mode (`--fix`, `--dry-run`)

## Quick Start

```bash
# Scan a single file
npx doclify-guardrail README.md

# Scan an entire directory
npx doclify-guardrail docs/

# Strict mode (warnings = failure)
npx doclify-guardrail docs/ --strict

# Generate a report
npx doclify-guardrail docs/ --report

# Check dead links (HTTP status + local relative paths)
npx doclify-guardrail docs/ --check-links

# Auto-fix safe issues (v1: http:// -> https://)
npx doclify-guardrail docs/ --fix

# Preview auto-fix without writing files
npx doclify-guardrail docs/ --fix --dry-run
```

## Usage

```
doclify-guardrail <file.md ...> [options]
doclify-guardrail --dir <path> [options]
```

### Options

| Flag | Description |
|------|-------------|
| `--strict` | Treat warnings as failures |
| `--max-line-length <n>` | Maximum line length (default: 160) |
| `--config <path>` | Config file path (default: `.doclify-guardrail.json`) |
| `--dir <path>` | Scan all `.md` files in directory (recursive) |
| `--report [path]` | Generate markdown report (default: `doclify-report.md`) |
| `--rules <path>` | Load custom rules from JSON file |
| `--check-links` | Validate links and fail on dead links |
| `--fix` | Auto-fix safe issues (v1: `http://` to `https://`) |
| `--dry-run` | Preview `--fix` changes without writing files (only valid with `--fix`) |
| `--no-color` | Disable colored output |
| `--debug` | Show runtime details |
| `-h, --help` | Show help |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | PASS -- all files clean |
| `1` | FAIL -- errors found, or warnings in strict mode |
| `2` | Usage error / invalid input |

## Configuration

Create a `.doclify-guardrail.json` in your project root:

```json
{
  "maxLineLength": 120,
  "strict": true
}
```

CLI flags override config file values.

## Built-in Rules

| Rule | Severity | Description |
|------|----------|-------------|
| `frontmatter` | warning | Missing YAML frontmatter block |
| `single-h1` | error | Zero or multiple H1 headings |
| `line-length` | warning | Lines exceeding max length |
| `placeholder` | warning | TODO, FIXME, TBD, WIP, HACK, CHANGEME, lorem ipsum, etc. |
| `insecure-link` | warning | HTTP links (should be HTTPS) |
| `dead-link` | error | Broken links (enabled with `--check-links`) |

All rules respect code block exclusion -- content inside fenced code blocks
and inline code is never flagged.

## Custom Rules

Create a JSON file with custom regex-based rules:

```json
{
  "rules": [
    {
      "id": "no-internal-urls",
      "severity": "error",
      "pattern": "https://internal\\.company\\.com",
      "message": "Internal URL found -- remove before publishing"
    },
    {
      "id": "no-draft-marker",
      "severity": "warning",
      "pattern": "\\[DRAFT\\]",
      "message": "Draft marker found in document"
    }
  ]
}
```

```bash
doclify-guardrail docs/ --rules my-rules.json
```

Custom rules are applied after built-in rules and respect code block exclusion.

## CI Integration

### GitHub Actions

```yaml
- name: Docs quality gate
  run: npx doclify-guardrail docs/ --strict --report
```

See `.github/workflows/docs-check.yml` for a complete example workflow.

### JSON Output

Pipe JSON output to other tools:

```bash
doclify-guardrail docs/ 2>/dev/null | jq '.summary'
```

## Dead Link Checker

Use `--check-links` to validate:
- `http(s)` links via HTTP status checks
- relative local file links (e.g. `./guide.md`)

When dead links are found, they are reported as `dead-link` errors.

## Auto-fix (safe v1)

Use `--fix` to automatically upgrade safe `http://` links to `https://`.
Ambiguous URLs (for example `localhost` or custom ports) are reported and left unchanged.

Use `--dry-run` only together with `--fix` to preview changes without writing files.
Using `--dry-run` alone is a usage error (exit code `2`).

## Report

Use `--report` to generate a markdown report:

```bash
doclify-guardrail docs/ --report quality-report.md
```

The report includes a summary table, per-file details with line numbers,
and execution metadata.

## License

MIT

---

## Italiano

Doclify Guardrail e' un quality gate per la documentazione Markdown.
Zero dipendenze esterne, funziona ovunque giri Node.js 20+.
Rileva errori, placeholder dimenticati, link insicuri e problemi di
formattazione con numeri di riga precisi e report in formato Markdown.
