# Doclify Guardrail

Doclify Guardrail checks Markdown and MDX documentation against facts that are
already present in the repository. It runs locally, does not execute documented
commands, and does not contact the network unless `--external-links` is passed.

This is `2.0.0-beta.2`. The supported GitHub Action remains
`Elgabor/doclify-guardrail/action@v1`; an Action for the v2 core is planned for
the next beta and is not available yet.

## Start

```sh
npm install --save-dev doclify-guardrail@next
npx doclify-guardrail check README.md
```

Check only tracked Markdown changed from a base revision:

```sh
npx doclify-guardrail changed --base origin/main
```

For a document that has not been written to disk, provide the intended
workspace-relative name. That name determines how local references are
resolved.

```sh
printf '# Notes\n' | npx doclify-guardrail check - --stdin-name README.md
```

Text output is bounded. Pass `--all` for every finding. Machine formats always
contain the complete result and can be written only through an explicit path.
Report paths are replaced atomically so repeated CI runs stay safe. An existing
Markdown or MDX document is never replaced by report output.

```sh
npx doclify-guardrail check README.md --format json --output .doclify/result.json
```

## What it checks

The default `repo` preset is intentionally small. A finding blocks only when
the document uses a precise syntax and Doclify can show the static source that
contradicts it. Ordinary prose and unsupported claims are left alone.

## Integrity Rules (5)

| Rule | Verified syntax | Evidence source |
| --- | --- | --- |
| `local-link` | Local Markdown path or anchor | Workspace files and heading anchors |
| `package-script` | `npm run <script>` | `package.json` scripts |
| `workspace-package` | `npm --workspace <package> run <script>` | Workspace package manifests |
| `make-target` | `make <target>` | Makefile targets |
| `cli-contract` | `doclify-guardrail <command> [flags]` | Static v2 CLI contract |

With `--external-links`, `external-link` reports a remote failure as advisory
and unverified; it never turns a complete local scan into a false blocking result.

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
In beta.2 the high-signal integrity rules are shared by non-generated purposes;
`generated` skips repository-command claims so generated output is not treated
as authored documentation.

```json
{
  "purpose": "published",
  "ignoreRules": ["make-target"],
  "exclude": ["drafts"]
}
```

`init --print` shows the smallest valid configuration. `init --write` creates
that file only when it does not already exist.

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

The demo has a clean README and a deliberately broken copy. The broken copy
points to a file that is absent; Doclify reports `local-link` with the observed
fact and its source.

```sh
node ./src/index.mjs check examples/evidence-demo/README.md --format compact
node ./src/index.mjs check examples/evidence-demo/fixtures/README.broken.md --config examples/evidence-demo/.doclify-guardrail.json --format json
```

The same result model is used by a future Action v2. The released Action v1 is
unchanged and must be referenced through its existing `@v1` tag.

## Migration from v1

v2 removes the fixer, style score, trend tracking, Cloud login/push, AI/Drift
commands, generic regex rules, and the short `doclify` executable. Replace
legacy invocations with `doclify-guardrail check` or `changed`; removed flags
return a stable migration error. The complete mapping is in
[MIGRATION.md](MIGRATION.md).

## Limits

Doclify does not validate Markdown style, execute code blocks, parse arbitrary
prose as a claim, or validate MDX expressions. Remote link checks are opt-in
and retain private-network protections.

## License

MIT
