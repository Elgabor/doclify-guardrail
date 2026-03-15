# Architettura Doclify Guardrail

## Pipeline di esecuzione

```
Input (.md/.mdx files)
  → Parser (frontmatter + AST markdown)
  → Rules engine (35 regole in parallelo)
  → Score calculator (formula pesata per severità)
  → Output formatter (format scelto dall'utente)
  → Exit code (0 = pass, 1 = fail)
```

## Score formula

```
score = 100 - Σ(penalty_i × weight_i)

Severità → Peso:
  error   = 10
  warning = 3
  info    = 1

Bonus: freshness ok = +5, tutti i link vivi = +5
Floor: score minimo = 0
```

## Regole: come aggiungerne una

1. Aggiungi la regola al `RULE_CATALOG` in `src/checker.mjs` — oggetto `{ id, severity, description }`
2. Implementa la logica di check nella funzione `checkMarkdown()` in `src/checker.mjs`
3. Aggiungi test in `test/guardrail.test.mjs` — usa `test()` da `node:test` con fixture inline
4. Esegui `node --test test/guardrail.test.mjs` per verificare

## Auto-fix: come aggiungerne uno

1. Aggiungi la funzione fix in `src/fixer.mjs`
2. Il fix DEVE essere idempotente e sicuro (no data loss)
3. Esporta la funzione da `src/fixer.mjs`
4. Test in `test/guardrail.test.mjs`: verifica che `fix(fail_content) → pass_content`

## Link checker: vincoli di sicurezza

- Protezione SSRF: blocca IP privati (127.0.0.1, 10.x, 192.168.x, etc.)
- Timeout: 10s per link, 60s totale
- Retry: 1 retry con backoff per 429/5xx
- Cache: risultati link cachati per sessione (no persistenza)

## Output formats

| Flag | Format | Uso |
|------|--------|-----|
| (default) | Terminal colorato | Sviluppo locale |
| `--json` | JSON | Integrazione programmatica |
| `--junit` | JUnit XML | CI/CD (Jenkins, GitLab) |
| `--sarif` | SARIF | GitHub Code Scanning |
| `--badge` | SVG | README badge |
| `--report` | Markdown | PR comment, documentazione |
