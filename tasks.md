# Task di prodotto e rilascio Doclify Guardrail

Stato: registro operativo
Piano di riferimento locale: `plan.md`
Versioni pubblicate: stable `2.0.1`; prerelease `2.0.0-beta.3`

Questo file registra task, prove e rischi residui del prodotto. `plan.md` resta il piano
locale di riferimento; codice, test e contratti pubblici restano le fonti di verità sul
comportamento effettivo.

## Come usare questo file

Questo è il registro operativo per gli agenti. Il piano descrive il perché; questo file
descrive unità di lavoro, ordine, prove e confini di rilascio.

Stati ammessi:

- `TODO`: non iniziata;
- `IN PROGRESS`: un agente ne è responsabile;
- `BLOCKED`: manca una decisione o una prova esplicitata;
- `DONE`: criteri e QA passati; commit locale creata quando la task modifica il
  prodotto;
- `RELEASED`: la versione è stata pubblicata e verificata separatamente.

Non marcare una task `DONE` soltanto perché il codice esiste. Registrare hash della
commit, prove realmente eseguite e rischi residui. L'aggiornamento del registro può
essere incluso nella stessa commit della task oppure in una commit documentale dedicata.

## Regole per ogni agente

Prima di iniziare:

1. leggere `AGENTS.md`, `plan.md`, questa task e i file sorgente coinvolti;
2. verificare branch, stato Git e modifiche già presenti;
3. non sovrapporsi a modifiche esistenti senza fermarsi e segnalarlo;
4. confermare il comportamento corrente con una prova mirata;
5. non leggere `.env`, credenziali, token o archivi di sessione;
6. non installare dipendenze e non eseguire rete/corpus live senza autorizzazione.

Definition of Done per task che modifica codice:

- test di regressione o contratto scritto prima della correzione/capacità;
- implementazione minima completa al boundary responsabile;
- nessun codice morto, duplicazione evitabile o astrazione per casi ipotetici;
- test mirati e `npm test` verdi;
- help, README, esempi, API e Action aggiornati se il contratto cambia;
- `npm run docs:sync-check` quando pertinente;
- `npm pack --dry-run --json` quando cambia il pacchetto pubblico;
- QA in sola lettura su almeno due codebase della matrice indicata;
- stato Git delle codebase QA invariato prima/dopo;
- `git diff --check` e review del diff completati;
- commit locale singola e coerente, senza modifiche estranee o file personali.

Una task documentale applica i controlli pertinenti e deve comunque verificare tutti i
comandi o esempi che cambia.

## Codici della matrice QA

- `PF`: `/Users/lorenzoborgato/code/portfolio-personale`
- `LL`: `/Users/lorenzoborgato/code/llm-lab`
- `PP`: `/Users/lorenzoborgato/code/proposalpilot`
- `SG`: `/Users/lorenzoborgato/code/social-growth-agent`
- `FX`: fixture sintetiche committate nel repository Doclify
- `RD`: snapshot Redis indicato dalla task o issue
- `DS`: snapshot DwarfStar indicato dalla task o issue

Le scansioni usano home/config temporanee, sono offline salvo test locale controllato e
non modificano le codebase. Se un repository non è disponibile, sostituirlo con un altro
repository pertinente sotto `/Users/lorenzoborgato/code` e registrare la sostituzione.

## Workflow Git e release

- un branch per versione o fix coerente: `release/v<versione>` oppure un branch
  descrittivo legato alle issue;
- una commit per task che modifica il prodotto, inclusi test, documentazione pubblica e
  aggiornamento del registro necessari a descrivere il comportamento;
- messaggio suggerito: `feat(scope): ...`, `fix(scope): ...`, `refactor(scope): ...` o
  `docs(scope): ...`; non forzare Conventional Commits se l'automazione futura sceglie
  un contratto diverso;
- nessuna commit parziale viene chiamata `DONE`; usare una commit temporanea soltanto se
  richiesta e dichiararla chiaramente;
- il merge di release deve essere non distruttivo e preservare le commit delle task;
- non riscrivere la storia condivisa e non fare force-push;
- merge, push, tag, GitHub release, aggiornamento dei tag della Action e `npm publish`
  sono gate distinti e richiedono autorizzazione esplicita, a meno che il prompt della
  release li abbia già autorizzati tutti con target esatti;
- beta npm con `--tag next`; stable npm con `--tag latest` soltanto dopo il gate stable;
- verificare il pacchetto installato dal registry dopo la pubblicazione; un pack locale
  verde non dimostra una release riuscita.

## 2.0.0-beta.1 — Fondazione corretta e contratti stabili

Branch: `release/v2.0.0-beta.1`
Esito: una CLI ancora incompleta come prodotto, ma corretta nei confini fondamentali e
sicura da evolvere. Non promuovere su npm `latest`.

### B1 — Decisione su nome, compatibilità e superficie pubblica

Stato: `DONE`

Lavoro:

- verificare disponibilità e conflitti di nome su npm, GitHub, binari e altri ecosistemi
  pertinenti;
- decidere pacchetto, binario canonico, alias legacy e descrizione esatta;
- inventariare comandi, flag, export API e input/output Action v1 come mantenere,
  migrare, deprecare o rimuovere;
- decidere supporto MDX di prima classe oppure preset `fragment` limitato;
- produrre tabella di migrazione senza rinominare o pubblicare nulla in questa task.

Accettazione:

- ogni superficie pubblica v1 ha una destinazione esplicita;
- gli utenti di `doclify-guardrail@1` e Action `@v1` non cambiano comportamento senza
  opt-in;
- descrizione e naming non promettono Cloud, AI generativa o revisione v2.1.

QA: esempi di installazione e migrazione in progetti temporanei `FX`.
Commit suggerita: `docs(product): decide v2 naming and migration contract`

Prove: `MIGRATION.md` inventaria package/bin, 51 flag, comandi, 12 export,
config/env, 19 input e 4 output Action; naming verificato su npm, GitHub, PyPI e
`doclify.io` il 2026-08-08; review finale Claude Code read-only: `NO FINDINGS`.
QA eseguito: `npm test` 269/269; `docs:sync-check`; scansione mirata 100/100;
`npm pack --dry-run --json`; due consumer `FX` temporanei installati offline dal
tarball locale con entrambi i bin v1 e gli export root/API verificati.
Commit: `d62222f22f2b4a41e8043d94def6005336be6fa3` (firma valida).
Rischio residuo: la guida non è ancora inclusa nel tarball v1 del gate beta.1;
P5 dovrà aggiungerla al packaging v2 e alla protezione automatica della
documentazione prima della pubblicazione.

