# Workflows

Istruzioni riutilizzabili per le 5 fasi del ciclo di sviluppo.
Funzionano con qualsiasi agente di codice.

## I 5 workflow

| File | Cosa fa | Quando usarlo |
|------|---------|---------------|
| `spec.md` | Scrive una specifica tecnica in stile Antirez | Prima di implementare qualsiasi feature |
| `implement.md` | Implementa da una spec con TDD | Quando la spec è stata approvata |
| `review.md` | Revisiona una PR contro la sua spec | Quando la draft PR è pronta |
| `docs.md` | Aggiorna documentazione dopo un merge | Dopo ogni feature mergiata |
| `audit.md` | Audit completo della codebase | Periodicamente o prima di un rilascio |

## Come usarli

### Claude Code

Crea symlink da `.claude/commands/`:

```bash
mkdir -p .claude/commands
ln -s ../../workflows/spec.md .claude/commands/spec.md
ln -s ../../workflows/implement.md .claude/commands/implement.md
ln -s ../../workflows/review.md .claude/commands/review.md
ln -s ../../workflows/docs.md .claude/commands/docs.md
ln -s ../../workflows/audit.md .claude/commands/audit.md
```

Poi usa come slash command:
```
/spec score-api
/implement score-api
/review 142
/docs score-api
/audit
```

`$ARGUMENTS` viene sostituito automaticamente con quello che scrivi dopo il comando.

### Cursor

Copia i file in `.cursor/rules/`:

```bash
mkdir -p .cursor/rules
cp workflows/*.md .cursor/rules/
```

### Codex (OpenAI)

Referenzia i workflow nel tuo AGENTS.md:

```markdown
## Workflows
Per scrivere specifiche: workflows/spec.md
Per implementare: workflows/implement.md
Per review: workflows/review.md
Per docs: workflows/docs.md
Per audit: workflows/audit.md
```

### Qualsiasi altro agente

I file sono Markdown puro. Puoi:
1. Copiare il contenuto nel prompt dell'agente
2. Dare il path del file come contesto
3. Dire all'agente: "Leggi workflows/spec.md e seguilo per la feature X"

## Il ciclo di sviluppo

```
workflows/audit.md          ← audit periodico (trova problemi)
        ↓
workflows/spec.md           ← scrivi la spec (definisci la soluzione)
        ↓
(tu leggi e confermi)
        ↓
workflows/implement.md      ← implementa con TDD (branch + test + codice + draft PR)
        ↓
workflows/review.md         ← revisiona la PR (verifica contro la spec)
        ↓
(tu confermi → merge)
        ↓
workflows/docs.md           ← aggiorna documentazione (dogfooding con Doclify)
        ↓
(ripeti per la prossima feature)
```

## Convenzione $ARGUMENTS

Tutti i workflow usano `$ARGUMENTS` come placeholder.
- Per spec/implement/docs: è il nome della feature (es. `score-api`)
- Per review: è il numero della PR (es. `142`)
- Per audit: non serve, analizza tutta la codebase

## Personalizzazione

I workflow sono progettati per Doclify ma i principi sono generici.
Per adattarli a un altro progetto:
1. Cambia i riferimenti a file specifici (CLAUDE.md, agent-docs/, docs/plans/)
2. Cambia il comando test (`node --test test/guardrail.test.mjs`)
3. Cambia il vincolo zero-deps se non si applica
4. Il resto (processo Antirez, TDD, quality checks) è universale
