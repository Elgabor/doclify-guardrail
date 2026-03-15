# Score API — Design Document

## Il problema

Un tech lead ha tre repo con documentazione Markdown. In ognuno gira Doclify in CI — controlla le regole, calcola lo score, genera il badge. Ma quando vuole rispondere alla domanda "la qualità dei nostri docs sta migliorando o peggiorando?" deve aprire tre pipeline diverse, cercare l'output nell'ultimo log, confrontare i numeri a mano. Lo score trending esiste, ma scrive in un file locale (`.doclify-history.json`) che nessun altro vede. Il badge SVG viene committato nel repo e si aggiorna solo se qualcuno lancia `--badge` e fa push. In pratica: i dati ci sono, ma restano intrappolati nella macchina che ha eseguito il comando.

Il risultato è che la qualità della documentazione non ha visibilità a livello di team. Nessuno sa se il PR di ieri ha fatto regredire lo score. Nessuno riceve un alert quando un repo scende sotto la soglia. Il quality gate locale (`--min-score`, `--fail-on-regression`) funziona per il singolo sviluppatore, ma non scala a un'organizzazione che vuole standard condivisi.

Questo è il muro che separa il tier free dal tier paid. Il CLI è completo e gratuito. Quello che i team pagano è la **visibilità condivisa**: un posto dove mandare i risultati e vederli aggregati, nel tempo, per tutti i repo. Senza Score API, non c'è dashboard. Senza dashboard, non c'è pricing.

## L'idea

Il CLI diventa un reporter: dopo ogni analisi, può spedire i risultati a un endpoint cloud (`POST /v1/scores`). Il cloud li archivia, li aggrega per progetto e nel tempo, e li rende disponibili via API REST per la dashboard, i badge dinamici e i webhook. Il CLI non cambia comportamento di default — il push è opt-in, attivato da un flag `--push` o da `push: true` nel config file.

## Come funziona

Marco gestisce la documentazione di un progetto open source. Installa Doclify, lo configura in GitHub Actions. Fin qui tutto come prima. Poi va su `app.doclify.app`, crea un progetto, ottiene un API token. Lo salva come secret nel repo (`DOCLIFY_TOKEN`). Aggiunge `--push` al comando nel workflow.

Da quel momento, ogni run di CI fa due cose: il lint normale (errori, warnings, score, exit code) e un POST al cloud con il riassunto dell'analisi. Marco apre la dashboard e vede la trend line dello score. Quando un collega apre una PR che abbassa lo score di 15 punti, la dashboard mostra la regressione. Il badge nel README punta a `https://api.doclify.app/v1/badges/{project-id}.svg` e si aggiorna a ogni push.

Sotto il cofano, il flusso è questo:

Il CLI termina l'analisi e produce l'oggetto `output` che già contiene `summary` (score, errori, warning, file scansionati), `repo` (fingerprint, remote URL), e `scanId`. Il modulo `cloud-client.mjs` — che già esiste e gestisce autenticazione e richieste JSON — espone una nuova funzione `pushScoreReport()` che fa POST a `/v1/scores` con il payload. Il cloud risponde con l'ID del report salvato e, opzionalmente, il delta rispetto all'ultimo report dello stesso progetto. Il CLI stampa una riga di conferma: "Score pushed → 82/100 (+3 vs previous)". Se il push fallisce (rete, auth, timeout), il CLI stampa un warning ma non cambia l'exit code — il lint resta la fonte di verità per pass/fail.

## Il modello

L'entità centrale è il **ScoreReport**: uno snapshot immutabile dei risultati di una singola esecuzione di Doclify. Non è il log completo di ogni finding — è il riassunto. I finding dettagliati restano nel CI log o nell'output SARIF/JUnit. Il cloud non ha bisogno di sapere che alla riga 42 del file `api.md` c'è un heading duplicato. Ha bisogno di sapere che quel run ha prodotto score 82, con 2 errori e 5 warning su 12 file.

```
ScoreReport
├── id            (UUID, generato dal cloud)
├── projectId     (string, identifica il progetto nel cloud)
├── scanId        (UUID, generato dal CLI — idempotency key)
├── timestamp     (ISO 8601, generato dal cloud)
├── commit        (short hash, dal CLI)
├── branch        (string, dal CLI)
├── version       (semver del CLI)
├── score         (0-100, avgHealthScore)
├── errors        (int, totalErrors)
├── warnings      (int, totalWarnings)
├── filesScanned  (int)
├── filesPassed   (int)
├── filesFailed   (int)
├── status        (PASS | FAIL)
├── gate          (oggetto opzionale: minScore, result)
└── meta          (oggetto libero: CI provider, run URL, etc.)
```