### B2 — Contratto CLI, risultati ed errori

Stato: `DONE`

Lavoro:

- definire grammatica di `check`, `changed`, `explain` e `init`;
- introdurre un unico modello versionato dei risultati;
- fissare exit 0/1/2, stdout/stderr e comportamento delle scansioni parziali;
- aggiungere golden test per text, JSON, SARIF e JUnit;
- garantire ordinamento deterministico, limiti di output e `--all`.

Accettazione:

- output macchina valido contiene un solo documento e nessun log umano;
- file illeggibili non producono un falso risultato pulito;
- CLI e API osservano lo stesso risultato strutturato.

QA: `PF`, `LL`, `FX`.
Commit suggerita: `feat(cli): establish v2 result and exit contracts`

Evidenza: i percorsi espliciti `check` e `changed` usano un solo risultato
deterministico `schemaVersion: 3`, condiviso dalla API asincrona `check`, con
exit 0/1/2, separazione stdout/stderr, scansioni parziali strutturate e golden
text/JSON/SARIF/JUnit. JSON, SARIF e JUnit restano completi; text e compact
limitano a 50 i finding e `--all` rimuove il limite. Diagnostiche, conteggi e
stato di completezza non vengono troncati. I finding del motore v1 sono
temporaneamente solo advisory senza falsa prova; symlink, output e percorsi
restano contenuti nel workspace. Review finale Claude Code read-only dopo tre
pass: `NO FINDINGS`.
QA eseguito con Node 22: test B2 24/24 e `npm test` 293/293;
`docs:sync-check`; scansione v2 circoscritta di `MIGRATION.md`; `git diff
--check`; `npm pack --dry-run --json`; `PF` 5/5 e `LL` 30/30 completi con stato
Git identico prima/dopo; consumer `FX` installato offline dal tarball locale,
CLI e API entrambi verificati.
Commit: `1b38245afc1e9c259f355cc2590ea2ab2387b2f0` (firma valida).
Rischio residuo: la risoluzione Git/config completa resta B3; il percorso v1
senza comando e gli export legacy restano fino a P2; `init` read-only va
assegnato a P1 dopo la forma della configurazione, mentre `explain` e stdin
restano P4. `MIGRATION.md` entra nel tarball soltanto nel gate P5.

### B3 — Correttezza Git e risoluzione della configurazione

Stato: `DONE`

Lavoro:

- risolvere radice Git e percorsi diff/staged correttamente da radice e sottodirectory;
- scoprire Git e configurazione una volta per scansione;
- contenere i file nel workspace selezionato;
- coprire repository normali, senza Git, worktree, file eliminati/rinominati e config
  gerarchica.

Accettazione:

- la stessa modifica produce gli stessi target da radice e sottodirectory;
- nessun subprocess Git/config viene creato per singolo file;
- i failure mode sono errori strutturati e testati.

QA: `PF`, `PP`, `SG`, `FX`.
Commit suggerita: `fix(git): make changed-file discovery root-correct`

Evidenza: `changed` scopre la radice Git una volta, esegue il diff da quella
radice e condivide selezione e risultato tra CLI e API. Il parser NUL-delimited
copre nomi con spazi, Unicode, tab e newline, usa la destinazione delle rename e
ignora file eliminati, non tracciati o ignorati. Radice e sottodirectory
producono output macchina identico anche nei worktree collegati; assenza di Git,
Git non disponibile e ref sconosciute hanno codici strutturati. La risoluzione
v2 applica config gerarchiche dal confine Git/workspace, mette in cache ogni
livello, ancora i percorsi alla config che li dichiara, pota le esclusioni prima
del traversal e mantiene target, config e `siteRoot` contenuti. Nessuna config
può abilitare la rete. Review finale Claude Code read-only: `NO FINDINGS`.
QA eseguito con Node 22: test v2/B3 39/39 e `npm test` 308/308;
`docs:sync-check`; scansione v2 di `MIGRATION.md` 1/1; `git diff --check`;
`npm pack --dry-run --json` con 38 entry; `PF`, `PP` e `SG` 1/1 completi in
sola lettura con stato Git identico prima/dopo; consumer `FX` installato offline
dal tarball locale con CLI e API verificate.
Commit: `2c268ce326689c62a16f866ca78d606293a75ba1` (firma valida).
Rischio residuo: `changed` esclude intenzionalmente file non tracciati, ignorati
ed eliminati; il resolver v1 resta fino a P2. La baseline di costo e le guardie
generali sullo stato Git appartengono a B4; Node 20 resta un gate CI prima del
merge.

### B4 — Isolamento dei test e baseline di prestazione

Stato: `DONE`

Lavoro:

- spostare repository, cache e output generati dai test in directory temporanee;
- registrare baseline riproducibile per 300 documenti e corpus deterministico;
- aggiungere guardie che confrontano lo stato Git prima/dopo;
- separare correttezza, performance e rete in profili distinti.

Accettazione:

- `npm test` non modifica il worktree né altri repository;
- baseline registra hardware, Node, cold/warm e tolleranza CI;
- test ordinari non usano rete o configurazione personale.

QA: `PF`, `LL`, `FX` con controllo stato esplicito.
Commit suggerita: `test(core): isolate fixtures and record performance baseline`

Evidenza: il profilo di correttezza esegue tutti i test in una sola sandbox del
sistema operativo con `cwd`, directory temporanee, cache, configurazione XDG e
`DOCLIFY_HOME` isolati. La guardia confronta stato Git e impronta metadata prima
e dopo, include i repository Git annidati nelle directory ignorate, fallisce in
modo chiuso sui percorsi non ispezionabili e rimuove la sandbox anche su
`SIGINT`/`SIGTERM`. Il corpus sintetico deterministico da 300 documenti registra
hash del contenuto e delle regole, hardware, Node, filesystem, misure cold/warm e
tolleranze locali/CI. Correttezza, performance e il profilo di rete preesistente
restano separati.
QA eseguito con Node 22: `npm test` 319/319 con repository invariato e sandbox
rimossa; performance `darwin-arm64-node22-fs26` sotto baseline (cold p95
87.767 ms, warm p95 39.672 ms); `docs:sync-check`; scansione v2 di
`MIGRATION.md` 1/1; `git diff --check`; `npm pack --dry-run --json` con 38
entry. `PF` 5/5 e `LL` 30/30 completi, più `changed` 0/0, con stato Git e
impronta metadata identici prima/dopo. Consumer `FX` installato offline dal
tarball locale con CLI e API 1/1; fixture e tarball temporanei rimossi. Review
finale Claude: nessun finding bloccante; due rifiniture accolte e ramo `NUL`
Windows mantenuto perché il package non esclude Windows.
Commit: `ee23f402565697c8d934ec5cc8bd52194340f5fe` (firma valida).
Rischio residuo: Node 20 resta da verificare nel gate CI; la relativa classe
performance è `unrecorded` e advisory finché non viene misurata. I test ordinari
usano soltanto loopback controllato, ma l'enforcement contro future socket
esterne appartiene ad A3. Le directory temporanee legacy preesistenti non sono
state rimosse per evitare cancellazioni non autorizzate e corse concorrenti.

