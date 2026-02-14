# Piano Step-by-Step — Validazione Mercato Doclify

> Versione: 1.0 — 14 febbraio 2026
> Prerequisiti: file doclify-landing.html pronto, account GitHub esistente
> Budget totale: 0€ (tutto gratis)

---

## FASE 1: Deploy Landing Page (30 minuti)

### Step 1.1 — Crea repo GitHub per la landing
```
1. Vai su github.com → New Repository
2. Nome: "doclify-landing" (può essere pubblica, non contiene codice sensibile)
3. NON inizializzare con README
4. Clicca "Create repository"
```

### Step 1.2 — Pusha il file HTML
```bash
# Sul tuo computer, nella cartella dove hai salvato doclify-landing.html
mkdir doclify-landing
cp doclify-landing.html doclify-landing/index.html   # IMPORTANTE: rinomina in index.html
cd doclify-landing
git init
git add .
git commit -m "Landing page Doclify Guardrail"
git branch -M main
git remote add origin https://github.com/TUO-USERNAME/doclify-landing.git
git push -u origin main
```

### Step 1.3 — Deploy su Vercel (gratis)
```
1. Vai su vercel.com → Sign Up con GitHub
2. Seleziona piano "Hobby" (gratuito)
3. Clicca "Add New" → "Project"
4. Importa il repo "doclify-landing"
5. Lascia tutte le impostazioni default (Vercel rileva automaticamente HTML statico)
6. Clicca "Deploy"
7. In ~20 secondi avrai URL tipo: doclify-landing.vercel.app
```

### Step 1.4 — (Opzionale) Dominio custom
```
Se hai un dominio (es. doclify.dev):
1. In Vercel → Settings → Domains
2. Aggiungi il dominio
3. Configura DNS come indicato da Vercel (CNAME o A record)
4. SSL automatico e gratuito

Se NON hai dominio: usa l'URL .vercel.app, va benissimo per validazione.
```

**Output:** URL landing page live e funzionante.

---

## FASE 2: Setup Form Waitlist (15 minuti)

### Step 2.1 — Crea form su Tally.so
```
1. Vai su tally.so → Sign Up (gratis, niente carta)
2. Crea nuovo form: "Doclify Waitlist"
3. Aggiungi campi:
   - Email (required)
   - Name (required)
   - Role (dropdown: Tech Lead, Engineering Manager, DevOps, CTO/Founder, Dev Advocate, Other)
4. Pubblica il form
```

### Step 2.2 — Collega Google Sheets (tracking automatico)
```
1. Nel form Tally → tab "Integrations"
2. Connetti Google Sheets
3. Ogni iscrizione finirà automaticamente in un foglio Google → tracking gratis
```

### Step 2.3 — Ottieni endpoint per la landing
```
Opzione A (raccomandata): Tally popup/embed
  1. In Tally → Share → Embed
  2. Copia il codice embed
  3. Sostituisci il <form> nella landing con l'embed Tally

Opzione B: Custom endpoint
  1. In Tally → Integrations → Webhooks
  2. Copia l'URL del webhook
  3. Nella landing, sostituisci 'YOUR_FORM_ENDPOINT' con l'URL

Opzione C (più semplice): Redirect
  1. Cambia il bottone "Get Early Access" nella landing per linkare
     direttamente al form Tally (share link)
  2. Zero codice da modificare
```

### Step 2.4 — Testa il flusso completo
```
1. Apri la landing page live
2. Compila il form con un'email di test
3. Verifica che arrivi su Tally + Google Sheets
4. Se funziona: ✅ sei pronto per andare live
```

**Output:** Form waitlist funzionante che raccoglie lead in automatico.

---

## FASE 3: Setup Calendly (10 minuti)

### Step 3.1 — Crea evento discovery call
```
1. Vai su calendly.com → Sign Up (piano gratuito)
2. Crea evento: "Doclify — 15 min Discovery Call"
3. Durata: 15 minuti
4. Disponibilità: scegli gli slot che preferisci
5. Nelle note dell'evento, aggiungi lo script call:
   - Come gestite oggi il controllo qualità delle docs?
   - Quale errore nelle docs vi costa più tempo?
   - Quante persone toccano docs prima del rilascio?
   - Quanto tempo perdete in review/correzioni ogni settimana?
   - Se risolvessimo questo problema, quanto valore avrebbe?
```

