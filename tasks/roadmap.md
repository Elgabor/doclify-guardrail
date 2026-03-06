# Roadmap doclify-guardrail

> **Visione:** markdownlint ti dice se il tuo Markdown e ben formattato. doclify ti dice se la tua documentazione e sana.
> Style + content + links + freshness + score + CI/CD + automazione: un solo tool.
> Prima di vendere, doclify deve essere credibile come quality gate. La priorita non e aggiungere feature: e rendere affidabile cio che esiste gia.

---

## Principio guida 2026

1. **Trust before surface area.** Un prodotto vendibile non e quello con piu feature, ma quello che non mente su PASS/FAIL.
2. **Una sola semantica canonica.** CLI, watch mode, API, JUnit, SARIF, GitHub Action e reliability tooling devono convergere sullo stesso risultato.
3. **Prima correggere le rotture, poi estendere.** Plugin, AI e cloud hanno senso solo dopo una release stabile.
4. **Ogni claim pubblico deve essere testato.** Se README promette una capability, deve esistere un test o uno smoke check che la copra.

---

## Modello di Business

| Tier | Prezzo | Target |
|------|--------|--------|
| **Free** (OSS) | $0 | Developer individuali, open source |
| **Pro** | $29/mese per repo | Team piccoli, startup |
| **Org** | $199/mese (50 repo, 10 membri) | Team medi |
| **Enterprise** | Da $999/mese (custom) | Grandi aziende, compliance |

**Principio:** il CLI free deve essere chiaramente migliore di markdownlint sul problema "docs health". Si paga per governance, team workflows, AI, cloud, compliance.

---

## Stato verificato sul ramo attuale

### Fondazioni gia presenti

- [x] Core CLI zero-deps su Node.js 20+
- [x] 35 regole built-in tra contenuto e stile
- [x] Auto-fix per style + insecure links
- [x] Diff/staged mode, track/trend, min-score, compact output
- [x] API programmatica (`lint`, `fix`, `score`)
- [x] Config gerarchica con override per subdirectory
- [x] Check link locali/remoti con guardrail SSRF
- [x] Freshness check, root-relative link handling, custom rules
- [x] Report Markdown, JUnit, SARIF e badge SVG
- [x] GitHub Action e PR comment bot
- [x] Reliability gate locale con corpus, baseline e waiver
- [x] Docs sync guardrail
- [x] 203 test locali verdi sul ramo attuale

### Stato di prodotto

Doclify ha gia superato la fase "toy tool". Ha un core coerente, output machine-readable, una story CI credibile e un perimetro di value proposition chiaro. Quello che manca non e la visione del prodotto: manca la stretta finale per farne una release stabile che puoi mettere davanti a utenti paganti senza dover aggiungere a voce "pero questa parte e un po fragile".

---

## Gap da chiudere prima di chiamarlo stabile

| Priorita | Gap | Stato | Note |
|----------|------|-------|------|
| P0 | GitHub Action bundle path rotto nel dist | [ ] | Rottura critica: l'artefatto che GitHub esegue puo non trovare il CLI |
| P0 | Watch mode diverge dal pipeline canonico | [ ] | Ignora check-links, check-freshness e parte del percorso fix |
| P0 | Config discovery fuori dal `cwd` | [ ] | Falsa benchmark e scan di repo esterni; impatta `run-corpus` |
| P1 | `disable-file` attivo dentro fenced code block | [ ] | Falso negativo grave su file che documentano le suppressions |
| P1 | Frontmatter/freshness fragile su CRLF | [ ] | Falsi positivi cross-platform |
| P1 | Freshness accetta date impossibili o future | [ ] | Il gate perde significato operativo |
| P1 | JUnit non riflette strict-mode failures | [ ] | CI/reporting divergono dal verdetto reale |
| P1 | Action `path` non supporta piu file espliciti | [ ] | Contratto pubblico ambiguo |
| P2 | Paginated PR comments da verificare | [ ] | Rischio duplicazione commenti su PR molto lunghe |
| P2 | HEAD-only fallback da verificare | [ ] | Rischio di falsi dead-link su alcuni host |

