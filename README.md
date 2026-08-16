# Doclify Guardrail

Documentation becomes misleading when links, package scripts, workspace
packages, Make targets, or CLI examples stop matching the repository. Doclify
Guardrail is for developers, maintainers, and CI authors: use it while editing
docs or reviewing a pull request, including changes produced with coding
agents, before the change is merged.

It checks Markdown and MDX against facts already present in the repository. It
runs locally, does not execute documented commands, and does not contact the
network unless `--external-links` is passed.

Version `2.0.1` is the current stable npm release. The `2.0.0-beta.3`
prerelease is on `next`. The supported v1 Action remains frozen at
`Elgabor/doclify-guardrail/action@v1`.

This repository documents shipped behavior and reproducible checks.

## Repository guide

- [Migration from v1](MIGRATION.md) — command, configuration, API, and Action changes.
- [Changelog](https://github.com/Elgabor/doclify-guardrail/blob/main/CHANGELOG.md) — shipped changes by version.
- [Contributing](https://github.com/Elgabor/doclify-guardrail/blob/main/CONTRIBUTING.md) — local checks and pull request expectations.
- [Security policy](https://github.com/Elgabor/doclify-guardrail/blob/main/SECURITY.md) — private vulnerability reporting.
- [External validation protocol](https://github.com/Elgabor/doclify-guardrail/blob/main/docs/validation-protocol.md) — evidence required before adoption claims.
- [Evidence demo](examples/evidence-demo/README.md) — a clean and intentionally broken scan.

For a reproducible problem, use the
[bug report form](https://github.com/Elgabor/doclify-guardrail/issues/new?template=bug_report.yml).
Use the
[feature request form](https://github.com/Elgabor/doclify-guardrail/issues/new?template=feature_request.yml)
for a focused proposal. Report vulnerabilities through the
[security policy](https://github.com/Elgabor/doclify-guardrail/blob/main/SECURITY.md),
not a public issue.

## Start

```sh
npm install --save-dev doclify-guardrail
npx doclify-guardrail check README.md
```

Check only tracked Markdown changed from a base revision:

```sh
npx doclify-guardrail changed --base origin/main
```

`changed` selects only tracked Markdown and MDX in the requested Git diff. It
does not select unchanged documents when only code, manifests, or configuration
change. Use `check .` in CI when every selected document must be compared with
the current repository facts.

For a document that has not been written to disk, provide the intended
workspace-relative name. That name determines how local references are
resolved.

```sh
printf '# Notes\n' | npx doclify-guardrail check - --stdin-name README.md
```

Text output is bounded. Pass `--all` for every finding. Machine formats always
contain the complete result and can be written only through an explicit path.
Report paths are replaced atomically so repeated CI runs stay safe. An existing
Markdown or MDX document is never replaced by report output, and output inside
Git metadata is refused.

```sh
npx doclify-guardrail check README.md --format json --output .doclify/result.json
```

## What it checks

The default rule set is intentionally small. A finding blocks only when the
document uses a precise syntax and Doclify can show the static source that
contradicts it. Ordinary prose, dynamic syntax, and host-dependent routes are
left alone. A clean result means no supported claim in the selected documents
was contradicted; it does not mean that every sentence was verified. If a
required source cannot be read or indexed completely, the result is
`incomplete`, not a clean pass.

## Integrity Rules (5)

| Rule | Verified syntax | Evidence source |
| --- | --- | --- |
| `local-link` | Explicit local path, or an anchor in a completely indexed Markdown file | Workspace files and ATX/Setext/static HTML anchors |
| `package-script` | Complete static `npm run <literal>`; optional `--if-present` is respected | Applicable `package.json` scripts |
| `workspace-package` | One static exact workspace name/path via `--workspace`/`-w`, before or after `run <literal>` | Declared workspace package manifests |
| `make-target` | Static `make` targets with an explicit `-C`/`--directory`, or an unambiguous root context | Selected Makefile targets |
| `cli-contract` | `doclify-guardrail <command> [options]` | Command-aware v2 CLI grammar |

With `--external-links`, `external-link` reports a remote failure as advisory
and unverified; it never turns a complete local scan into a false blocking result.

For current command claims (`published`, `instructions`, and `fragment`), an
unqualified `npm run` or `make` is checked against the root `package.json` or
Makefile only when the selected document is directly in the discovery root.
Documents in subdirectories require one static workspace selector or an
explicit `-C`/`--directory` for a blocking command finding. `plan` and
`changelog` purposes do not treat command examples as current instructions;
`local-link` still applies to their paths and anchors. Unsupported syntax is
not verified, and a clean result does not verify all prose.

Use the built-in explanation when deciding whether to change a document or add
a narrow suppression.

```sh
npx doclify-guardrail explain local-link
```

Inline suppressions remain available for documented exceptions:

```md
<!-- doclify-disable-next-line package-script -->
`npm run <script>`
```

## Document purpose

Every selected document has one purpose: `published`, `instructions`,
`fragment`, `plan`, `changelog`, or `generated`. Configuration wins over the
filename heuristic; the safe fallback is `fragment`. Purpose is included in
the result for each file and does not turn generic formatting into a gate.
In v2, `generated` skips repository-command claims so generated output is not
treated as authored documentation. `plan` and `changelog` are still selected,
but their command examples are not treated as current command claims; local
links and anchors continue to be checked. Purpose does not make unsupported
syntax verified.

```json
{
  "purpose": "published",
  "ignoreRules": ["make-target"],
  "exclude": ["drafts"]
}
```

The example above shows optional fields. `init --print` shows the smallest
valid configuration. `init --write` creates that file only when it does not
already exist.

```sh
npx doclify-guardrail init --print
npx doclify-guardrail init --write
```

## Output and exit codes

`text`, `compact`, `json`, `sarif`, and `junit` are rendered from one result.
Findings include severity, confidence, and an evidence object. Operational
diagnostics stay on stderr, so JSON, SARIF, and JUnit stdout remain parseable.

| Exit code | Meaning |
| --- | --- |
| 0 | Complete scan with no blocking findings |
| 1 | Blocking findings, or a partial scan with a usable result |
| 2 | Invalid usage, configuration, or a scan that produced no usable result |

## Reproducible demo

From a checkout of this repository, the demo has a clean README and a
deliberately broken copy. The clean scan exits `0`; the failing scan exits `1`
because the broken copy points to a missing file. Doclify reports `local-link`
with the observed fact and its source. The [demo runbook](examples/evidence-demo/runbook.md)
explains both expected results.

```sh
node ./src/index.mjs check examples/evidence-demo/README.md --format compact
node ./src/index.mjs check examples/evidence-demo/fixtures/README.broken.md --config examples/evidence-demo/.doclify-guardrail.json --format json
```

## GitHub Action v2

The v2 Action is a thin adapter over the same CLI result. It requires no token,
has only `contents: read` permission, and stays offline unless
`external-links: 'true'` is set. Pin the release-specific tag in CI:

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v5.0.1
    with:
      persist-credentials: false
  - uses: Elgabor/doclify-guardrail/action@v2.0.1
    with:
      path: README.md
```

The release tag `v2.0.1` is signed. Use `Elgabor/doclify-guardrail/action@v2`
to follow the latest compatible v2 release, or pin the full commit SHA from the
release page when the workflow requires an immutable reference.

Use `mode: changed` with exactly one of `base` or `staged: 'true'` to delegate
Git selection to the v2 `changed` command. A base comparison needs the requested
revision to be present in the checkout, commonly via `fetch-depth: 0`.

Inputs map directly to v2 CLI options: `mode`, `path`, `base`, `staged`,
`config`, `ignore-rules`, `exclude`, `site-root`, `external-links`, `link-allow-list`,
`link-timeout-ms`, and `link-concurrency`. Outputs are `status`, `complete`,
`files`, `blocking`, `advisory`, and `diagnostics`. The Action emits at most 50
annotations while the outputs retain complete counts. The released v1 Action
is unchanged and remains on its existing `@v1` tag.

## Migration from v1

v2 removes the fixer, style score, trend tracking, Cloud login/push, AI/Drift
commands, generic regex rules, and the short `doclify` executable. Replace
legacy invocations with `doclify-guardrail check` or `changed`; removed flags
return a stable migration error. The complete mapping is in
[MIGRATION.md](MIGRATION.md).

## Limits

Doclify does not validate Markdown style, execute code blocks, parse arbitrary
prose, or validate MDX expressions. Wildcards, placeholders, shell substitutions,
implicit npm cwd, workspace parent/multiple selectors, and ambiguous nested
Makefile contexts are unsupported rather than blocking facts. npm's implicit
`env`, `restart`, and `start` events are not asserted absent from `scripts`.
Unsupported is not the same as verified. Relative extensionless links are host
routes and are not asserted
against a guessed `.md` file. Remote link checks are opt-in and retain
private-network protections. A clean result covers only supported claims in the
selected documents, not all prose.

## License

MIT
