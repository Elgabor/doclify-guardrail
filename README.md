# Doclify Guardrail CLI — MVP v0.2

CLI locale low-cost per controllare file Markdown prima della pubblicazione (guardrail minimi di qualità/sicurezza), senza API esterne.

## Quick start
```bash
cd projects/doclify-guardrail-mvp
npm install
npm test
node ./src/index.mjs ./sample.md
```

## Uso CLI
```bash
doclify-guardrail <file.md> [opzioni]
```

### Opzioni
- `--strict`: tratta i warning come failure
- `--max-line-length <n>`: soglia max caratteri per linea (default `160`)
- `--config <path>`: path config JSON (default: `.doclify-guardrail.json` nella cwd)
- `--debug`: stampa dettagli di runtime (su stderr)
- `-h, --help`: help rapido

## Config file di progetto
Crea `.doclify-guardrail.json` nella root progetto:

```json
{
  "maxLineLength": 120,
  "strict": true
}
```

Precedenza configurazione:
1. flag CLI (es. `--strict`, `--max-line-length`)
2. file config
3. default interni

## Regole guardrail v0.2
1. `single-h1` (**error**) — deve esserci un solo H1
2. `frontmatter` (**warning**) — frontmatter YAML consigliato in testa
3. `line-length` (**warning**) — linee oltre soglia
4. `placeholder` (**warning**) — rileva `TODO`, `lorem ipsum`, `xxx`
5. `insecure-link` (**warning**) — link `http://`

## Output
La CLI produce:
- **summary leggibile** su `stderr`
- **JSON stabile** su `stdout`

Esempio JSON:
```json
{
  "version": "0.2",
  "file": "./sample.md",
  "strict": false,
  "pass": true,
  "findings": {
    "errors": [],
    "warnings": []
  },
  "summary": {
    "errors": 0,
    "warnings": 0,
    "status": "PASS"
  }
}
```

## Exit code
- `0`: PASS
- `1`: FAIL (`errors > 0` oppure warning con `--strict`)
- `2`: uso scorretto / input non valido

## Use-cases reali
1. **Pre-publish locale**: controllo veloce prima di pubblicare docs
2. **CI minima**: pipeline che fallisce su errori o warning (`--strict`)
3. **Standard team**: config condivisa per lunghezza righe/strict

## Demo terminale 30–45s
Script pronto: `./scripts/demo.sh`

Oppure sequenza manuale:
```bash
npm test
node ./src/index.mjs ./sample.md
node ./src/index.mjs ./sample.md --strict
node ./src/index.mjs ./sample.md --max-line-length 100
```

## Vincoli rispettati
- nessuna API esterna
- nessun servizio a pagamento
- solo Node.js standard library
