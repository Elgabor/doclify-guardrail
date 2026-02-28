# Roadmap doclify-guardrail

> **Visione:** markdownlint ti dice se il tuo Markdown è ben formattato. doclify ti dice se la tua documentazione è sana.
> Stile + contenuto + link + freshness + coverage + score + CI/CD — un solo tool.

---

## Parte 1 — Bug e miglioramenti immediati

### P0 — Bug critici (bloccanti per produzione) ✅ COMPLETATI

| # | Feature | Stato | Note |
|---|---------|-------|------|
| 1 | Fix JSON output buffer | ✅ Risolto v1.3 | Sostituito `console.log` con `process.stdout.write` + gestione backpressure/drain |
| 2 | Fix inline suppressions | ✅ Già risolto v1.2 | `buildSuppressionMap()` in checker.mjs implementa disable-next-line e disable/enable |
| 3 | Log su stderr, JSON su stdout | ✅ Già risolto v1.2 | `log()` usa `console.error()`, JSON su stdout |
| NEW | Fix `--fix` dentro code block | ✅ Risolto v1.3 | `autoFixInsecureLinks` ora salta fenced e inline code block |

### P1 — Bug minori (qualità UX) ✅ COMPLETATI

| # | Feature | Stato | Note |
|---|---------|-------|------|
| 4 | Strict mode: mostrare "error" nei finding | ✅ Risolto v1.3 | Warning promossi mostrano `✗ error [strict]` in rosso |
| 5 | Warning per regole inesistenti in `--ignore-rules` | ✅ Risolto v1.3 | Warning su stderr per ID non trovati in RULE_CATALOG |
| 6 | Fix messaggio duplicato in `doclify init` | ✅ Già risolto | `return 1` immediato previene doppio print |
| 7 | Fix messaggio "PLACEHOLDER" per TODO | ✅ Già risolto | Ogni pattern ha il proprio messaggio specifico |
| 17 | Score 0/100 meno punitivo | ✅ Risolto v1.3 | Formula con rendimenti decrescenti (√warnings), 13 warn → 54/100 |
| 18 | Parsing URL migliorato | ✅ Risolto v1.3 | Regex con parentesi annidate + cleanup solo per bare/ref URL |

### P2 — Miglioramenti funzionali ✅ COMPLETATI

| # | Feature | Stato | Note |
|---|---------|-------|------|
| 13 | `doclify init --force` | ✅ Risolto v1.3 | Sovrascrive config con `--force`, messaggio aggiornato |
| 14 | `exclude` nel config JSON | ✅ Risolto v1.3 | `exclude` in config mergiato con `--exclude` CLI |
| 15 | `--ascii` output mode | ✅ Risolto v1.3 | `--ascii` sostituisce Unicode con `[PASS] [FAIL] [WARN] [INFO]` |
| 22 | `disable-file` suppression | ✅ Risolto v1.3 | `<!-- doclify-disable-file [rules] -->` sopprime file interi |

---

## Parte 2 — Strategia per superare markdownlint

L'obiettivo non è copiare markdownlint — è renderlo obsoleto. Doclify deve diventare l'unico tool che serve, coprendo sia lo stile sia il contenuto.

### 2.1 — Colmare il gap delle regole core (da 11 a ~30)

Non servono tutte le 59. Servono le 20 che contano davvero, quelle che gli utenti trovano ogni giorno.

| Regola | Perché è critica | Auto-fixable |
|--------|-----------------|--------------|
| `blanks-around-headings` | 86 finding su questa repo, la violazione più visibile | Sì |
| `blanks-around-lists` | 113 finding, la più frequente in assoluto | Sì |
| `blanks-around-fences` | Leggibilità code block | Sì |
| `fenced-code-language` | Docs senza linguaggio = syntax highlight rotto | No |
| `no-trailing-spaces` | Igiene base, ogni linter la ha | Sì |
| `no-multiple-blanks` | Rumore visivo nei file | Sì |
| `no-bare-urls` | Link non cliccabili in molti renderer | Sì (wrap in `<>`) |
| `no-trailing-punctuation-heading` | Heading con `.` o `:` finale | Sì |
| `heading-start-left` | Heading indentati per errore | Sì |
| `no-missing-space-atx` | `#Heading` senza spazio — errore comune | Sì |
| `first-line-h1` | File senza H1 iniziale | No |
| `no-reversed-links` | `(text)[url]` invece di `[text](url)` | Sì |
| `no-space-in-emphasis` | `** bold **` non renderizza | Sì |
| `no-space-in-links` | `[ text ](url)` — spazi rotti | Sì |
| `no-inline-html` (opzionale) | HTML raw in Markdown puro | No |
| `single-trailing-newline` | POSIX compliance | Sì |
| `image-alt-required` | Già presente (`img-alt`), rafforzare | No |
| `no-empty-links` | Già presente (`empty-link`) | No |
| `table-pipe-alignment` | Tabelle rotte visivamente | Sì |
| `ol-prefix-ordered` | Liste numerate 1-1-1 vs 1-2-3 | Sì |

**Risultato:** 15 regole auto-fixable vs le 31 di markdownlint. Ma queste 20 coprono il 95% dei problemi reali (le altre 39 di markdownlint sono di nicchia).

### 2.2 — Auto-fix intelligente di massa (`doclify fix .`)

Markdownlint ha 31 fix, ma sono tutti stilistici. Doclify deve avere fix **semantici**:

