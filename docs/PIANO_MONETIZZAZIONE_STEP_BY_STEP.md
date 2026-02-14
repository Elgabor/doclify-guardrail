# Piano Monetizzazione Doclify — Come Farsi Pagare

> Versione: 1.0 — 14 febbraio 2026
> Stato: dalla repo GitHub al primo pagamento
> Principio: vendere prima, costruire poi (Principi David)

---

## IL QUADRO: Cosa hai e cosa ti manca

### Cosa HAI già
```
✅ CLI funzionante (v0.4, 16/16 test)
✅ Repo GitHub privata
✅ 5 regole guardrail implementate
✅ --report, --rules, --strict, --config
✅ Hook pre-commit
✅ Landing page
```

### Cosa ti MANCA per monetizzare
```
❌ Sistema di pagamento
❌ Meccanismo di licensing (free vs paid)
❌ Offerta chiara (cosa include il piano a pagamento)
❌ Checkout page
```

---

## STRATEGIA: Quale modello per Doclify

### Modelli possibili

| Modello | Pro | Contro | Per Doclify? |
|---|---|---|---|
| **Open core** (free base + paid pro) | Community gratis, upsell naturale | Devi decidere cosa è free vs paid | ✅ Raccomandato |
| **Full SaaS** con dashboard web | Recurring revenue, lock-in | Troppo da costruire ora | ❌ Troppo presto |
| **License key** su CLI | Semplice, B2B-friendly | Serve sistema verifica | ✅ Fattibile |
| **Consulenza / setup guidato** | Alto ticket, zero infra | Non scala | ✅ Per i primi clienti |

### La mia raccomandazione: START con consulenza → EVOLVI in license key

```
FASE A (ora → primo pagamento):
  Vendi "Pilot Package" come servizio:
  - Setup guidato Doclify per il team del cliente
  - Regole custom configurate per i loro docs
  - 30 giorni di supporto diretto
  - Prezzo: 39,99€/mese OPPURE 199€ una tantum per il pilot
  → NON serve infrastruttura, solo il tuo tempo + la CLI

FASE B (dopo 3-5 clienti):
  Implementa license key nella CLI:
  - Free: 3 regole base, max 10 file per scan
  - Pro: tutte le regole, file illimitati, regole custom, report
  → Pagamento via Lemon Squeezy o Polar

FASE C (dopo 10+ clienti):
  Dashboard web opzionale:
  - Storico scan
  - Config team condivisa
  - CI/CD integration guidata
```

---

## FASE A: Vendere il Pilot (zero infra necessaria)

### Step A.1 — Definisci l'offerta Pilot

**Cosa offri al cliente:**
```
📦 Doclify Pilot Package — 39,99€/mese per team

Include:
1. Installazione guidata Doclify CLI nel repo del cliente (call 30 min)
2. Configurazione regole custom per il loro progetto
3. Setup hook pre-commit o CI/CD integration
4. 30 giorni supporto diretto via Slack/email
5. Report settimanale qualità docs (generato da Doclify)

Durata: 1 mese rinnovabile
Cancellazione: libera, zero vincoli
```

**Cosa NON devi costruire:**
```
- Nessun sistema di licensing
- Nessuna dashboard
- Nessun server
- Usi la CLI che hai già + il tuo tempo
```

### Step A.2 — Come farti pagare (subito, 0€ di costi fissi)

**Opzione raccomandata: Lemon Squeezy**

Perché Lemon Squeezy e non Stripe:
```
- Zero costi fissi mensili
- Gestisce IVA/VAT per te (è Merchant of Record)
- License key automatiche incluse
- Checkout page pronta all'uso
- Commissione: 5% + 0,50€ per transazione
  → Su 39,99€: paghi ~2,50€ di commissioni → incassi ~37,49€

Per confronto:
- Stripe: 2,9% + 0,25€ ma devi gestire IVA da solo
- Polar.sh: 4% (più developer-focused, buona alternativa)
- Gumroad: 10% (troppo caro)
```

### Step A.3 — Setup Lemon Squeezy (20 minuti)

```
1. Vai su lemonsqueezy.com → Sign Up (gratis)
2. Completa onboarding: nome, email, paese, dati pagamento
3. Crea "Store": Doclify
4. Crea prodotto:
   - Nome: "Doclify Guardrail — Pilot Package"
   - Descrizione: "Setup guidato + supporto 30 giorni per il tuo team"
   - Prezzo: 39,99€/mese (subscription mensile)
   - Oppure: 199€ una tantum (per chi preferisce)
   - Abilita "License Key" (servirà per Fase B)
5. Copia il checkout link generato
6. Testa con un acquisto di prova
```

### Step A.4 — Inserisci il pagamento nel flusso

```
DURANTE la call discovery (quando il cliente è interessato):
  "Ti mando il link per attivare il pilot. Ricevi setup guidato questa settimana."
  → Mandi il checkout link Lemon Squeezy

OPPURE via DM dopo la call:
  "Come concordato, ecco il link per il pilot Doclify:
   [CHECKOUT LINK]
   Appena confermato ti contatto per il setup."

OPPURE sulla landing page:
  Aggiungi sezione "Pricing" con bottone che punta al checkout Lemon Squeezy
```

### Costo totale Fase A

| Voce | Costo |
|---|---|
| Lemon Squeezy | 0€ fissi (solo % su vendite) |
| Commissione per vendita 39,99€ | ~2,50€ |
| Vercel (hosting landing) | 0€ |
| Tally.so (form) | 0€ |
| Calendly (booking) | 0€ |
| **Totale costi fissi** | **0€** |
| **Costo per vendita** | **~2,50€ (6,3%)** |

