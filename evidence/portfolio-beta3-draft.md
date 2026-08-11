# Portfolio copy draft for beta.3

Status: `DRAFT_DO_NOT_PUBLISH`

This file prepares task A5. It does not authorize a portfolio edit or deploy.
Publication remains blocked until the private beta evidence exists, beta.3 has
an immutable released reference, and a separate portfolio task is authorized.

## Current claim audit

The current portfolio describes Doclify as flagging "documentation drift" and
"risky changes". Those phrases are broader than the deterministic v2 rule
catalog. The replacement below names only behavior demonstrated by the public
fixture and tests.

As verified on 2026-08-11, npm serves `1.7.4` on `latest` and
`2.0.0-beta.2` on `next`. The Action v2 adapter in this branch is a beta.3
source candidate, not a published Action release.

## Proposed Italian copy

> Doclify Guardrail è una CLI open source in beta che controlla se istruzioni
> precise nei file Markdown e MDX corrispondono ai fatti già presenti nel
> repository. Verifica link e anchor locali, script npm, workspace, target Make
> e comandi Doclify. Funziona offline di default, non esegue gli esempi e mostra
> la prova usata per ogni errore bloccante.

## Proposed English copy

> Doclify Guardrail is an open-source beta CLI that checks whether precise
> instructions in Markdown and MDX match facts already present in the
> repository. It verifies local links and anchors, npm scripts, workspaces,
> Make targets, and Doclify commands. It runs offline by default, does not
> execute examples, and shows the evidence behind each blocking error.

## Public evidence map

| Portfolio claim | Public evidence |
| --- | --- |
| Markdown and MDX checks against repository facts | `README.md` rule table and `src/claim-checker.mjs` |
| Local links and anchors | `examples/evidence-demo/` and `bench/precision-cases.json` |
| npm scripts, workspaces, Make targets, and Doclify commands | `README.md` rule table and `bench/precision-cases.json` |
| Offline by default | `README.md`, `scripts/check-network-boundary.mjs`, `test/action-v2.test.mjs`, and `.github/workflows/docs-check.yml` |
| Does not execute documented examples | `README.md` and the static checker implementation |
| Evidence for blocking errors | broken demo JSON output and the labeled correctness gate |
| Open-source beta status | repository license and the immutable beta.3 release reference, once published |

The private beta may support a separate adoption statement only after A4 meets
its declared thresholds. Do not add participant counts, time-to-result,
replacement claims, or quotations before that evidence is committed.

## Reproducible demo script

Run from a clean checkout of the immutable beta.3 release reference.

1. Show the clean local result:

   ```sh
   node ./src/index.mjs check examples/evidence-demo/README.md --format compact
   ```

2. Show the deliberately broken local link and its JSON evidence:

   ```sh
   node ./src/index.mjs check examples/evidence-demo/fixtures/README.broken.md --config examples/evidence-demo/.doclify-guardrail.json --format json
   ```

3. Show the repository workflow using `./action` on the same checked-out commit
   and its `status`, `complete`, and `blocking` outputs.

The root `.doclify-guardrail.json` excludes the deliberately broken fixture so
ordinary repository scans stay green. The demo command passes its committed
empty configuration explicitly so it can select that file without changing
the rule set. It needs no model, secret, remote link check, hidden setup, or
manual edit between the clean and broken runs.