**Conclusione operativa:** la prossima milestone non deve essere "plugin system". Deve essere "stability release".

---

## Changelog versioni completate

### v1.2 — Core features + inline suppressions ✅

### v1.3 — Bug fix critici + UX ✅

- Fix JSON output buffer (backpressure/drain)
- Fix `--fix` dentro code block
- Strict mode labeling `error [strict]`
- Warning per regole inesistenti in `--ignore-rules`
- Score con rendimenti decrescenti (`sqrt(warnings)`)
- Parsing URL con parentesi annidate
- `doclify init --force`
- `exclude` nel config JSON
- `--ascii` output mode
- `disable-file` suppression

### v1.4 — +15 regole core con auto-fix ✅

- Parita markdownlint vicina sul piano sintattico
- Introduzione delle regole style con auto-fix

### v1.5 "Foundation" — CLI imbattibile ✅

- Diff/staged mode
- Watch mode
- `--min-score`
- `--format compact`
- API programmatica
- Config gerarchica

### v1.6 "Automate" — CI surfaces + action + trend ✅

- GitHub Action (`action/`)
- PR comment bot
- `--track`, `--trend`, `--fail-on-regression`
- JUnit, SARIF, badge, report
- Reliability gate (`run-corpus`, `compare-baseline`)

---

## v1.7 "Stabilize" — release affidabile e vendibile

**Tema:** chiudere le divergenze tra le superfici esistenti e pubblicare la prima versione che puoi proporre con fiducia a team esterni.

### Obiettivo di milestone

Una release `v1.7` deve permetterti di dire, senza riserve:

- il CLI e la GitHub Action restituiscono lo stesso verdetto a parita di input;
- i formati CI non mentono sullo stato reale;
- il tool regge file reali cross-platform;
- il reliability gate misura il comportamento reale del prodotto;
- i claim del README sono verificati da test o smoke checks.

### Track A — Release blockers da chiudere subito

- [ ] Fix GitHub Action bundle path nel dist
- [ ] Aggiungi smoke test che esegue `action/dist/index.mjs`
- [ ] Refactor `--watch` per riusare il pipeline principale
- [ ] Correggi config discovery per target fuori dal `cwd`
- [ ] Fai girare `run-corpus` con semantica identica a uno scan lanciato dal repo target

### Track B — Correttezza del dominio e dei guardrail

- [ ] Ignora `doclify-disable-file` dentro fenced code blocks
- [ ] Normalizza LF/CRLF prima del parsing frontmatter
- [ ] Rendi esplicita la policy su date future e invalide
- [ ] Aggiungi finding chiaro per freshness metadata non valido
- [ ] Allinea JUnit al pass/fail reale in strict mode
- [ ] Decidi il contratto dell'input `path` della action: singolo target o lista vera

### Track C — Hardening di prodotto

- [ ] Aggiorna README, docs tecnici e examples dopo ogni fix di semantica
- [ ] Aggiungi una matrice test per smoke path pubblici: CLI, API, Action dist, report JUnit/SARIF
- [ ] Aggiungi test per file CRLF e per repo esterni con config al parent
- [ ] Aggiungi un release checklist con criteri go/no-go
- [ ] Definisci patch policy: ogni bug cross-surface deve avere almeno un test di regressione

### Track D — Validazione commerciale minima

- [ ] Dogfood su 3-5 repository reali fuori da questo repo
- [ ] Esegui reliability PR e nightly senza introdurre waiver nuovi
- [ ] Raccogli tempi medi, crash rate, finding correctness e falsi positivi
- [ ] Prepara una "stable release note" orientata al valore per team tecnici

### Definition of Done per v1.7

