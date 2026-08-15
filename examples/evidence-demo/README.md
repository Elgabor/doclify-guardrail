# Evidence demo

This fixture shows the difference between a document that matches repository
facts and one that contains a broken local reference. It is entirely local and
does not require `--external-links`.

- [Run the demo](runbook.md) for the commands and expected results.
- `README.md` is the clean document and should pass.
- `fixtures/README.broken.md` intentionally links to a missing file and should
  report `local-link`.
