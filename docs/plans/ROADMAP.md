# Doclify Guardrail — Roadmap

> v1.7.2 | Aggiornata: 2026-03-14

---

## Fase 0 — Sicurezza e bug fix (priorita: critica) (status: done)

Prima di tutto fixare le vulnerabilita e i bug. Ogni task e indipendente: fix, test, commit. Una alla volta.

- **task 1: Fix ReDoS nelle custom rules** (status: done) — `src/rules-loader.mjs:48` accetta qualsiasi regex senza validazione. Pattern tipo `(a+)+$` bloccano Node per sempre. Aggiungi validazione che rifiuti nested quantifier prima di `new RegExp()`. Test: pattern pericoloso → errore chiaro.

- **task 2: Fix path traversal in report** (status: done) — `src/report.mjs:110` scrive dove gli dici senza controllo. Con `--report ../../etc/passwd` scrivi fuori dal progetto. Dopo `path.resolve()`, verifica che il risultato sia dentro `process.cwd()` con `isDescendantOrSame()`. Test: path `../outside` → rifiutato.

- **task 3: Fix git argument injection** (status: done) — `src/diff.mjs:7-10` non blocca ref che iniziano con `-`. Un `--exec=malicious` passa il check. Aggiungi `if (ref.startsWith('-')) throw`. Test: `--force` come base ref → rifiutato.

- **task 4: Fix bug suppression map** (status: done) — `src/checker.mjs:310`, `<!-- doclify-enable -->` senza regole chiama `activeDisables.clear()` che cancella TUTTO, anche le soppressioni specifiche per regola. Cambia in `activeDisables.delete('*')`. Test: `<!-- doclify-disable rule-a -->` + `<!-- doclify-enable -->` → `rule-a` resta disabilitata.

- **task 5: Fix crash filesystem** (status: done) — `src/index.mjs:1397`, `writeFileSync` senza try/catch. Disco pieno o path inesistente = stack trace brutto. Wrappa in try/catch con messaggio leggibile. Test: path non scrivibile → errore user-friendly.

**Risultato**: zero vulnerabilita note, test suite verde.

---

## Fase 1 — Pulizia e credibilita (priorita: alta) (status: todo)

Rimuovere tutto cio che e rotto, incompleto, o danneggia la percezione del prodotto. Niente feature nuove qui — solo sistemare quello che c'e.

- **task 1: Nascondi comandi `ai *` placeholder** — `src/index.mjs`: i comandi `ai scan`, `ai fix`, `ai prioritize`, `ai coverage` sono stub vuoti visibili nella help. Danneggiano la credibilita. Spostali dietro flag `--experimental`: senza flag non appaiono nella help e rispondono "Feature in sviluppo, usa --experimental". Test: `doclify --help` senza `--experimental` → nessun comando `ai` visibile.

- **task 2: Rendi `duplicate-section-intent` opt-in** — `src/checker.mjs`: questa regola genera troppi falsi positivi con heading simili ma legittimi. Cambiala da attiva di default a opt-in (attiva solo se abilitata nel config). Test: scan senza config esplicito → nessun warning `duplicate-section-intent`.

- **task 3: Allinea release channels** — npm e GitHub devono mostrare la stessa versione. Pubblica su npm e crea GitHub release con tag v1.7.2. Verifica: `npm view doclify-guardrail version` = 1.7.2, `gh release view v1.7.2` esiste.

- **task 4: Fix link checker hang** — `src/links.mjs:177`: DNS lookup senza timeout, se il DNS non risponde il processo si blocca per sempre. Wrappa con `Promise.race([lookup(...), timeout(5000)])`. Anche: `src/links.mjs:390`, cache DNS e HTTP crescono senza limite → cap a 2048 entry con eviction FIFO. Test: mock DNS che non risponde → timeout dopo 5s, non hang infinito.

**Risultato**: il prodotto e pulito, coerente, senza roba rotta visibile. Chi lo installa per la prima volta vede un tool professionale.

---

## Fase 2 — Distribuzione e onboarding (priorita: alta) (status: todo)

Il problema di Doclify non e tecnico — e che nessuno lo trova e chi lo trova ci mette troppo a configurarlo. markdownlint ha 1.5M download/settimana perche ha VS Code extension, pre-commit hook, e setup immediato. Questa fase colma quei gap.
Lavora in sequenza: prima `init` (fondamento), poi pre-commit e VS Code.

