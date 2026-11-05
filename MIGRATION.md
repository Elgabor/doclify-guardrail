# Migrating to Doclify Guardrail v2

This guide covers version `2.0.3`. The v2 core is local and read-only by
default.

The package keeps `engines: >=20`. Node.js 20 reached end of life on
2026-04-30 and is still accepted for compatibility. Use a maintained LTS
release: Node.js 22, 24, or 26. CI tests correctness on exactly 20.20.2,
22.23.4, 24.22.2, and 26.13.0; the JavaScript Action runs on `node24`.

## Command changes

| v1 | v2 |
| --- | --- |
| `doclify [paths]` | `doclify-guardrail check [paths]` |
| `--diff --base <ref>` | `changed --base <ref>` |
| `--diff --staged` | `changed --staged` |
| `--json` | `--format json` |
| `--junit <file>` | `--format junit --output <file>` |
| `--sarif <file>` | `--format sarif --output <file>` |
| no stdin support | `check - --stdin-name <workspace-relative name>` |
| no rule help | `explain <rule-id>` |
| `dead-link` / `broken-local-anchor` | `local-link` |

The `doclify` executable is gone in v2. Use `doclify-guardrail` in scripts and
hooks.

## Removed surfaces

There is no v2 fixer, score, badge, trend, watch mode, Cloud login, Cloud
push, repository memory, AI command, Drift Guard, freshness heuristic, custom
regex rule loader, or generic style-lint mode. Use an existing formatter,
style linter, or dedicated link tool when those are the need.

Removed flags fail with `legacy-option` instead of being ignored. The core keeps
local links, optional external-link checks, contained output paths, inline
suppressions, JSON/SARIF/JUnit output, and hierarchical configuration.

## Configuration

The configuration filename stays `.doclify-guardrail.json`. Its supported keys
are `purpose`, `ignoreRules`, `exclude`, `siteRoot`, `linkAllowList`,
`linkTimeoutMs`, and `linkConcurrency`.

`purpose` is one of `published`, `instructions`, `fragment`, `plan`,
`changelog`, or `generated`. The nearest configured purpose takes precedence
over the filename heuristic. Unknown and removed configuration keys fail
explicitly.

## API and package exports

The only public programmatic import is:

```js
import { check } from 'doclify-guardrail/api';
```

`lint`, `fix`, `score`, `RULE_CATALOG`, and the package-root export are removed.

## Complete v1 surface lookup

The following inventory records the v1-to-v2 mapping for projects that need an
exact replacement. Every omitted item fails as `legacy-option`; none is silently
accepted.

| v1 surface | v2 destination |
| --- | --- |
| bare targets, `doclify [paths]`, `--dir <path>` | `doclify-guardrail check [paths]` |
| `--diff`, `--base`, `--staged` | `changed --base <ref>` or `changed --staged` |
| `--strict`, `--min-score`, `--max-line-length` | Removed; v2 uses verified blocking and advisory findings. |
| `--rules`, `--check-freshness`, `--freshness-max-days`, `--check-frontmatter`, `--check-inline-html` | Removed; use a dedicated policy or style tool. |
| `--check-links` | Local links are checked by default; use `--external-links` for opt-in network checks. |
| `--allow-private-links` | Removed; private-network protections cannot be disabled. |
| `--fix`, `--dry-run`, `--report`, `--badge`, `--badge-label` | Removed; the v2 core does not rewrite documents or generate score artifacts. |
| `--json`, `--junit`, `--sarif` | `--format json`, `--format junit`, or `--format sarif`; add `--output <path>` only for an explicit write. |
| `--ascii`, `--debug`, `--list-rules` | Removed; use color-free text output and `explain <rule-id>`. |
| `--watch`, `--track`, `--trend`, `--fail-on-regression` | Removed; run `check` or `changed` from the caller's own workflow. |
| `login`, `logout`, `whoami`, `--push`, `--project-id`, `--api-url`, `--token` | Removed; there is no Cloud, auth, credential-store, or remote-memory path. |
| `--ai-drift`, `--ai-mode`, `--fail-on-drift`, `--fail-on-drift-scope`, `ai ...` | Removed; v2 has no AI or Drift Guard compatibility path. |
| `init --force` | `init --write`, which refuses to replace an existing configuration. |
| API `lint` | `check` from `doclify-guardrail/api`. |
| API `fix`, `score`, `RULE_CATALOG`, package-root import | Removed. |
| config keys `strict`, `maxLineLength`, `checkLinks`, `checkFreshness`, `freshnessMaxDays`, `checkFrontmatter`, `checkInlineHtml`, `push`, `projectId` | Removed keys fail with `config-removed-key`. |
| `.doclify-history.json`, `doclify-report.md`, `doclify-badge.svg`, `.doclify/` auth state | No v2 equivalent; remove them only after validating they are no longer used by your own workflow. |
| Action inputs and outputs from `action@v1` | Stay on the frozen `Elgabor/doclify-guardrail/action@v1` contract, or use the stable v2 contract documented below. |