Il **projectId** è il legame tra il CLI e il cloud. Viene assegnato dal cloud quando Marco crea il progetto sulla dashboard. Il CLI lo riceve in due modi: dal config file (`.doclify-guardrail.json`, campo `projectId`) oppure dalla variabile d'ambiente `DOCLIFY_PROJECT_ID`. Il fingerprint del repo (`repo.mjs`) serve come fallback: se il CLI ha un token valido ma nessun projectId esplicito, il cloud usa il fingerprint per fare match con un progetto esistente o ne crea uno implicito.

Il **scanId** funge da idempotency key. Se il CLI invia lo stesso scanId due volte (retry dopo timeout), il cloud restituisce il report già salvato senza duplicarlo.

Relazione tra entità nel cloud (fuori scope di questa spec, ma rilevante per il contratto API):

```
Organization (1) ──→ (N) Project ──→ (N) ScoreReport
                           │
                           └──→ (1) Badge (SVG dinamico, ultimo score)
                           └──→ (N) Webhook (URL + eventi)
```

## Decisioni e trade-off

**Payload minimale, non il dump completo.**

Il CLI potrebbe mandare al cloud l'intero output JSON, incluso ogni finding di ogni file. Ho scelto di mandare solo il riassunto (score, conteggi, status) per tre ragioni. Prima: privacy — i team non vogliono che il contenuto dei loro docs finisca su un server esterno. Seconda: dimensione — un repo con 500 file markdown produce un JSON di output che può superare il megabyte; il riassunto sta sotto il kilobyte. Terza: semplicità — il cloud non ha bisogno di indicizzare i finding per funzionare; li usa solo la dashboard, e per la v1 la dashboard mostra trend e score, non il dettaglio dei problemi.

Il costo di questa scelta: la dashboard non può fare drill-down sui problemi specifici. Per la v1 è accettabile — il dev vede il trend nel cloud e il dettaglio nel CI log. Per la v2 potremmo aggiungere un endpoint opzionale per il push dei finding, ma solo quando c'è una dashboard che li consuma.

**Push opt-in, non default.**

Il CLI non manda nulla al cloud a meno che l'utente non lo chieda esplicitamente con `--push` o configurando `push: true` nel config file. Anche con un token configurato, senza `--push` il comportamento è identico a oggi. Questo protegge da sorprese: un utente che ha fatto `doclify login` per usare AI drift in cloud mode non si ritrova a mandare score report senza averlo chiesto.

Il costo: l'onboarding richiede un passo in più (aggiungere `--push`). Ma è un costo che si paga una volta nel workflow CI e che evita il problema molto peggiore di "perché sta mandando dati al cloud senza che io l'abbia chiesto?".

**Il push non influenza l'exit code.**

Se il POST al cloud fallisce — rete giù, token scaduto, server 500 — il CLI stampa un warning e termina con l'exit code del lint. L'alternativa sarebbe fallire anche per errori di push, ma questo trasformerebbe un problema di reporting in un blocco del CI. Il lint è la fonte di verità; il push è telemetria. I team non devono avere la pipeline rossa perché il cloud di Doclify ha avuto 30 secondi di downtime.

Il costo: se il push fallisce silenziosamente, il team potrebbe non accorgersi che la dashboard non si aggiorna. Mitigazione: il warning è visibile nel CI log, e il cloud può mandare un alert "nessun report ricevuto da 48h" via webhook.

**scanId come idempotency key.**

Il CLI genera già un `scanId` (UUID) per ogni run. Lo usiamo come idempotency key per il POST. Se il CLI fa retry dopo un timeout e il cloud ha già ricevuto il primo tentativo, restituisce il report esistente con status 200 invece di crearne un duplicato. L'alternativa era usare commit+branch come chiave naturale, ma uno stesso commit può essere analizzato più volte con configurazioni diverse (strict vs non-strict, con o senza link check), e ognuna di queste è un report legittimamente diverso.

**Nessuna nuova dipendenza.**

Il cloud client (`cloud-client.mjs`) usa `fetch` nativo di Node.js 20+. La funzione `pushScoreReport()` è una chiamata `requestJson()` con method POST — lo stesso pattern già usato per `verifyApiKey()` e `requestAiDrift()`. Zero dipendenze aggiunte.