- **task 1: Comando `doclify init`** — Nuovo comando interattivo in `src/index.mjs`: (1) chiede tipo progetto (docs-only, monorepo, MDX), (2) genera `.doclify-guardrail.json` con preset, (3) genera `.github/workflows/doclify.yml`, (4) esegue prima scan. Obiettivo: da `npm install` a CI verde in <10 minuti. Test: `doclify init --preset default` in directory vuota con un .md → config + workflow creati, scan passa.

- **task 2: Config presets** — `src/config-resolver.mjs`: tre preset — `default` (regole base, no link check), `strict` (tutto attivo), `minimal` (solo errori). Usabili con `--preset` o `"preset"` nel config. Il preset applica opzioni predefinite prima dei CLI override. Test: `--preset strict` attiva `--check-links` e `--check-freshness` automaticamente.

- **task 3: Pre-commit hook** — Crea `.pre-commit-hooks.yaml` nella root: entry che esegue `doclify scan --diff --staged`. Documenta nel README le 3 righe YAML da copiare. Test: in un repo di test, modifica .md con errore → pre-commit blocca il commit.

- **task 4: VS Code extension MVP** — Nuovo repo `vscode-doclify`. L'estensione: (1) esegue `doclify scan --json` sul file aperto, (2) mostra finding come diagnostics inline (sottolineature), (3) offre quick-fix per le 13 regole auto-fixable. Test: file .md con `#heading` (senza spazio) → warning inline, quick-fix lo corregge.

- **task 5: Output PR migliorato** — `src/ci-output.mjs` e `action/`: il commento PR e troppo verboso. Cambialo: (1) delta score vs commit precedente ("+3 punti"), (2) errori in cima, (3) warning a basso impatto collassati. Test: 2 errori + 15 warning → errori visibili, warning collassati.

**Risultato**: un developer fa `npx doclify-guardrail init`, ha CI in 5 minuti, vede finding in VS Code, pre-commit blocca commit con errori. Target: >1000 npm download/settimana.

---

## Fase 3 — AI Layer MVP (priorita: media) (status: todo)

Punto di svolta: da tool gratuito a prodotto monetizzabile. Nessun competitor linting Markdown offre AI in CI. Lo spazio e completamente vuoto.
Prima il backend, poi le feature AI una alla volta. Ogni feature deve funzionare end-to-end prima di passare alla successiva.

- **task 1: Backend API serverless** — Nuovo repo `doclify-api`, deploy su Cloudflare Workers. Endpoint: `POST /v1/auth/verify`, `POST /v1/ai/review` (proxy Claude API), `POST /v1/ai/fix`, `GET /v1/usage`. Rate limit: 60 req/min per API key. Test: `/v1/ai/review` con API key valida e body Markdown → ritorna finding AI.

- **task 2: `doclify ai review`** — Nuovo `src/ai-review.mjs`. Legge file Markdown, invia al backend che li passa a Claude Haiku 4.5 con prompt strutturato (chiarezza, completezza, tono, accuratezza). Output integrato con finding statici ma etichettato `[AI]`. Costo ~$0.002/file. Test: file con sezione incompleta → finding AI segnala il problema.

- **task 3: `doclify ai fix`** — Nuovo `src/ai-fix.mjs`. Per ogni finding, invia finding + 10 righe di contesto a Claude Sonnet 4.6 via `/v1/ai/fix`. Ritorna sezione riscritta, utente vede diff e decide. Costo ~$0.02/file. Test: heading con punteggiatura → suggerimento AI corretto + diff leggibile.

- **task 4: `doclify ai explain-drift`** — In `src/drift.mjs`, flag `--ai-explain`: invia risultati drift a Claude Haiku con prompt "spiega cosa potrebbe essere stale e cosa aggiornare". Costo ~$0.002/alert. Test: drift alert simulato → spiegazione in linguaggio naturale.

- **task 5: Free tier** — Backend: ogni API key ha 50 file AI review/mese gratis. Dopo il limite: "Hai raggiunto il limite. Esegui `doclify upgrade`." Reset il primo del mese. Test: 51esima chiamata → errore 429 con messaggio chiaro.