### Gate 2.0.0-beta.1

- B1-B4 `DONE`;
- review finale: corretti il `fsmonitor` Git configurato dal repository, le
  letture di link locali fuori confine, le diagnostiche mancanti in JUnit/text,
  l'overwrite dell'input tramite hard link e la baseline performance malformata;
- versione e descrizione del pacchetto aggiornate a `2.0.0-beta.1`;
- QA finale Node 22: `npm test` 322/322 con repository invariato,
  `npm run test:performance` pass (cold p95 94.222 ms, warm p95 46.473 ms),
  `docs:sync-check`, help/version, `npm pack --dry-run --json` (38 entry) e
  `git diff --check` verdi;
- smoke read-only finale: `PF` README 1/1 pass e `LL` README 1/1 pass; i tre
  file non tracciati preesistenti di `LL` sono rimasti identici prima/dopo;
- commit finale: `7042d39` (firma da verificare con Git);
- review release: `e766917` corregge JUnit/cache e aggiorna `undici` della
  Action a 6.28.0; `9db4b4e` conserva la compatibilità della cache default.
  Tutte le commit sono firmate. PR #22 mergeata su `main` (merge commit
  `48f2d96`) con Docs Check e Reliability Gate verdi; audit Action finale 0
  vulnerabilità e QA locale 324/324. Publish `2.0.0-beta.1 --tag next`
  iniziata ma fermata dal registry perché richiede OTP/autenticazione umana;
  `latest` è ancora 1.7.4 e la beta non è verificata come pubblicata.
- pubblicazione eventuale soltanto su npm `next` e dopo autorizzazione.

## 2.0.0-beta.2 — Vertical slice ad alto segnale

Branch: `release/v2.0.0-beta.2`
Base: tag o commit verificata di `2.0.0-beta.1`
Esito: il flusso principale produce poche segnalazioni fondate su prove.

### P1 — Tipi di documento e preset `repo`

Stato: `DONE`

Lavoro:

- introdurre `published`, `instructions`, `fragment`, `plan`, `changelog`, `generated`;
- definire precedenza fra configurazione, euristica file e fallback sicuro;
- sostituire i default stilistici rumorosi con regole di integrità ad alto segnale;
- creare fixture positive, negative e ambigue per ogni regola predefinita.

Accettazione:

- frammenti e puntatori non falliscono perché privi di H1;
- regole predefinite raggiungono almeno 95% sull'holdout interno;
- nessuna adozione richiede una riformattazione massiva.

QA: `LL`, `SG`, `PF`, `FX`.
Commit suggerita: `feat(rules): add purpose-aware repository presets`

### P2 — Rimozione delle superfici non supportate

Stato: `DONE`

Lavoro:

- rimuovere fixer, upgrade URL, score, badge, trend, track e watch dal core v2;
- rimuovere Cloud, auth, push, memoria e comandi AI incompleti;
- eliminare codice, config, export, test e documentazione collegati;
- aggiungere errori di migrazione espliciti per opzioni rimosse;
- mantenere congelata la Action v1 fino alla relativa migrazione.

Accettazione:

- il tarball non include moduli rimossi o percorsi credenziali;
- le opzioni legacy falliscono con messaggio di migrazione stabile;
- non restano rami nascosti o compatibilità non testata.

QA: `PF`, `PP`, `FX`; smoke v1 isolato per la compatibilità documentata.
Commit suggerita: `refactor(core): remove unsupported v1 product surfaces`

### P3 — Verifica deterministica delle affermazioni

Stato: `DONE`

Lavoro:

- indicizzare una volta file, anchor, script package, pacchetti workspace, target Make e
  contratto CLI supportato;
- verificare soltanto affermazioni con fonte statica non ambigua;
- includere nella segnalazione fatto, fonte e stato della prova;
- lasciare ambiguità e tipi non supportati come `unverified`, non bloccanti;
- non eseguire mai comandi, moduli o esempi Markdown.

Accettazione:

- ogni finding bloccante cita una prova riproducibile;
- holdout dedicato almeno al 95% per finding bloccanti;
- casi README, guida, piano, changelog, frammento e istruzioni sono coperti.

QA: `PF`, `LL`, `PP`, `SG`, `FX`.
Commit suggerita: `feat(evidence): verify repository-backed documentation claims`

### P4 — stdin, output compatto ed explain

Stato: `DONE`

Lavoro:

- supportare stdin con `--stdin-name` obbligatorio;
- rendere equivalente l'analisi da disco e stdin;
- produrre output breve per contesti di agenti con rimando a `--all`;
- implementare `explain <rule-id>` con scopo, prova e rimedio sicuro;
- documentare hook locali per Codex, Claude Code, pre-commit e pre-push senza concedere
  scrittura o rete.

Accettazione:

- stdin e file producono gli stessi finding;
- troncamento e JSON sono deterministici;
- gli esempi hook funzionano in repository temporanei.

QA: `PF`, `SG`, `FX`.
Commit suggerita: `feat(agent): add bounded stdin and explain workflows`

### P5 — Documentazione, esempi e demo riproducibile

Stato: `DONE`

Lavoro:

- riscrivere README sulla promessa v2 effettiva;
- aggiungere guida di migrazione da v1;
- rendere ogni comando pubblico eseguibile in CI;
- creare una fixture demo in cui una modifica rende falsa una dichiarazione e Doclify
  cita la prova esatta;
- produrre output terminale, JSON e Action equivalenti senza chiamate a modelli.

Accettazione:

- esempi clean passano realmente e quelli failing falliscono per il motivo dichiarato;
- README non dichiara funzioni future;
- la demo può essere usata nel portfolio senza configurazione segreta o claim inventati.

QA: esecuzione esempi in `PF`, `LL` e repository temporaneo `FX`.
Commit suggerita: `docs(v2): publish executable workflows and evidence demo`

### Gate 2.0.0-beta.2

- P1-P5 `DONE`;
- tutti i gate beta.1 ancora verdi;
- precisione holdout registrata e nessuna deroga nascosta;
- matrice completa `PF`, `LL`, `PP`, `SG` invariata;
- slop review: eliminare codice morto, doppie fonti di verità, helper monouso non utili,
  log ridondanti e commenti che parafrasano il codice;
- eventuale pubblicazione soltanto su `next` con autorizzazione.

## 2.0.0-beta.3 — Integrazione, architettura e prova con utenti

Branch: `release/v2.0.0-beta.3-clean`
Base: `6c59891` (`2.0.0-beta.2` verificata)
Esito: prerelease tecnica pubblicata e verificata; validazione con utenti ancora aperta.

### A1 — Separazione del core per responsabilità

Stato: `DONE`

Lavoro:

- estrarre da `src/index.mjs` parsing CLI, orchestrazione, policy, I/O ed emissione;
- separare test per contratto senza cambiare il comportamento pubblico;
- mantenere filesystem, Git, rete e terminale dietro boundary piccoli;
- evitare framework interni o interfacce senza due consumatori reali.

Accettazione:

- golden test invariati prima/dopo;
- nessuna duplicazione di policy fra CLI, API e Action;
- performance entro la baseline concordata.

QA: `PF`, `PP`, `FX`.
Commit suggerita: `refactor(core): separate policy from runtime boundaries`

Esito: grammatica CLI pura separata dal runtime, analisi dei claim riusata e
boundary di output rafforzato senza duplicare policy fra CLI, API e Action.

### A2 — GitHub Action v2 come adattatore sottile

Stato: `DONE`

Lavoro:

- mappare input Action sul contratto CLI v2 senza duplicare regole;
- mantenere permessi minimi e rete disabilitata per default;
- ricostruire bundle e licenze dalle dipendenze già autorizzate;
- mantenere `v1` immutata e preparare linea `v2` separata;
- testare annotazioni, errori e output su fixture locali.

Accettazione:

- Action e CLI producono risultati semanticamente equivalenti;
- bundle, metadati e sorgente sono allineati;
- nessun token viene richiesto per il flusso base.

QA: `PF`, `SG`, `FX` tramite workflow/action isolata.
Commit suggerita: `feat(action): adapt GitHub Action to the v2 core`

Esito: Action v2 ridotta ad adattatore della CLI, offline per default e senza
token; bundle, metadati e smoke da riferimento immutabile risultano allineati.

### A3 — Harness di affidabilità fondato sulla correttezza

Stato: `DONE`

Lavoro:

- sostituire fingerprint di rumore con corpus etichettati e metriche per regola;
- aggiungere property/fuzz test per parser, path, Unicode, CRLF, MDX e limiti risorse;
- mantenere rete opzionale e su server locale controllato nei test ordinari;
- fallire quando precisione o performance scendono sotto i gate dichiarati.

Accettazione:

- ogni metrica ha fixture, denominatore e soglia comprensibili;
- una baseline non può essere rigenerata solo per rendere verde una regressione;
- CI separa correttezza, performance e rete.

QA: `LL`, `PP`, `SG`, `FX`.
Commit suggerita: `test(reliability): gate on labeled correctness evidence`

Esito: CI separa correttezza etichettata, rete locale controllata e performance.
La tolleranza performance resta deliberatamente un allarme per regressioni
macroscopiche, non una prova prestazionale stretta.

### A4 — Beta privata e raccolta delle prove

Stato: `BLOCKED_INPUT` (`AWAITING_REAL_USERS`)

Lavoro:

- coinvolgere 3-5 sviluppatori che usano agenti di coding;
- registrare il controllo manuale o toolchain esistente prima dell'uso;
- far usare il pacchetto su almeno due modifiche reali per partecipante;
- classificare finding accettati, scartati e mancati senza telemetria predefinita;
- trasformare difetti riproducibili in fixture anonime e task, non in patch casuali.

Accettazione:

- almeno tre partecipanti completano il flusso ripetuto;
- tempo mediano al primo risultato utile inferiore a cinque minuti;
- almeno 30 finding revisionati e almeno 70% azionabili;
- per almeno tre persone Doclify sostituisce un passaggio nominato;
- nessun dato privato dei repository entra nelle fixture pubbliche.

QA: uso reale autorizzato più matrice completa locale.
Commit suggerita: `test(beta): record anonymized v2 adoption evidence`

Esito: protocollo privato, criteri di consenso e formato aggregato pronti; non
esistono ancora risultati qualificanti. Servono 3-5 partecipanti reali e almeno
tre completamenti prima di chiudere la task.

### A5 — Revisione della promessa portfolio

Stato: `DONE`

Lavoro:

- confrontare demo, README, npm e copy corrente di `gaborrar.dev`;
- preparare copy bilingue fondato solo su funzioni rilasciate e prove beta;
- preparare un breve copione demo riproducibile;
- non modificare o pubblicare il portfolio senza una task/autorizzazione separata.

Accettazione:

- ogni claim del copy rimanda a una prova pubblica;
- stato beta/stable è esplicito;
- la demo non nasconde configurazione artificiale o interventi manuali.

QA: verifica della demo su checkout pulito e review locale di `PF`.
Commit suggerita: `docs(portfolio): prepare evidence-backed project narrative`

Esito: copy bilingue, mappa delle prove e copione demo preparati come
`DRAFT_DO_NOT_PUBLISH`. Il portfolio non è stato modificato; pubblicazione e
aggiornamento dei claim restano separati e subordinati ad A4 e a un riferimento
di release immutabile.

### Gate 2.0.0-beta.3

Stato: `BLOCKED_INPUT`

- A1-A3 e A5 `DONE`; A4 attende utenti reali;
- gate beta.1 e beta.2 ancora verdi;
- Action v2 installabile da riferimento immutabile in test isolato;
- matrice QA completa, test package installato e security review;
- nessun P0/P1 e nessun falso positivo irrisolto in regole bloccanti;
- eventuale pubblicazione su `next` autorizzata separatamente.

