# task 5: Fix crash filesystem

> Fase: 0 | Task: 5 | Effort stimato: S

## Il problema

Nel ramo `--fix`, Doclify modifica il contenuto in memoria e poi prova a fare `fs.writeFileSync(...)` direttamente dentro `runScan()` in [`src/index.mjs`](/Users/lorenzoborgato/Dev/doclify-guardrail-mvp/src/index.mjs). Se il filesystem rifiuta la scrittura (permessi, path sparito, disco pieno, mount read-only), oggi il dettaglio utente dipende da un errore grezzo di sistema.

Il punto dolente e che l'utente non sta facendo una operazione "esotica": sta usando una feature core (`--fix`). Quando fallisce in scrittura, quello che serve non e un codice errno crudo ma un messaggio che dica chiaramente quale file non e stato scritto e che il problema e I/O, non parsing markdown.

Nelle task precedenti di Fase 0 abbiamo chiuso vulnerabilita da input non fidato e comportamenti sorprendenti (`rules-loader`, `report`, `diff`, suppression map). Qui il residuo e di robustezza operativa: il comando non deve sembrare "rotto" quando fallisce una write, deve fallire in modo leggibile.

## La soluzione

Introduciamo un boundary di errore locale attorno alla write dei fix: intercettiamo il fallimento di `writeFileSync`, lo traduciamo in errore user-facing con path del file e causa, e lasciamo invariato il flusso generale che raccoglie `fileErrors` senza crash globale.

## Come funziona

Il flusso rimane quello esistente: Doclify legge il file, applica fix link/formattazione, poi decide se scrivere. La differenza e nel punto di write: invece di chiamare direttamente `fs.writeFileSync`, incapsuliamo il blocco in `try/catch` e rilanciamo un errore normalizzato.

Scenario concreto: `doclify docs/ --fix` su un file reso read-only tra read e write.

1. `runScan()` calcola `fixed` e/o `formatted` come oggi.
2. Entra nel ramo `!args.dryRun && (fixed.modified || formatted.modified)`.
3. Prova la write in `try`.
4. Se fallisce, costruisce un errore esplicito tipo:
   `Unable to write fixed file "<relative-or-absolute-path>": EACCES: permission denied`
5. Il `catch` esterno per-file di `runScan()` continua a convertire questo errore in `fileErrors[]`, quindi niente stack trace, niente crash dell'intera run.

Snippet atteso:

```js
if (!args.dryRun && (fixed.modified || formatted.modified)) {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    recordSelfWrite(opts.watchState, filePath);
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    throw new Error(`Unable to write fixed file "${toRelativePath(filePath)}": ${reason}`);
  }
}
```

Il punto importante e la semantica: non nascondiamo la causa originale, la rendiamo leggibile e contestualizzata.

## Decisioni e trade-off

Scelta: `try/catch` locale nel ramo write di `runScan()`, non un handler globale.
Perche: l'errore va contestualizzato con il file specifico nel momento in cui avviene. Un wrapper globale perde precisione e rischia messaggi ambigui.
Costo: piccola duplicazione di pattern rispetto ad altri writer (`report`, `junit`, `sarif`, `badge`) che hanno gia un proprio catch.

Scelta: rilanciare `Error` con prefisso user-facing e dettaglio originale.
Perche: il prefisso rende chiaro il dominio ("fixed file write"), il dettaglio conserva diagnostica utile.
Costo: il messaggio finale contiene una parte dipendente dalla piattaforma (`EACCES`, `EROFS`, etc.), quindi i test devono assertare su frammenti stabili.

Alternativa scartata: intercettare errore e fare solo log warning continuando la run come se nulla fosse.
Perche scartata: sarebbe fuorviante; l'utente chiedeva `--fix`, quindi una write fallita deve restare un fallimento verificabile.
Costo della rinuncia: niente "best effort silent mode", ma comportamento piu corretto per CI.

## File da toccare

- `/Users/lorenzoborgato/Dev/doclify-guardrail-mvp/src/index.mjs` - MODIFICA  
  Inserire `try/catch` locale attorno a `fs.writeFileSync` nel ramo `--fix` e rilanciare errore contestualizzato con path file.

- `/Users/lorenzoborgato/Dev/doclify-guardrail-mvp/test/guardrail.test.mjs` - MODIFICA  
  Aggiungere test CLI che simula file non scrivibile durante `--fix` e verifica: nessun crash, exit non-zero, messaggio `fileErrors` chiaro con prefisso nuovo.

- `/Users/lorenzoborgato/Dev/doclify-guardrail-mvp/tasks/roadmap.md` - MODIFICA  
  Aggiornare stato della task da `todo` a `specified` dopo la creazione della spec.

## Edge case

Casi gestiti:
- file diventato read-only tra lettura e scrittura;
- path eliminato/spostato tra lettura e scrittura;
- errore I/O generico senza `message` standard (fallback su `String(err)`).

Casi non gestiti (accettabile ora):
- retry automatico su errori transitori;
- classificazione fine per errno con suggerimenti diversi per ogni OS;
- rollback di fix applicati ad altri file gia scritti in precedenza nella stessa run.

## Criteri di done

1. Eseguendo `doclify <file> --fix` su un file non scrivibile, il processo non termina con stack trace non gestito.
2. L'output JSON contiene `fileErrors` con errore che include prefisso `Unable to write fixed file`.
3. Il messaggio errore include il path del file target e conserva il motivo originale del sistema (es. `EACCES`/`EROFS`/`ENOENT`).
4. Un caso nominale `--fix` su file scrivibile continua a funzionare senza regressioni.
5. I test preesistenti relativi a `--fix`, `--dry-run` e report restano verdi.

## Note per chi implementa

Seguire il pattern gia usato nel progetto: errori user-facing sintetici, nessuna nuova dipendenza, e assert test su substring stabili invece che su messaggio completo.

Mantenere `recordSelfWrite(...)` nello stesso blocco `try` dopo la write riuscita: se la write fallisce non deve essere registrata come self-write in watch mode.

Non spostare logica in moduli nuovi: il fix e locale a `runScan()` e deve restare li per coerenza con il flusso attuale.
