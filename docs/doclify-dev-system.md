# Doclify Guardrail — Sistema di Sviluppo con Claude Code

> Playbook operativo per le 5 fasi del ciclo di sviluppo, basato sull'audit della codebase (v1.7.2, 15 marzo 2026) e sui pattern della repo [claude-code-tips](https://github.com/ykdojo/claude-code-tips).

---

## Architettura del sistema

Il sistema si basa su un principio centrale: **ogni fase produce un artefatto in Markdown che alimenta la fase successiva**. Claude Code è il connettore tra le fasi — legge l'output della fase precedente, esegue il lavoro, e produce l'input per la fase successiva.

```
PLAN.md → SPEC.md → branch + codice → PR review → DOCS aggiornati
   ↑                                                      |
   └──────────── feedback loop (score trending) ──────────┘
```

---

## Prerequisiti: Setup del progetto

### CLAUDE.md del progetto Doclify

Questo file va nella root del repo. Deve essere **conciso** — ogni riga costa token (Tip 30: "Keep CLAUDE.md simple"). Rivedi periodicamente e rimuovi ciò che non serve più.

```markdown
# Doclify Guardrail

Quality gate CLI per documentazione Markdown. Node.js 20+, ES Modules, zero dipendenze nel core.

## Architettura
- `src/rules/` — 35 regole (12 contenuto + 23 stile)
- `src/score.js` — health score 0-100 con formula pesata
- `src/fix/` — 14 auto-fix sicuri
- `src/link-checker.js` — dead link check con protezione SSRF
- `src/freshness.js` — staleness detection (>180 giorni)
- `src/drift/` — AI Drift Guard (analisi semantica offline)
- `src/output/` — terminal, JSON, JUnit XML, SARIF, SVG badge, MD report
- `action/` — GitHub Action con commento automatico su PR
- API pubblica: `lint()`, `fix()`, `score()`

## Convenzioni
- Commit: conventional commits (feat/fix/docs/refactor)
- Branch: `feat/nome`, `fix/nome`, `docs/nome`
- Test: ogni nuova regola ha test unitario + fixture .md
- PR: sempre draft prima, review poi
- Zero dipendenze: nessun npm install nel core CLI

## Versione corrente
v1.7.2 — 35 regole, 14 auto-fix, health score, trending, GitHub Action

## Pricing target
Free: linting statico CLI. Paid ($15-30/seat/mese): AI drift, dashboard, trending cloud.
```

### Struttura cartelle per il sistema

```
docs/
├── plans/           ← output Fase 1
│   └── PLAN-Q2-2026.md
├── specs/           ← output Fase 2
│   ├── SPEC-drift-guard-v2.md
│   └── SPEC-dashboard-api.md
├── handoffs/        ← documenti di continuità tra sessioni
│   └── HANDOFF.md
├── reviews/         ← checklist e note di review
└── changelog/       ← note di rilascio per versione
```

---

## Fase 1 — Pianificazione del prodotto

**Obiettivo**: decidere cosa costruire e in che ordine, partendo dall'audit della codebase.

**Tip applicati**: #3 (break down problems), #39 (plan then prototype), #27 (research tool), #5 (fresh context), #8 (handoff documents).

### Come funziona

1. **Sessione di ricerca** — Apri Claude Code nella root del progetto e parti dall'audit:

```
Leggi docs/audit-code-base-15-03-26.md e il file CLAUDE.md.
Basandoti sullo stato attuale (v1.7.2, 35 regole, zero deps),
sulla mappa competitiva e sul pricing target,
identifica le 5 feature più importanti da costruire
per passare da free a paid ($15-30/seat/mese).
Per ogni feature: problema che risolve, effort stimato (S/M/L),
impatto sul pricing. Scrivi tutto in docs/plans/PLAN-Q2-2026.md.
```

2. **Ricerca competitiva** — Usa Claude Code come research tool (Tip 27):

```
Cerca su web come Swimm implementa il code-coupling detection.
Cerca come SonarQube calcola il quality gate.
Aggiorna PLAN-Q2-2026.md con quello che trovi di rilevante.
```

3. **Prioritizzazione** — Fai ordinare per impatto/effort:

```
Riordina le feature nel piano per rapporto impatto/effort.
Le feature che sbloccano il pricing vanno in cima.
Quelle che hanno effort S e impatto alto vengono prima di effort L.
```

4. **Handoff** — Quando il contesto si riempie, crea il documento di passaggio (Tip 8):

