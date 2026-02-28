# Roadmap doclify-guardrail

> **Visione:** markdownlint ti dice se il tuo Markdown è ben formattato. doclify ti dice se la tua documentazione è sana.
> L'unico quality gate AI per documentazione Markdown, pensato per team di sviluppo.
> Stile + contenuto + link + freshness + prose quality + coverage + score + CI/CD + AI — un solo tool.

---

## Modello di Business

| Tier | Prezzo | Target |
|------|--------|--------|
| **Free** (OSS) | $0 | Developer individuali, open source |
| **Pro** | $29/mese per repo | Team piccoli, startup |
| **Org** | $199/mese (50 repo, 10 membri) | Team medi |
| **Enterprise** | Da $999/mese (custom) | Grandi aziende, compliance |

**Principio:** Il CLI free è MEGLIO di markdownlint. Si paga per team features, AI, cloud dashboard, compliance.

---

## Changelog versioni completate

### v1.2 — Core features + inline suppressions ✅

### v1.3 — Bug fix critici + UX ✅

- Fix JSON output buffer (backpressure/drain)
- Fix `--fix` dentro code block
- Strict mode labeling `✗ error [strict]`
- Warning per regole inesistenti in `--ignore-rules`
- Score con rendimenti decrescenti (√warnings)
- Parsing URL con parentesi annidate
- `doclify init --force`
- `exclude` nel config JSON
- `--ascii` output mode
- `disable-file` suppression

### v1.4 — +15 regole core con auto-fix ✅

26 regole totali (11 content + 15 style), 13 auto-fix. Parità markdownlint al 95%.

Regole aggiunte: `no-trailing-spaces`, `no-multiple-blanks`, `single-trailing-newline`, `no-missing-space-atx`, `heading-start-left`, `no-trailing-punctuation-heading`, `blanks-around-headings`, `blanks-around-lists`, `blanks-around-fences`, `fenced-code-language`, `no-bare-urls`, `no-reversed-links`, `no-space-in-emphasis`, `no-space-in-links`, `no-inline-html`.

---

## v1.5 "Foundation" — CLI imbattibile

**Tema:** Superare markdownlint su ogni fronte. Nessun motivo per usare altro.

| Feature | Complessità | Stato |
|---------|-------------|-------|
| `doclify diff` (`--diff`, `--base`, `--staged`) | Media | |
| `doclify watch` (fs.watch con debounce) | Media | |
| `--min-score <n>` quality gate | Bassa | |
| `--format compact\|tap` | Bassa | |
| Pre-commit hook nativo | Bassa | |
| API programmatica (`api.mjs`) | Media | |
| +5 regole (`list-marker-consistency`, `no-empty-sections`, `heading-increment`, `no-duplicate-links`, `link-title-style`) | Media | |
| Config gerarchica (subdirectory override) | Media | |

---

## v1.6 "Automate" — GitHub Action + PR Bot

**Tema:** Quality gate automatico in ogni pull request.

| Feature | Complessità | Stato |
|---------|-------------|-------|
| GitHub Action ufficiale (repo separato) | Media | |
| PR Comment Bot (score delta, tabella file) | Alta | |
| Score trending locale (`.doclify-history.json`, `--track`, `--trend`) | Media | |
| `--fail-on-regression` | Bassa | |
| GitLab CI template | Bassa | |

---

## v1.7 "Extend" — Plugin System + Presets

**Tema:** La community estende doclify senza forkare.

| Feature | Complessità | Stato |
|---------|-------------|-------|
| Plugin system JS (moduli ES con `{ rules, fixers }`) | Alta | |
| Reporter plugins (`--reporter ./custom.mjs`) | Media | |
| Shared config presets (`"extends": "doclify-config-strict"`) | Media | |
| Rule severity override (`"rules": { "line-length": "off" }`) | Bassa | |
| `doclify init --preset strict\|docs-site\|api-docs` | Bassa | |
| Framework autodetect (Docusaurus/VitePress/MkDocs) | Media | |

---

## v2.0 "Intelligence" — VS Code + Prose Quality + Inclusive Language

**Tema:** Non solo formattazione, ma qualità della prosa. Zero dipendenze.

| Feature | Complessità | Stato |
|---------|-------------|-------|
| VS Code Extension (diagnostics, quick fixes, score bar) | Alta | |
| Prose quality locale (Flesch-Kincaid, passive voice, sentence length) | Alta | |
| Inclusive language (database JSON, ispirato a alex.js) | Media | |
| Content dedup detection (n-gram fingerprinting cross-file) | Media | |
| `doclify coverage` (rapporto exports vs docs) | Media | |
| `doclify explain <rule>` | Bassa | |