La candidate tecnica è stata fusa in `main` con PR #24 (`0404a45`) e i due run
post-merge sono verdi. Il gate prodotto non è chiuso: manca l'evidenza A4.
La review di completamento ha prodotto la follow-up PR #25 (`ce0a505`):
changelog Unreleased, significato esplicito del gate performance, test symlink
portabili e rimozione del path personale dalla copia corrente delle note. Anche
i due run post-merge della follow-up sono verdi.

La preparazione npm `2.0.0-beta.3` è stata fusa in `main` con PR #26
(`3e0f997`): suite 59/59, rete, performance isolata, docs sync, audit Action,
pack reale installato e review indipendente sono verdi. Tutti i branch locali e
remoti diversi da `main` sono stati eliminati. Lorenzo ha pubblicato beta.3 su
npm `next`; `latest` resta `1.7.4`. Il `gitHead` npm coincide con `3e0f997`,
marcato dal tag firmato e dalla GitHub prerelease `v2.0.0-beta.3`. La PR #27
(`a259d96`) ha allineato README, migrazione, changelog, prova portfolio e smoke
Action al riferimento pubblicato; CI post-merge verde. Dopo la pulizia resta
soltanto `main` in locale e su `origin`. A4 resta `BLOCKED_INPUT`.

## 2.0.0 — Core stabile

Branch: `release/v2.0.0`
Base: `2.0.0-beta.3` più correzioni provate dalla beta
Esito atteso: prima release stabile del nuovo prodotto.

### S1 — Chiudere i finding della beta

Stato: `DONE`

- correggere soltanto difetti riproducibili o rimuovere/declassare regole non provate;
- aggiungere regression test per ogni fix;
- non aggiungere feature durante la stabilizzazione.

QA: scegliere almeno due repository per finding; poi matrice completa.
Commit suggerita: una commit per gruppo coerente di finding, registrata come sottovoce
di S1.

#### S1.1 — Correggere `make-target` e il contratto CLI documentato

Stato: `DONE`

Issue: #28 e #29.

Lavoro completato:

- `make-target` ignora le assegnazioni, riconosce opzioni Make conservative, risolve
  `-C` sul Makefile selezionato e verifica tutti i target espliciti;
- `.DEFAULT`, pattern Make applicabili, `-f` e sintassi shell ambigua restano non
  verificate quando il repository non offre una prova statica sufficiente;
- parser, help e `cli-contract` consumano una sola grammatica command-aware per
  `check`, `changed`, `explain` e `init`;
- help per comando, README, docs sync, corpus etichettato e test di regressione sono
  allineati allo stesso contratto.

QA eseguito interamente in Docker:

- `npm test` 63/63, repository invariato e sandbox rimossa;
- corpus etichettato 41/41, precisione 100% per `make-target` e `cli-contract`, zero
  falsi positivi bloccanti;
- profili rete e performance, `npm run docs:sync-check`, help/version, self-scan del
  README, `npm pack --dry-run --json` con 35 file e `git diff --check` verdi;
- Redis `4f20cb4` completo con zero finding `make-target`; le quattro assegnazioni
  dell'issue producono zero finding;
- DwarfStar `84cc882` pulito; le quattro mutazioni controllate producono quattro
  finding `make-target`, inclusa la selezione del Makefile tramite `-C`;
- snapshot Redis e DwarfStar montati read-only e stato Git identico prima/dopo.

Commit: `41ab3db` e `343a404`, mergiate in `main` da PR #30 come `dfe86b7`;
firme valide e otto check GitHub verdi sul head finale.

Rischi residui: i sei finding `local-link` osservati su Redis sono estranei alle issue;
la classe performance Docker `linux-arm64-node22-fs2035054128` è deterministica ma
non ha una baseline revisionata; nessuna baseline è stata modificata.

#### S1.2 — Bloccare le reti IANA non globali nei link remoti

Stato: `DONE`

Finding riprodotto durante l'audit finale: il guard SSRF lasciava passare alcuni
prefissi IANA non globalmente raggiungibili, inclusi i blocchi di documentazione
IPv4/IPv6, discard-only e translation locale.

Lavoro completato:

- sostituita la logica a rami con `node:net` `BlockList`, senza dipendenze;
- aggiunti i prefissi IANA non globali mancanti e mantenute le eccezioni globali
  `192.0.0.9`, `192.0.0.10` e `64:ff9b::/96`;
- mantenuti il controllo dopo DNS lookup e il blocco dei target IPv4 mappati in IPv6;
- aggiunti regression test positivi, negativi e ai confini dei prefissi.

QA: il test fallisce prima del fix su `192.0.2.1`; dopo il fix passa su Node locale e
Node 22 Docker, insieme a `test:network`, alla suite 64/64 e al corpus etichettato
41/41. Commit firmata: `1de75ae`.

Chiusura S1: non risultano issue GitHub aperte e tutti i finding riproducibili emersi
dalla stabilizzazione sono coperti. A4 resta un gate separato di evidenza con utenti,
non un finding di codice da chiudere artificialmente.

### S2 — Audit finale di semplicità, sicurezza e compatibilità

Stato: `DONE`

- cercare codice morto, duplicazione, astrazioni premature e compatibilità nascosta;
- verificare path traversal, SSRF opt-in, escape terminale/report e limiti risorse;
- confrontare pacchetto v1, beta v2 e Action v1/v2 in ambienti isolati;
- verificare che ogni rimozione abbia migrazione e che ogni claim pubblico sia vero.

QA: `PF`, `LL`, `PP`, `SG`, `FX`.
Commit suggerita: `refactor(release): remove residual complexity before v2 stable`

Lavoro completato:

- rimossi helper v1 non raggiungibili dalla CLI/API v2 e ridotto il prodotto di 113
  righe nette senza aggiungere file, dipendenze o astrazioni;
- unificati i valori `purpose` nel modulo di dominio già responsabile della
  classificazione dei documenti;
- reso fail-closed un target con contenimento indeterminato, preservando il contratto
  `file-unreadable` per i normali errori di permesso;
- esteso il blocco SSRF a IPv4 special-purpose/benchmark/multicast-reserved e IPv6
  site-local/multicast, mantenendo rete disabilitata senza opt-in;
- verificati escape terminale, JSON/SARIF/JUnit, output contenuti e atomici, limite
  stdin, timeout/concorrenza link, limite delle annotazioni e buffer della Action;
- confrontati in ambienti isolati npm v1.7.4 e v2, oltre alla Action congelata `v1`
  e alla Action v2; le rimozioni restano coperte da `MIGRATION.md`.