MDX is classified as the limited `fragment` purpose unless configuration assigns
another supported purpose. V2 does not evaluate MDX expressions.

In v2 purpose is reported for every selected file. Generated documents skip
anchor and command claims; local path checks still apply.
`plan` and `changelog` do not treat command examples
as current instructions, while their local paths and anchors remain subject to
`local-link`. This is classification, not a style preset.

For current command claims (`published`, `instructions`, and `fragment`), an
unqualified `npm run` or `make` is checked against the root `package.json` or
Makefile only when the selected document is directly in the discovery root.
Documents in subdirectories require one static exact workspace name/path or an
explicit `-C`/`--directory` for a blocking command finding. npm checks only
complete static literal script keys and one exact workspace selector; wildcard,
placeholder, shell-variable, parent/multiple-selector, and implicit-cwd forms
are unsupported, not verified. npm's implicit `env`, `restart`, and `start`
events are not asserted absent from `scripts`. Relative extensionless links are not mapped to
`.md` by guesswork. A malformed or unreadable source needed by a selected claim
produces an incomplete result rather than a clean pass. A clean result covers
supported claims in the selected documents, not every sentence.

Markdown file symlinks are checked through contained canonical targets,
respecting exclusions. Unavailable symlink evidence makes a requested anchor
check incomplete. Directory symlinks are not traversed.

Missing local routes with an available `.md` or `.mdx` source companion are
treated as host routes, including versioned names such as
`migrating-to-5.0.0`. This abstention does not verify that the generated site
serves the route. Explicit Markdown files and their anchors remain checked.
A companion must be a contained, readable regular file allowed by the active
exclusions, including its canonical symlink source. Excluded or unreadable
companions produce operational diagnostics; directories and absent companions
do not establish route evidence.

Heading anchors accept possible slugs with underscore emphasis delimiters
removed, while retaining internal underscores such as `snake_case` and
previously accepted slugs. Static single-line HTML headings without an explicit
`id` or `name` also contribute possible text-derived anchors. For these HTML
headings, multiline text, encoded entities, dynamic expressions, or nested or
malformed headings leave anchor evidence incomplete.

JUnit emits an error for a testcase with diagnostics or an unscanned file;
that error takes precedence over a blocking finding in the same testcase.
Failure and error totals count the elements actually emitted.

For opt-in remote checks, `--link-timeout-ms` sets a per-URL budget. The timeout
starts when a URL leaves the worker queue and covers DNS preflight, redirects,
and HEAD-to-GET fallback.

## GitHub Action

`Elgabor/doclify-guardrail/action@v1` remains on its own v1 contract. The v2
release does not change or retag that Action.

The release-specific v2 Action reference for this version is `@v2.0.3`.
It maps `mode`, `path`, `base`, `staged`,
`config`, `ignore-rules`, `exclude`, `site-root`, and the opt-in external-link
settings directly to the v2 CLI. `mode: changed` requires exactly one of `base`
or `staged`; base comparisons also require that revision in the checkout. It
requires no token and does not comment on pull requests, push data,
calculate a score, or run Cloud and AI features. Its outputs are `status`,
`complete`, `files`, `blocking`, `advisory`, and `diagnostics`.
If the scan cannot start because the invocation or configuration is invalid,
the step fails before those result outputs exist.

```yaml
- uses: Elgabor/doclify-guardrail/action@v2.0.3
  with:
    path: README.md
```

The v1 Action's SARIF and score outputs have no v2 Action equivalent. SARIF
remains available from the CLI with `--format sarif --output <path>`. Use
`Elgabor/doclify-guardrail/action@v2` for compatible v2 updates, `v2.0.3` for
this release, or its full commit SHA for an immutable reference. Path inputs
that start with `-` remain literal relative paths, including `path: '-'`;
stdin is available through the CLI.
