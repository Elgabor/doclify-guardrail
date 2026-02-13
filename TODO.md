# TODO — Doclify Guardrail MVP (stato operativo)

## P0 completate (criterio verificabile)
- [x] Hardening parser CLI (help, errori chiari, opzioni sconosciute)  
  **Verifica:** `node ./src/index.mjs --help` e test `parseArgs`.
- [x] Modalità `--strict` (warning => fail)  
  **Verifica:** test `CLI: strict mode trasforma warning in fail (exit 1)`.
- [x] Supporto config `.doclify-guardrail.json`  
  **Verifica:** test `resolveOptions: legge .doclify-guardrail.json`.
- [x] Regole guardrail con severità consistente  
  **Verifica:** output JSON `findings.errors[]` / `findings.warnings[]` con `severity`.
- [x] Output JSON stabile + summary leggibile  
  **Verifica:** JSON su stdout + summary su stderr (`[doclify-guardrail] ...`).
- [x] Test estesi su strict/config/exit code  
  **Verifica:** `npm test` tutto verde.
- [x] Asset demo 30-45s terminale  
  **Verifica:** esecuzione `./scripts/demo.sh`.

## P1 aperte (prossimi incrementi)
- [ ] Mini report markdown esportabile (`--report out.md`)
- [ ] Regole custom caricabili da file (plugin semplice)
- [ ] Hook git pre-commit opzionale

## Regola costi
Stop immediato se qualunque task richiede API a pagamento non previste.
Richiedere OK esplicito prima di sbloccare costi extra.
