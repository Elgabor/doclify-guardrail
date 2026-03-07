# Reliability Gate

Questa guida definisce il processo per validare Doclify su repository reali (OSS) con benchmark ripetibili e soglie bloccanti.

## Obiettivo

- Validare stabilita e affidabilita su repo reali.
- Bloccare regressioni prima delle release.
- Rendere i claim "production-ready" verificabili.

## Struttura file

- `bench/corpus.manifest.json`: dataset, commit pin-nati, profili scan.
- `bench/reliability-thresholds.json`: soglie hard deterministic/network.
- `bench/waivers.json`: eccezioni temporanee con scadenza.
- `bench/baselines/*.json`: baseline ufficiali per confronto.
- `bench/out/*`: artifact generati da run/comparator.

## Corpus tags

Il manifest usa tag separati per controllare la copertura:

- `pr-sample`: subset veloce usato in PR.
- `nightly-det-full`: corpus completo deterministic (`small`, `medium`, `large`).
- `nightly-net-sample`: subset network per contenere tempi e flakiness da rete.

Corpus corrente (commit pin-nati):

- `spoon-knife` (`small`)
- `markdownlint` (`small`)
- `nodejs-node` (`medium`)
- `kubernetes-website` (`large`)

Per la release `v1.7.0` questi 4 repository costituiscono anche
il set minimo obbligatorio di dogfooding esterno della stable candidate.

## Setup locale

Prerequisiti:

- Node.js >= 20
- `git` disponibile in PATH
- accesso rete verso i repository OSS configurati nel manifest

Comandi:

```bash
npm install
npm run reliability:pr
```

Nota cache/locking:

- `run-corpus` usa lock per-repo nella cache (`<cache-root>/<repo-id>.lock`) per evitare race quando piu run partono in parallelo sulla stessa macchina.
- Opzioni utili: `--cache-root`, `--lock-timeout-ms`, `--stale-lock-ms`.

## Bootstrap baseline

Rigenera tutte le baseline quando:

- hai una release stabile;
- hai validato manualmente che i nuovi finding siano corretti;
- hai aggiornato intenzionalmente regole o threshold.

Comando:

```bash
npm run reliability:bootstrap
```

Questo comando produce:

- `bench/baselines/pr-deterministic.json`
- `bench/baselines/nightly-deterministic.json`
- `bench/baselines/nightly-network.json`

## Waiver policy

`bench/waivers.json` consente eccezioni temporanee su metriche specifiche:

- `newFindingsDelta`
- `p95ScanMs`
- `peakMemoryMb`
- `timeoutRate`

Regole:

- ogni waiver deve avere `owner`, `reason`, `expiresOn`;
- i waiver scaduti vengono ignorati automaticamente;
- niente waiver senza data di scadenza.
- per la stable candidate `v1.7.0`, PR e nightly devono restare verdi
  senza introdurre waiver nuovi.

Esempio:

```json
{
  "schemaVersion": 1,
  "waivers": [
    {
      "id": "WAIVER-001",
      "repoId": "spoon-knife",
      "metric": "p95ScanMs",
      "expiresOn": "2026-06-30",
      "reason": "Investigation in corso su regressione transitoria in CI",
      "owner": "team-doclify"
    }
  ]
}
```

## Interpretazione report

Il comparator genera due artifact:

- report markdown (`--report`, es. `bench/out/pr-deterministic-report.md`)
- report JSON (`.json` con lo stesso prefisso)

Stati:

- `PASS`: nessuna violazione bloccante.
- `FAIL`: almeno una violazione non coperta da waiver attivo.

Nota sulle regressioni tempo:

- Il controllo percentuale `maxP95RegressionPct` si applica solo quando la baseline p95 supera `minBaselineP95ForPctMs`.
- Il limite assoluto in millisecondi (`maxP95RegressionMs`) resta sempre attivo.

## Quando e lecito aggiornare baseline

Aggiorna la baseline solo se tutte queste condizioni sono vere:

1. il cambiamento e intenzionale e documentato (changelog/PR description);
2. i nuovi finding non sono false positive;
3. non stai nascondendo regressioni di performance o crash;
4. il team concorda il reset del riferimento.

Se manca una di queste condizioni, non aggiornare la baseline: usa un waiver a scadenza breve e apri remediation task.
