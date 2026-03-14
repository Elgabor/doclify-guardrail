# task 4: Fix bug suppression map

> Fase: 0 | Task: 4 | Effort stimato: S

## Il problema

Oggi la mappa delle soppressioni inline in [`src/checker.mjs`](/Users/lorenzoborgato/Dev/doclify-guardrail-mvp/src/checker.mjs) ha un comportamento troppo aggressivo quando incontra `<!-- doclify-enable -->` senza lista regole: chiama `activeDisables.clear()` e cancella tutto, non solo il disable globale.

Il bug si vede in un caso reale che un team può scrivere senza malizia: disabilita `placeholder` per tutto il file, apre un blocco temporaneo con `doclify-disable` (globale), poi chiude quel blocco con `doclify-enable`. A quel punto il disable specifico `placeholder` dovrebbe restare attivo, ma viene perso. Il risultato è rumore inatteso nei warning e perdita di fiducia nelle direttive di soppressione.

Nelle task precedenti di fase 0 abbiamo blindato input e output per evitare effetti collaterali invisibili. Qui il problema residuo è simile: una direttiva legittima produce uno stato interno incoerente e quindi un comportamento sorprendente per l’utente.

## La soluzione

Quando `doclify-enable` è usato senza regole, dobbiamo chiudere solo il disable globale (`*`) e lasciare intatti i disable specifici (`rule-id`). In pratica: sostituire la cancellazione completa con una rimozione mirata della chiave `*` nel tracking interno delle soppressioni.

## Come funziona

Il flusso resta quello attuale: `checkMarkdown()` costruisce la suppression map una volta, poi filtra i finding con `isSuppressed()`. Cambia solo la semantica del ramo `doclify-enable` senza argomenti dentro `buildSuppressionMap()`.

Esempio concreto:

```md
# Title
<!-- doclify-disable placeholder -->
TODO A
<!-- doclify-disable -->
TODO B
<!-- doclify-enable -->
TODO C
```

Con comportamento corretto, `TODO A`, `TODO B`, `TODO C` restano tutti soppressi per `placeholder`: il blocco globale copre solo la finestra centrale, ma il disable specifico sopravvive anche dopo la sua chiusura.

Sotto il cofano, la logica del ramo di chiusura diventa:

```js
if (ruleIds === null) {
  // chiude solo il disable globale
  activeDisables.delete('*');
} else {
  // comportamento invariato: decremento o delete per regole esplicite
}
```

Il resto della macchina a stati (`Map` con contatori, supporto a nesting, apply per linea) resta invariato.

## Decisioni e trade-off

Scelta: fix minimale sulla riga incriminata, senza riscrivere `buildSuppressionMap`.
Perché: il bug è locale e riproducibile; una riscrittura completa alza rischio regressioni su sintassi già coperta da test.
Costo: manteniamo la complessità attuale della funzione e non semplifichiamo l’architettura in questa task.

Scelta: preservare il modello attuale `Map<ruleId, count>`.
Perché: il counting supporta nesting e chiusure progressive, già usato dai rami `doclify-disable <rules>` / `doclify-enable <rules>`.
Costo: il codice resta meno immediato di un modello booleano.

Alternativa scartata: reinterpretare `doclify-enable` senza argomenti come “reset totale”.
Perché scartata: rompe il contratto descritto dalla roadmap e introduce effetto collaterale su disable specifici già attivi.
Costo della rinuncia: nessuno pratico; perdiamo solo una semantica più aggressiva che oggi è fonte del bug.

## File da toccare

- `src/checker.mjs` — MODIFICA  
  Nel ramo `SUPPRESS_BLOCK_END_RX` con `ruleIds === null`, sostituire `activeDisables.clear()` con rimozione mirata del disable globale (`activeDisables.delete('*')`), mantenendo invariata la logica su regole esplicite.

- `test/guardrail.test.mjs` — MODIFICA  
  Aggiungere un regression test dedicato al caso “disable specifico + disable globale + enable globale” che verifica la persistenza della soppressione specifica dopo la chiusura del blocco globale.

## Edge case

Casi gestiti:
- nesting tra disable specifici e disable globale;
- `doclify-enable <rule>` continua a decrementare solo la regola indicata;
- file con sole direttive globali mantiene comportamento atteso (abilita/disabilita tutto a blocchi).

Casi non gestiti (accettabile ora):
- validazione sintattica forte di ID regole inesistenti nelle direttive;
- warning dedicati per direttive sbilanciate o ridondanti.

## Criteri di done

1. Con `<!-- doclify-disable placeholder -->` seguito da blocco `<!-- doclify-disable --> ... <!-- doclify-enable -->`, i finding `placeholder` dopo `doclify-enable` restano soppressi.
2. Un caso base con solo `<!-- doclify-disable --> ... <!-- doclify-enable -->` continua a riabilitare i finding fuori dal blocco.
3. I test esistenti di inline suppression in [`test/guardrail.test.mjs`](/Users/lorenzoborgato/Dev/doclify-guardrail-mvp/test/guardrail.test.mjs) restano verdi senza adattamenti non necessari.
4. Non ci sono cambiamenti nei codici/linee dei finding fuori dal perimetro suppression.

## Note per chi implementa

Segui il pattern corrente del file: mutazioni locali su `Map`, niente nuova dipendenza, niente estrazione prematura di helper se non serve al fix.

Il punto fragile è la semantica di `ruleIds === null`: in quel ramo “all rules” non significa “cancella ogni stato”, significa “operare sulla chiave wildcard”. Mantieni questa distinzione netta anche nei test.

Riusa lo stile test attuale: fixture Markdown inline, filtro per `code === 'placeholder'`, assert su linee per provare che la soppressione persiste nel punto giusto.