```
Scrivi docs/handoffs/HANDOFF.md con: obiettivo, cosa è stato deciso,
cosa resta da fare, decisioni aperte. Il prossimo agente parte da qui.
```

### Output atteso: PLAN.md

```markdown
# Piano Prodotto Q2 2026

## Contesto
Doclify v1.7.2. Obiettivo: abilitare tier paid $15-30/seat/mese.

## Feature prioritizzate

### 1. Dashboard Cloud + API trending (Effort: L, Impatto: CRITICO)
**Problema**: lo score trending è solo locale (ASCII). I team vogliono
una dashboard condivisa con storico, alert, badge.
**Cosa serve**: API REST per push score, dashboard web, webhook per alert.
**Sblocca pricing**: sì — è la feature principale del tier paid.

### 2. AI Drift Guard v2 — code-aware (Effort: M, Impatto: ALTO)
**Problema**: il drift guard attuale è offline e generico. Non sa
quale codice è cambiato e quale doc dovrebbe aggiornarsi.
**Cosa serve**: integrazione git diff → mapping code↔doc → alert mirato.
**Sblocca pricing**: sì — feature AI differenziante.

### 3. Custom rule builder (Effort: M, Impatto: MEDIO)
...

## Decisioni aperte
- Dashboard: self-hosted o SaaS?
- AI drift: quale modello per embedding? (locale vs API)
```

### Pattern chiave

- **Una sessione = un tema**. Non mescolare ricerca competitiva e architettura nella stessa sessione (Tip 5: fresh context).
- **Prototipi rapidi** prima di decidere (Tip 39): se non sei sicuro che un approccio funzioni, chiedi a Claude Code di fare un prototipo veloce prima di metterlo nel piano.
- **Spezza i problemi grandi** (Tip 3): "Dashboard Cloud" è troppo grande. Spezzalo in: API score push, storage, frontend dashboard, webhook, badge SVG.

---

## Fase 2 — Scrittura delle specifiche

**Obiettivo**: trasformare ogni feature del piano in una specifica implementabile.

**Tip applicati**: #3 (breakdown), #39 (plan before code), #18 (writing assistant), #19 (markdown), #8 (handoff), #34 (TDD — le specifiche definiscono i test).

### Come funziona

1. **Carica il contesto** — Ogni spec parte dal piano:

```
Leggi docs/plans/PLAN-Q2-2026.md, sezione "AI Drift Guard v2".
Leggi src/drift/ per capire l'implementazione attuale.
Scrivi una specifica tecnica in docs/specs/SPEC-drift-guard-v2.md.
```

2. **Struttura della spec** — Chiedi sempre questa struttura:

```
La spec deve avere queste sezioni:
- Problema (1 paragrafo)
- Soluzione proposta (architettura, diagramma ASCII se serve)
- API / interfaccia pubblica (firma funzioni, tipi, esempi)
- Casi d'uso con input/output atteso
- Test cases (cosa deve passare, cosa deve fallire)
- File coinvolti (quali file toccare, quali creare)
- Breaking changes (se ce ne sono)
- Criteri di accettazione (quando la feature è "fatta")
```

3. **Iterazione line-by-line** (Tip 18): dopo il primo draft, rivedi con Claude Code:

```
Rivediamo la spec insieme. Sezione per sezione.
Nella sezione API, manca il caso in cui il file .md non ha frontmatter.
Aggiungi. Nella sezione test cases, aggiungi un caso per repo monorepo
con docs in sottocartelle diverse.
```

4. **Definisci i test prima del codice** (Tip 34 — TDD):

```
Dalla sezione "Test cases" della spec, genera i file di test
in test/drift-v2/. Devono fallire tutti. Committa solo i test.
```

### Output atteso: SPEC.md

```markdown
# SPEC: AI Drift Guard v2 — Code-Aware

## Problema
Il drift guard attuale (v1) analizza i docs in isolamento.
Non sa che `src/score.js` è cambiato e che `docs/scoring.md`
potrebbe essere disallineato. I team scoprono il disallineamento
solo quando un utente si lamenta.

## Soluzione
Aggiungere un mapping bidirezionale code↔doc basato su:
1. Convenzione di path (`src/X.js` → `docs/X.md`)
2. Annotazioni in frontmatter (`related-code: src/score.js`)
3. Git diff: se un file code è cambiato, flag le docs correlate

## API pubblica
```js
// Nuova funzione esportata
drift(options: DriftOptions): DriftResult[]

