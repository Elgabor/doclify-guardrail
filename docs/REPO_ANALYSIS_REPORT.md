# Doclify Guardrail MVP — Analisi Completa della Repository

**Data:** 2026-02-14
**Versione analizzata:** 0.1.0 (package.json) / 0.2 (output JSON)
**Commit:** `a38576d` — `chore: bootstrap doclify guardrail mvp v0.2`
**Totale file:** 9 (268 LoC sorgente, 105 LoC test, 27 LoC script)

---

## 1. ARCHITETTURA

### Struttura cartelle e file

```
doclify-guardrail-mvp/
├── .gitignore                  # node_modules/, *.log, .DS_Store
├── package.json                # Manifest NPM, zero dipendenze esterne
├── README.md                   # Documentazione (95 righe, italiano)
├── TODO.md                     # Stato P0/P1 (26 righe)
├── sample.md                   # File markdown di esempio (7 righe)
├── scripts/
│   └── demo.sh                 # Demo terminale (27 righe)
├── src/
│   └── index.mjs               # Unico sorgente CLI (268 righe)
└── test/
    └── guardrail.test.mjs      # Test suite (105 righe)
```

**Assenti:** `.github/`, `.husky/`, `docs/`, `LICENSE`, `CHANGELOG.md`, `.editorconfig`, qualsiasi config linter/formatter.

### Entry point CLI

- **File:** `src/index.mjs:1` — shebang `#!/usr/bin/env node`
- **Invocazione:** `node ./src/index.mjs <file.md> [opzioni]` oppure `doclify-guardrail <file.md>` (via `bin` in package.json)
- **Flag accettati:** `--strict`, `--max-line-length <n>`, `--config <path>`, `--debug`, `-h`/`--help`
- **Parsing:** funzione custom `parseArgs()` (`src/index.mjs:97-162`) — loop manuale su `argv`, nessuna libreria (yargs, commander, ecc.)
- **Guard entry:** `src/index.mjs:264` — `if (import.meta.url === \`file://${process.argv[1]}\`) process.exit(runCli())`

### Pipeline di esecuzione

```
argv
 → parseArgs()          (src/index.mjs:97)   — estrae file, flag, configPath
 → resolveOptions()     (src/index.mjs:164)  — merge CLI → config file → defaults
 → fs.readFileSync()    (src/index.mjs:240)  — legge il file markdown
 → checkMarkdown()      (src/index.mjs:30)   — applica 5 regole, produce errors/warnings
 → buildResult()        (src/index.mjs:181)   — costruisce oggetto JSON con pass/fail
 → printHumanSummary()  (src/index.mjs:200)  — stampa 1 riga su stderr
 → JSON.stringify()     (src/index.mjs:260)  — output JSON su stdout
 → return exitCode      (src/index.mjs:261)  — 0=pass, 1=fail, 2=errore uso
```

### Dipendenze esterne

**Zero.** Il `package.json` non ha `dependencies` né `devDependencies`. Usa solo:
- `node:fs` — lettura file e config
- `node:path` — risoluzione path
- `node:test` + `node:assert/strict` — test runner (Node.js ≥20 built-in)
- `node:child_process` — `spawnSync` nei test per testare la CLI come processo

Questo è un punto di forza significativo: nessun `node_modules`, installazione istantanea.

### Pattern di codice

- **Funzionale procedurale**: nessuna classe, nessun OOP. Funzioni pure (quasi tutte) composte in sequenza.
- **No plugin system**: le 5 regole sono hardcoded dentro `checkMarkdown()`. Non esiste un meccanismo per registrare/caricare regole esterne.
- **No AST parsing**: il markdown viene analizzato con regex direttamente sulla stringa raw. Non usa `unified`, `remark`, `markdown-it`, o alcun parser.
- **Dual output**: stderr per il summary umano, stdout per il JSON machine-readable. Pattern buono per piping.

---

## 2. REGOLE IMPLEMENTATE

### 2.1 `single-h1` — Severity: **error**