### Step 3.2 — Inserisci link nella landing
```
Nel file index.html, trova la riga:
  <a href="#" id="calendlyLink">Book a 15-min discovery call →</a>

Sostituisci # con il tuo link Calendly:
  <a href="https://calendly.com/TUO-USERNAME/doclify-discovery" id="calendlyLink">

Pusha su GitHub → Vercel aggiorna automaticamente.
```

**Output:** Discovery call prenotabili direttamente dalla landing.

---

## FASE 4: Primo Post X + Link Landing (15 minuti)

### Step 4.1 — Pubblica Post #1 (focus problema)

**Testo ITA (pubblica questo):**
```
Molti team rilasciano docs con TODO, link rotti o struttura incoerente.

Sto costruendo Doclify Guardrail: CLI locale che blocca questi problemi
prima della pubblicazione.

In 30 secondi scansiona i tuoi Markdown e trova errori.
Zero costi API, zero setup complesso.

Se gestisci docs tecniche e vuoi testarlo in anteprima →
[LINK LANDING]

Oppure scrivimi "DOC" in DM.
```

**Testo ENG (pubblica come reply al tweet ITA):**
```
Many teams ship docs with TODO, broken links or inconsistent structure.

I'm building Doclify Guardrail: local CLI that catches these issues
before publishing.

Scans your Markdown in 30 seconds. No API costs, no complex setup.

If you manage technical docs and want early access →
[LINK LANDING]

Or DM me "DOC".
```

### Step 4.2 — Engagement immediato post pubblicazione
```
Nei 30 minuti dopo il post:
1. Metti like a 5 tweet di persone nel target (tech lead, devops, dev tool makers)
2. Rispondi a 3 tweet altrui con commenti utili (non spam, valore reale)
3. Segui 5-10 profili nel target
```

**Output:** Post live con link landing, primi segnali di engagement.

---

## FASE 5: Outreach DM Batch #1 (60 minuti)

### Step 5.1 — Identifica 10 profili target su X

**Come trovarli:**
```
1. Cerca su X: "docs" OR "documentation" OR "markdown" OR "devops"
2. Filtra per profili con:
   - Bio che menziona "tech lead", "engineering", "devops", "CTO"
   - Tweet recenti su docs, tooling, CI/CD
   - Repo GitHub pubbliche con docs/
3. Cerca nelle community:
   - Chi tweeta su Docusaurus, MkDocs, VitePress
   - Chi commenta release di tool simili (markdownlint, vale, etc.)
4. Guarda followers/following di account tipo:
   @readme, @docusaborocean, @mkaboreas (account dev tool)
```

### Step 5.2 — Invia DM personalizzati

**Template DM (personalizza SEMPRE il motivo):**
```
Ciao [Nome],

sto testando un tool che blocca errori nelle docs tecniche prima del publish
(placeholder, link rotti, struttura).

Ho pensato a te perché [MOTIVO REALE - es: "ho visto che gestisci le docs
di [progetto]" oppure "il tuo tweet su [topic] mi ha fatto pensare che
potresti avere questo problema"].

Ti va una call da 15 minuti per capire se può aiutare il tuo team?
Nessuna vendita, solo feedback pratico.

[LINK CALENDLY]
```

**Regole DM:**
```
- Max 3-4 righe, niente wall of text
- Personalizzare SEMPRE il motivo del contatto
- MAI inviare lo stesso DM identico a tutti
- Se non rispondono entro 48h: 1 follow-up leggero, poi stop
- Mai più di 10-15 DM/giorno (rischio blocco account)
```

### Step 5.3 — Traccia tutto su Google Sheets
```
Crea foglio "Doclify Outreach Tracker" con colonne:
| Data | Nome | Handle X | DM inviato | Risposta | Interesse | Call prenotata | Note |
```

**Output:** 10 DM inviati, tracking attivo.

---

## FASE 6: Secondo Post X + Engagement (30 minuti)

### Step 6.1 — Pubblica Post #2 (focus risultato/pilot)