interface DriftOptions {
  base?: string        // git ref di confronto (default: HEAD~1)
  mappingStrategy?: 'path' | 'frontmatter' | 'both'
}

interface DriftResult {
  doc: string          // path del file doc
  code: string[]       // path dei file code correlati
  reason: string       // perché è flaggato
  confidence: number   // 0-1
}
```

## File coinvolti
- `src/drift/index.js` — refactor: estrarre logica v1, aggiungere v2
- `src/drift/mapping.js` — NUOVO: logica di mapping code↔doc
- `src/drift/git-diff.js` — NUOVO: wrapper git diff
- `test/drift-v2/` — NUOVA cartella test

## Criteri di accettazione
- [ ] `doclify --drift --base HEAD~5` mostra docs disallineate
- [ ] Mapping per path funziona senza configurazione
- [ ] Mapping per frontmatter funziona con `related-code`
- [ ] Nessuna dipendenza aggiunta (usa child_process per git)
- [ ] Tutti i test in test/drift-v2/ passano
```

### Pattern chiave

- **Una spec = una feature**. Non mescolare feature diverse nella stessa spec.
- **I criteri di accettazione sono checkbox**. Quando sono tutti spuntati, la feature è finita.
- **Le spec sono il contratto** tra te (product owner) e Claude Code (implementatore). Più sono precise, meno iterazioni servono.

---

## Fase 3 — Implementazione e apertura PR

**Obiettivo**: scrivere il codice basandosi sulla spec, con test che passano, e aprire una draft PR.

**Tip applicati**: #3 (breakdown), #4 (git + gh CLI), #9 (write-test cycle), #14 (multitasking tabs), #16 (git worktrees), #34 (TDD), #28 (verify output), #36 (subagents), #40 (simplify code).

### Come funziona

1. **Prepara il branch** — Usa git worktrees se lavori su più feature in parallelo (Tip 16):

```
Crea un git worktree per feat/drift-v2 in ../doclify-drift-v2.
Apri una nuova sessione Claude Code in quella cartella.
```

2. **Carica la spec** — La sessione parte dalla spec, non dal piano:

```
Leggi docs/specs/SPEC-drift-guard-v2.md.
I test in test/drift-v2/ esistono già e falliscono tutti.
Implementa la feature seguendo la spec. Procedi file per file:
prima src/drift/mapping.js, poi src/drift/git-diff.js,
poi refactora src/drift/index.js.
Dopo ogni file, lancia i test per verificare che passino.
```

3. **Ciclo write-test** (Tip 9, 34) — Claude Code scrive codice, lancia test, corregge:

```
Lancia npm test -- --grep "drift-v2" dopo ogni file.
Se un test fallisce, correggi il codice, non il test.
I test sono il contratto dalla spec.
```

4. **Verifica intermedia** (Tip 28) — Ogni tot file, fermati e verifica:

```
Mostrami un riassunto di tutti i file che hai toccato finora.
Per ogni file, 1 riga con: cosa fa, quante righe, test status.
```

5. **Semplifica** (Tip 40) — Prima di committare, chiedi di rivedere:

```
Rileggi tutto il codice che hai scritto per drift-v2.
C'è qualcosa di sovra-ingegnerizzato? Possiamo semplificare?
Ricorda: zero dipendenze. Se hai usato qualcosa di esterno, rimuovilo.
```

6. **Commit e draft PR** (Tip 4) — Usa conventional commits e draft PR:

```
Committa con messaggi conventional commits.
Poi crea una draft PR con gh cli. Titolo: "feat: AI Drift Guard v2 — code-aware mapping"
Nella descrizione, includi:
- Link alla spec (docs/specs/SPEC-drift-guard-v2.md)
- Checklist dei criteri di accettazione dalla spec
- Cosa testare manualmente
Non pushare ancora, fammi prima vedere il diff.
```

### Gestione del contesto lungo

Le implementazioni grandi superano il contesto di una sessione. Usa questi pattern:

**Handoff tra sessioni** (Tip 8):

```
Il contesto si sta riempiendo. Scrivi docs/handoffs/HANDOFF.md con:
- Cosa hai implementato finora (file per file, con status test)
- Cosa resta da implementare dalla spec
- Problemi trovati e decisioni prese
- Comandi per lanciare i test
Il prossimo agente partirà da questo file.
```

Nella sessione successiva:

```
docs/handoffs/HANDOFF.md
```

**Multitasking** (Tip 14): se un'implementazione è bloccata (es. aspetti CI), apri un nuovo tab e lavora su un'altra feature. Tieni massimo 3-4 tab attivi.