**Business:** Primo revenue — Pro tier $29/mese per dedup, coverage, prose trending.

---

## v2.1 "Teams" — Cloud Dashboard + Governance

**Tema:** I manager vedono la qualità. I team collaborano.

| Feature | Complessità | Stato |
|---------|-------------|-------|
| Cloud dashboard (doclify.dev, Next.js + GitHub OAuth) | Molto Alta | |
| Team style guides (config condivisa via cloud) | Alta | |
| Multi-repo overview (ranking per qualità) | Media | |
| Notifiche (email/Slack per score drop, stale docs) | Media | |
| Score trending cloud (grafici storici per repo/branch) | Media | |

**Business:** Revenue significativo — Org tier $199/mese.

---

## v2.5 "AI Guard" — Feature AI-powered

**Tema:** AI come copilota per la qualità. Opt-in via `--ai` + `DOCLIFY_AI_KEY`.

| Feature | Complessità | Stato |
|---------|-------------|-------|
| AI prose quality scoring (LLM: chiarezza, completezza, tono) | Alta | |
| Brand voice consistency (`--brand-voice ./voice.md`) | Alta | |
| Auto-generated doc suggestions (bozze per funzioni non documentate) | Alta | |
| Semantic staleness (AI confronta codice vs docs) | Media | |
| Smart anchor suggestions (link rotto → suggerimento AI) | Media | |
| Translation quality check (confronto file multilingua) | Alta | |

**Business:** Pro $39/mese (AI 100 file/mese), Org $299/mese (illimitato).

---

## v3.0 "Enterprise" — SSO, Audit, Compliance

**Tema:** Enterprise-ready. Governance, compliance, audit trail.

| Feature | Complessità | Stato |
|---------|-------------|-------|
| SSO (SAML/OIDC: Okta, Azure AD, Google) | Alta | |
| Audit logs (ogni azione loggata, export CSV/JSON) | Alta | |
| Approval workflows (PR regression → doc owner approval) | Alta | |
| Compliance policies (template SOC2, ISO 27001, GDPR) | Media | |
| RBAC (admin, editor, viewer) | Media | |
| Custom AI models (Ollama/vLLM self-hosted) | Media | |
| REST API pubblica + SDK (Node.js/Python/Go) | Media | |
| Webhook system (Zapier, PagerDuty, Jira) | Bassa | |

**Business:** Enterprise $999+/mese. SSO, SLA 99.9%, dedicated support.

---

## Sequenza e dipendenze

```text
v1.4 ✅ (oggi — 26 regole, 13 fix, 116 test)
  │
v1.5 Foundation (2-3 mesi)
  │   diff, watch, min-score, API, +5 regole
  │
v1.6 Automate (1-2 mesi)
  │   GitHub Action, PR bot, score trending
  │
v1.7 Extend (2-3 mesi)
  │   Plugin system, shared configs, presets
  │
v2.0 Intelligence (3-4 mesi)  ← PRIMO REVENUE
  │   VS Code, prose quality, inclusive lang, dedup
  │
v2.1 Teams (3-4 mesi)  ← REVENUE SIGNIFICATIVO
  │   Cloud dashboard, team style guides
  │
v2.5 AI Guard (2-3 mesi)
  │   AI prose, brand voice, translation
  │
v3.0 Enterprise (4-6 mesi)  ← ENTERPRISE REVENUE
      SSO, audit, compliance, API pubblica
```

**Timeline totale:** 18-24 mesi da v1.4 a v3.0.

---

## Strategia competitiva

| Competitor | Cosa fa | Come lo superiamo |
|-----------|---------|-------------------|
| markdownlint | 50 regole sintassi | Doclify: 26+ regole + prose + links + score + AI |
| vale | Prose linting (Go) | Doclify: prose + sintassi + team + AI in un tool |
| remark-lint | AST-based, 70+ plugin | Doclify: zero dipendenze, setup immediato |
| GitBook ($65+/mese) | CMS + AI Agent | Doclify: quality gate, non CMS. Complementare. |
| ReadMe ($99+/mese) | API docs platform | Doclify: Markdown-focused, non API platform. |
| Grammarly ($12/user) | AI prose (API deprecata) | Doclify: API funzionante + tecnico + team |

**Lock-in tramite valore:**
1. v1.5-1.7: Superiorità tecnica del CLI free
2. v2.0: VS Code + prose quality indispensabile
3. v2.1: Dati storici nel cloud (perdere mesi di trend se cambi)
4. v2.5: Brand voice personalizzata
5. v3.0: Audit trail e compliance non migrabili
