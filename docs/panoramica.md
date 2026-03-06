# Doclify Guardrail — Panoramica

Doclify Guardrail e un quality gate per documentazione Markdown.
Il core CLI analizza file `.md` e `.mdx` con **35 regole built-in**,
produce finding error e warning, calcola un health score 0-100
e restituisce PASS o FAIL.

## Cosa fa

- Unisce controlli di contenuto e stile nello stesso passaggio.
- Verifica link HTTP/HTTPS e link locali.
- Segnala documenti stantii con il freshness check.
- Produce output terminale, JSON, report Markdown, JUnit, SARIF e badge SVG.
- Supporta git diff, watch mode, trend score e GitHub Action integrata.

## Flusso operativo

1. Risolve argomenti CLI e configurazione gerarchica.
2. Scopre i file Markdown da file espliciti, directory, glob o git diff.
3. Costruisce un contesto di scan immutabile per ogni file.
4. Applica il catalogo built-in e le eventuali custom rules.
5. Esegue, se richiesto, dead-link checker, freshness checker e auto-fix safe.
6. Aggrega risultati, score e artifact CI.

## Regole coperte

### Contenuto

Doclify include 12 regole di contenuto.
Esempi: `single-h1`, `dead-link`, `stale-doc`, `broken-local-anchor`.

### Stile

Doclify include 23 regole di stile.
Esempi: `blanks-around-headings`, `no-bare-urls`, `link-title-style`.

### Root-relative local links

I link come `/docs/page.md` vengono verificati solo se `siteRoot` e configurata.
Senza `siteRoot`, Doclify emette il warning
`unverifiable-root-relative-link`.
Lo stesso warning resta anche per route root-relative che non mappano
in modo diretto a un file sorgente sotto `siteRoot`.

## GitHub Action

La action built-in espone lo stesso summary del CLI:

- legge gli input dichiarati in `action/action.yml`
- esegue il bundle `action/dist/index.mjs`
- rilancia il CLI in JSON mode tramite `action/entrypoint.mjs`
- esporta `score`, `status`, `errors` e `warnings`
- puo aggiornare un commento PR tramite `action/pr-comment.mjs`

## Dove approfondire

- [README](../README.md)
- [Documentazione tecnica](documentazione-tecnica.md)
- [Reliability gate](reliability-gate.md)