- **File:** `src/index.mjs:39-44`
- **Logica:** regex `/^#\s.+$/gm` — conta le occorrenze di righe che iniziano con `# ` (H1 ATX). Se 0: errore "Manca titolo H1". Se >1: errore "Trovati N H1".
- **Test:** `test/guardrail.test.mjs:15-28` — testa happy path (1 H1 → 0 errori) e caso "nessun H1" (1 errore con code `single-h1`).
- **Limiti:**
  - **Non rileva H1 in blocchi code fenced** (` ```# Heading``` ` viene contato come H1). Fix: escludere righe dentro code blocks.
  - **Non rileva H1 Setext-style** (`Heading\n===`). Fix: aggiungere regex per Setext H1.
  - **Nessun test per H1 multipli.** Il branch `h1Matches.length > 1` non ha un test dedicato. Fix: aggiungere test con 2+ H1.

### 2.2 `frontmatter` — Severity: **warning**

- **File:** `src/index.mjs:35-37`
- **Logica:** controlla se `content.startsWith('---\n')`. Se no, warning.
- **Test:** `test/guardrail.test.mjs:30-33` — il test `warning su placeholder` ha implicitamente frontmatter mancante (il markdown inizia con `# Titolo`), ma non c'è un test dedicato che asserisca la presenza del warning `frontmatter`.
- **Limiti:**
  - **`---\r\n` (Windows CRLF) non è rilevato.** Fix: usare `content.startsWith('---\n') || content.startsWith('---\r\n')` o normalizzare line endings.
  - **Non valida che il frontmatter sia YAML valido**, solo che il file inizi con `---\n`. Un file con `---\ngarbage\n---` passa. Fix: tentare `YAML.parse()` o almeno verificare la chiusura `---`.
  - **Non controlla che il frontmatter sia chiuso.** Un file che inizia con `---\n` ma non ha un secondo `---` non genera warning. Fix: cercare il delimitatore di chiusura.
  - **Nessun test dedicato.** Fix: aggiungere test esplicito per warning frontmatter.

### 2.3 `line-length` — Severity: **warning**

- **File:** `src/index.mjs:46-56`
- **Logica:** split per `\n`, per ogni riga controlla `line.length > maxLineLength`. Default: 160. Configurable via `--max-line-length` o config.
- **Test:** nessun test unitario diretto. Il comportamento è testato indirettamente via il test strict mode (il file di test ha righe corte). Fix: aggiungere test con riga lunga.
- **Limiti:**
  - **Conta anche righe dentro frontmatter, code block, tabelle, URL lunghi.** Un URL di 200 caratteri in un link markdown genera warning. Fix: opzione per escludere code blocks e URL.
  - **Non segnala il contenuto della riga** nel finding. Il messaggio dice "Linea 5 oltre 160 caratteri (175)" ma non mostra la riga. Fix: includere un excerpt.

### 2.4 `placeholder` — Severity: **warning**

- **File:** `src/index.mjs:58-63`
- **Logica:** 3 regex testate sull'intero contenuto: `/\bTODO\b/i`, `/lorem ipsum/i`, `/\bxxx\b/i`. Se match, warning con la regex nel messaggio.
- **Test:** `test/guardrail.test.mjs:30-34` — testa che `TODO` generi warning con code `placeholder`.
- **Limiti:**
  - **Un solo warning per pattern**, anche se ci sono 50 occorrenze di `TODO`. Non dice quante né dove. Fix: iterare con `matchAll` e riportare riga/colonna per ogni occorrenza.
  - **`TODO` dentro code blocks viene rilevato.** Commenti nel codice (es. `<!-- TODO: fix later -->`) generano falsi positivi. Fix: escludere code blocks.
  - **La regex nel messaggio** (`Placeholder rilevato: /\bTODO\b/i`) è criptica per un utente finale. Fix: mostrare il testo matchato e la riga.
  - **Pattern limitati:** mancano `FIXME`, `HACK`, `TBD`, `[inserire qui]`, `[...]`. Fix: estendere la lista.
  - **`xxx` può avere falsi positivi** in contesti legittimi (es. protocollo "xxx" in RFC). Fix: probabilmente accettabile per un MVP.

### 2.5 `insecure-link` — Severity: **warning**

- **File:** `src/index.mjs:65-70`
- **Logica:** regex `/\[.*?\]\(http:\/\/.*?\)/g` — cerca link markdown con URL `http://`. Conta le occorrenze.
- **Test:** nessun test. Fix: aggiungere test con link http e https.
- **Limiti:**
  - **Non rileva link bare** (`http://example.com` senza sintassi `[]()`). Fix: cercare anche URL bare.
  - **Non rileva link in HTML** (`<a href="http://...">`). Fix: aggiungere regex per tag `<a>`.
  - **Non rileva link in reference-style** (`[text][id]` con `[id]: http://...`). Fix: cercare anche definizioni reference.
  - **Nessun test.** Regola completamente non testata.

---

## 3. SISTEMA DI CONFIGURAZIONE

### `--config <path>`

- **Implementazione:** `src/index.mjs:125-133` (parsing), `src/index.mjs:82-95` (`parseConfigFile`), `src/index.mjs:164-179` (`resolveOptions`)
- **Formato:** JSON puro. Deve essere un oggetto (non array, non stringa).
- **Chiavi riconosciute:** `maxLineLength` (number), `strict` (boolean).
- **Default path:** `.doclify-guardrail.json` nella cwd (`src/index.mjs:103`).
- **Merge:** CLI flag → config file → `DEFAULTS` costante. Precedenza corretta implementata via nullish coalescing (`??`) a `src/index.mjs:166-167`.
- **Errore config:** se il file esiste ma non è JSON valido, esce con exit 2 e messaggio chiaro.
- **Silenzio se mancante:** se il config file non esiste, viene ignorato silenziosamente (corretto).
- **Limite:** nessuna validazione delle chiavi. Un config con `{ "typo": true }` viene accettato senza warning. Fix: validare le chiavi note e avvisare su chiavi sconosciute.

### `--strict`

- **Implementazione:** `src/index.mjs:120-123` (parsing), `src/index.mjs:167` (resolve), `src/index.mjs:182` (effetto)
- **Effetto:** se `strict=true`, i warning vengono considerati come failure → `pass=false` → exit 1.
- **Configurabile sia da CLI che da config file.**

### `--max-line-length <n>`

- **Implementazione:** `src/index.mjs:135-147` (parsing con validazione: intero positivo)
- **Effetto:** modifica la soglia per la regola `line-length`. Default: 160.

### `--report`

- **NON IMPLEMENTATO.** È elencato in `TODO.md` come P1 aperta: "Mini report markdown esportabile (`--report out.md`)".
- Il README non lo menziona. Non c'è codice per generare report markdown.

### `--rules`

- **NON IMPLEMENTATO.** È elencato in `TODO.md` come P1: "Regole custom caricabili da file (plugin semplice)".
- Non esiste alcun sistema di caricamento regole esterne.

### `--debug`

- **Implementazione:** `src/index.mjs:115-118` (flag), `src/index.mjs:244-257` (output)
- **Effetto:** stampa su stderr un JSON con `args` e `resolved` options. Utile per debug, non documentato completamente.

---

## 4. TEST SUITE

### Organizzazione

- **File unico:** `test/guardrail.test.mjs` — 105 righe, 8 test.
- **Framework:** `node:test` + `node:assert/strict` (built-in Node.js ≥20). Zero dipendenze.
- **Comando:** `npm test` → `node --test`

### Lista test

| # | Nome test | Tipo | Riga |
|---|-----------|------|------|
| 1 | `passa con H1 singolo` | unit | 15 |
| 2 | `fallisce senza H1` | unit | 22 |
| 3 | `warning su placeholder` | unit | 30 |
| 4 | `parseArgs: errore opzione sconosciuta` | unit | 36 |
| 5 | `resolveOptions: legge .doclify-guardrail.json` | integration | 40 |
| 6 | `CLI: strict mode trasforma warning in fail (exit 1)` | e2e | 52 |
| 7 | `CLI: warning senza strict resta pass (exit 0)` | e2e | 68 |
| 8 | `CLI: file non trovato -> exit 2` | e2e | 83 |

### Copertura: cosa è testato

- ✅ H1 mancante → errore
- ✅ H1 singolo → pass
- ✅ Placeholder `TODO` → warning
- ✅ Opzione sconosciuta → throw
- ✅ Config file caricato → maxLineLength e strict applicati
- ✅ Strict mode → exit 1 con warning
- ✅ Non-strict → exit 0 con warning
- ✅ File non trovato → exit 2
- ✅ Config strict da file → exit 1

### Copertura: cosa NON è testato

- ❌ H1 multipli (branch `h1Matches.length > 1` mai testato)
- ❌ Frontmatter warning (nessun test dedicato)
- ❌ Regola `line-length` (nessun test con riga lunga)
- ❌ Regola `insecure-link` (completamente non testata)
- ❌ `--max-line-length` override effettivo (solo parsing testato indirettamente)
- ❌ `--help` (nessun test che verifichi output o exit code 0)
- ❌ `--debug` output (nessun test)
- ❌ Config file malformato (nessun test per errore JSON)
- ❌ Config file con chiavi non valide
- ❌ Argomenti multipli inattesi
- ❌ File senza estensione .md (viene accettato qualsiasi file)
- ❌ File vuoto
- ❌ File binario
- ❌ File con encoding non UTF-8
- ❌ `lorem ipsum` e `xxx` placeholder patterns

### Qualità

I test esistenti sono solidi e ben scritti. Coprono il core happy path e alcuni failure path importanti (exit code). Tuttavia, **la copertura stimata è circa 50-60%** dei branch logici. 2 regole su 5 sono completamente non testate (`insecure-link`, `line-length`). Il pattern dei test e2e (spawnSync) è eccellente per verificare il comportamento reale della CLI.

---

## 5. HOOK PRE-COMMIT

### Stato: NON IMPLEMENTATO

- `TODO.md` lo lista come P1: "Hook git pre-commit opzionale".
- Non esiste:
  - Nessuna directory `.husky/`
  - Nessun file `pre-commit` in `.git/hooks/`
  - Nessuno script `install-hook` o `setup`
  - Nessuna integrazione con `husky`, `lint-staged`, `lefthook`, o `simple-git-hooks`
  - Nessuna documentazione su come integrare in un hook

### Cosa servirebbe (suggerimento)

Un hook pre-commit minimale richiederebbe:
1. Script `scripts/install-hook.sh` che copia un hook in `.git/hooks/pre-commit`
2. L'hook esegue `git diff --cached --name-only --diff-filter=ACM '*.md' | xargs node ./src/index.mjs`
3. Oppure integrazione con `lint-staged` in package.json

---

## 6. OUTPUT E REPORTING

### Formato output terminale

- **stderr** (`src/index.mjs:200-203`): una riga human-readable:
  ```
  [doclify-guardrail] PASS — errori: 0, warning: 0, strict: off
  ```
  oppure:
  ```
  [doclify-guardrail] FAIL — errori: 1, warning: 2, strict: on
  ```

- **stdout** (`src/index.mjs:260`): JSON formattato (pretty-print con 2 spazi):
  ```json
  {
    "version": "0.2",
    "file": "./sample.md",
    "strict": false,
    "pass": true,
    "findings": {
      "errors": [],
      "warnings": []
    },
    "summary": {
      "errors": 0,
      "warnings": 0,
      "status": "PASS"
    }
  }
  ```

### Formato report markdown

**NON IMPLEMENTATO.** Flag `--report` non esiste nel codice. È una P1 aperta in TODO.md.

### Informazioni incluse nel JSON output

- ✅ Versione tool (`version: "0.2"`)
- ✅ File analizzato (`file`)
- ✅ Modalità strict (`strict`)
- ✅ Pass/fail (`pass`)
- ✅ Lista errori con code, severity, message
- ✅ Lista warning con code, severity, message
- ✅ Summary con conteggi

### Informazioni escluse

- ❌ Timestamp dell'analisi
- ❌ Numero riga/colonna per ogni finding
- ❌ Excerpt della riga incriminata
- ❌ Suggerimento di fix per ogni finding
- ❌ Config effettiva utilizzata (disponibile solo con `--debug`)
- ❌ Tempo di esecuzione

### Exit code

| Codice | Significato | Quando |
|--------|-------------|--------|
| `0` | PASS | Nessun errore (e nessun warning se strict) |
| `1` | FAIL | Errori presenti, o warning con `--strict` |
| `2` | Errore uso | File mancante, argomenti invalidi, config malformata |

Implementazione corretta e consistente in `src/index.mjs:206-265`.

---

## 7. DEVELOPER EXPERIENCE (DX)

### Installazione e primo uso

**Positivo:**
- Zero dipendenze → `npm install` non serve (nessun `node_modules`)
- `node ./src/index.mjs ./sample.md` funziona immediatamente
- `npm test` funziona out-of-the-box
- Il file `sample.md` è incluso per provare subito

**Negativo:**
- Non è pubblicato su npm → non si può fare `npx doclify-guardrail`
- Nessuna istruzione per installazione globale (`npm link`)
- Il `package.json` ha `"private": true` → non pubblicabile senza modifica

### README

- **Lingua:** italiano (limita l'audience internazionale)
- **Completezza:** buono per un MVP. Copre: quick start, opzioni CLI, config file, regole, exit code, use-case, demo.
- **Esempi:** sì, mostra comandi e output JSON di esempio.
- **Mancanze:** nessun esempio di output con errori/warning, nessuna sezione "Contributing", nessuna menzione di limitazioni note, nessun badge CI.

### Messaggi di errore

**Buoni:**
- `Errore: manca <file.md>.` + `Usa --help per esempi di utilizzo.` — chiaro e utile.
- `File non trovato: ./nonesiste.md` — diretto.
- `Opzione sconosciuta: --boh` — specifico.
- `Valore mancante per --config` — preciso.

**Migliorabili:**
- `Config non valida (path): Unexpected token...` — espone l'errore JSON raw. Fix: wrappare con messaggio più amichevole.
- I warning delle regole sono in italiano e contengono regex raw (es. `Placeholder rilevato: /\bTODO\b/i`). Fix: mostrare testo umano.

### Cosa manca per un nuovo utente

1. **Nessun `npx` support** — deve clonare il repo per provare.
2. **Nessun esempio di output con problemi** — il README mostra solo il JSON "pass".
3. **Nessun modo per analizzare più file** — accetta un solo file alla volta.
4. **Nessun glob support** — non puoi fare `doclify-guardrail docs/**/*.md`.
5. **Nessun colore nel terminale** — il summary su stderr è plain text, niente ANSI colors.

---

## 8. VALUTAZIONE CRITICA

### 3 punti di forza tecnici

1. **Zero dipendenze, zero costi.** L'intera CLI è un singolo file di 268 righe senza alcuna dipendenza esterna. Si avvia in millisecondi, non ha vulnerabilità da supply chain, non richiede `npm install`. Per un tool guardrail questo è un valore reale.

2. **Separazione stdout/stderr e JSON stabile.** Il pattern di output (JSON machine-readable su stdout, summary umano su stderr) è la best practice per CLI composabili. Permette `doclify-guardrail doc.md | jq .pass` senza interferenze. La struttura JSON è versionata (`version: "0.2"`).

3. **Exit code semantici e config file con merge corretto.** I 3 exit code (0/1/2) permettono integrazione CI affidabile. Il sistema di precedenza CLI → config → defaults è implementato correttamente con nullish coalescing, evitando i bug classici di merge.

### 5 problemi o lacune più importanti (per impatto utente)

1. **Supporta un solo file alla volta.** Un utente con 50 file markdown deve invocare la CLI 50 volte. Non c'è glob expansion, nessun supporto directory, nessun report aggregato. Questo è il limite più impattante per adozione reale.
   - *Fix:* accettare multipli argomenti e/o `--dir <path>` con glob ricorsivo. Aggregare i risultati in un unico JSON.

2. **Nessun numero di riga nei finding.** Gli errori dicono "Manca titolo H1" ma non dicono *dove*. La regola `line-length` è l'unica che indica il numero di riga. L'utente deve cercare manualmente il problema.
   - *Fix:* aggiungere campo `line` (e opzionalmente `column`) a ogni finding in `normalizeFinding()`.

3. **Regex su testo raw invece di AST.** L'H1 check conta `# ` anche dentro code blocks. Il placeholder check rileva `TODO` nei code examples. Un documento con un code block che mostra un heading genera un falso positivo.
   - *Fix:* preprocessare il markdown rimuovendo i code blocks (fenced e indented) prima di applicare le regex, oppure usare un parser lightweight come `markdown-it`.

4. **2 regole su 5 completamente non testate.** `insecure-link` e `line-length` non hanno test. Il branch "H1 multipli" non ha test. La copertura reale è ~50-60%.
   - *Fix:* aggiungere almeno 5-6 test per coprire i branch mancanti.

5. **Report markdown non implementato.** Documentato in TODO.md come P1, ma per un team che vuole integrare il tool in una CI con artefatti, il report è essenziale.
   - *Fix:* implementare `--report <path>` che generi un `.md` con tabella dei finding.

### Debito tecnico

- **Versione disallineata:** `package.json` dice `0.1.0`, l'output JSON dice `0.2`. Fix: allineare.
- **Nessun linter/formatter** sul progetto stesso (niente ESLint, Prettier). Il codice è pulito ma non c'è enforcement.
- **`parseArgs` è fragile per espandibilità**: ogni nuova opzione richiede un nuovo blocco `if` manuale. Non scala bene oltre 6-7 flag. Fix: accettabile per MVP, ma considerare `parseArgs` di `node:util` (Node.js ≥18.3).
- **Nessun type checking:** il progetto è `.mjs` puro senza JSDoc types o TypeScript. Errori di tipo scoperti solo a runtime.
- **`CLI_PATH` nei test** (`path.resolve('src/index.mjs')`) è relativo alla cwd, fragile se i test vengono lanciati da una directory diversa.
- **Nessun file `LICENSE`** — impedisce il riuso legale da parte di terzi.

### Cosa impedirebbe a un tech lead di adottarlo

1. **No multi-file:** un team ha decine/centinaia di file markdown. Lanciare la CLI uno alla volta è inaccettabile.
2. **No CI recipe:** nessun esempio GitHub Actions / GitLab CI. Il team deve scriversi l'integrazione.
3. **Falsi positivi da code blocks:** in progetti con documentazione tecnica (codice dentro markdown), i falsi positivi renderanno il tool inutilizzabile.
4. **No line numbers:** senza numeri di riga, su file grandi trovare il problema è tedioso.
5. **Nessun ecosistema:** no plugin, no regole custom, no estensibilità. Se una regola non va bene, l'unica opzione è forkare.

---

## 9. CONFRONTO COMPETITIVO RAPIDO

### Cosa fa doclify che markdownlint non fa?

- **Regola `frontmatter`** come check di presenza — markdownlint non ha una regola built-in per la presenza di frontmatter YAML (ha `MD041` per il primo heading, non per frontmatter).
- **Regola `insecure-link`** — markdownlint non controlla il protocollo dei link.
- **Regola `placeholder`** — markdownlint non ha detection di placeholder text (TODO, lorem ipsum).
- **Output JSON con campo `pass`/`version`** — markdownlint ha output JSON ma con struttura diversa, senza un campo pass/fail esplicito.
- **Zero dipendenze** — markdownlint ha un dependency tree significativo.

### Cosa fa doclify che remark-lint non fa?

- **Semplicità radicale:** doclify è un singolo file, remark-lint richiede un ecosistema di plugin (`remark-cli`, `remark-preset-lint-*`, unified, ecc.).
- **Regola `insecure-link`** — non esiste come plugin remark-lint standard.
- **Regola `placeholder`** — non esiste come plugin remark-lint standard.
- **Installazione zero:** remark-lint richiede `npm install` di 20+ pacchetti.

### Qual è il vero differenziale tecnico

Il differenziale è la **semplicità operativa**: un singolo file, zero dipendenze, output JSON stabile, 3 exit code, config minimale. Per team che vogliono un "gate" minimo sulla qualità markdown senza configurare un ecosistema di linting, doclify è più veloce da adottare.

Il target non è "sostituire markdownlint" ma "aggiungere un guardrail in 2 minuti dove prima non c'era nulla".

### Dove doclify è INFERIORE ai competitor

| Area | markdownlint | remark-lint | doclify |
|------|-------------|-------------|---------|
| Regole disponibili | 50+ | 80+ plugin | 5 |
| AST parsing | ✅ (markdown-it) | ✅ (unified/mdast) | ❌ (regex) |
| Multi-file | ✅ (glob) | ✅ (glob) | ❌ (1 file) |
| Numeri di riga | ✅ | ✅ | ❌ (parziale) |
| Fix automatico | ✅ (`--fix`) | ✅ (`--fix`) | ❌ |
| Estensibilità | ✅ (regole custom) | ✅ (plugin) | ❌ |
| Editor integration | ✅ (VS Code ext.) | ✅ (VS Code ext.) | ❌ |
| CI recipes | ✅ (GitHub Action) | ✅ | ❌ |
| Documentazione | ✅ (inglese, completa) | ✅ (inglese, completa) | Parziale (italiano) |
| Community | ✅ (18k+ stars) | ✅ (attiva) | ❌ (zero) |

**Conclusione:** doclify è un MVP funzionante con architettura pulita e scelte tecniche valide (zero deps, dual output, exit codes). Il gap principale verso l'adottabilità è: multi-file, line numbers, esclusione code blocks, e almeno un paio di regole in più. Il posizionamento "guardrail minimo senza setup" è legittimo, ma deve funzionare senza falsi positivi per essere credibile.

---

*Report generato analizzando ogni file della repository. Nessun file è stato saltato.*
