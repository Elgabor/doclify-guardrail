# Doclify: da Quality Gate a Documentation Engine

## La visione

Doclify non diventa "un altro AI doc writer". Doclify diventa l'unico sistema che
**scrive, verifica, corregge e mantiene** documentazione in un loop chiuso.

La differenza è fondamentale:

```
CHATGPT / COPILOT / MINTLIFY:
  Scrivi docs → sperare che siano buone → dimenticarsene → degradano

DOCLIFY:
  Scrivi docs (AI guidata dalle regole) →
  Verifica automatica (35 regole + score) →
  Auto-correggi (14 fix + AI) →
  Pubblica solo se score ≥ soglia →
  Monitora nel tempo (freshness + drift) →
  Ri-scrivi quando serve (il loop ricomincia)
```

Nessun competitor ha questo loop. Swimm scrive ma non enforcea.
Vale enforcea ma non scrive. ChatGPT scrive qualsiasi cosa senza standard.

---

## Come si evolve il prodotto — 3 fasi

### Fase A: Il Giudice (oggi → già fatto)
Doclify sa giudicare la documentazione.
35 regole, score 0-100, link check, freshness, quality gate.

"Questi docs sono buoni o no?" → Doclify risponde con un numero.

### Fase B: Il Giudice + Dashboard (prossimo → Q2 2026)
Doclify giudica E mostra i risultati nel tempo.
Dashboard cloud, trending, alert, webhook, badge.

"Come stanno i nostri docs rispetto a ieri?" → La dashboard risponde.

### Fase C: Il Giudice che sa anche Scrivere (futuro → Q3-Q4 2026)
Doclify giudica, mostra E agisce.
Scrive docs, le verifica contro le sue stesse regole,
le corregge, e le mantiene aggiornate nel tempo.

"Scrivi la documentazione per questa funzione,
 assicurati che passi il quality gate,
 e avvisami se diventa stale." → Doclify fa tutto.

---

## Fase C nel dettaglio: come funziona l'AI writing

### Il principio: "I generate what I enforce"

La maggior parte dei doc writer AI genera testo generico.
Doclify genera testo che rispetta le sue stesse regole.

Esempio concreto:

```
INPUT: src/score.js (codice sorgente)
       .doclify/style.yml (regole del team)
       docs/ (documentazione esistente)

DOCLIFY AI:
  1. Legge il codice → capisce cosa fa score.js
  2. Legge le regole → sa che serve: heading H2, description, params, example
  3. Legge i docs esistenti → capisce lo stile e il tono del team
  4. Genera docs/api/score.md
  5. Lancia le sue stesse 35 regole sulla doc generata
  6. Score = 72? → Auto-fix i problemi trovati → ri-verifica
  7. Score = 94? → OK, propone la PR
  8. Il quality gate controlla → PASS → merge

OUTPUT: docs/api/score.md — documentazione che è
        GARANTITA passare il quality gate del team
```

### I 4 superpoteri dell'AI writing di Doclify

#### 1. Genera docs dal codice (come tutti, ma meglio)
Legge il codice sorgente e genera documentazione.
Ma a differenza degli altri, la genera SECONDO LE REGOLE DEL TEAM.
Se il team vuole heading H2, li usa. Se vuole esempi, li include.
Se vuole un certo tono, lo rispetta. Perché conosce le regole.

#### 2. Self-verify (nessuno lo fa)
Dopo aver generato, lancia le sue stesse regole.
Se il testo non passa, lo corregge. Loop fino a score ≥ soglia.
Il risultato è documentazione che è MATEMATICAMENTE conforme.

#### 3. Self-maintain (il vero game changer)
Quando il codice cambia (git diff), il drift guard identifica
quali docs sono disallineate. L'AI ri-genera SOLO le sezioni
che sono cambiate. Non riscrive tutto — aggiorna chirurgicamente.
Poi ri-verifica. Il quality gate conferma.

Questo risolve il problema #1 della documentazione:
la documentazione che invecchia senza che nessuno se ne accorga.

#### 4. Style transfer (differenziante)
L'AI impara lo stile dai docs ESISTENTI del team.
Non genera testo generico — genera testo che sembra scritto
dalla stessa persona che ha scritto il resto dei docs.
Coerenza di tono, terminologia, struttura.

---

## Come lo vendi — il positioning evoluto

### Oggi (Fase A+B):
> "Doclify è il SonarQube dei docs.
>  Quality gate, score e trending per la tua documentazione."