QA eseguita:

- `npm test` 64/64 e corpus etichettato 41/41 con zero falsi positivi bloccanti;
- rete locale, performance su 300 documenti, docs sync, self-scan di README,
  migrazione e registro, `git diff --check` e pack dry-run con 35 file verdi;
- PF 5/5, LL 32/32, PP 27/27, SG 5/5 e FX 2/2: scansioni complete e pulite,
  stato Git invariato prima/dopo;
- tarball v1.7.4 e v2 installati offline e provati sulla stessa fixture; smoke Action
  `v1`/v2 verdi; audit production della Action con zero vulnerabilità.

Commit: `f22486f` (`refactor(release): remove residual v2 complexity`, firma valida).

Rischi residui del primo audit: A4 resta senza prove da utenti reali; ogni modifica
successiva a S1 richiede una nuova esecuzione proporzionata di S2.

Riesecuzione finale dopo S1.2 e sul candidato `2.0.0`:

- Docker: suite 64/64, corpus 41/41 con precisione 100% per regola e zero falsi
  positivi bloccanti; rete, docs sync, self-scan, pack e bundle Action verdi;
- performance Docker ARM non registrata: cold p95 60.55 ms, warm p95 19.558 ms;
  nessuna baseline modificata;
- DwarfStar `84cc882` pulito su 19 file e Redis `1b8c472` con i sei `local-link`
  attesi su 27 file; text, compact, JSON deterministico, SARIF, JUnit, Git selection,
  glob, external link opt-in, stdin, init, explain, API e Action sorgente/bundle provati;
- su copie tmpfs di entrambi i corpus, cinque mutazioni controllate producono
  esattamente un finding per regola; la riparazione torna pulita;
- Action production audit: zero vulnerabilità su sette dipendenze runtime.

Rischi residui aggiornati: A4 resta senza prove real-user; i sei link Redis puntano a
file o moduli assenti dal checkout sorgente; la classe performance Docker ARM non è
una baseline revisionata.

### S3 — Preparare gli artefatti di release

Stato: `DONE`

- aggiornare versione, changelog, migrazione, README, metadati npm e Action;
- produrre tarball con checksum e installarlo in un progetto temporaneo;
- preparare note GitHub e checklist senza pubblicare;
- registrare branch, commit, tag candidato, versioni package/Action e dist-tag atteso.

QA: pack/installazione isolata più matrice completa finale.
Commit suggerita: `chore(release): prepare doclify guardrail 2.0.0`

Artefatti preparati:

- package npm e metadati Action allineati a `2.0.0`; README, migrazione e changelog
  distinguono il candidato locale dagli artefatti pubblicati;
- branch `release/v2.0.0`; commit firmate `1de75ae` e `7acd109`; nome del tag
  candidato non ancora creato `v2.0.0`, dist-tag npm atteso `latest`, major Action
  atteso `v2`;
- tarball `doclify-guardrail-2.0.0.tgz`: 35 file, 38.322 byte, npm shasum
  `2a594cf8c5ba2136e62d43e64d3b1b3524f4acd4`, SHA-256
  `228633ef4738098c8214c98d0d90c13555ddd4906c5c0d35c381a99600ad8698`;
- installazione offline pulita del tarball: versione, help, CLI su DwarfStar/Redis e
  import API verdi.

Bozza note GitHub: prima stable del core locale e read-only; cinque regole di
integrità evidence-backed; CLI/API/Action v2 deterministiche; output macchina e
selezione Git; hardening di path, output atomici e SSRF; superfici v1 Cloud/AI/fixer
rimosse come documentato in `MIGRATION.md`. A4 non è adozione dimostrata.

Checklist candidata:

- [x] versione, changelog, migrazione, README e metadati Action;
- [x] bundle Action riproducibile e audit production senza vulnerabilità;
- [x] pack, checksum, installazione offline e matrice completa finale;
- [x] merge della PR in `main`;
- [x] tag firmato `v2.0.0` e GitHub Release;
- [x] pubblicazione npm su `latest` e verifica indipendente dal registry;
- [x] riferimento mobile Action `v2`.

### S4 — Pubblicare e verificare 2.0.x

Stato: `VERIFYING`

La PR #33 è stata fusa in `main` come `ad98fb4`; Docs Check e Reliability sono
verdi. npm pubblica `2.0.1` su `latest` con `gitHead=ad98fb4`, integrity
`sha512-NMI7TqTlXk7K0gtoUi5J/7fPu+L4t5ePHGJ+QG3g7AKKimTAx5OweTs5padhTA/djLSHTRWAdcmGIntBQCFoyA==`
e shasum `fce4fd6255477652fd60c406514498e02c19e9dc`; `next` resta su
`2.0.0-beta.3`.

Il tag firmato `v2.0.1`, la GitHub Release
`https://github.com/Elgabor/doclify-guardrail/releases/tag/v2.0.1` e il tag mobile
firmato `v2` puntano tutti ad `ad98fb4`. `v1` resta su `78a59f7`. Il tarball
`2.0.1` sostituisce la documentazione candidata rimasta nel tarball immutabile
`2.0.0`.

Preparazione `2.0.1`: suite 64/64, corpus etichettato 41/41, rete, performance,
docs sync, scansione dei documenti, bundle Action e audit production sono verdi.
Il tarball contiene 35 file, ha npm shasum
`fce4fd6255477652fd60c406514498e02c19e9dc` e SHA-256
`de9f367d23f3ae7a37b76d196787b33ca167723e8725c8e9e7ed31960503390d`.
Installazione, CLI e API sono verdi localmente; il pack/install Node 22 Docker è
verde in modalità offline, read-only e non-root. Il runtime non è cambiato, quindi
la matrice DwarfStar/Redis già registrata per `2.0.0` non è stata riclonata.

Checklist di chiusura `2.0.1`:

- [x] merge protetto del diff di release;
- [x] tag firmato e GitHub Release `v2.0.1`;
- [x] pubblicazione npm `2.0.1` su `latest` e installazione pulita;
- [x] creazione del riferimento mobile Action `v2` sul commit `v2.0.1`;
- [ ] PR finale con SHA e prove degli artefatti pubblicati.

Azioni, ciascuna soggetta all'autorizzazione ricevuta:

1. merge del branch di release in `main`;
2. push di branch e `main` su `origin`;
3. creazione e push del tag immutabile `v2.0.1`;
4. GitHub Release;
5. aggiornamento linea Action `v2` senza spostare `v1`;
6. `npm publish --tag latest`;
7. verifica dal registry con installazione pulita, `--version`, `--help` e demo;
8. aggiornamento del portfolio tramite task separata autorizzata.

Accettazione:

- GitHub, npm e Action sono riportati e verificati separatamente;
- il pacchetto registry coincide con commit/tag e contenuto approvati;
- un fallimento parziale interrompe la sequenza e viene riportato, senza tentare
  correzioni distruttive o ripubblicare la stessa versione.

Commit: nessuna commit di codice improvvisata durante la pubblicazione.

## 2.1.0 — Revisione dei documenti interessati

Branch: `release/v2.1.0`
Prerequisito: core v2 stabile e R1 con decisione `go`
Esito: coda consultiva, spiegabile e ad alta precisione dei documenti da rivedere.

### R1 — Discovery prima dell'implementazione

Stato: `TODO`

- etichettare almeno dieci modifiche assistite dall'AI in cinque repository;
- registrare quali documenti non modificati richiedevano davvero revisione;
- simulare una coda con hunk, riferimenti esatti, prossimità e storia Git locale;
- confrontare con markdownlint, Lychee e strumenti specializzati;
- intervistare almeno tre utenti target su esempi reali;
- decidere `go`, `revise` o `stop`.

Gate `go`:

- almeno cinque casi coinvolgono documenti diversi da `AGENTS.md`/`CLAUDE.md`;
- almeno 60% di rilevanza nei primi cinque risultati della simulazione;
- almeno tre utenti indicano un'azione concreta che intraprenderebbero.

QA: analisi in sola lettura su `PF`, `LL`, `PP`, `SG` e un quinto repository
pertinente; nessun codice di produzione.
Commit suggerita: `docs(discovery): decide affected-document review hypothesis`

### R2 — Grafo documenti e fatti del repository

Stato: `BLOCKED` fino a R1 `go`

- analizzare ogni documento una sola volta;
- collegare documenti a path, anchor, identificativi e flag verificati;
- usare hunk modificati e storia Git locale senza eseguire contenuto;
- esporre query immutabili al motore di review.

QA: `PF`, `LL`, `PP`, `FX`, inclusi Unicode, CRLF, MDX e repository grandi.
Commit suggerita: `feat(graph): index document and repository evidence once`

### R3 — Ordinamento spiegabile della coda

Stato: `BLOCKED` fino a R2

- definire segnali forti prima dell'algoritmo;
- usare riferimenti esatti e co-change come segnali principali;
- mantenere similarità di token soltanto come ranking debole;
- mostrare hunk o relazione che include ogni documento;
- impedire alle euristiche di bloccare la CI.

Accettazione: almeno 80% di precisione nei primi cinque risultati su holdout indipendente.
QA: `PF`, `LL`, `PP`, `SG`, `FX`.
Commit suggerita: `feat(review): rank affected documents with traceable evidence`

### R4 — Comando `review` e override opzionali

Stato: `BLOCKED` fino a R3

- esporre la coda in text/JSON con traccia esplicativa;
- aggiungere mapping `coverage` soltanto opzionali e validati;
- diagnosticare glob vuoti, target eliminati e mapping obsoleti;
- mantenere zero-config utile prima degli override.

QA: `PF`, `SG`, `PP`, `FX`.
Commit suggerita: `feat(review): expose advisory review queue and coverage hints`

### R5 — Beta, pulizia e release 2.1.0

Stato: `BLOCKED` fino a R4

- tre partecipanti, due modifiche reali ciascuno;
- almeno 80% di accettazione nei primi cinque risultati esterni;
- rimuovere segnali che non migliorano la coda;
- eseguire l'intero gate stable e la slop review;
- preparare e pubblicare seguendo gli stessi gate separati di S3/S4.

QA: matrice completa più uso esterno autorizzato.
Commit suggerita: `chore(release): prepare doclify guardrail 2.1.0`

## 2.2.0 — Policy di integrità riutilizzabili

Branch: `release/v2.2.0`
Prerequisito: almeno tre richieste indipendenti riconducibili allo stesso bisogno
Esito: contratti repository-specifici piccoli, deterministici e versionabili.

### E1 — Validare i casi di policy

Stato: `BLOCKED` in attesa di domanda reale

- raccogliere casi che il core non può conoscere automaticamente;
- scartare casi già coperti da linter o strumenti specializzati;
- scegliere al massimo tre tipi di contratto con semantica chiara;
- decidere `go`, `revise` o `stop` prima di progettare una DSL.

QA: esempi reali anonimizzati da almeno tre repository.
Commit suggerita: `docs(discovery): define reusable integrity policy cases`

### E2 — Schema minimo delle policy

Stato: `BLOCKED` fino a E1 `go`

- estendere la configurazione esistente senza linguaggio di plugin generico;
- validare path, glob, rule id e severità al boundary;
- fornire messaggi di errore e migrazione deterministici;
- mantenere policy pure, locali e senza esecuzione.

QA: `PF`, `PP`, `SG`, `FX`.
Commit suggerita: `feat(policy): add minimal repository integrity contracts`

### E3 — Spiegazioni, interoperabilità e template

Stato: `BLOCKED` fino a E2

- includere nelle segnalazioni la policy e la prova applicata;
- fornire template piccoli per monorepo, CLI e documentazione operativa;
- interoperare tramite JSON/SARIF esistenti invece di un nuovo plugin runtime;
- verificare che zero-config resti il percorso principale.

QA: `LL`, `PP`, `SG`, `FX`.
Commit suggerita: `docs(policy): add traceable templates and interoperability`

### E4 — Beta, slop review e release 2.2.0

Stato: `BLOCKED` fino a E3

- provare le policy con gli utenti che le hanno richieste;
- misurare tempo di configurazione, falsi positivi e manutenzione dopo modifiche;
- rimuovere ogni tipo di policy non ripetuto o troppo ambiguo;
- eseguire matrice completa, audit stable e gate separati di pubblicazione.

QA: matrice completa più utenti autorizzati.
Commit suggerita: `chore(release): prepare doclify guardrail 2.2.0`

## Checklist di autorizzazione per una release eseguita da un agente

Per permettere all'agente di completare senza ulteriori conferme, il prompt deve
autorizzare esplicitamente:

- versione e branch esatti;
- creazione delle commit per task;
- merge esatto verso `main` e metodo di merge;
- push del branch e/o di `main` verso `origin`;
- creazione e push del tag esatto;
- creazione della GitHub Release;
- aggiornamento del major tag della GitHub Action, se previsto;
- `npm publish` con dist-tag esatto (`next` o `latest`);
- eventuale aggiornamento e deploy del portfolio come task separata.

Servono inoltre, senza esporli all'agente:

- autenticazione GitHub già configurata con permessi di push/release;
- accesso npm già configurato per `doclify-guardrail` o il nome scelto;
- disponibilità di Lorenzo se npm richiede OTP o approvazione 2FA interattiva;
- branch protection compatibile con il metodo scelto e CI obbligatoria verde;
- worktree pulito o modifiche preesistenti chiaramente attribuite;
- decisione sul naming e sui dist-tag;
- autorizzazione separata per qualsiasi modifica a dominio o portfolio.

I comandi fidati possono consumare autenticazione in modo opaco. L'agente non legge,
stampa o copia token, `.npmrc`, `.env`, keychain o session store.

## Registro di avanzamento

Compilare una riga dopo ogni task completata:

| Task | Stato | Commit | QA eseguito | Note/rischio residuo |
| --- | --- | --- | --- | --- |
| B1 | DONE | `d62222f` | `npm test` 269/269; docs sync; scan 100/100; pack dry-run; 2 FX offline | `MIGRATION.md` entra nel tarball e nel docs guard in P5; pack beta.1 resta v1. |
| B2 | DONE | `1b38245` | `npm test` 293/293; B2 24/24; docs sync; scan v2; pack dry-run; PF/LL invariati; FX offline | Git/config in B3; legacy in P2; init in P1; explain/stdin in P4; packaging guida in P5. |
| B3 | DONE | `2c268ce` | `npm test` 308/308; v2/B3 39/39; docs sync; scan v2; pack dry-run; PF/PP/SG invariati; FX offline | Untracked/ignored/deleted esclusi per contratto; resolver v1 in P2; baseline e guardie Git in B4; Node 20 in CI. |
| B4 | DONE | `ee23f40` | `npm test` 319/319; perf 300 docs; docs sync; scan v2; pack dry-run; PF/LL invariati; FX offline | Node 20 e classe perf CI al gate; enforcement socket esterne in A3; temp legacy intatte. |
| P1 | DONE | `369dd45` | `npm test` 41/41; precision holdout 26/26; perf 300 docs; docs sync; pack dry-run; PF/LL/PP/SG invariati | Le purpose non rendono bloccante lo stile generico; `generated` salta i claim sui comandi. |
| P2 | DONE | `369dd45` | test di migrazione; docs sync; pack dry-run; smoke Action v1; audit Action 0 vulnerabilità | Action `@v1` congelata; Action v2 rinviata ad A2. |
| P3 | DONE | `369dd45` | `npm test` 41/41; precision holdout 26/26; QA PF/LL/PP/SG invariata | `external-link` resta consultiva e non verificata. |
| P4 | DONE | `369dd45` | test contratto beta.2; docs sync; demo stdin/output/explain | Output testuale limitato; formati macchina completi e deterministici. |
| P5 | DONE | `369dd45` | esempi clean/failing; docs sync; scan v2; pack dry-run; demo riproducibile | README e migrazione dichiarano beta.2; Action v2 resta futura. |
| A1 | DONE | `7d5188c` | suite 59/59; pack installato; QA 69 file su 4 checkout autorizzati; Git invariato | Output Markdown non sovrascrivibile; report non Markdown atomici; invocazione bin npm via symlink coperta. |
| A2 | DONE | `df0ad54` | test Action sorgente/bundle; build riproducibile; audit 0 vulnerabilità; smoke locale e SHA immutabile in CI | L'Action stabile è disponibile con tag `v2.0.0` e SHA `5ce78dc`; non esiste ancora un alias mobile `v2`. |
| A3 | DONE | `c71434e`, `2170e26` | 26/26 casi etichettati; 0 falsi positivi bloccanti; rete locale; property test; perf Linux/macOS verde | Soglia CI ampia, adatta solo a regressioni macroscopiche; test symlink saltati solo su Windows; evidenza reale demandata ad A4. |
| A4 | BLOCKED_INPUT | `2048e4c` | protocollo e confini privacy revisionati; nessun risultato qualificante registrato | Richiede 3-5 utenti reali, almeno 3 completamenti e 30 finding revisionati; non inferire adozione dalla QA locale. |
| A5 | DONE | `e21ba8e`, `7e74c42` | demo su tarball/checkouts puliti; claim mappati a prove pubbliche; changelog candidato; review anti-slop | Solo draft; portfolio intatto e pubblicazione non autorizzata. |
| S1 | DONE | `41ab3db`, `1de75ae` | S1.1 e S1.2; regression test; nessuna issue GitHub aperta | A4 resta un gate real-user separato. |
| S1.1 | DONE | `41ab3db`, `343a404` | Docker: 63/63 test; corpus 41/41; rete, performance, docs sync, self-scan e pack; RD/DS invariati; 8 check GitHub verdi | `.DEFAULT`, Makefile alternativo e sintassi shell ambigua restano non verificati; classe performance Docker ARM non registrata. |
| S1.2 | DONE | `1de75ae` | fail pre-fix; Node/Docker regression; rete; suite 64/64; confini IANA pubblici/non globali | Registry IANA può evolvere; aggiornare solo da fonte primaria e con test di confine. |
| S2 | DONE | `f22486f`, `1de75ae`, `7acd109` | 64/64; 41/41; rete/performance/docs/pack; DwarfStar/Redis tutte le superfici; mutazioni 5/5; pack installato; Action audit 0 | A4 resta senza prove real-user; classe performance Docker ARM non registrata. |
| S3 | DONE | `7acd109` | metadata/docs; bundle; pack 35 file; SHA-256; install offline; CLI/API sui due corpus | Candidato soltanto: registry, tag, Release e Action stable non pubblicati. |
| S4 | VERIFYING | PR #31, PR #33, `ad98fb4`, `v2.0.1`, `v2` | merge e CI; npm `latest`; install smoke; tag firmati; GitHub Release; Action SHA/tag mobile | Manca il gate della PR finale di evidenza; A4 resta `BLOCKED_INPUT`. |
| R1 | TODO | - | - | - |
| R2-R5 | BLOCKED | - | - | R1 deve produrre go |
| E1-E4 | BLOCKED | - | - | domanda reale non ancora dimostrata |
