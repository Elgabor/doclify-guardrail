# Workflow: Aggiornare documentazione dopo un merge

Aggiorna la documentazione del progetto dopo che una feature è stata mergiata.
Poi verifica la qualità con Doclify stesso (dogfooding).

## Contesto

Identifica l'ultima PR mergiata per "$ARGUMENTS":
```
gh pr list --state merged --limit 5
```

Leggi la spec collegata in docs/specs/SPEC-$ARGUMENTS.md.
Leggi il diff della PR per capire cosa è cambiato.

## Processo

### Fase 1 — Identifica cosa aggiornare

Basandoti sulla spec e sul diff, determina quali documenti necessitano modifiche:

- README.md — se la feature è user-facing (nuovo comando CLI, nuova flag, nuova API)
- CHANGELOG.md — sempre, per ogni feature mergiata
- docs/ — se esistono guide correlate

NON riscrivere documenti interi. Modifica solo le sezioni rilevanti.

### Fase 2 — Aggiorna CHANGELOG

Aggiungi entry sotto [Unreleased] con formato:
```
- feat: descrizione breve della feature (#numero-PR)
```

Se [Unreleased] non esiste, crealo sopra l'ultima versione.

### Fase 3 — Aggiorna README

Se la feature aggiunge:
- Nuovi comandi CLI → aggiorna la sezione CLI Reference
- Nuove flag → aggiorna la tabella flags
- Nuova API programmatica → aggiorna la sezione Programmatic API
- Nuove regole → aggiorna la tabella Built-in Rules

Mantieni lo stile esistente del README. Non cambiare formattazione,
non aggiungere sezioni nuove se non necessario.

### Fase 4 — Dogfooding

Lancia Doclify sulla documentazione appena aggiornata:
```
node src/index.mjs docs/ README.md CHANGELOG.md --check-links
```

Se lo score è sotto 80, correggi i problemi trovati.
Se ci sono link rotti, fixali.

### Fase 5 — Commit

```
git add -A
git commit -m "docs: update documentation for $ARGUMENTS"
```

Mostra il diff prima di committare e aspetta conferma.