**Branch dal CLI, non dal cloud.**

Il CLI manda il nome del branch nel payload. L'alternativa era far dedurre al cloud il branch dal commit hash via GitHub API, ma questo richiede permessi aggiuntivi e non funziona per repo privati o non-GitHub. Il CLI ha accesso diretto a `git rev-parse --abbrev-ref HEAD`, che è più affidabile e non richiede nulla.

## Edge cases e limiti

**Nessun token configurato e `--push` richiesto.** Il CLI stampa un errore chiaro: "Cannot push: no API token configured. Run `doclify login --key <token>` or set DOCLIFY_TOKEN." Exit code non cambia — il lint è stato eseguito.

**Token valido ma nessun projectId e nessun fingerprint.** Può succedere in una directory senza git. Il CLI manda il fingerprint `cwd:hash` che il cloud usa per creare un progetto implicito con nome generico. Funziona, ma la dashboard mostrerà un progetto con nome poco leggibile. Documentare che per risultati migliori serve un projectId esplicito o un repo git.

**Run senza file scansionati.** Se l'analisi produce zero file (directory vuota, pattern di esclusione troppo aggressivo), il CLI non fa push. Non ha senso mandare un report con score 0 e zero file — inquinerebbe il trend.

**Payload troppo grande.** Il riassunto è piccolo per design, ma il campo `meta` è un oggetto libero. Il cloud deve rifiutare payload sopra una soglia (es. 64KB) con 413 Payload Too Large. Il CLI non include finding dettagliati nel payload di default, quindi in pratica non si raggiunge mai questo limite.

**Rate limiting.** Il cloud deve proteggere l'endpoint con rate limiting per token (es. 60 req/min). Il CLI non fa retry su 429 — stampa il warning e prosegue. Un CI che gira ogni 2 minuti non arriverà mai a 60 req/min, ma un utente che lancia `--push` in un loop potrebbe.

**Clock skew.** Il timestamp è generato dal cloud, non dal CLI. Questo evita problemi di orologi non sincronizzati su macchine CI diverse.

## File coinvolti

**`src/cloud-client.mjs`** — MODIFICATO. Aggiungere la funzione `pushScoreReport(options)` che fa POST a `/v1/scores`. Segue lo stesso pattern di `requestAiDrift()`: accetta `apiUrl`, `apiKey`, `payload`, `timeoutMs`, `retries`. Timeout default 5000ms (leggermente più alto del default per le altre chiamate, perché il cloud deve scrivere su storage).

**`src/index.mjs`** — MODIFICATO. Aggiungere il parsing del flag `--push` (e `push` dal config file). Dopo il tracking locale (`--track`) e prima dei quality gate check, inserire la logica di push: costruire il payload dal `output.summary` e `output.repo`, chiamare `pushScoreReport()`, stampare conferma o warning. Aggiungere `--project-id <id>` come flag CLI opzionale.

**`src/config-resolver.mjs`** — MODIFICATO. Aggiungere il campo `push` (boolean, default false) e `projectId` (string, opzionale) alla risoluzione del config file.

**`src/repo.mjs`** — MODIFICATO. Aggiungere la funzione `getCurrentBranch()` che esegue `git rev-parse --abbrev-ref HEAD` con lo stesso pattern di `getRepoFingerprint()`. Gestire il caso detached HEAD restituendo il valore di `HEAD`.

**`test/guardrail.test.mjs`** — MODIFICATO. Aggiungere test per: costruzione del payload, gestione errori di push, flag `--push` nel parsing degli argomenti, `getCurrentBranch()`.

**`action/entrypoint.mjs`** — MODIFICATO. Aggiungere input Action `push` (default `false`) e propagare `--push` solo quando `push=true`. Aggiungere input `project-id` e propagare `--project-id <id>` quando valorizzato.

## Test cases

**Costruzione payload corretto.** Input: un `output` con summary `{ avgHealthScore: 82, totalErrors: 2, totalWarnings: 5, filesScanned: 12, filesPassed: 10, filesFailed: 2, status: 'FAIL' }`, repo metadata con fingerprint e remote, scanId, commit "abc1234", branch "feat/docs-update". Output atteso: oggetto payload con tutti i campi mappati correttamente, `score: 82`, `branch: "feat/docs-update"`. Verifica: ogni campo del payload corrisponde al dato sorgente.