---

## FASE B: License Key nella CLI (dopo 3-5 clienti)

### Step B.1 — Definisci Free vs Pro

```
FREE (npm install, funziona subito):
  - 3 regole base: single-h1, placeholder, insecure-link
  - Max 10 file per scan
  - Output solo terminale (no --report)
  - Niente regole custom

PRO (con license key):
  - Tutte le 5+ regole
  - File illimitati
  - --report (markdown report)
  - --rules (regole custom JSON)
  - --config (configurazione team)
  - Hook pre-commit
  - Aggiornamenti prioritari
```

### Step B.2 — Implementa verifica license key

**Approccio semplice (raccomandato):**
```javascript
// In doclify CLI, aggiungi verifica license key
// La key viene salvata in ~/.doclify/license.json

const LICENSE_API = 'https://api.lemonsqueezy.com/v1/licenses/validate';

async function validateLicense(key) {
  try {
    const res = await fetch(LICENSE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key: key,
        instance_name: os.hostname()
      })
    });
    const data = await res.json();
    return data.valid === true;
  } catch {
    // Offline? Controlla cache locale
    return checkCachedLicense(key);
  }
}

// All'avvio della CLI:
if (isProFeature && !await validateLicense(config.licenseKey)) {
  console.log('⚡ This feature requires Doclify Pro.');
  console.log('   Get your license at: https://doclify.lemonsqueezy.com');
  process.exit(1);
}
```

**Flusso utente:**
```
1. Utente compra Pro su Lemon Squeezy → riceve license key via email
2. Utente esegue: doclify activate YOUR-LICENSE-KEY
3. Key salvata in ~/.doclify/license.json
4. CLI verifica key ad ogni run Pro (con cache offline)
```

### Step B.3 — Pubblica pacchetto npm

```bash
# Prepara il package per npm
cd doclify-guardrail-mvp

# Verifica package.json: name, version, bin, description
# name: "doclify-guardrail"
# bin: { "doclify-guardrail": "./src/cli.js" }

# Crea account npm se non lo hai
npm adduser

# Pubblica
npm publish

# Ora chiunque può fare:
npm install -g doclify-guardrail
```

**Costo Fase B: 0€ (npm publish è gratuito)**

---

## FASE C: Evoluzione futura (dopo 10+ clienti)

### Opzioni di crescita

```
1. Dashboard web (Vercel + Supabase):
   - Storico scan per team
   - Config condivisa
   - Costo: 0€ su free tier Supabase

2. GitHub Action ufficiale:
   - doclify-guardrail come step CI/CD
   - Marketplace GitHub gratuito
   - Più visibilità + lead automatici

3. Regole AI-powered (futuro):
   - Analisi semantica docs con LLM
   - Suggerimenti automatici di fix
   - Questo giustifica pricing più alto (99-199€/mese)
```

---

## RIEPILOGO: Cosa fare e quando

```
ADESSO (questa settimana):
□ Setup Lemon Squeezy store + prodotto pilot
□ Copia checkout link
□ Usa nelle call discovery come CTA finale
□ Primo obiettivo: 1 pagamento di 39,99€

DOPO 3-5 CLIENTI (settimana 3-4):
□ Implementa free/pro split nella CLI
□ Aggiungi verifica license key via Lemon Squeezy API
□ Pubblica su npm
□ Aggiorna landing con sezione pricing

DOPO 10+ CLIENTI (mese 2-3):
□ GitHub Action
□ Dashboard base (opzionale)
□ Secondo tier pricing (99€/mese per team grandi)
```

---

## TABELLA COSTI COMPLETA

| Voce | Costo | Quando paghi |
|---|---|---|
| GitHub (repo) | 0€ | Già attivo |
| Vercel (hosting landing) | 0€ | Fase 1 |
| Tally.so (form waitlist) | 0€ | Fase 1 |
| Calendly (booking call) | 0€ | Fase 1 |
| Lemon Squeezy (checkout) | 0€ fissi, 5%+0,50€/vendita | Fase A |
| npm (publish pacchetto) | 0€ | Fase B |
| Dominio custom (opzionale) | ~10€/anno | Quando vuoi |
| **TOTALE costi fissi** | **0€** | |
| **Costo variabile** | **~2,50€ per ogni vendita da 39,99€** | |

---

## FAQ Rapide

**D: Devo avere Partita IVA per vendere?**
Con Lemon Squeezy come Merchant of Record, tecnicamente loro vendono per te
e ti pagano come "creator". Per i primi incassi piccoli puoi partire così.
Quando i ricavi crescono, apri P.IVA. Consulta un commercialista per la tua
situazione specifica.

**D: Come gestisco i rimborsi?**
Lemon Squeezy ha sistema rimborsi integrato. Per il pilot: se il cliente
non è soddisfatto nei primi 7 giorni, rimborso completo. Semplice e
professionale.

**D: E se un utente condivide la license key?**
La verifica Lemon Squeezy include "activation limit": puoi settare
max 3 attivazioni per key. Se superano, la key si disattiva e devono
comprare un'altra licenza.

**D: Devo rendere la repo pubblica?**
Per il modello open-core SÌ, la versione free dovrebbe essere pubblica
(attira utenti e fiducia). La versione Pro può restare in repo privata
con distribuzione via npm + license key.

**D: Quanto incasso netto su 39,99€?**
39,99€ - 5% Lemon Squeezy (2,00€) - 0,50€ fisso = **37,49€ netti**.
Per 7 clienti: ~262€/mese. Per 20 clienti: ~750€/mese.
