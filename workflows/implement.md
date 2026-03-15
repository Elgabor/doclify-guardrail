# Workflow: Implementare da una specifica

Implementa una feature partendo dalla sua specifica tecnica.
Prima capisci il sistema, poi scrivi test, poi codice. Mai al contrario.

## Contesto

Leggi questi file prima di toccare codice:
- docs/specs/SPEC-$ARGUMENTS.md (la specifica da implementare)
- agent-docs/architecture.md (struttura codebase)
- agent-docs/testing.md (convenzioni test)
- agent-docs/git-workflow.md (convenzioni git)

## Principi

Prima il modello, poi il codice.
Non scrivi codice finché non hai ricostruito mentalmente il flusso del sistema.

Fix minimo possibile.
La miglior implementazione è quella che cambia meno codice possibile
per ottenere il risultato.

Root cause > sintomo.
Se un test fallisce, correggi il codice. Mai il test.
I test sono il contratto dalla spec.

Blast radius awareness.
Ogni modifica può impattare altre parti del sistema.
Esplicita sempre il possibile raggio di impatto.

Scope discipline.
Non introdurre refactor non richiesti.
I commit devono essere piccoli e mirati.

Zero dipendenze.
Non aggiungere pacchetti npm. Se serve una funzionalità,
implementala o usa le API native di Node.js.

## Processo — segui le fasi in ordine

### Fase 1 — Comprensione

Leggi la spec SPEC-$ARGUMENTS.md per intero.

Ricostruisci il flusso di esecuzione:
- Trigger (cosa avvia la feature)
- Componenti coinvolti (quali file in src/)
- Funzioni chiamate (quali funzioni esistenti vengono toccate)
- Output atteso (cosa produce la feature)

Spiega questo flusso in prosa breve, citando file e funzioni reali.
L'obiettivo è dimostrare che hai capito come il sistema funziona oggi
e dove la nuova feature si inserisce.

### Fase 2 — Branch

Crea il branch dalla spec:
```
git checkout -b feat/$ARGUMENTS
```

### Fase 3 — Test first (TDD)

Scrivi i test PRIMA del codice. I test devono riflettere la sezione
"Test cases" dalla spec.

Lanciali. Devono FALLIRE tutti. Se un test passa prima dell'implementazione,
il test è sbagliato — verifica che sta testando la cosa giusta.

Committa solo i test:
```
git add test/
git commit -m "test: add failing tests for $ARGUMENTS"
```

### Fase 4 — Implementazione

Implementa file per file, seguendo "File coinvolti" dalla spec.

Dopo OGNI file:
1. Lancia i test correlati
2. Se falliscono, correggi il codice (mai i test)
3. Se passano, vai al file successivo

Regole:
- Modifica solo i file indicati nella spec
- Evita refactor non richiesti
- Commenta solo le parti non ovvie
- Ogni funzione nuova ha massimo 50 righe

### Fase 5 — Verifica completa

Quando tutti i test della feature passano, lancia la suite completa:
```
node --test test/guardrail.test.mjs
```

Se qualcosa che NON è correlato alla feature fallisce, FERMATI.
È una regressione. Segnala e aspetta indicazioni.

### Fase 6 — Semplificazione

Rileggi tutto il codice che hai scritto.

Chiediti:
- C'è codice sovra-ingegnerizzato? Semplifica.
- C'è una funzione che fa troppe cose? Spezza.
- Ho aggiunto qualcosa che non era nella spec? Rimuovi.
- Ho introdotto dipendenze esterne? Rimuovi.

### Fase 7 — Commit e draft PR

Committa con conventional commits:
```
git add -A
git commit -m "feat: $ARGUMENTS"
```

Crea draft PR:
```
gh pr create --draft \
  --title "feat: $ARGUMENTS" \
  --body "## Spec
docs/specs/SPEC-$ARGUMENTS.md

## Criteri di accettazione
[copia la checklist dalla spec]

## Come testare
[comandi per riprodurre e verificare]

## Impatto
[blast radius e rischio regressione]"
```

### Fase 8 — Confidence check

Valuta la qualità dell'implementazione. Score 1-10 su:

- Comprensione della spec
- Copertura test
- Minimalità del codice
- Rischio regressione

Se qualche punteggio è sotto 7, spiega perché e cosa miglioreresti.

## Contesto lungo

Se il contesto si riempie prima di finire, scrivi docs/handoffs/HANDOFF.md con:
- Cosa hai implementato (file per file, con status test)
- Cosa resta da implementare dalla spec
- Problemi trovati e decisioni prese
- Comandi per lanciare i test

Il prossimo agente partirà da quel file.