**Push con successo.** Mock di `requestJson` che restituisce `{ id: 'uuid', delta: +3 }`. Verifica: il CLI stampa "Score pushed" con score e delta. Exit code non influenzato.

**Push fallito — errore di rete.** Mock di `requestJson` che lancia `CloudError('timeout')`. Verifica: il CLI stampa un warning ma non cambia exit code. Se il lint era PASS, exit code resta 0.

**Push fallito — nessun token.** Flag `--push` presente ma nessun token configurato. Verifica: il CLI stampa errore "Cannot push: no API token configured" e prosegue con il lint normale.

**Push con zero file scansionati.** Output con `filesScanned: 0`. Verifica: il push viene saltato, nessuna chiamata HTTP.

**Idempotency.** Due chiamate con lo stesso `scanId`. Verifica: il cloud (o il mock) restituisce lo stesso `id` senza duplicare.

**Flag parsing.** `parseArgs(['docs/', '--push'])` produce `args.push === true`. `parseArgs(['docs/', '--project-id', 'my-proj'])` produce `args.projectId === 'my-proj'`. `parseArgs(['docs/'])` produce `args.push === false`.

**getCurrentBranch().** In un repo git: restituisce il nome del branch corrente. In detached HEAD: restituisce "HEAD". Fuori da un repo git: restituisce "unknown".

**Config file con push.** File `.doclify-guardrail.json` con `{ "push": true }`. Verifica: `resolveOptions()` restituisce `push: true` anche senza flag CLI.

## Piano di implementazione

**Fase 1 — `getCurrentBranch()` e payload builder.** Aggiungere `getCurrentBranch()` a `repo.mjs`. Creare una funzione pura `buildScorePayload(output, repoMetadata, branch)` in `cloud-client.mjs` (o in un nuovo helper in `index.mjs`) che costruisce l'oggetto payload dal risultato dell'analisi. Testabile senza rete, senza mock HTTP. Tempo stimato: la più piccola unità di lavoro indipendente.

**Fase 2 — `pushScoreReport()` in cloud-client.** Aggiungere la funzione che fa POST a `/v1/scores` usando `requestJson()`. Aggiungere test con mock di fetch. Verificare gestione errori: timeout, 401, 429, 500.

**Fase 3 — Integrazione nel CLI.** Aggiungere `--push` e `--project-id` al parsing degli argomenti. Aggiungere `push` e `projectId` alla risoluzione config. Inserire la logica di push nel flusso principale di `index.mjs`, dopo il tracking locale. Stampare conferma o warning.

**Fase 4 — GitHub Action.** Propagare `push` e `project-id` come input della Action. Passare `--push` solo quando `push=true`.

**Fase 5 — Test end-to-end.** Test che verifica il flusso completo: lint → push → conferma. Con mock del cloud. Verificare che il push non interferisce con exit code, tracking locale, o altri output.

## Criteri di accettazione

- [ ] `doclify docs/ --push` invia un POST a `/v1/scores` con il payload corretto
- [ ] Il payload contiene: score, errors, warnings, filesScanned, filesPassed, filesFailed, status, commit, branch, scanId, version, repo fingerprint
- [ ] Senza token, `--push` stampa errore e prosegue senza cambiare exit code
- [ ] Errore di rete/cloud durante il push: warning stampato, exit code invariato
- [ ] Zero file scansionati: il push viene saltato
- [ ] `scanId` funge da idempotency key (documentato nel contratto API)
- [ ] `--project-id <id>` sovrascrive il projectId dal config/env
- [ ] `DOCLIFY_PROJECT_ID` env var è supportata come alternativa al flag
- [ ] Il config file supporta `"push": true` e `"projectId": "..."`
- [ ] `getCurrentBranch()` funziona in repo git, detached HEAD, e fuori git
- [ ] La GitHub Action propaga `--push` solo quando `push=true`
- [ ] Tutti i test case elencati passano
- [ ] Zero dipendenze aggiunte

## Decisioni chiuse

**Contratto API lato cloud.** Il CLI richiede `id` nella risposta di `POST /v1/scores`; `delta` è opzionale (`{ id, delta? }`). Se `id` manca, il push è trattato come errore non bloccante (warning, exit code lint invariato).

**Policy push.** Il push resta strict opt-in: `--push` o `push: true` in config/Action input. La sola presenza di un token non abilita il push.

**Action contract.** La GitHub Action espone input espliciti `push` (default `false`) e `project-id`; non abilita auto-push implicito.
