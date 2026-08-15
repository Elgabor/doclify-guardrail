# Evidence demo runbook

Run these commands from the repository root. The demo is local and offline.

## Clean document

```sh
node ./src/index.mjs check examples/evidence-demo/README.md --format compact
```

Expected result: exit code `0` and no findings.

## Intentionally broken document

```sh
node ./src/index.mjs check examples/evidence-demo/fixtures/README.broken.md --config examples/evidence-demo/.doclify-guardrail.json --format json
```

Expected result: exit code `1` and a `local-link` finding for
`missing-runbook.md`. The JSON result includes the observed missing path and
its workspace-relative source.
