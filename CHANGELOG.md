# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [1.7.3] - 2026-03-18

### Changed

- moved the public repository examples to `examples/` and removed the dead demo script
- rewrote the public docs check so it validates only tracked files on a clean clone
- updated the README to be self-contained and fixed the GitHub Action path/tag guidance
- translated the public changelog to English and added package metadata for repository discovery
- simplified the public/private boundary in `.gitignore` and added `.editorconfig`

## [1.7.2] - 2026-03-15

- feat: push score summary to Doclify Cloud via `--push` (#21)
- feat: `--project-id` flag and `DOCLIFY_PROJECT_ID` env var for cloud project binding
- feat: config file supports `push` and `projectId` fields
- feat: GitHub Action supports `push` and `project-id` inputs

## [1.7.1] - 2026-03-15

Patch release focused on the regressions found immediately after `v1.7.0`.

- fixed the `--watch` bootstrap so immediate changes are not missed during initial startup
- stabilized the `--watch --fix` test on Linux CI
- corrected the documentation quality gate for the README and reliability guidance

## [1.7.0] - 2026-03-15

Doclify 1.7.0 was the core stabilization release.
The goal was not to add surface area, but to make verdicts reliable across every public entrypoint.

### Stability and parity

- watch mode is aligned with the canonical CLI pipeline, including `--fix`, `--check-links`, and `--check-freshness`
- the GitHub Action bundle is aligned with the real repository layout and covered by a smoke test on `action/dist/index.mjs`
- `run-corpus` now executes scans from the target repository checkout so config discovery and output reflect real usage

### Domain correctness

- `doclify-disable-file` is ignored inside fenced code blocks
- frontmatter and freshness parsing is normalized across LF and CRLF
- `stale-doc` reports missing, invalid, and future dates explicitly without introducing new public rules
- HEAD -> GET fallback now covers the method-limited cases included in 1.7 (`403`, `404`, `405`, `501`)

### CI and reporting

- JUnit derives failures from the canonical per-file pass/fail verdict, so strict mode no longer diverges from the real result
- the PR comment bot paginates all comments before deciding whether to create or update
- the `nightly-deterministic` baseline is aligned with the real `run-corpus` semantics, which from 1.7 measure the product from the target repo `cwd` instead of the Doclify repo
- the README and reliability guidance were updated to match the real 1.7 behavior