**Background tasks** (Tip 36): se i test sono lenti, mandali in background con Ctrl+B e continua a lavorare.

### Output atteso: draft PR

```
feat: AI Drift Guard v2 — code-aware mapping (#142)

## Cosa cambia
Aggiunge mapping bidirezionale code↔doc al drift guard.
Spec: docs/specs/SPEC-drift-guard-v2.md

## Criteri di accettazione
- [x] `doclify --drift --base HEAD~5` mostra docs disallineate
- [x] Mapping per path funziona senza configurazione
- [x] Mapping per frontmatter funziona con `related-code`
- [x] Nessuna dipendenza aggiunta
- [x] Tutti i test in test/drift-v2/ passano

## Come testare
npm test -- --grep "drift-v2"
node src/cli.js --drift --base HEAD~5 docs/
```

---

## Fase 4 — Review della PR

**Obiettivo**: verificare che il codice rispetti la spec, sia sicuro, testato e semplice.

**Tip applicati**: #26 (interactive PR reviews), #28 (verify output), #9 (test cycle), #40 (simplify), #34 (tests).

### Come funziona

1. **Apri una sessione dedicata alla review** — Contesto fresco (Tip 5):

```
Recupera la PR #142 con gh pr view 142.
Scarica il diff con gh pr diff 142.
Leggi la spec in docs/specs/SPEC-drift-guard-v2.md.
Fai una review strutturata:
- La PR implementa tutti i criteri di accettazione della spec?
- Ci sono breaking changes non documentati?
- Il codice rispetta la convenzione zero-deps?
- I test coprono i casi edge dalla spec?
- C'è codice sovra-ingegnerizzato da semplificare?
```

2. **Review file per file** (Tip 26 — interactive review): tu controlli il ritmo:

```
Andiamo file per file. Inizia da src/drift/mapping.js.
Mostrami le parti critiche e dimmi se ci sono problemi.
```

3. **Double-check claims** (Tip 28):

```
Nella PR dici che non hai aggiunto dipendenze.
Verifica: controlla package.json, cerca require() e import
in tutti i nuovi file. Fammi una tabella con ogni import e
se è built-in Node, interno al progetto, o esterno.
```

4. **Test di integrazione** — Fai girare i test e verifica il risultato:

```
Lancia npm test completo, non solo drift-v2.
Se qualcosa che non è drift-v2 fallisce, c'è una regressione.
```

5. **Richiedi miglioramenti o approva**:

```
In src/drift/git-diff.js, la funzione parseGitDiff è 80 righe.
Puoi spezzarla in funzioni più piccole? Ricorda: semplifica (Tip 40).
Dopo il refactor, rilancia i test e committa.
```

6. **Quando sei soddisfatto**, marca la PR come ready:

```
La review è completa. Tutti i criteri di accettazione sono soddisfatti.
Marca la PR come ready for review con gh pr ready 142.
```

### Checklist di review standard

Questa va in `docs/reviews/REVIEW-CHECKLIST.md`:

```markdown
# Checklist Review PR — Doclify

## Correttezza
- [ ] Implementa tutti i criteri di accettazione dalla spec
- [ ] Nessuna regressione (test suite completa passa)
- [ ] Nessun breaking change non documentato

## Qualità codice
- [ ] Zero dipendenze esterne aggiunte
- [ ] Nessuna funzione > 50 righe (semplificare se necessario)
- [ ] Nomi chiari per funzioni e variabili
- [ ] Nessun codice morto o commentato

## Test
- [ ] Ogni nuovo file ha test corrispondente
- [ ] Casi edge dalla spec coperti
- [ ] Test leggibili (il nome del test spiega cosa verifica)

## Sicurezza
- [ ] Nessun path traversal nei nuovi input
- [ ] Nessun eval() o Function() su input utente
- [ ] Link checker: protezione SSRF mantenuta

## Documentazione
- [ ] Changelog aggiornato se feature user-facing
- [ ] JSDoc sulle funzioni pubbliche esportate
```

---

## Fase 5 — Aggiornamento e creazione documentazione

**Obiettivo**: aggiornare i docs del progetto dopo ogni merge, e usare Doclify stesso come dogfooding.

**Tip applicati**: #19 (markdown), #18 (writing assistant), #29 (DevOps — CI per docs), #41 (automation of automation), #9 (write-test cycle su docs stesse).

### Come funziona