**Testo ITA:**
```
In 30 secondi Doclify segnala errori nelle tue docs:
→ H1 multipli
→ Placeholder dimenticati (TODO, lorem ipsum)  
→ Link insicuri (http://)
→ Report markdown automatico

Cerco 3 team per pilot B2B: setup guidato + feedback diretto.

Interessato? DM aperto o prenota una call da 15 min:
[LINK CALENDLY]
```

### Step 6.2 — Engagement attivo
```
1. Rispondi a TUTTI i commenti al post #1 e #2
2. Ringrazia chi retweeta
3. Continua interazioni con profili target
4. Se qualcuno commenta positivamente → DM immediato
```

**Output:** Secondo touchpoint pubblico, lead caldi in arrivo.

---

## FASE 7: KPI Check + Decisione GO/NO-GO (30 minuti)

### Step 7.1 — Raccogli numeri

Compila questa tabella a fine giornata / fine weekend:

```
| KPI                        | Obiettivo | Risultato |
|----------------------------|-----------|-----------|
| Post X pubblicati          | 2         |           |
| DM inviati                 | 10        |           |
| DM con risposta            | 2+ (20%)  |           |
| Call prenotate             | 2-3       |           |
| Waitlist iscritti          | 5+        |           |
| Intent-to-pay              | 2+        |           |
```

### Step 7.2 — Decisione

```
SE >= 2 segnali positivi (risposte DM, call prenotate, iscrizioni):
  → GO: continua con call discovery Settimana 2
  → Segui roadmap giorno 5-7

SE < 2 segnali positivi:
  → PIVOT immediato:
    1. Prova community diverse: dev.to, Reddit r/devops, r/webdev
    2. Rivedi targeting: forse il pain non è abbastanza forte per questo segmento
    3. Se dopo 7 giorni totali zero trazione → STOP, cambia segmento
```

**Output:** Decisione documentata con dati reali.

---

## FASE 8: Iterazione Settimana 2+ (se GO)

### Routine giornaliera
```
OGNI GIORNO (60-90 min):
□ 1 post X (alterna problema/risultato/behind-the-scenes)
□ 5-10 DM nuovi a profili target
□ Risposte e engagement a chi interagisce
□ Follow-up a chi ha mostrato interesse ieri
□ Aggiorna tracker Google Sheets
```

### Call discovery (quando le prenoti)
```
1. Usa lo script 5 domande dal Kit validazione X
2. NON vendere durante la call — ascolta e prendi appunti
3. Alla fine: "Se risolvessimo questo, quanto valore avrebbe per voi?"
4. Se positivi: "Stiamo offrendo un pilot a prezzo test. Ti mando i dettagli?"
5. Traccia ogni call su Google Sheets: nome, azienda, pain, budget, next step
```

### Settimana 2 — Obiettivo
```
- 2-3 call discovery completate
- 1 proposta pilot inviata
- Post X: almeno 5 totali
- DM: almeno 30 totali
- Waitlist: 10+ iscritti
```

### Settimana 3 — Obiettivo
```
- 1 cliente pilota pagante (o intent-to-pay firmato)
- Offerta commerciale v1 pronta
- Primi testimonial/feedback raccolti
- Decisione su moat primario
```

---

## Checklist Riepilogativa

```
FASE 1 — Deploy
□ Repo GitHub creata
□ File HTML pushato come index.html
□ Vercel collegato e deploy attivo
□ URL landing funzionante

FASE 2 — Form
□ Form Tally creato con campi giusti
□ Google Sheets collegato
□ Form collegato alla landing (embed o link)
□ Test end-to-end completato

FASE 3 — Calendly
□ Evento discovery 15 min creato
□ Link inserito nella landing
□ Pusha aggiornamento e verifica

FASE 4 — Post #1
□ Post pubblicato su X con link landing
□ 30 min engagement post-pubblicazione

FASE 5 — Outreach
□ 10 profili target identificati
□ 10 DM personalizzati inviati
□ Tracker Google Sheets attivo

FASE 6 — Post #2
□ Secondo post pubblicato
□ Engagement attivo su commenti

FASE 7 — KPI
□ Numeri raccolti
□ Decisione GO/NO-GO documentata
```
