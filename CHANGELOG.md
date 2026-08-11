# Changelog

All notable changes to this project are documented in this file.

## [2.0.0-beta.3] - 2026-08-11

### Added

- added a v2 GitHub Action adapter that delegates to the same local CLI core, needs no token, and stays offline unless remote-link checks are explicitly enabled
- added separate CI jobs for labeled correctness, controlled local-network behavior, and reviewed performance baselines
- added a private-beta evidence protocol and portfolio copy draft without claiming adoption or publishing the draft

### Changed

- separated pure command parsing and help text from CLI runtime effects
- made installed npm binary symlinks invoke the CLI entrypoint reliably
- replaced the rule-noise fingerprint with 26 labeled cases and deterministic property coverage for paths, links, Markdown variants, and repository boundaries
- reduced the Action dependency graph by removing the GitHub API and PR-comment path

### Security

- refuse report output that aliases scanned documents or resolves inside Git metadata
- write repeatable non-Markdown reports through a temporary file and atomic rename without following an existing output symlink
- block CGNAT and IPv4-compatible IPv6 private targets, and fail closed after 40 symbolic-link resolutions

### Notes

- `2.0.0-beta.3` is published on npm's `next` tag with a signed GitHub prerelease; `latest` remains on the stable v1 line
- the performance tolerance catches macroscopic regressions; it is not evidence of a tight performance target
- private-beta task A4 still awaits qualifying real-user sessions

## [2.0.0-beta.2] - 2026-08-10

### Changed

- replaced the v1 style-lint, fixer, score, trend, Cloud, AI, Drift, and watch surfaces with the v2 local integrity core
- classify documents by purpose and report that purpose in the deterministic result model
- added evidence-backed checks for local references, npm scripts, workspace packages, Make targets, and the static Doclify CLI contract
- added `check - --stdin-name`, `explain <rule-id>`, and explicit `init --print` / `init --write` workflows
- removed the short `doclify` executable and package-root API export; `doclify-guardrail/api` exports `check`

### Notes

- blocking findings now carry reproducible evidence while schema version remains `3` during the prerelease line
- Action v1 is unchanged; a v2 Action is deferred to beta.3
- refreshed the 300-document performance baseline after the intentional five-rule catalog replacement and the lazy, exclusion-aware repository index
- retired the v1 external-corpus reliability workflow and its v1-only output baselines; beta.2 uses the local deterministic gate plus the recorded read-only QA matrix instead

## [1.7.4] - 2026-06-09

### Security

- escape Markdown table, code span, and HTML control characters in Markdown reports and GitHub PR comments to reduce report-spoofing risk
- reject JUnit, SARIF and badge output paths outside the current workspace
- require HTTPS for Doclify Cloud API URLs, except localhost/loopback URLs used for local testing
- block private, loopback, link-local and metadata Cloud API URL targets even when they use HTTPS
- guard Doclify Cloud API requests at connection lookup time to reduce DNS-rebinding token exfiltration risk
- guard remote link checks at connection lookup time to reduce DNS-rebinding SSRF risk
- pass the GitHub Action `doclify-token` to the CLI through `DOCLIFY_TOKEN` instead of argv
- redact token-like values from `--debug` output
- escape badge labels before rendering SVG output
- harden GitHub workflows with read-only token permissions, non-persisted checkout credentials and install-time `--ignore-scripts`

### CI

- move the GitHub Action runtime metadata to Node 24
- update official workflow actions to Node-24-era major versions older than 14 days
- update `actions/setup-node` to the latest stable release that satisfies the 14-day dependency freshness rule
- update GitHub Action toolkit dependencies and bundled action output
- align README GitHub Actions examples with the current workflow action majors
- keep deterministic reliability blocking while making live-network reliability advisory because external link timeouts are not product regressions

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