1. **Dopo ogni merge, aggiorna i docs** — Apri sessione dedicata:

```
La PR #142 (AI Drift Guard v2) è stata mergiata.
Leggi la spec docs/specs/SPEC-drift-guard-v2.md.
Aggiorna:
1. README.md — sezione features, aggiungi drift v2
2. docs/cli-reference.md — aggiungi flag --drift --base
3. docs/api.md — aggiungi funzione drift() e tipi
4. CHANGELOG.md — aggiungi entry sotto [Unreleased]
Per ogni file che aggiorni, non riscrivere tutto.
Modifica solo le sezioni rilevanti.
```

2. **Dogfooding** — Usa Doclify sui propri docs:

```
Lancia doclify . --check-links --check-freshness --min-score 80
Se lo score è sotto 80, mostrami quali file hanno problemi
e suggerisci le fix. Applica le auto-fix sicure.
```

3. **Crea docs per nuove feature** — Se la feature è completamente nuova:

```
Crea docs/guides/drift-guard.md.
È una guida utente, non una spec tecnica.
Struttura: cosa fa, come si usa, esempi, FAQ.
Tono: diretto, pratico, con esempi copia-incolla.
Il target è uno sviluppatore che vuole attivare drift guard
nella sua CI in 5 minuti.
```

4. **Badge e reporting** — Genera gli artefatti visivi:

```
Genera il badge SVG aggiornato con doclify --badge docs-health.svg
Aggiorna il link nel README se necessario.
```

### Automazione del ciclo docs (Tip 41)

Crea una GitHub Action che lancia Doclify sui propri docs ad ogni PR:

```yaml
# .github/workflows/docs-quality.yml
name: Docs Quality Gate
on: [pull_request]
jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: doclify/guardrail-action@v1
        with:
          min-score: 80
          check-links: true
          check-freshness: true
          diff-only: true
```

Questo chiude il loop: la documentazione è protetta dallo stesso tool che stai costruendo.

---

## Flusso completo — Esempio end-to-end

Ecco come le 5 fasi si collegano per la feature "AI Drift Guard v2":

```
Giorno 1 — PIANIFICAZIONE
├── Sessione 1: audit → priorità feature → PLAN-Q2-2026.md
└── Sessione 2: ricerca Swimm/SonarQube → aggiorna piano

Giorno 2 — SPECIFICHE
├── Sessione 3: analisi src/drift/ attuale → SPEC-drift-guard-v2.md
└── Sessione 4: scrivi test che falliscono → commit test

Giorno 3-4 — IMPLEMENTAZIONE
├── Sessione 5: worktree feat/drift-v2 → mapping.js + git-diff.js
├── Sessione 6: (handoff) → refactor index.js → test passano
└── Sessione 7: semplifica → draft PR #142

Giorno 5 — REVIEW
├── Sessione 8: review interattiva file per file
├── Fix richieste → push → test CI verdi
└── gh pr ready 142

Giorno 5 — DOCUMENTAZIONE
├── Sessione 9: aggiorna README, CLI ref, API, CHANGELOG
├── Sessione 10: crea guida utente drift-guard.md
└── doclify . → score 87 → dogfooding ok
```

---

## Regole trasversali

Queste regole valgono per **tutte le fasi**:

1. **Una sessione, un obiettivo**. Non mescolare pianificazione e coding nella stessa sessione (Tip 5).

2. **Handoff sempre**. Quando il contesto si riempie, scrivi HANDOFF.md prima di chiudere (Tip 8). La sessione successiva parte da lì.

3. **Contesto fresco > contesto lungo**. Meglio 3 sessioni corte con handoff che 1 sessione lunga dove le performance degradano (Tip 5).

4. **Verifica sempre**. Dopo ogni output significativo, chiedi a Claude Code di double-check (Tip 28): "Verifica ogni claim, fammi una tabella di cosa hai potuto verificare."

5. **Semplifica**. Se il codice o il testo sembra sovra-ingegnerizzato, chiedi di semplificare (Tip 40). Vale per codice, specifiche e documentazione.

6. **Git è il tuo checkpoint**. Committa spesso. Usa draft PR. Non pushare finché non hai verificato il diff (Tip 4).

7. **I test sono il contratto**. Scrivi i test dalla spec PRIMA del codice. Se un test fallisce, il codice è sbagliato, non il test (Tip 34).

8. **Dogfooding**. Usa Doclify sui docs di Doclify. Se il tuo tool non passa il suo stesso quality gate, c'è un problema.
