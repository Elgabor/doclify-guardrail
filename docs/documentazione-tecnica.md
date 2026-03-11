# Documentazione Tecnica — Doclify Guardrail

Questa pagina descrive il comportamento reale del ramo `main`.
Il core CLI resta zero-deps.
La GitHub Action usa dipendenze isolate nella directory `action/`.

## Architettura

```text
src/index.mjs             orchestrazione CLI e output finali
src/checker.mjs           catalogo regole e lint core
src/config-resolver.mjs   merge config + precedence CLI
src/glob.mjs              scoperta file e glob minimi
src/scan-context.mjs      contesto immutabile per file
src/links.mjs             link checker HTTP e locali
src/quality.mjs           health score e freshness
src/ci-output.mjs         JUnit, SARIF e badge
src/api.mjs               API lint, fix, score, RULE_CATALOG
src/repo.mjs              fingerprint repo, scan id e home dir
src/auth-store.mjs        storage locale credenziali cloud
src/cloud-client.mjs      client zero-deps per auth e AI cloud
src/repo-memory.mjs       cache locale memoria repo
src/drift.mjs             Drift Guard offline deterministico
action/action.yml         contratto pubblico della action
action/entrypoint.mjs     runner action e bridge verso il CLI
action/pr-comment.mjs     upsert del commento PR
action/dist/index.mjs     bundle ncc eseguito da GitHub Actions
```

## Catalogo regole

`src/checker.mjs` espone **35 regole built-in** tramite `RULE_CATALOG`.

### Contenuto (12)

`frontmatter`, `single-h1`, `heading-hierarchy`, `duplicate-heading`,
`line-length`, `placeholder`, `insecure-link`, `empty-link`, `img-alt`,
`dead-link`, `unverifiable-root-relative-link`, `stale-doc`.

### Stile (23)

`no-trailing-spaces`, `no-multiple-blanks`, `single-trailing-newline`,
`no-missing-space-atx`, `heading-start-left`,
`no-trailing-punctuation-heading`, `blanks-around-headings`,
`blanks-around-lists`, `blanks-around-fences`, `fenced-code-language`,
`no-bare-urls`, `no-reversed-links`, `no-space-in-emphasis`,
`no-space-in-links`, `no-inline-html`, `no-empty-sections`,
`heading-increment`, `no-duplicate-links`, `list-marker-consistency`,
`link-title-style`, `dangling-reference-link`, `broken-local-anchor`,
`duplicate-section-intent`.

`unverifiable-root-relative-link` e il warning che protegge i link locali
root-relative quando `siteRoot` non e disponibile o quando una route
root-relative non mappa in modo affidabile a un file sorgente.

## Flusso CLI

`parseArgs()` legge le flag CLI e valida i parametri.

`resolveOptions()` e `resolveFileOptions()` fondono default,
file config e override CLI.

`resolveFileList()` espande file espliciti, directory, glob e diff git.

`createFileScanContext()` congela il contesto effettivo per ogni file.

`checkMarkdown()` esegue il catalogo built-in e le custom rules.

`checkDeadLinksDetailed()` e `checkDocFreshness()` si attivano solo se richiesti.

`buildOutput()` aggrega finding e score.

`runScan()` e il runner canonico riusabile dal CLI.

I comandi top-level `login`, `whoami`, `logout` e `ai drift`
riusano gli stessi moduli core senza toccare l'API JS pubblica.
`ai fix`, `ai prioritize` e `ai coverage` oggi rispondono
esplicitamente con "not available yet".

I report CI vengono generati da `src/ci-output.mjs`.

## Score e output

`src/quality.mjs` definisce la formula canonica dello score:

```text
errorPenalty   = errors * 20
warningPenalty = 5 * sqrt(warnings) + warnings * 2
score          = clamp(round(100 - errorPenalty - warningPenalty), 0, 100)
```

Il summary JSON espone:

`schemaVersion: 2`: contratto top-level del payload CLI.

`scanId`: id univoco del run.

`summary.healthScore`: score progetto canonico.

`summary.avgHealthScore`: alias backward-compatible.

`files[].summary.healthScore`: score del singolo file.

`repo`: fingerprint, root, remote e source del repository corrente.

`timings`: millisecondi canonici del run.

`engine.mode`: `scan` oppure `ai`.

`engine.features`: superficie attivata nel run corrente.

`ai.drift`: eventuale payload Drift Guard integrato nello scan.

`src/ci-output.mjs` deve riusare questi campi prima di qualsiasi fallback.
In particolare JUnit deve derivare le failure dal pass/fail canonico per file,
non solo dal conteggio errori.

## GitHub Action

`action/action.yml` dichiara input, output e runtime `node20`.
L'input `path` e stabilizzato come singolo target
(file, directory o glob), non come lista multilinea.

La action supporta anche:

- `ai-drift`
- `ai-mode`
- `fail-on-drift`
- `fail-on-drift-scope`
- `api-url`
- `doclify-token`

`action/entrypoint.mjs` risolve il percorso del CLI
sia da sorgente sia dal bundle,
esegue il CLI con `--json`,
interpreta stdout e setta gli output della action.

Per compatibilita il token GitHub per i commenti PR resta separato
dal token Doclify Cloud usato dalle feature AI.

`action/pr-comment.mjs` aggiorna o crea un commento PR
marcato con `<!-- doclify-guardrail-comment -->`
usando paginazione completa dei commenti PR.

`action/dist/index.mjs` e il bundle ncc committato
che GitHub esegue realmente nel workflow.

L'upload SARIF resta uno step esplicito del workflow chiamante.

## Guardrail documentale

`npm run docs:sync-check` importa `RULE_CATALOG.length`
e verifica che README e docs tecnici riportino lo stesso conteggio
e i file chiave della GitHub Action.

`.github/workflows/docs-check.yml` esegue:

1. test suite
2. docs sync guardrail
3. lint strict su `README.md` e `docs/` con discovery di file `.md` e `.mdx`

Patch policy v1.7:
ogni bug cross-surface richiede almeno un regression test;
ogni rottura su un public path richiede anche uno smoke test sull'entrypoint reale.

## Riferimenti

- [Panoramica](panoramica.md)
- [README](../README.md)
- [Reliability gate](reliability-gate.md)
