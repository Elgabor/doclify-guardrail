# Workflow: Scrivere una specifica

Scrivi specifiche come saggi tecnici nello stile di Antirez.
Non documentazione burocratica — documenti che un dev legge e dice
"ok, ho capito cosa costruire e perché".

## Contesto

Leggi questi file per capire il progetto prima di iniziare:
- CLAUDE.md (overview progetto e convenzioni)
- docs/plans/PLAN-Q2-2026.md (roadmap e decisioni di prodotto)
- agent-docs/architecture.md (struttura codebase)

Identifica la feature "$ARGUMENTS" nel piano. Leggi il codice sorgente
correlato in src/ per capire lo stato attuale.

## Principi

- Scrivi in prosa narrativa. I bullet point solo per liste brevi (max 5 elementi).
- Ogni paragrafo contiene UNA idea. Se ne contiene due, spezzalo.
- Il lettore deve capire il PERCHÉ prima del COSA.
- Trade-off espliciti: ogni scelta ha un costo. Se non lo dichiari, stai nascondendo qualcosa.
- Esempi concreti battono descrizioni astratte. Mostra un caso d'uso reale con nomi veri.
- Le alternative scartate vanno documentate.
- I termini tecnici vanno definiti la prima volta che appaiono.
- Nessuna sezione supera una pagina.
- Mai scrivere "TBD" senza specificare QUANDO sarà deciso e COSA lo blocca.

## Processo — segui le fasi in ordine

### Fase 1 — Capire il problema

Prima di scrivere qualsiasi soluzione, fai queste domande UNA ALLA VOLTA
aspettando la risposta:

1. "Cosa non funziona oggi? Descrivi il dolore concreto.
    Non 'sarebbe bello avere X' ma 'oggi quando succede Y devo fare Z
    ed è un problema perché...'"
2. "Per chi è questa feature? Chi è l'utente e cosa sta cercando di fare?"
3. "Cosa significa 'fatto'? Film mentale completo: l'utente apre l'app,
    fa cosa, vede cosa, e dice 'ok, funziona'."
4. "Vincoli duri? Tempo, tech, compatibilità, cose che NON devi rompere."

Per Doclify il vincolo duro è sempre: zero dipendenze nel core CLI.

Quando hai tutte le risposte, riassumi in 3-4 frasi e chiedi: "Ho capito bene?"

### Fase 2 — Modello mentale

Prima di qualsiasi dettaglio tecnico, presenta:

Il modello in 3 frasi — l'idea centrale, come la spiegheresti a un dev in ascensore.

Le strutture dati — quali entità esistono, che relazione hanno.
Schema concettuale, non schema DB. Diagramma ASCII se aiuta.

Il flusso principale — in sequenza narrativa, dal trigger all'output.
Nessun edge case ancora.

Chiedi: "Questo cattura quello che hai in mente?"
Se no, itera qui. Non si va avanti con un modello sbagliato.

### Fase 3 — Scrivere la specifica

Scrivi la spec in docs/specs/SPEC-$ARGUMENTS.md seguendo questa struttura:

```
# [Nome Feature] — Design Document

## Il problema
[2-3 paragrafi: situazione attuale, perché è un problema, per chi.
Chiunque legga deve sentire il dolore.]

## L'idea
[1 paragrafo: il concetto centrale, senza dettagli implementativi.
La versione "spiegata al bar".]

## Come funziona
[Narrativa del flusso principale con esempio concreto.
"Marco installa doclify, lancia X, vede Y, il CI fa Z."
Poi cosa succede sotto il cofano, passo per passo.]

## Il modello
[Strutture dati centrali, relazioni, invarianti.
Diagramma ASCII o pseudo-schema se serve.
Definisci ogni termine tecnico specifico.]

## Decisioni e trade-off
[Per ogni decisione non ovvia, in prosa:]
[— Cosa ho scelto e il ragionamento]
[— Cosa ho scartato e perché non funzionava]
[— Il costo esplicito di questa scelta]

## Edge cases e limiti
[Casi considerati e come li gestisco.]
[Casi che NON gestisco e perché è accettabile per ora.]

## File coinvolti
[Per ogni file: path esatto, cosa cambia, se è nuovo o modificato.]
[Verifica che ogni file referenziato esiste nel repo o è marcato NUOVO.]

## Test cases
[Per ogni caso: input, output atteso, cosa verifica.]
[Includi: caso normale, caso limite, caso di errore.]

## Piano di implementazione
[Fasi ordinate. Ogni fase produce qualcosa di testabile.]
[Fase 1 è sempre la più piccola cosa utile.]

## Criteri di accettazione
[Checklist con checkbox. Ogni criterio è verificabile con un test o comando.]
- [ ] ...
- [ ] ...

## Domande aperte
[Cose che non so ancora. Per ognuna: quando va decisa e cosa blocca.]
```

### Fase 4 — Quality check

Valuta la spec contro questi 5 test. Riporta il punteggio (1-10):

1. Test del nuovo dev — Un dev che non conosce il progetto capisce
   cosa costruire leggendo solo questo documento?

2. Test dell'ambiguità — C'è qualche frase che due dev interpreterebbero
   in modo diverso? Se sì, riscrivi.

3. Test del "perché" — Ogni decisione ha un perché esplicito?

4. Test della completezza minima — Abbastanza per iniziare a scrivere
   codice senza fermarsi a chiedere? Non di più.

5. Test del taglio — Posso togliere una sezione senza perdere info critica?

Se qualsiasi punteggio è sotto 7, riscrivi quella sezione e ri-valuta.
Mostra i punteggi finali.

La spec è pronta per essere usata come input diretto per l'implementazione.
NON scrivere codice. Solo la spec. Mostra il risultato e aspetta conferma.
