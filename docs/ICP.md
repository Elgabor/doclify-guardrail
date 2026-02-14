# Doclify Guardrail — Ideal Customer Profile (ICP)

> Versione: 1.0 — 14 febbraio 2026
> Principio guida: nicchia > mercato ampio (Principi David §3)

---

## Persona primaria

**Ruolo:** Tech Lead / Engineering Manager

**Azienda tipo:** Startup o PMI tech, team engineering 3-10 persone, prodotto software con documentazione developer-facing pubblica.

**Età:** 28-42 anni

**Seniority:** Mid-senior (3-8 anni esperienza), responsabile diretto della qualità delle docs del team.

---

## Problema principale

Le docs tecniche pubbliche (API docs, guide onboarding, README prodotto) vengono rilasciate con errori evitabili:

- **Placeholder dimenticati:** `TODO`, `lorem ipsum`, `xxx`, `TBD` che finiscono in produzione
- **Link rotti o insicuri:** riferimenti `http://` invece di `https://`, link morti
- **Struttura incoerente:** heading multipli H1, frontmatter mancante, righe troppo lunghe
- **Nessun gate automatico:** la review è manuale, soggettiva, e spesso saltata per pressione di delivery

**Costo del problema:** danno reputazionale con developer esterni, ticket di supporto evitabili, tempo perso in review manuali (stimato 2-4h/settimana per team).

---

## Soluzione cercata

Un tool che faccia quality gate automatico sui file Markdown prima del publish, con queste caratteristiche:

- Locale (no dati su server esterni)
- Veloce (< 30 secondi per run)
- Zero setup complesso (CLI, `npm install`, via)
- Integrabile in CI/CD o pre-commit hook
- Regole personalizzabili per il team

---

## Dove sta online

| Canale | Comportamento |
|---|---|
| **X (Twitter)** | Segue account dev tool, commenta release note, condivide tips tecnici |
| **GitHub** | Repo pubbliche con docs, contribuisce a progetti open source |
| **dev.to / Hashnode** | Legge e pubblica articoli su DX, tooling, CI/CD |
| **Reddit** | r/devops, r/webdev, r/programming (lurker o commentatore) |
| **Slack/Discord** | Community tech verticali (es. Docusaurus, MkDocs, DevOps) |

**Canale primario per outreach:** X (Twitter) — combinazione contenuti + DM diretti.

---

## Quanto paga

| Voce | Valore |
|---|---|
| **Budget tool individuali** | Autonomia su acquisti < 50€/mese senza approval |
| **Prezzo pilot Doclify** | **39,99€/mese per team** |
| **Modello** | Subscription mensile, cancellazione libera |
| **Confronto mentale** | "Costa meno di un'ora di debug su docs rotte" |
| **Willingness to pay signal** | Già paga per: GitHub Pro, Vercel, Notion, linting tools |

---

## Criteri di qualificazione lead

Un lead è qualificato se soddisfa almeno 3 di questi 5 criteri:

1. **Ruolo:** Tech Lead, Engineering Manager, o CTO di team 3-10
2. **Docs pubbliche:** Il loro prodotto ha documentazione developer-facing visibile
3. **Pain attivo:** Menziona problemi con docs (errori, review lente, inconsistenze)
4. **Stack compatibile:** Usa Markdown per docs (non Confluence/Google Docs esclusivamente)
5. **Budget autonomo:** Può decidere acquisto tool < 50€/mese senza catena approvativa lunga

---

## Anti-persona (chi NON è il target)

- **Enterprise > 50 persone:** cicli decisionali troppo lunghi, servono procurement/security review
- **Freelancer singolo:** non ha il pain del team, non paga per tool docs
- **Team che usa solo Confluence/Google Docs:** non usa Markdown, Doclify non serve
- **Studenti / hobbisti:** zero budget, zero urgenza

---

## Proposta di valore (one-liner)

> **Doclify blocca errori nelle tue docs tecniche in 30 secondi, prima che i tuoi utenti li vedano.**

---

## Note per outreach

- Parlare di **risultato** (zero errori in produzione), non di **feature** (CLI con 5 regole)
- Usare linguaggio da peer tecnico, non da marketer
- CTA sempre leggera: "ti va una call da 15 min?" o "scrivimi DOC in DM"
- Mai spam: personalizzare sempre il motivo del contatto