**Risultato**: `doclify ai review` funziona end-to-end. Free tier attivo. Almeno 100 utenti provano l'AI review.

---

## Fase 4 — Monetizzazione (priorita: media) (status: todo)

Trasforma le feature AI in revenue. Boundary non negoziabile: linting statico gratis per sempre, solo AI cloud a pagamento.
Prima billing, poi pricing page, poi CLI upgrade flow.

- **task 1: Stripe integration** — Backend: Stripe Billing con due piani — Pro ($19/repo/mese, 2000 file AI), Team ($49/org/mese, 5 repo, quota condivisa). Webhook per attivazione automatica. Test: subscription di test → API key promossa a "pro", quota = 2000.

- **task 2: Pricing page** — Landing page statica (GitHub Pages o doclify.dev). Tre colonne: Free / Pro / Team. Chiaro in 5 secondi cosa e gratis. Link a Stripe Checkout. Test: click "Inizia con Pro" → Stripe Checkout → API key attivata in 30s.

- **task 3: CLI upgrade e quota** — `src/index.mjs`: (1) `doclify usage` mostra quota rimasta, (2) `doclify upgrade` apre browser su pricing, (3) quota esaurita → messaggio chiaro con link upgrade. Test: 50/50 file usati + `doclify ai review` → messaggio quota esaurita.

- **task 4: Boundary enforcement** — `src/index.mjs` e `src/cloud-client.mjs`: `scan`, `fix`, `diff`, `watch`, `trend`, `report` funzionano SEMPRE senza auth. Comandi `ai *` richiedono auth + quota. Linting statico non rallenta se il cloud e giu. Test: `scan` senza auth → funziona. `ai review` senza auth → "Esegui `doclify login`".

**Risultato**: primo utente pagante. Billing automatico. Boundary free/paid chiaro. Target MRR: >$500.

---

## Fase 5 — Moat e crescita (priorita: bassa) (status: todo)

Cose che i competitor non possono copiare in meno di 6 mesi. Il vantaggio a questo punto e: scoring + drift + AI in CI — combinazione unica. Questa fase lo rende difendibile.
Task piu grandi, alcune parallelizzabili.

- **task 1: Plugin JS v1** — Nuovi `src/plugin-loader.mjs` e `src/plugin-api.mjs`. Un plugin e un file `.mjs` che esporta `{ id, severity, check(context) }`. Loader con timeout 5s. Custom rules regex restano come adapter. Template repo `doclify-plugin-template`. Test: plugin "heading maiuscolo" → Doclify lo carica e lo esegue.

- **task 2: Repository memory** — Backend: `POST /v1/memory` salva score per commit, finding accettati/rifiutati, drift history. CLI invia dati opt-in dopo scan. AI review usa la memory: "Questo fix accettato 8/10 volte". Test: 5 scan → `/v1/memory` ritorna storia completa.

- **task 3: Scan incrementale** — Nuovo `src/cache.mjs`. SHA256 per file, salta file non modificati, cache in `.doclify-cache.json`. Se config cambia → invalida tutto. Target: >35% piu veloce su repo >50 file. Test: scan due volte senza modifiche → seconda >35% piu veloce, risultato identico.

- **task 4: AST parsing opzionale** — `src/checker.mjs`, flag `--ast`. Usa `mdast-util-from-markdown`. Migra 3 regole: `heading-hierarchy`, `no-empty-sections`, `broken-local-anchor`. Mantieni path regex per chi non vuole la dep. Test: scan con/senza `--ast` → risultati identici per le 3 regole.

- **task 5: Style guide packs** — Pack per Google e Microsoft style guide. File JSON di custom rules o plugin. Pacchetti npm separati (`doclify-style-google`, `doclify-style-microsoft`). Test: pack Google installato → regole Google applicate.

- **task 6: Benchmark pubblico** — Script `scripts/run-benchmark.mjs` su corpus in `bench/`. Report trimestrale: precision, recall, performance, confronto con markdownlint e Vale. Test: script genera report con tutte le metriche.

**Risultato**: ecosystem plugin attivo (>5 plugin), scan incrementale, almeno un style guide pack, benchmark pubblico. Target: >30 utenti paganti, >8000 npm download/settimana.
