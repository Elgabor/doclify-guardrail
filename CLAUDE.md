# Doclify Guardrail

Quality gate CLI per documentazione Markdown. "SonarQube dei docs."

## Stack

Node.js 20+, ES Modules (.mjs), zero dipendenze nel core. v1.7.2.

## Struttura sorgente

- src/index.mjs — CLI orchestrator, arg parsing, main flow
- src/checker.mjs — 35 regole lint engine + inline suppressions
- src/config-resolver.mjs — hierarchical config chain + CLI precedence
- src/scan-context.mjs — immutable per-file scan context
- src/fixer.mjs — 14 auto-fix (insecure links + formatting)
- src/diff.mjs — git diff integration (--diff, --staged)
- src/links.mjs — dead link checker (HTTP + local, SSRF-hardened)
- src/quality.mjs — health score + freshness checker
- src/trend.mjs — score history tracking + ASCII trend graph
- src/api.mjs — API programmatica: lint(), fix(), score()
- src/ci-output.mjs — JUnit XML, SARIF v2.1.0, SVG badge
- src/report.mjs — markdown report generator
- src/glob.mjs — file discovery con glob patterns
- src/rules-loader.mjs — custom rules JSON loader
- src/colors.mjs — ANSI colors + ASCII mode
- src/fences.mjs — fenced-code parsing helpers
- action/ — GitHub Action (action.yml + entrypoint.mjs + pr-comment.mjs)
- bench/ — reliability gate corpus + thresholds
- scripts/ — corpus runner + baseline comparator

## Comandi

```bash
node --test test/guardrail.test.mjs           # test suite
node --test --test-reporter spec              # test verbose
npm run reliability:pr                         # reliability gate veloce
doclify docs/ --strict --check-links          # test manuale end-to-end
doclify --list-rules                          # lista 35 regole
```

## Convenzioni

- ES Modules: import/export con estensione .mjs esplicita
- Conventional commits: feat:, fix:, docs:, refactor:
- Branch: feat/nome, fix/nome, docs/nome
- Ogni nuova regola DEVE avere test in test/guardrail.test.mjs + fixture
- IMPORTANTE: zero dipendenze nel core. Mai aggiungere pacchetti npm
- PR sempre come draft prima, review poi
- Exit codes: 0 = PASS, 1 = FAIL, 2 = usage error

## Documentazione interna

Leggi questi file SOLO quando il task lo richiede, non in anticipo:
- Architettura e come aggiungere regole/fix: agent-docs/architecture.md
- Convenzioni di testing: agent-docs/testing.md
- Git workflow e PR: agent-docs/git-workflow.md
- Playbook operativo completo: docs/doclify-dev-system.md

Per il contesto di prodotto (piani, spec, handoff):
- docs/plans/ — roadmap e decisioni di prodotto
- docs/specs/ — specifiche tecniche feature
- docs/handoffs/ — continuità tra sessioni
