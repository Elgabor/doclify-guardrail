# Release Checklist

## Go / No-Go

- `npm test` verde.
- `npm run docs:sync-check` verde.
- Smoke pubblici verdi: CLI, API, `action/dist/index.mjs`, JUnit, SARIF.
- Nessuna divergenza nota tra CLI normale, watch mode, JUnit e GitHub Action.
- `npm run reliability:pr` verde senza waiver nuovi.
- `npm run reliability:nightly:det` verde senza waiver nuovi.
- `npm run reliability:nightly:net` verde senza waiver nuovi.
- README e docs tecnici allineati al comportamento reale.
- Nessun bug P0 aperto su CLI/Action.
- Tutti i bug P1 risolti o declassati con motivazione scritta.

## Patch Policy

- Ogni bug cross-surface richiede almeno un regression test.
- Ogni bug su public path richiede anche uno smoke test dell'entrypoint reale.
- Le baseline reliability si aggiornano solo per cambiamenti intenzionali, validati e documentati.
- Se il cambiamento non e intenzionale o non e ancora validato, si mantiene la baseline e si apre remediation.

## Release Cut

- Aggiornare changelog/release note con impatto tecnico e evidence di affidabilita.
- Verificare il version bump a `1.7.0` in package root e action package.
- Taggare la release solo dopo tutti i gate sopra.
