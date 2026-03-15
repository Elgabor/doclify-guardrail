# Workflow: Revisionare una PR

Revisiona una pull request come un reviewer che vuole capire il software,
non come un generatore automatico di checklist.

## Contesto

Recupera la PR:
```
gh pr view $ARGUMENTS
gh pr diff $ARGUMENTS
```

Identifica la spec collegata dalla descrizione della PR.
Leggi la spec in docs/specs/.

## Principi

Prima il modello, poi il verdetto.
Se non hai capito come il sistema è pensato, non sei autorizzato a giudicarlo.

Ogni problema deve avere prove.
File, funzioni, flussi, condizioni. Mai accuse vaghe.

Ogni problema deve avere un impatto.
"È brutto" non conta. "Può generare stati inconsistenti" conta.

Non fare vibe review.
Non sparare giudizi generici su "clean code" o "best practice".
Parti dal comportamento reale del sistema.

Le alternative vanno dette.
Se segnali che qualcosa è sbagliato, spiega quale direzione sarebbe più sana.

## Processo — segui le fasi in ordine

### Fase 1 — Comprensione del cambiamento

Prima di giudicare, capisci.

Ricostruisci in prosa breve:
- Qual è lo scopo della PR (leggi dalla spec)
- Quali file sono stati toccati e perché
- Come si inserisce nel flusso esistente del sistema

Se qualcosa non ti torna, dillo subito. Non andare avanti
facendo finta di aver capito.

### Fase 2 — Verifica contro la spec

Per ogni criterio di accettazione nella spec:
- È implementato? Mostra l'evidenza (file:riga o output test)
- È testato? Indica quale test lo copre
- Se manca, segnala con precisione cosa manca

Formato:
```
- [ ] Criterio X → ✅ implementato in src/file.mjs:42, testato in test:riga
- [ ] Criterio Y → ❌ non implementato, manca la gestione del caso Z
```

### Fase 3 — Passaggi di analisi

Analizza il diff con passaggi distinti. Non mischiare tutto.

Correttezza logica:
- Branch mancanti o impossibili
- Input validi che portano a output sbagliati
- Assunzioni fragili (nullability, tipi, ordine)

Integrità del modello:
- Invarianti non protetti
- Stato mutato nei posti sbagliati
- Convenzioni del progetto violate

Error handling:
- Eccezioni perse o mangiate
- Errori silenziosi
- Operazioni parziali senza cleanup

Sicurezza (per Doclify specificamente):
- Nuovi input da utente senza sanitizzazione
- Path traversal nei percorsi file
- SSRF nel link checker (protezione mantenuta?)
- eval() o Function() su input utente

Zero dipendenze:
- Verifica package.json: sono state aggiunte dipendenze?
- Verifica ogni import: tutto è interno al progetto o Node.js built-in?

### Fase 4 — Regressioni

Lancia la suite completa:
```
node --test test/guardrail.test.mjs
```

Se qualcosa fallisce che non è correlato alla feature, è una regressione.
Segnala con: file del test, nome del test, errore.

### Fase 5 — Qualità del codice

- Funzioni > 50 righe? Segnala e suggerisci come spezzare.
- Codice morto o commentato? Segnala.
- Naming che nasconde il vero ruolo? Suggerisci alternativa.
- Complessità non necessaria? Mostra la versione più semplice.

Non fare il brillante: fai il preciso.

### Fase 6 — Verdetto

Dai uno di questi verdetti:

✅ APPROVE — tutti i criteri soddisfatti, nessuna regressione, codice pulito.

🔄 REQUEST CHANGES — elenca cosa va corretto. Per ogni richiesta:
  - Cosa non va (con evidenza)
  - Perché è un problema (impatto)
  - Cosa suggerisci (alternativa concreta)

❌ REJECT — problemi strutturali che richiedono riscrittura.
  Spiega perché un fix incrementale non basta.

### Fase 7 — Confidence

Score 1-10 su:
- Comprensione del cambiamento
- Completezza della review
- Certezza del verdetto
- Rischio residuo post-merge

Se il verdetto è APPROVE, chiedi:
"Vuoi che marchi la PR come ready? gh pr ready $ARGUMENTS"