- [ ] Zero issue P0 aperte sulla superficie CLI/Action
- [ ] Tutte le issue P1 sopra risolte o esplicitamente declassate con motivazione scritta
- [ ] Reliability gate verde su corpus PR e nightly
- [ ] Nessuna divergenza nota tra CLI normale, watch, JUnit e Action
- [ ] Documentazione aggiornata ai comportamenti reali
- [ ] Release taggabile senza caveat del tipo "questa parte non e ancora affidabile"

### Sequenza consigliata di esecuzione

1. **Action e pipeline parity**
   Fissa `DG-01` e `DG-02` per rimuovere subito i due percorsi che oggi possono mentire o fallire in CI.
2. **Config e reliability**
   Fissa `DG-03`, poi riesegui `reliability:pr` e rivaluta le baseline solo dopo aver validato l'impatto.
3. **Correttezza del parser**
   Fissa `DG-04`, `DG-05`, `DG-06` per stabilizzare suppressions, frontmatter e freshness.
4. **Reporting machine-readable**
   Fissa `DG-07` e chiarisci `DG-08`, cosi CLI, action e artifact hanno un contratto pubblico coerente.
5. **Docs + release**
   Aggiorna README/roadmap/docs, prepara changelog di stabilizzazione, tagga la release solo quando tutti i smoke test pubblici sono verdi.

### Deliverable concreti di v1.7

- release `v1.7.0`
- changelog orientato a stabilita e affidabilita
- smoke suite per `action/dist`
- regression tests per tutti i bug P0/P1
- baseline reliability rigenerate solo se necessario e con motivazione

---

## v1.8 "Productize" — onboarding, presets, configurabilita sana

**Tema:** una volta stabile, rendere doclify piu facile da adottare senza aumentare troppo il rischio architetturale.

| Feature | Complessita | Stato |
|---------|-------------|-------|
| Rule severity override (`"rules": { "line-length": "off" }`) | Bassa | |
| `doclify init --preset strict|docs-site|api-docs` | Bassa | |
| Shared config presets (`"extends": "doclify-config-strict"`) | Media | |
| Framework autodetect (Docusaurus/VitePress/MkDocs) | Media | |
| Migliorare UX Action e examples CI | Media | |
| Migration guide "da markdownlint a doclify" | Bassa | |

**Perche viene prima dei plugin:** prima semplifica l'adozione del core. Un sistema di plugin sopra un core non ancora stabilizzato amplifica il debito, non il valore.

---

## v1.9 "Extend" — plugin system dopo la stabilita

**Tema:** estendere doclify senza forkare il core.

| Feature | Complessita | Stato |
|---------|-------------|-------|
| Plugin system JS (moduli ES con `{ rules, fixers }`) | Alta | |
| Reporter plugins (`--reporter ./custom.mjs`) | Media | |
| Hook per output custom | Media | |

**Condizione per partire:** v1.7 e v1.8 devono essere gia stabili. Niente plugin se il core ha ancora divergenze tra CLI e Action.

---

## v2.0 "Intelligence" — prose quality e assistenza locale

**Tema:** aumentare il valore percepito senza trasformare doclify in un CMS.

| Feature | Complessita | Stato |
|---------|-------------|-------|
| VS Code Extension (diagnostics, quick fixes, score bar) | Alta | |
| Prose quality locale (Flesch-Kincaid, passive voice, sentence length) | Alta | |
| Inclusive language (database JSON, ispirato a alex.js) | Media | |
| Content dedup detection cross-file | Media | |
| `doclify coverage` (rapporto exports vs docs) | Media | |
| `doclify explain <rule>` | Bassa | |

**Business:** qui inizia il primo revenue serio del tier Pro. Ma ha senso solo sopra un core stabile e credibile.

---

## v2.1 "Teams" — cloud dashboard + governance

**Tema:** portare doclify da tool a sistema di lavoro per team.

