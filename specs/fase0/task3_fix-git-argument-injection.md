# Fix git argument injection

> Fase: 0 | Task: 3 | Effort stimato: S

## Il problema

Oggi `src/diff.mjs` valida `base` solo contro metacaratteri shell (`;`, `|`, `&`, ...), ma non blocca i valori che iniziano con `-`. Questo significa che un input pensato come ref Git puo diventare un'opzione di `git diff` invece di un riferimento, alterando il comando eseguito.

Il bug non dipende dalla shell injection classica, perche usiamo `spawnSync` con array argomenti. Il problema e piu sottile: option injection nel comando Git. Se `base` e `--qualcosa`, Git lo interpreta come flag e non come ref, con effetti imprevedibili sul risultato e sulla sicurezza operativa.

Nelle task precedenti di Fase 0 abbiamo gia introdotto guardrail fail-fast su input pericolosi (`rules-loader`, `report`). Qui il residuo e lo stesso pattern: input utente non affidabile accettato troppo a lungo nel flusso.

## La soluzione

Rendere `assertSafeBaseRef()` responsabile anche del vincolo semantico "un ref non puo iniziare con `-`". Se il valore `base` inizia con `-`, il modulo `diff` deve fallire immediatamente con errore esplicito, prima di invocare Git.

## Come funziona

Il flusso attuale resta invariato: `getChangedFiles()` chiama `buildGitArgs()`, che chiama `assertSafeBaseRef()`, poi esegue `spawnSync('git', args)`. Cambia solo la validazione in ingresso.

Caso concreto: un consumer programmatico chiama `getChangedFiles({ base: '--force' })`.

1. `buildGitArgs()` entra nel ramo non staged.
2. `assertSafeBaseRef('--force')` rileva il prefisso `-`.
3. Lancia `Error` con messaggio user-facing.
4. `getChangedFiles()` non invoca Git.
5. Il chiamante riceve un errore deterministico e tracciabile.

Sotto il cofano la modifica e locale:

```js
function assertSafeBaseRef(base) {
  if (typeof base !== 'string' || base.length === 0 || FORBIDDEN_BASE_CHARS_RX.test(base)) {
    throw new Error('Invalid --base value: contains forbidden shell metacharacters');
  }
  if (base.startsWith('-')) {
    throw new Error('Invalid --base value: must not start with "-"');
  }
}
```

Il check resta centralizzato in `diff.mjs`, cosi copre sia CLI sia uso API interno/esterno senza duplicare logica.

## Decisioni e trade-off

Scelta: bloccare qualsiasi `base` che inizi con `-`.
Perche: e la guardia minima necessaria per impedire option injection su `git diff` con costo implementativo quasi nullo.
Costo: eventuali nomi di ref non convenzionali con prefisso `-` verranno rifiutati.

Scelta: mantenere il controllo in `src/diff.mjs` invece che nel parser CLI.
Perche: il parser CLI gia filtra molti casi, ma non e un confine di sicurezza sufficiente per gli usi programmatici (`getChangedFiles()` chiamato da codice).
Costo: la validazione viene eseguita anche quando i dati provengono da path gia "fidati" nel layer superiore.

Alternativa scartata: risolvere sempre il ref a commit SHA via comando Git separato (`rev-parse`) e usare solo hash.
Perche scartata: introduce round-trip aggiuntivo e superficie error handling piu ampia per un bug che la roadmap chiede di chiudere in modo mirato.
Costo della rinuncia: non otteniamo una normalizzazione completa del ref, solo un guardrail di sicurezza.

## File da toccare

`src/diff.mjs` — MODIFICA  
Estendere `assertSafeBaseRef()` con il check su prefisso `-` e messaggio errore dedicato.

`test/guardrail.test.mjs` — MODIFICA  
Aggiungere regression test su `getChangedFiles`/`getChangedMarkdownFiles` con base che inizia con `-`, verificando che l'errore sia lanciato prima di eseguire Git.

`tasks/ROADMAP.md` — MODIFICA  
Aggiornare lo stato della task corrente da `todo` a `specified`.

## Edge case

Casi gestiti:
- `base` con metacaratteri shell resta rifiutato come oggi.
- `base` con prefisso `-` viene rifiutato esplicitamente.
- `base` valido (`HEAD`, `main`, `origin/main`, hash commit) continua a funzionare invariato.

Casi non gestiti (accettabile ora):
- Validazione semantica completa dell'esistenza del ref prima del `git diff`.
- Sanitizzazione di refname complessi oltre al vincolo richiesto dalla task.

## Criteri di done

1. `getChangedFiles({ base: '--force' })` lancia errore con messaggio chiaro su prefisso non valido.
2. `getChangedMarkdownFiles({ base: '--force' })` propaga lo stesso errore.
3. Un caso valido (`base: 'HEAD'`) continua a restituire un array senza regressioni.
4. Il test CLI gia esistente su metacaratteri (`HEAD; ...`) resta verde.
5. Suite test locale (`node --test test/guardrail.test.mjs`) passa senza nuovi flaky test.

## Note per chi implementa

Mantieni il pattern corrente del progetto: helper piccolo, `throw new Error(...)`, nessuna dipendenza esterna.

Nei test segui lo stile gia presente: fixture isolate con `makeTempDir()`, assert su frammenti stabili del messaggio, niente coupling con output completo di Git.

Non spostare logica in `index.mjs`: il boundary corretto e `diff.mjs`, cosi il guardrail resta valido anche fuori dalla CLI.
