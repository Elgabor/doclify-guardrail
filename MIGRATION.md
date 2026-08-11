# Migrating to Doclify Guardrail v2

`2.0.0-beta.3` is published on npm's `next` tag. `latest` remains on the v1
line. The v2 core is local and read-only by default.

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

The following inventory preserves the beta.1 migration decisions for users who
need an exact replacement. Every omitted item fails as `legacy-option`; none is
silently accepted.

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
| Action inputs and outputs from `action@v1` | Stay on the frozen `Elgabor/doclify-guardrail/action@v1` contract, or test the beta.3 contract with the full release commit below. |

MDX is classified as the limited `fragment` purpose unless configuration assigns
another supported purpose. V2 does not evaluate MDX expressions.

In beta.3 purpose is reported for every selected file. The high-signal integrity
rules are shared by non-generated purposes; `generated` skips repository-command
claims. This is classification, not a style preset.

## GitHub Action

`Elgabor/doclify-guardrail/action@v1` remains on its own v1 contract. This beta
does not change, rebuild, or retag that Action.

The beta.3 Action adapter is published under the signed tag
`v2.0.0-beta.3` at commit `3e0f9970319c75ea1760f09e57b203d156144d26`.
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
- uses: Elgabor/doclify-guardrail/action@3e0f9970319c75ea1760f09e57b203d156144d26
  with:
    path: README.md
```

The v1 Action's SARIF and score outputs have no v2 Action equivalent. SARIF
remains available from the CLI with `--format sarif --output <path>`. Do not
replace `@v1` with a floating `@v2` reference. Test beta.3 with the full release
commit above; its signed tag is
`Elgabor/doclify-guardrail/action@v2.0.0-beta.3`.
