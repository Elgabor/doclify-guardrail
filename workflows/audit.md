# Workflow: Audit della codebase

Analizza la codebase per scovare problemi reali, specifici, dimostrabili
e prioritizzabili. Non una review cosmetica — una diagnosi precisa.

## Contesto

Leggi CLAUDE.md per capire il progetto.
Analizza l'intera cartella src/ e test/.

## Principi

Prima il modello, poi il verdetto.
Se non hai capito come il sistema è pensato, non sei autorizzato a giudicarlo.

Ogni problema deve avere prove.
File, funzioni, flussi, condizioni. Mai accuse vaghe.

Ogni problema deve avere un impatto.
"È brutto" non conta. "Può generare stati inconsistenti, rompe l'invariante X,
rende impossibile isolare Y" conta.

Ogni problema deve essere atomico.
Un problema = una issue. Se contiene due cause radice, è scritta male.

Le alternative vanno dette.
Se segnali che qualcosa è sbagliato, spiega quale direzione sarebbe più sana,
anche senza scrivere la patch.

La semplicità è una proprietà di progetto.
Se un'area richiede troppo contesto per essere capita, quello è già un segnale.

Non fare vibe review.
Non sparare giudizi su "clean code", "SOLID", "best practice".
Parti dal comportamento reale del sistema.

## Processo — segui le fasi in ordine

### Fase 0 — Contratto di analisi

Prima di cercare problemi, chiarisci in massimo 10 righe:
1. Che tipo di sistema stai analizzando
2. Qual è il suo scopo operativo
3. Quali sono i confini dell'analisi
4. Cosa puoi osservare davvero e cosa no
5. Come distinguerai: bug, rischio, debito tecnico, limite intenzionale, scelta discutibile ma coerente

Non fare ancora findings qui. Stai definendo il terreno di gioco.

### Fase 1 — Modello mentale della codebase

Scrivi in prosa narrativa:
- Moduli principali e responsabilità
- Come si muovono i dati
- Flussi core
- Confini tra dominio, orchestrazione, integrazione, output
- Invarianti che reggono il sistema
- Sorgenti di verità vs derivazioni

Poi una mappa sintetica:
- Entry points principali
- Componenti ad alto rischio
- Componenti ad alta centralità
- Zone con accoppiamento sospetto
- Zone che meritano analisi aggressiva

Se il modello mentale è debole, dichiaralo. Non andare avanti fingendo.

### Fase 2 — Passaggi di caccia ai problemi

Analizza con passaggi distinti. Non mischiare tutto.

**A — Correttezza logica.**
Bug deterministici, branch mancanti, nullability fragile, stati non gestiti,
validazioni incoerenti, logica duplicata che può divergere.

**B — Integrità del modello.**
Invarianti non protetti, responsabilità spezzate male, stato mutato nei posti sbagliati,
dati derivati trattati come source of truth, convenzioni implicite non enforceate.

**C — Architettura e accoppiamento.**
Moduli che sanno troppo, dipendenze bidirezionali, orchestratori che fanno lavoro di dominio,
pattern nominali usati senza beneficio reale.

**D — Error handling e affidabilità.**
Eccezioni perse, errori silenziosi, retry pericolosi, side effect parziali,
operazioni non idempotenti, handling diverso per errori equivalenti.

**E — Performance e scalabilità.**
Complessità nascosta, loop su collezioni crescenti, query ripetute,
carichi in memoria sproporzionati, punti che reggono solo a volume basso.

**F — Sicurezza e operatività.**
Config fragile, default pericolosi, input esterni trattati con fiducia,
permessi troppo larghi, assenza di guardrail operativi.
Per Doclify in particolare: protezione SSRF nel link checker, path traversal,
eval su input utente.

**G — Testabilità.**
Aree dove è facile rompere senza accorgersene, test che non catturano
il rischio reale, buchi nei test attorno agli invarianti,
codice difficile da testare perché mal separato.

**H — Comprensibilità e manutenzione.**
Naming che nasconde il vero ruolo, astrazioni che complicano senza comprimere,
metodi che fanno troppe cose, file che richiedono troppo contesto esterno.

### Fase 3 — Costruisci i findings

Per ogni problema trovato, assegna:
- ID temporaneo
- Titolo tecnico breve
- Area/modulo (file e funzioni specifiche)
- Severità: critical / high / medium / low
- Confidenza: alta / media / bassa
- Categoria: bug / rischio / debito / architettura / performance / sicurezza / testabilità / DX
- Evidenza concreta
- Possibile causa radice
- Rischio se ignorato

Regole di raggruppamento:
- Se due sintomi hanno la stessa causa radice, puoi tenerli insieme solo se la causa è veramente una
- Se un sintomo nasce da due problemi distinti, separalo
- Nel dubbio, separa. Issue piccole e precise > issue omnibus

### Fase 4 — Filtro qualità

Per ogni finding, verifica:

1. Atomicità — descrive davvero un solo problema?
2. Prova — c'è evidenza concreta nel codice?
3. Impatto — si capisce perché importa?
4. Causa — sto descrivendo il meccanismo o solo il sintomo?
5. Non banalità — è una issue utile o un gusto stilistico mascherato?
6. Confine — il fix ha un perimetro leggibile?

Se non passa, riscrivi o scarta.

### Fase 5 — Report finale

Presenta i findings ordinati per severità (critical → low).

Per ogni finding, formato:

```
### [ID] — [Titolo]

**Severità:** critical/high/medium/low
**Confidenza:** alta/media/bassa
**Area:** src/file.mjs — funzione()

**Problema:**
[1-2 frasi nette su cosa non va]

**Evidenza:**
[File, funzioni, branch logici, condizioni — specifici]

**Perché è un problema:**
[Impatto concreto: correttezza, rischio, manutenzione, performance, sicurezza]

**Direzione suggerita:**
[Cosa fare, senza scrivere il codice. Alternativa concreta.]

**Criterio di "done":**
[Come verifichi che il problema è risolto]
```

Alla fine, scrivi un sommario:
- Totale findings per severità
- Le 3 aree di rischio più alte
- La raccomandazione su cosa affrontare per primo e perché

NON scrivere codice. NON aprire issue automaticamente.
Mostra il report e aspetta indicazioni.
