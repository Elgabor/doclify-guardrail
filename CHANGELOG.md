# Changelog

## v1.7.1

Patch release per chiudere le regressioni emerse subito dopo `v1.7.0`.

- fix del bootstrap `--watch` per non perdere cambi immediati durante la fase iniziale di watch;
- stabilizzazione del test `--watch --fix` su Linux CI;
- correzione del quality gate documentale su README e reliability docs.

## v1.7.0

Doclify 1.7.0 e la release di stabilizzazione del core.
L'obiettivo non e aggiungere superficie: e rendere affidabili i verdetti su tutte le entrypoint pubbliche.

### Stabilita e parity

- Watch mode riallineato alla pipeline canonica del CLI, inclusi `--fix`, `--check-links` e `--check-freshness`.
- GitHub Action bundle allineato al layout reale del repository e coperto da smoke test su `action/dist/index.mjs`.
- `run-corpus` esegue ora gli scan dal checkout del repository target, cosi config discovery e output riflettono l'uso reale.

### Correttezza del dominio

- `doclify-disable-file` ignorato dentro fenced code blocks.
- Parsing frontmatter/freshness normalizzato su LF e CRLF.
- `stale-doc` segnala in modo esplicito date mancanti, invalide e future senza introdurre nuove regole pubbliche.
- Fallback HEAD -> GET esteso ai casi method-limited coperti in 1.7 (`403`, `404`, `405`, `501`).

### CI e reporting

- JUnit deriva le failure dal pass/fail canonico per file, quindi strict mode non diverge piu dal verdetto reale.
- PR comment bot usa paginazione completa prima di decidere create/update.
- Baseline `nightly-deterministic` riallineata alla semantica reale di `run-corpus`, che dalla 1.7 misura il prodotto dal `cwd` del repo target invece che dal repo Doclify.
- README, docs tecnici e reliability guide aggiornati ai comportamenti reali della 1.7.