### Domani (Fase C):
> "Doclify è il documentation engine per il tuo team.
>  Scrive docs che passano sempre il quality gate,
>  le mantiene aggiornate quando il codice cambia,
>  e ti avvisa prima che diventino stale."

### La tagline che unifica tutto:
> **"Documentation that writes, checks, and fixes itself."**

O in italiano:
> **"Documentazione che si scrive, si controlla e si corregge da sola."**

---

## Architettura tecnica della Fase C

```
┌─────────────────────────────────────────────────┐
│              CLI / GitHub Action                  │
│                                                   │
│  doclify generate src/score.js                    │
│  doclify review docs/api/score.md                 │
│  doclify maintain --watch                         │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│            DOCLIFY AI ENGINE                      │
│                                                   │
│  ┌─────────┐  ┌──────────┐  ┌───────────────┐   │
│  │ GENERATE │→ │ VERIFY   │→ │ FIX           │   │
│  │ (LLM)   │  │ (regole) │  │ (LLM + rules) │   │
│  └─────────┘  └──────────┘  └───────────────┘   │
│       ↑              │              │             │
│       └──────────────┴──────────────┘             │
│              loop fino a score ≥ soglia           │
│                                                   │
│  Context:                                         │
│  - Codice sorgente (AST + semantica)              │
│  - Regole del team (.doclify/rules/)              │
│  - Docs esistenti (stile, tono, struttura)        │
│  - Git history (cosa è cambiato)                  │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│              DASHBOARD CLOUD                      │
│                                                   │
│  - Score trending (generati + verificati)         │
│  - Drift alerts (code changed, doc stale)         │
│  - Auto-maintain log (cosa l'AI ha aggiornato)    │
│  - Review queue (docs generate in attesa di OK)   │
└─────────────────────────────────────────────────┘
```

### Scelta del modello AI

Per la Fase C servono chiamate LLM. Due opzioni:

| Opzione | Pro | Contro |
|---|---|---|
| **API esterna (Claude/GPT)** | Qualità massima, zero infra | Costo per call, dati escono dal sistema |
| **Modello locale (Ollama)** | Zero costo, dati restano locali | Qualità inferiore, richiede GPU |

**Raccomandazione:** API esterna per il tier Pro (il cliente paga $29/seat,
il costo API è ~$0.01-0.10 per doc generata — margine enorme).
Opzione locale per chi ha requisiti di privacy.

### Nuovi comandi CLI

```bash
# Genera docs per un file di codice
doclify generate src/score.js --output docs/api/score.md

# Genera docs per tutto il progetto
doclify generate src/ --output docs/api/

# Rivedi e correggi una doc esistente
doclify review docs/api/score.md --fix

# Mantieni docs allineate al codice (watch mode)
doclify maintain --base HEAD~1

# Tutto insieme: genera, verifica, fixa, pusha
doclify generate src/score.js --verify --fix --push
```

---

## La risposta alla tua domanda

Sì, Doclify può diventare uno scrittore di documentazione preciso,
efficace e affidabile. Ma NON perché usa un AI migliore degli altri.

Può farlo perché è L'UNICO che ha il loop chiuso:
**genera → verifica → corregge → monitora → ri-genera.**

Tutti gli altri generano e sperano. Doclify genera e DIMOSTRA
che il risultato è conforme, con un numero (lo score)
e un gate (pass/fail).

È la differenza tra uno scrittore che ti dà un testo e dice "dovrebbe andare bene"
e uno scrittore che ti dà un testo con un certificato di conformità allegato.

---

## L'ordine giusto per costruirlo

NON partire dall'AI writing. Parti dal giudice, poi aggiungi la penna.

1. **Ora → Fase B**: Dashboard + Quality Gate (vendi la visibilità)
2. **Q3 → Fase C step 1**: `doclify review` — l'AI rivede docs esistenti
3. **Q3 → Fase C step 2**: `doclify generate` — l'AI scrive docs nuove
4. **Q4 → Fase C step 3**: `doclify maintain` — l'AI mantiene docs nel tempo

Perché questo ordine? Perché se parti dalla scrittura AI senza il quality gate,
sei uno dei 50 tool che scrivono docs con AI. Se parti dal quality gate e POI
aggiungi la scrittura, sei l'unico che GARANTISCE la qualità di ciò che scrive.

Il quality gate è il moat. L'AI writing è il turbo.