| Fix | Cosa fa | markdownlint |
|-----|---------|--------------|
| Trailing spaces, blank lines, heading spacing | Fix strutturali base | Ha equivalente |
| `http://` → `https://` | Già presente | No |
| Bare URL → `<url>` | Wrap automatico | No |
| Link rotti → suggerimento | Trova il file rinominato/spostato e suggerisce fix | No |
| TOC auto-generation | `<!-- toc -->` genera table of contents dai heading | No |
| Frontmatter auto-inject | Aggiunge `title`, `updated`, `created` dove manca | No |
| Date freshness auto-update | Aggiorna `updated: YYYY-MM-DD` al momento del fix | No |

**Il messaggio killer:** `doclify fix .` sistema tutto in un colpo — stile, link, date, frontmatter.

### 2.3 — Watch mode (`doclify watch`)

```bash
doclify watch docs/ --strict
```

- Monitora file in tempo reale con `fs.watch`
- Mostra errori incrementalmente quando salvi un file
- Output compatto: solo i delta (nuovi errori / errori risolti)
- Markdownlint non ha nulla di simile (richiede VS Code extension)

### 2.4 — Diff mode (`doclify diff`)

```bash
doclify diff                    # confronta con HEAD
doclify diff --base main        # confronta con branch main
doclify diff --staged           # solo file staged
```

- Scansiona solo i file Markdown modificati rispetto a un ref git
- Perfetto per pre-commit hook e CI su PR
- Markdownlint non ha integrazione git nativa

### 2.5 — Documentation coverage (`doclify coverage`)

```bash
doclify coverage --source src/
```

| Metrica | Cosa misura |
|---------|-------------|
| File coverage | Ogni modulo in `src/` ha un `.md` corrispondente? |
| Export coverage | Le funzioni/classi esportate sono documentate? |
| Changelog coverage | Ogni versione in CHANGELOG ha una entry? |
| API coverage | Ogni endpoint ha documentazione? |

**Output:** `Documentation coverage: 73% (22/30 modules documented)`

Nessun linter Markdown fa questo. Game-changer per team enterprise.

### 2.6 — Score con trend tracking (`doclify score`)

```bash
doclify score --history
```

```
docs health  84/100  ██████████████████░░  (+3 vs last week)

Trend (last 5 runs):
  Feb 20: 78  ████████████████░░░░
  Feb 22: 81  ████████████████░░░░
  Feb 24: 81  ████████████████░░░░
  Feb 25: 84  █████████████████░░░
  Feb 26: 84  █████████████████░░░
```

- Salva lo score in `.doclify-history.json` ad ogni run
- Mostra trend nel tempo
- `--min-score 80` come quality gate: fail se lo score scende sotto soglia
- `--no-regression` fail se lo score è calato rispetto all'ultimo run

### 2.7 — AI-powered suggestions (opzionale, con LLM)

```bash
doclify . --suggest
```

| Check | Cosa fa |
|-------|---------|
| Readability score | Flesch-Kincaid / livello di leggibilità del testo |
| Broken anchor suggest | Link a `#sezione-xyz` rotto → "Forse intendevi `#sezione-x-y-z`?" |
| Stale content detection | Rileva codice/API deprecate menzionate nella doc |
| Missing sections | "Questo README non ha sezione Installation o Usage" |
| Duplicate content | Due file con contenuto >80% simile |

---

## Parte 3 — CI/CD first-class

| Feature | Stato attuale | Da aggiungere |
|---------|---------------|---------------|
| JUnit XML | Presente | OK |
| SARIF | Presente | OK |
| Badge SVG | Presente | OK |
| GitHub Action ufficiale | Assente | `uses: doclify/action@v1` con PR comment automatico |
| GitLab CI template | Assente | Template `.gitlab-ci.yml` preconfigurato |
| PR comment bot | Assente | Commento automatico sulla PR con diff dello score e nuovi finding |
| GitHub Code Scanning | SARIF presente | Upload automatico con `--sarif --upload` |
| Pre-commit hook | Assente | `doclify diff --staged --strict` come hook nativo |
| `--fail-on-regression` | Assente | Fail se lo score cala rispetto a baseline |

---

## Parte 4 — Developer experience

| Feature | Impatto |
|---------|---------|
| VS Code extension | Real-time squiggles, quick-fix, hover con spiegazione regola |
| Config wizard interattivo | `doclify init --interactive` con domande su stack (SSG, CMS, docs-as-code) |
| `doclify ignore <file>` | Aggiunge il file a `exclude` nel config senza editare JSON |
| `doclify explain <rule>` | Mostra descrizione dettagliata, esempi buoni/cattivi, link a docs |
| Autodetect framework | Rileva Docusaurus/VitePress/MkDocs e applica regole appropriate |
| Custom rules in JS | Regex-only è limitante. Supportare funzioni JS per regole complesse |
| Config gerarchica | Permettere `.doclify-guardrail.json` in sotto-directory per override locali |
| Documentazione web | Sito con esempi, ricette CI/CD, confronto con alternative |

---

## Roadmap per versione

```
v1.3  —  Fix bug critici (JSON buffer, suppressions, stderr)
v1.4  —  +15 regole core con auto-fix (parità markdownlint al 95%)
v1.5  —  doclify diff + pre-commit hook + doclify watch
v1.6  —  Score trending + --min-score + --no-regression
v1.7  —  GitHub Action + PR comment bot
v1.8  —  doclify coverage (documentation coverage analysis)
v2.0  —  VS Code extension + config wizard + AI suggestions
```

> **I primi 3 item (P0) sono bloccanti:** senza fix JSON e suppressions, il tool non è affidabile per CI/CD.
> Tutto il resto può essere prioritizzato in base al feedback utenti.
