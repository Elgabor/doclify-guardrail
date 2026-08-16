# Migrating to Doclify Guardrail v2

Version `2.0.1` is the current stable npm release. The v2 core is local and
read-only by default.

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

In v2 purpose is reported for every selected file. `generated` skips
repository-command claims. `plan` and `changelog` do not treat command examples
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

## GitHub Action

`Elgabor/doclify-guardrail/action@v1` remains on its own v1 contract. The v2
release does not change or retag that Action.

The stable v2 Action adapter is published under the signed tag `v2.0.1`.
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
- uses: Elgabor/doclify-guardrail/action@v2.0.1
  with:
    path: README.md
```

The v1 Action's SARIF and score outputs have no v2 Action equivalent. SARIF
remains available from the CLI with `--format sarif --output <path>`. Use
`Elgabor/doclify-guardrail/action@v2` for compatible v2 updates, the signed
`v2.0.1` tag for the specific release, or its full commit SHA for an immutable
reference.
