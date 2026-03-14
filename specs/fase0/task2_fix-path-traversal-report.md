# Fix path traversal in report

> Fase: 0 | Task: 2 | Effort stimato: S

## Il problema

Oggi `generateReport()` in `src/report.mjs` prende `--report`, fa `path.resolve()` e scrive subito su disco. Questo significa che un path come `../outside.md` o `/tmp/report.md` viene accettato senza guardrail, anche se esce dal workspace corrente.

Il problema non e teorico. Se Doclify gira in CI o in una macchina condivisa, un input malevolo o sbagliato puo causare scritture fuori progetto, con impatti che vanno da artefatti sporchi a overwrite di file non previsti. Per l’utente il sintomo e invisibile: il comando “funziona”, ma ha scritto dove non doveva.

Nella task precedente abbiamo introdotto un fail-fast di sicurezza nel loader delle custom rules. Il pattern e lo stesso: bloccare input pericolosi vicino al punto d’uso, con errore esplicito. Qui il problema residuo e il path output del report.

## La soluzione

Prima della `writeFileSync`, validiamo che il path finale del report sia dentro `process.cwd()`. Se il candidato esce dal boundary, fermiamo tutto con errore leggibile e non scriviamo nulla.

## Come funziona

Il flusso resta identico fino alla fase finale di `generateReport()`: costruzione markdown, `resolvedPath`, scrittura su disco. Inseriamo un gate tra resolve e write.

Caso concreto: l’utente esegue `doclify docs/ --report ../outside.md` dalla root repo.

1. `index.mjs` passa `args.report` a `generateReport(output, { reportPath })`.
2. `report.mjs` risolve il path assoluto (`resolvedPath`).
3. Nuovo check `isDescendantOrSame(resolvedPath, process.cwd())`.
4. Se `false`, `generateReport()` lancia errore: path non consentito fuori workspace.
5. `index.mjs` mantiene il comportamento esistente: stampa `Failed to write report: ...` e termina con exit code `2`.

Sotto il cofano servono due helper locali in `report.mjs`:

```js
function canonicalizeForBoundaryCheck(targetPath) {
  // realpath del file se esiste; altrimenti realpath della parent + basename
}

function isDescendantOrSame(candidatePath, basePath) {
  // confronto via path.relative su path canonici
}
```

La canonicalizzazione della parent evita bypass banali via symlink gia esistenti.

## Decisioni e trade-off

Scelta: boundary fisso su `process.cwd()`.
Perche: e il contratto implicito della CLI oggi (scan/output relativi al cwd) ed e quello richiesto dalla roadmap.
Costo: non si puo piu scrivere report in path esterni anche per casi legittimi.

Scelta: fail-fast con `throw` dentro `generateReport()`.
Perche: mantiene la separazione dei ruoli attuale; `index.mjs` resta orchestratore e converte in messaggio utente + exit code.
Costo: chi usa API interna deve gestire l’eccezione, ma e gia il pattern del modulo.

Scelta: helper locale in `report.mjs` invece di esportare utility da `config-resolver`.
Perche: riduce coupling fra moduli che hanno responsabilita diverse.
Costo: piccola duplicazione logica (`isDescendantOrSame`) da tenere allineata.

Alternativa scartata: introdurre una allowlist/flag `--unsafe-report-path`.
Perche non ora: complica UX e superficie sicurezza in una fase che deve chiudere vulnerabilita note.
Costo della rinuncia: meno flessibilita per chi vuole output fuori repo.

## File da toccare

- `src/report.mjs` — MODIFICA  
  Aggiungere validazione di boundary prima della scrittura del report, con helper di canonicalizzazione path + check discendenza.

- `test/guardrail.test.mjs` — MODIFICA  
  Aggiungere test unit (`generateReport` rifiuta path fuori cwd) e test CLI (`--report ../outside.md` fallisce con exit `2` e messaggio chiaro).

- `tasks/roadmap.md` — MODIFICA  
  Aggiornare stato task da `todo` a `specified` dopo la scrittura della spec.

## Edge case

Casi gestiti:
- Path relativo con traversal (`../...`) rifiutato.
- Path assoluto fuori `cwd` rifiutato.
- Path dentro `cwd` (anche annidato) accettato.
- Path con symlink nella parent gia esistente valutato su path canonico.

Casi non gestiti (accettabile ora):
- Creazione automatica directory mancanti per il report (comportamento invariato).
- Policy diverse da `cwd` (es. boundary su git root o flag custom).

## Criteri di done

1. `generateReport(output, { reportPath: '../outside.md' })` lancia errore con testo che indica chiaramente il vincolo “inside workspace”.
2. CLI con `--report ../outside.md` termina con exit code `2` e stampa `Failed to write report: ...`.
3. CLI con `--report doclify-report.md` continua a scrivere correttamente il report nel progetto.
4. Non ci sono regressioni nei test esistenti su report (`generateReport` e `--report`).

## Note per chi implementa

Resta coerente con lo stile corrente: helper piccoli nel modulo, `throw new Error(...)` con messaggi user-facing, niente side effect nascosti.

Nei test segui il pattern gia usato in suite: `makeTempDir()`, `spawnSync`, assert su sottostringhe stabili del messaggio invece di matchare l’intera frase.

Non spostare la responsabilita in `index.mjs`: il controllo va in `report.mjs`, cosi copre sia CLI sia uso programmatico.
