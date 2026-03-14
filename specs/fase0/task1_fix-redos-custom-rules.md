# task 1: Fix ReDoS nelle custom rules

> Fase: 0 | Task: 1 | Effort stimato: S

## Il problema

Oggi `doclify` accetta qualunque regex nelle custom rules e la compila direttamente con `new RegExp()` in [`src/rules-loader.mjs`](/Users/lorenzoborgato/Dev/doclify-guardrail-mvp/src/rules-loader.mjs). Questo e un problema pratico, non teorico: basta una regola come `(a+)+$` e la scansione puo andare in catastrophic backtracking su input sfavorevoli, bloccando la CPU per molto tempo.

Il danno non e solo per chi scrive la regola. Se la rule file finisce in repo e viene usata in CI, l'intera pipeline puo diventare lenta o apparentemente "appesa", con diagnosi difficile. L'utente vede solo che `doclify` non finisce, ma la causa reale e nascosta nella regex.

In questa fase non ci sono task precedenti gia specificate o implementate da ereditare. Quindi il problema residuo e ancora integro: manca un guardrail minimo di sicurezza prima della compilazione.

## La soluzione

Aggiungiamo una validazione preventiva in `rules-loader`: prima di compilare la regex, analizziamo la stringa pattern e rifiutiamo pattern con nested quantifier ad alto rischio (gruppo quantificato che contiene gia quantificatori). Se il pattern e pericoloso, fermiamo subito il caricamento con errore esplicito e actionable.

## Come funziona

Il flusso resta quello attuale: `index` chiama `loadCustomRules()`, che valida ogni regola. La differenza e che `validateCustomRule()` inserisce uno step in piu prima di `new RegExp()`.

Concretamente:

1. `validateCustomRule()` continua a validare `id`, `pattern`, `message`, `severity`.
2. Prima della compilazione chiama una funzione dedicata, ad esempio `assertRegexIsSafe(rule.pattern, rule.id)`.
3. La funzione cerca nested quantifier potenzialmente esplosivi, per esempio:
   - `(a+)+`
   - `([a-z]+)*`
   - `(\w*)+`
4. Se trova un match pericoloso, lancia `Error` con messaggio chiaro:
   - include `rule.id`
   - spiega che il pattern e rifiutato per rischio ReDoS
5. Se il check passa, si procede con `new RegExp(...)` come oggi.

Snippet atteso (firma e intenzione):

```js
function assertRegexIsSafe(pattern, ruleId) {
  if (hasNestedQuantifier(pattern)) {
    throw new Error(`Rule "${ruleId}": unsafe regex pattern (possible ReDoS via nested quantifier)`);
  }
}
```

Lato CLI non serve nuova logica: l'errore viene gia propagato da `loadCustomRules()` e stampato come `Custom rules error: ...` in [`src/index.mjs`](/Users/lorenzoborgato/Dev/doclify-guardrail-mvp/src/index.mjs).

## Decisioni e trade-off

Scelta: validazione euristica locale (zero dependency) in `rules-loader`.
Perche: il progetto mantiene una filosofia zero-deps nel core CLI; per questo task basta bloccare il caso peggiore richiesto da roadmap senza introdurre parser regex completo.
Costo: non intercettiamo ogni possibile forma di ReDoS, ma riduciamo il rischio principale subito.

Scelta: fail-fast al caricamento della regola.
Perche: meglio errore immediato e leggibile rispetto a hang runtime durante scan.
Costo: alcune regex borderline ma legittime potrebbero essere rifiutate (falso positivo conservativo).

Alternativa scartata: introdurre libreria esterna tipo safe-regex.
Perche scartata: aumenta superficie dipendenze e complessita manutentiva per un fix che deve essere rapido e mirato.
Costo della rinuncia: minor completezza analitica rispetto a un parser dedicato.

## File da toccare

[`/Users/lorenzoborgato/Dev/doclify-guardrail-mvp/src/rules-loader.mjs`](/Users/lorenzoborgato/Dev/doclify-guardrail-mvp/src/rules-loader.mjs) - MODIFICA  
Inserire check di sicurezza regex prima di `new RegExp()`, con helper locale per detection nested quantifier e messaggio errore chiaro.

[`/Users/lorenzoborgato/Dev/doclify-guardrail-mvp/test/guardrail.test.mjs`](/Users/lorenzoborgato/Dev/doclify-guardrail-mvp/test/guardrail.test.mjs) - MODIFICA  
Aggiungere regression test su `loadCustomRules` (pattern pericoloso rifiutato) e smoke test CLI (`--rules` con pattern pericoloso -> exit 2 + errore esplicito).

## Edge case

Casi gestiti:
- Pattern chiaramente nested quantifier vengono bloccati prima della compilazione.
- Pattern malformati restano gestiti dal ramo gia esistente `invalid regex`.
- Pattern semplici e legittimi (senza nested quantifier) continuano a funzionare invariati.

Casi non gestiti (accettabile in questa task):
- Tutte le forme non banali di ReDoS non basate su nested quantifier.
- Analisi semantica completa di escape avanzati, lookaround complessi, backreference pathological.

Il perimetro e coerente con la roadmap: fix mirato e testabile, non motore di analisi regex completo.

## Criteri di done

- Con un `rules.json` contenente `(a+)+$`, `loadCustomRules()` lancia errore che contiene `Rule "..."` e riferimento al rischio ReDoS.
- Con un pattern sicuro (es. `\\bfoo\\b`) `loadCustomRules()` continua a compilare la regex senza regressioni.
- CLI con `--rules` puntato a file contenente regex pericolosa termina con exit code `2` e stderr con prefisso `Custom rules error:`.
- I test gia esistenti su malformed JSON e invalid regex restano verdi.

## Note per chi implementa

Segui il pattern attuale di `rules-loader`: funzioni pure piccole, `throw new Error(...)` con messaggi orientati all'utente, nessun side effect.

Nei test resta coerente con lo stile corrente in [`test/guardrail.test.mjs`](/Users/lorenzoborgato/Dev/doclify-guardrail-mvp/test/guardrail.test.mjs): `node:test`, fixture temporanee con `makeTempDir()`, assert su porzioni di messaggio invece che su stringa intera rigida.

Evita di spostare logica in `index`: il punto giusto e il loader, cosi API programmatica e CLI ricevono la stessa protezione.
