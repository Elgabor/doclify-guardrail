# Git Workflow — Doclify Guardrail

## Branch naming

```
feat/nome-feature       ← nuova funzionalità
fix/nome-bug            ← correzione bug
docs/nome-doc           ← documentazione
refactor/nome           ← refactoring senza cambio di comportamento
chore/nome              ← manutenzione, tooling, CI
fase0/nome, fase1/nome  ← milestone di progetto
```

Branch base: `main`. Ogni branch parte da `main` aggiornato.

## Conventional commits

Formato: `tipo(scope): descrizione breve`

| Tipo | Quando |
|------|--------|
| `feat` | Nuova funzionalità |
| `fix` | Correzione bug |
| `docs` | Solo documentazione |
| `refactor` | Refactoring senza cambio di comportamento |
| `chore` | Manutenzione, setup, tooling |
| `test` | Solo test |

- Scope opzionale tra parentesi: `fix(links):`, `feat(score):`
- Descrizione in minuscolo, senza punto finale
- Corpo opzionale separato da riga vuota per dettagli

Esempi dal repo:

```
feat: finalize v1.7.2 guardrail and roadmap updates
fix(score): reuse canonical health score semantics
fix(links): validate root-relative local links via siteRoot
docs: align technical documentation with runtime behavior
chore: normalize npm bin metadata for v1.6.0
```

## PR workflow

1. Crea branch da `main` aggiornato
2. Sviluppa con commit atomici (un concetto per commit)
3. Esegui test: `node --test test/guardrail.test.mjs`
4. Push e apri PR come **draft**
5. Review → approva → merge

```bash
git checkout main && git pull
git checkout -b feat/nome-feature

# ... sviluppo ...

node --test test/guardrail.test.mjs
git push -u origin feat/nome-feature
gh pr create --draft --title "feat: descrizione" --body "..."
```

## Regole

- **Mai push diretto su `main`** — sempre via PR
- **PR sempre come draft prima**, review poi
- **Test obbligatori** prima di ogni PR — la CI esegue il reliability gate
- **Zero dipendenze nel core** — non aggiungere pacchetti npm
- **Exit codes**: 0 = PASS, 1 = FAIL, 2 = usage error
- Ogni nuova regola lint DEVE avere test + fixture in `test/guardrail.test.mjs`