| Feature | Complessita | Stato |
|---------|-------------|-------|
| Cloud dashboard (doclify.dev, Next.js + GitHub OAuth) | Molto Alta | |
| Team style guides (config condivisa via cloud) | Alta | |
| Multi-repo overview | Media | |
| Notifiche (email/Slack per score drop, stale docs) | Media | |
| Score trending cloud | Media | |

**Business:** revenue significativo sul tier Org.

---

## v2.5 "AI Guard" — AI come acceleratore, non stampella

**Tema:** AI opt-in dove aggiunge valore reale al controllo documentale.

| Feature | Complessita | Stato |
|---------|-------------|-------|
| AI prose quality scoring | Alta | |
| Brand voice consistency | Alta | |
| Auto-generated doc suggestions | Alta | |
| Semantic staleness (codice vs docs) | Media | |
| Smart anchor suggestions | Media | |
| Translation quality check | Alta | |

**Vincolo:** non usare AI per coprire bug del core. Prima stabilita, poi valore aumentato.

---

## v3.0 "Enterprise" — SSO, audit, compliance

**Tema:** readiness enterprise dopo che il prodotto ha gia adoption e fiducia.

| Feature | Complessita | Stato |
|---------|-------------|-------|
| SSO (SAML/OIDC: Okta, Azure AD, Google) | Alta | |
| Audit logs | Alta | |
| Approval workflows | Alta | |
| Compliance policies | Media | |
| RBAC | Media | |
| REST API pubblica + SDK | Media | |
| Webhook system | Bassa | |

---

## Sequenza e dipendenze aggiornata

```text
v1.6 ✅  Core solido + CI surfaces + reliability tooling
  │
v1.7 Stabilize (2-5 settimane)
  │   Correzione bug P0/P1, parity tra superfici, smoke suite, stable release
  │
v1.8 Productize (1-2 mesi)
  │   Presets, configurabilita sana, onboarding, migration path
  │
v1.9 Extend (1-2 mesi)
  │   Plugin system e reporter plugins, solo dopo stabilita
  │
v2.0 Intelligence (3-4 mesi)
  │   Prose quality, VS Code, dedup, coverage
  │
v2.1 Teams (3-4 mesi)
  │   Cloud dashboard, team guides, multi-repo overview
  │
v2.5 AI Guard (2-3 mesi)
  │   AI prose, semantic staleness, voice consistency
  │
v3.0 Enterprise (4-6 mesi)
      SSO, audit, compliance, API pubblica
```

**Timeline totale aggiornata:** 20-26 mesi, ma solo se la stabilizzazione viene trattata come lavoro di prodotto, non come side quest.

---

## Strategia competitiva aggiornata

| Competitor | Cosa fa | Come lo superiamo |
|-----------|---------|-------------------|
| markdownlint | Regole sintattiche | Doclify: quality gate completo e score |
| vale | Prose linting | Doclify: contenuto + stile + links + team workflow |
| remark-lint | AST + plugin | Doclify: setup immediato e zero-deps |
| GitBook | CMS + AI | Doclify: quality gate, non piattaforma di authoring |
| ReadMe | API docs platform | Doclify: focalizzato su Markdown repo-based |

**Posizionamento corretto per vendere:**

1. **Adesso:** vendi affidabilita, non AI.
2. **Dopo v1.7:** vendi "docs quality gate che puoi mettere in CI e fidarti del risultato".
3. **Dopo v1.8-v2.0:** vendi produttivita e insight, non solo linting.
4. **Dopo v2.1+:** vendi governance, dati storici e lock-in operativo.

---

## Checklist prima di iniziare nuove feature "ambiziose"

- [ ] La GitHub Action dist e testata davvero
- [ ] `--watch` non diverge piu dal scan normale
- [ ] `run-corpus` misura il comportamento reale del prodotto
- [ ] Frontmatter e freshness sono affidabili su file reali
- [ ] JUnit/SARIF/Action non raccontano stati diversi
- [ ] README e docs tecnici descrivono il sistema reale, non quello desiderato

Se una di queste checkbox resta aperta, la prossima feature non e ancora la scelta giusta.
