# Testing — Doclify Guardrail

## Struttura test

```
test/
└── guardrail.test.mjs   ← file unico con tutti i test
```

Tutti i test (regole, fix, score, integrazione CLI, link checker, ecc.) sono in un singolo file.
Le fixture sono inline nel test o create come file temporanei tramite `makeTempDir()`.

## Come scrivere un test

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMarkdown } from '../src/index.mjs';

test('nome-regola: should detect problem', () => {
  const result = checkMarkdown('contenuto markdown con errore');
  assert.ok(result.warnings.length > 0);
  assert.equal(result.warnings[0].code, 'nome-regola');
});

test('nome-regola: should pass for valid content', () => {
  const result = checkMarkdown('# Valid\n\nGood doc.\n');
  const matching = result.warnings.filter(w => w.code === 'nome-regola');
  assert.equal(matching.length, 0);
});
```

## Convenzioni

- Usa `node:test` e `node:assert/strict` — NO jest, NO mocha (zero deps)
- Un `test()` per caso, raggruppati per funzionalità nel file
- Nomi test: `nome-regola: should <verbo> for/when <condizione>`
- Fixture inline nel test o via `makeTempDir()` per test filesystem
- I test di integrazione CLI lanciano `src/index.mjs` come child_process via `spawn`

## Comandi rapidi

```bash
node --test test/guardrail.test.mjs               # tutto
node --test --test-name-pattern "heading"          # solo test con "heading" nel nome
node --test --test-reporter spec test/guardrail.test.mjs  # output verbose
```
