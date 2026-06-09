# Doclify Guardrail Stabilization Notes

<!-- doclify-disable-file blanks-around-lists,line-length -->

Updated: 2026-06-09

## Operating Context

- Repository: `Elgabor/doclify-guardrail`
- Local path: `/Users/lorenzoborgato/code/doclify-guardrail`
- Goal: stabilize the repo, remove low-quality code, make CI pass, assess
  security, research real user pain points, and prepare a phased plan for a
  better version and future npm publish.
- External actions intentionally deferred unless explicitly approved: remote
  branch deletion, public tag, npm publish, or production action.
- Approval update on 2026-06-08: Lorenzo approved committing and pushing the
  new version to `main`; tag creation, remote branch cleanup, and npm publish
  remain intentionally deferred.
- Continuation update on 2026-06-09: pushed CI and scheduled reliability are
  green on commit `89a4b1e`; npm latest is still `1.7.2`; local release
  metadata remains `1.7.4`.

## Current Facts

- Package: `doclify-guardrail` v1.7.4, Node `>=20`, ESM, zero root dependencies.
- Public exports: `.` -> `src/index.mjs`, `./api` -> `src/api.mjs`.
- Binaries: `doclify` and `doclify-guardrail`, both pointing at `src/index.mjs`.
- GitHub Action lives in `action/`, uses `node24`, bundled entrypoint
  `action/dist/index.mjs`, and separate action dependencies.
- CI workflows:
  - `Docs Check`: action dependency install, action bundle parity, action audit, root tests, docs sync, npm pack dry run, docs quality gate.
  - `Reliability Gate`: PR deterministic corpus run, scheduled deterministic + network corpus runs.
- Git state after clone: local branch `main`; remote branches `origin/main` and `origin/fase0/sicurezza-e-bugfix`; tags `v1.7.3`, `v1.7.2`, `v1`.
- New local working file: `PROJECT_STABILIZATION.md`.

## Important Findings

- Remote branch cleanup is not local-only: deleting `origin/fase0/sicurezza-e-bugfix` needs an explicit destructive remote action approval later.
- Release tag should not be created yet: current latest tag is already
  `v1.7.3`; local release metadata is prepared as `1.7.4`, while public tag
  creation waits for push approval and green CI.
- Remote CI: push-triggered `Docs Check` and `Reliability Gate` passed on
  2026-06-08 for commit `89a4b1e`; scheduled `Reliability Gate` also passed on
  2026-06-09 for the same commit.
- Historical remote CI failure cause: live network link checks timed out, not a crash.
  Downloaded artifact report shows timeout rate 50% for `spoon-knife` and
  31.0559% for `markdownlint` versus threshold 1%.
- CI policy change in working tree: deterministic reliability remains blocking;
  scheduled live-network reliability is advisory so external link timeouts still
  produce artifacts but do not keep the repository red.
- CI runtime hygiene in working tree: custom GitHub Action metadata moved from
  `node20` to `node24`; official workflow actions moved to stable
  Node-24-era major tags older than 14 days: `checkout@v5.0.1`,
  `setup-node@v6.4.0`, `cache@v5.0.5`, and `upload-artifact@v7.0.1`.
  `checkout@v6.0.3` was intentionally not used because it was published on
  2026-06-02.
- GitHub Action dependency hygiene in working tree: direct action dependencies
  moved to `@actions/core@^3.0.1`, `@actions/github@^9.1.1`, and
  `@vercel/ncc@^0.38.4`; those versions are older than 14 days.
- Major action tag risk: README examples use
  `Elgabor/doclify-guardrail/action@v1`; remote tag `v1` currently dereferences
  to the same commit as `v1.7.3`. If action users on `@v1` should receive
  `1.7.4`, moving/updating `v1` is a separate public tag action that needs
  explicit approval.

## Verification Log

- `npm test`: passed, 269/269 tests after the security, CI and version-bump
  changes. New coverage includes connection-time private IP blocking for remote
  link checks, shared network guard behavior, and stricter Cloud API URL
  rejection, including IPv4-mapped IPv6 loopback literals and Cloud API
  connection-time DNS-rebinding blocking. The latest follow-up coverage also
  verifies Markdown escaping in reports and PR comments.
- `npm run docs:sync-check`: passed, 35 built-in rules in sync. The check now
  also guards hardened README/workflow invariants: current checkout/setup/cache
  and upload actions, `persist-credentials: false`, `--ignore-scripts`,
  least-privilege workflow permissions, advisory network gate, and `node24`
  action metadata.
- `npm pack --dry-run`: passed; package is `doclify-guardrail@1.7.4` and
  includes 29 files, about 63.9 kB packed / 246.4 kB unpacked after the README
  simplification and Markdown escaping helper.
- `npm pack --json --pack-destination /tmp/...` plus temp install smoke test:
  passed. Installed tarball `doclify-guardrail-1.7.4.tgz`, verified both
  `npx doclify --version` and `npx doclify-guardrail --version` report `1.7.4`,
  ran `npx doclify README.md --strict --no-color --ascii`, and imported
  `doclify-guardrail/api` with a valid `lint` export. Latest smoke tarball has
  29 entries including `src/network-guard.mjs` and `src/markdown-escape.mjs`.
- `npm pack --dry-run --json`: passed; packed file list contains only
  `LICENSE`, `README.md`, `package.json`, and `src/**`. It does not include the
  stabilization ledger, action bundle, tests, benchmark output, or local
  artifacts.
- YAML syntax validation: passed for `.github/workflows/docs-check.yml`,
  `.github/workflows/reliability-gate.yml`, and `action/action.yml`.
- Release metadata audit: passed. Root package, action package, and action lock
  all report `1.7.4`; both CLI bin names target `src/index.mjs`; public API
  export `./api` points at `src/api.mjs`; root Node engine remains `>=20`;
  action metadata uses `node24`.
- `node ./src/index.mjs --version`: passed; CLI reports `1.7.4`.
- `node ./src/index.mjs README.md --strict --report report.md`: passed; README
  score 100/100. Generated `report.md` is gitignored.
- README simplification pass on 2026-06-08: passed
  `npm run docs:sync-check`, passed
  `node ./src/index.mjs README.md --strict --report report.md`, and kept all
  required public examples, action tag policy, workflow examples, CLI reference,
  GitHub Action inputs, Cloud/auth notes, suppressions, JSON output, API usage,
  and security defaults documented.
- Final pre-push verification after README rewrite on 2026-06-08: passed
  `npm test`, `npm run reliability:pr`, action `npm ci`, action build, action
  `npm audit --omit=dev`, action `npm outdated --depth=0`, YAML parsing for
  workflows/action metadata, action bundle parity, tarball install smoke,
  `npm run docs:sync-check`, README strict scan, ledger strict scan, and
  `git diff --check`.
- Follow-up release-readiness pass on 2026-06-09:
  - documentation subagent found non-blocking README gaps; fixed by documenting
    `DOCLIFY_API_URL`, `login --api-url`, `ai drift --staged`,
    `ai drift --mode`, `--version`, and JSON `version`/`strict`/`fileErrors`/`fix`.
  - security subagent found a low report-spoofing risk in Markdown report and
    PR comment rendering; fixed with shared Markdown escaping and regression
    tests for filenames, drift docs, reasons, and finding messages.
  - dependency subagent found `@vercel/ncc@0.44.0` and
    `actions/checkout@v6.0.3` too fresh for the 14-day rule; kept current safe
    pins and updated `actions/setup-node` to safe latest `v6.4.0`.
  - local `npm pack --dry-run --json` still confirms a clean 29-file tarball.
- `node ./src/index.mjs PROJECT_STABILIZATION.md --strict --no-color --ascii`:
  passed; stabilization ledger score 100/100.
- `git diff --check`: passed after adding a deterministic action bundle
  whitespace post-process.
- Root `npm audit --omit=dev`: not applicable because the root package has no lockfile and no dependencies.
- `action/npm ci --no-audit --no-fund --ignore-scripts`: passed for
  `doclify-guardrail-action@1.7.4`; installed 23 packages.
- `action/npm run build`: passed for `doclify-guardrail-action@1.7.4`;
  generated `dist/index.mjs` and `dist/licenses.txt`.
- Action bundle parity in the dirty worktree: rerunning `npm run build` after
  dependency and token-handling updates leaves `dist/index.mjs` and
  `dist/licenses.txt` hashes unchanged. Current hashes:
  `dist/index.mjs` =
  `5415079d98ac7bc43415f238b6ee737829255ffcf8043eb57521d79f51381527`,
  `dist/licenses.txt` =
  `f4001794b80bd559f8e6cff318dfc13e40cea7ae01a7994715c618c17361fc28`.
- `action/npm audit --omit=dev`: passed; 0 vulnerabilities.
- `action/npm outdated --depth=0` after clean action install: only reports
  `@vercel/ncc@0.44.0` as newer. It was published on 2026-06-09 and is
  intentionally held by the 14-day dependency freshness rule.
- `node --test --test-name-pattern "Action dist|score-api: Action dist"`:
  passed, 5/5 action dist smoke tests after toolkit dependency and token
  handling updates.
- `npm run reliability:pr`: passed; deterministic PR corpus compared against
  baseline.
- Subagent review: PR-style reviewer found no blocking code findings and
  flagged only release-process risks: untracked files must be staged and Node
  20/24 coverage must be confirmed by pushed CI.
- Subagent security review found three additional release-scope findings and
  they were fixed in this working tree:
  - remote link SSRF DNS-rebinding risk, fixed with `src/network-guard.mjs` and
    connection-time private IP lookup blocking in `src/links.mjs`
  - Cloud API URL private HTTPS/metadata target risk, fixed in
    `src/cloud-client.mjs`
  - GitHub Action token argv exposure, fixed by forwarding `doclify-token` via
    `DOCLIFY_TOKEN` and `core.setSecret`
- Follow-up subagent security review found one additional release-blocking
  bypass: IPv4-mapped IPv6 loopback literals in hex form such as
  `::ffff:7f00:1`. It was fixed in `src/network-guard.mjs` and covered by
  tests for both remote link checking and Cloud API URL normalization.
- The final residual defense-in-depth note from that review was also addressed:
  `src/cloud-client.mjs` no longer uses unguarded `fetch`; Cloud API requests
  use native HTTP(S) with the same private-network blocking lookup used by
  remote link checks. A regression test verifies that a private IP returned at
  Cloud API connection lookup time is rejected before the request proceeds.
- Subagent QA/release review found no local blockers; remaining coverage gap is
  pushed CI runtime coverage for Node 20 CLI and GitHub-hosted `node24` action
  execution.
- Local runtime note: local checks ran under Node `v22.17.1`. Node 20
  (`v20.19.4`) and Node 24 are not installed locally through `nvm`; `nvm ls 24`
  returns `N/A`. The pushed GitHub workflows are configured with
  `node-version: '20'`, while the custom action metadata uses `node24`, so Node
  20 CLI coverage and Node 24 action runtime coverage must be confirmed in CI
  after push.

## Security Notes

- Root package currently has no third-party runtime dependencies.
- Action dependency chain audit passed with 0 vulnerabilities.
- Link checker has explicit SSRF hardening by default: blocks private,
  loopback, link-local, and metadata hosts unless `--allow-private-links` is
  used. The current implementation also guards the DNS lookup used by the actual
  HTTP(S) connection so a private IP returned after preflight is still rejected.
- Security audit findings to fix:
  - Fixed in working tree: CI artifact paths (`--junit`, `--sarif`, `--badge`)
    now use the same workspace containment model as `--report`.
  - Fixed in working tree: Cloud API URL override now requires HTTPS except
    localhost/loopback local testing.
  - Fixed in working tree: Cloud API URL override now rejects private,
    loopback, link-local and metadata hosts even when the URL uses HTTPS, and
    rejects DNS resolutions to those IP ranges before Cloud requests send a
    bearer token. Cloud API requests now also use connection-time lookup
    validation to reduce DNS-rebinding token exfiltration risk.
  - Fixed in working tree: remote link checks use a shared network guard and
    connection-time lookup validation to reduce DNS-rebinding SSRF risk.
  - Fixed in working tree: GitHub Action `doclify-token` is marked with
    `core.setSecret` and passed to the child CLI through `DOCLIFY_TOKEN`, not as
    a `--token` argv value.
  - Fixed in working tree: `--debug` redacts token/api-key/secret-like values.
  - Fixed in working tree: badge SVG label is XML-escaped.
  - Fixed in working tree: Markdown report and GitHub PR comment content now
    escapes table, code span, and HTML control characters for file paths,
    drift alert docs/reasons, unreadable-file errors, and finding messages.
  - Fixed in working tree: workflows declare `permissions: contents: read`, use
    `persist-credentials: false`, and install with `--ignore-scripts`.
  - Fixed in working tree: direct GitHub Action toolkit dependencies were
    updated to current older-than-14-days major versions.
  - Fixed in working tree: action bundle build now strips generated trailing
    whitespace so the committed bundle can pass `git diff --check`.

## User Pain Points Research

- Real pain points found:
  - Developers lose time finding trustworthy docs and internal information.
    Atlassian's 2025 State of DevEx writeup says 50% of developers report
    losing 10+ hours/week to inefficiencies, with finding information across
    services/docs/APIs listed as a top time-waster:
    [Atlassian DevEx 2025](https://www.atlassian.com/blog/developer/developer-experience-report-2025/amp).
  - Poor, missing, fragmented or inconsistent documentation is reported as a
    major productivity barrier in 2025 coverage of Stack Overflow research. The
    same coverage notes that fewer than one-third of developers document code
    daily and nearly 40% do not do it weekly:
    [ITPro coverage](https://www.itpro.com/software/development/if-software-development-were-an-f1-race-these-inefficiencies-are-the-pit-stops-that-eat-into-lap-time-why-developers-need-to-sharpen-their-focus-on-documentation).
  - Developers get pulled into explaining docs/workflows and fixing
    documentation instead of coding. Lokalise reports developers solved
    documentation/workflow explanations for others and spent time writing/fixing
    internal documentation:
    [Lokalise Developer Delay Report](https://lokalise.com/blog/blog-the-developer-delay-report/).
  - Real community complaints center on stale docs, broken links,
    screenshots/steps from old UI versions, and docs that actively mislead
    users:
    [technical writing thread](https://www.reddit.com/r/technicalwriting/comments/1n8yzry)
    and
    [ExperiencedDevs thread](https://www.reddit.com/r/ExperiencedDevs/comments/1qejexx/documentation_is_three_years_out_of_date_and/).
  - Markdown linting has real false-positive/config pain. The markdownlint issue
    tracker shows false-positive issues such as code-block and poetry cases,
    while GitLab localization has an issue around markdownlint config behavior
    not working as expected:
    [markdownlint issues](https://github.com/markdownlint/markdownlint/issues)
    and
    [GitLab localization issue](https://gitlab.com/gitlab-com/localization/docs-site-localization/-/issues/737).
  - Broken external links are a real long-tail problem in developer knowledge
    bases. A research paper on Stack Overflow broken links reports many broken
    links were used for examples or supporting information:
    [Stack Overflow broken-link paper](https://arxiv.org/abs/2010.04892).
- Product implications:
  - Keep Doclify focused on fast, low-friction CI feedback rather than heavy docs generation.
  - Make failures explain exactly what changed and what to do next; users hate generic lint noise.
  - Treat live external link checking as useful but flaky/advisory unless the user explicitly chooses blocking behavior.
  - Drift/freshness/anchor checks are closer to real user pain than pure Markdown style rules.
  - False-positive controls need to be obvious: suppressions, allow-lists, per-folder config and good rule explanations matter.

## Cleanup Candidates

- `src/index.mjs` is the main maintainability risk. It combines CLI parsing,
  command routing, scan execution, watch mode, reports, trend, cloud push, and
  AI drift.
- `test/guardrail.test.mjs` is a single large test file with broad coverage; useful for stability but hard to navigate and slice.
- `action/entrypoint.mjs` and `action/dist/*` must stay in lockstep; this is an intentional maintenance cost enforced by CI.
- `src/checker.mjs` is rule-dense and line-number sensitive; changes need focused regression tests.
- Removed/reduced in working tree:
  - duplicated workspace path containment logic in `report.mjs` by introducing `src/workspace-path.mjs`
  - insecure artifact writer behavior in `ci-output.mjs`
  - unsafe debug token output path in `index.mjs`
  - stale Node 20 action metadata/runtime warnings
  - stale GitHub Action toolkit dependency versions in `action/package.json`
  - stale README GitHub Actions examples using older workflow action majors
  - README GitHub Actions examples now also show `persist-credentials: false`
    to match the hardened workflow policy
  - drift risk in `scripts/check-docs-sync.mjs`; it now validates the hardened
    README/workflow/action metadata invariants instead of only rule-count sync
  - generated action bundle trailing whitespace after the toolkit bump
  - duplicated private-host SSRF logic in `links.mjs` by introducing
    `src/network-guard.mjs`
  - GitHub Action token argv exposure by using child-process environment
    forwarding for `doclify-token`
- Do not remove yet:
  - committed `action/dist/*`; CI intentionally verifies bundle parity for marketplace/action consumers
  - reliability corpus baselines; they are the only broad regression harness
  - `test/guardrail.test.mjs`; split it later after release stabilization, not during a security patch
- Introduce next:
  - a small `src/cli-debug.mjs` or `src/secrets.mjs` if redaction grows beyond current helper
  - a dedicated `src/artifact-output.mjs` only if more output formats are added
  - config docs/examples for "advisory vs blocking" link checks

## Release And Repo Hygiene

- Remote branches currently visible: `main` and `fase0/sicurezza-e-bugfix`.
- Remote tags currently visible: `v1`, `v1.7.2`, `v1.7.3`.
- Remote CI currently green on `main` commit `89a4b1e` for `Docs Check`,
  push `Reliability Gate`, and the 2026-06-09 scheduled `Reliability Gate`.
- Npm release readiness note from audit: local package version is `1.7.4`, while
  latest published npm version is reported as `1.7.2`. Publish will be a real
  version release and should wait for green CI and changelog confirmation.
- `npm view doclify-guardrail version versions --json` confirmed latest published npm version is `1.7.2`; local package is ahead at `1.7.4`.
- `npm outdated --all` in `action/` shows one intentionally held direct
  dependency: `@vercel/ncc`, whose latest `0.44.0` was published on
  2026-06-09 and is held by the 14-day freshness rule. Some transitive
  dependencies remain below latest by their parents' semver ranges, with
  `npm audit --omit=dev` still at 0 vulnerabilities.
- Since `v1.7.3` already exists as a git tag and the current working tree adds
  more security/CI changes, the local release metadata is now prepared as
  `1.7.4`; the public tag `v1.7.4` still must be created only after push and
  green CI.
- Required external actions still pending explicit approval:
  - delete remote branch `fase0/sicurezza-e-bugfix`
  - create/push new version tag
  - publish to npm

## Completion Audit

- Analysis initial + durable notes: locally complete. Evidence:
  `PROJECT_STABILIZATION.md` exists and passes Doclify strict mode.
- Test project: locally complete. Evidence: full test suite, docs sync, README
  strict scan, deterministic reliability, action dist smoke tests and tarball
  install smoke test passed for `1.7.4`.
- Identify problems and improvements: locally complete. Evidence: Important
  Findings, Security Notes, Cleanup Candidates, User Pain Points Research and
  Phased Plan sections in this file.
- Security and dependency verification: locally complete. Evidence: root has no
  runtime dependencies, action audit has 0 vulnerabilities, action direct
  dependencies are current, release metadata audit passes, and path/token/API URL
  hardening plus network-guard tests are in `test/guardrail.test.mjs`.
- Remove low-quality code where appropriate: locally complete for release scope.
  Evidence: duplicated workspace containment logic was centralized, unsafe
  artifact writes were hardened, generated action bundle whitespace is
  deterministic, and stale CI/action dependencies were updated.
- Stable repo on `main`: complete for the pushed stabilization commit
  `89a4b1e`; latest push and scheduled CI are green.
- Zero remote branches beyond `main`: pending external destructive approval.
  Current remote still has `fase0/sicurezza-e-bugfix`.
- New version tag: pending external approval. Local metadata is `1.7.4`;
  remote tag `v1.7.4` does not exist yet. Major tag `v1` also still points at
  the old release commit and should be updated only if Lorenzo approves moving
  that public tag.
- Npm publish: intentionally pending until Lorenzo is ready; latest published
  npm version remains `1.7.2`.

## External Action Runbook

Run only after explicit approval from Lorenzo.

- Staging checklist for the current follow-up diff:
  - `.github/workflows/docs-check.yml`
  - `.github/workflows/reliability-gate.yml`
  - `CHANGELOG.md`
  - `README.md`
  - `PROJECT_STABILIZATION.md`
  - `scripts/check-docs-sync.mjs`
  - `src/report.mjs`
  - `src/markdown-escape.mjs`
  - `test/guardrail.test.mjs`
  - `action/pr-comment.mjs`
  - `action/dist/index.mjs`
  - `action/dist/licenses.txt`
- Suggested commit message:
  - `chore: polish release docs and report output`
- Commit intent:
  - simpler and complete release documentation for all public entrypoints
  - Markdown escaping for report and PR comment output
  - stable `setup-node@v6.4.0` workflow examples and docs-sync invariants
  - updated action bundle and regression coverage
- Final local pre-push check if the diff has changed:
  - `npm test`
  - `npm run docs:sync-check`
  - `(cd action && npm ci --no-audit --no-fund --ignore-scripts && npm run build && npm audit --omit=dev)`
  - `(cd action && before=$(shasum -a 256 dist/index.mjs dist/licenses.txt); npm run build >/tmp/doclify-action-build.log && after=$(shasum -a 256 dist/index.mjs dist/licenses.txt); test "$before" = "$after")`
  - `npm run reliability:pr`
  - `npm pack --dry-run --json`
  - tarball install smoke test in a temp directory
- Commit and push:
  - review `git status --short`
  - `git add ...`
  - `git commit -m "chore: polish release docs and report output"`
  - `git push origin main`
- CI gate:
  - confirm pushed `Docs Check` is green
  - confirm pushed `Reliability Gate` deterministic job is green
  - confirm GitHub-hosted action execution accepts `runs.using: node24`
  - scheduled live-network job may remain advisory because external links can
    time out
- Remote branch cleanup:
  - `git push origin --delete fase0/sicurezza-e-bugfix`
  - confirm `git ls-remote --heads origin` shows only `main`
- Tag:
  - create `v1.7.4` only after pushed CI is green
  - `git tag v1.7.4`
  - `git push origin v1.7.4`
  - decide whether to move the public major tag `v1` to the same commit for
    GitHub Action users of `action@v1`
  - if approved, update `v1` with an annotated tag and push it only after
    explaining that this moves a public release pointer
- Publish later:
  - verify npm account, 2FA, and provenance expectations manually
  - publish from clean `main` only after explicit `npm publish` approval

If Git is configured to auto-sign commits or tags, stop before committing or
tagging and confirm the signature/responsibility implications with Lorenzo.

## Phased Plan For Next Version

### Phase 0 - Stabilization Evidence

Status: done locally in this working tree.

- Keep `PROJECT_STABILIZATION.md` as the durable context ledger.
- Confirm local/remote branches and tags.
- Run local CI-equivalent checks.
- Audit package contents and dependency chain.
- Record live-network CI failure as a flaky external-link gate, not a parser regression.

### Phase 1 - Security And CI Patch Release

Target version: `1.7.4` patch release.

Status: local release metadata prepared and locally verified, tag not created.

- Keep current security fixes:
  - workspace-contained report/JUnit/SARIF/badge writes
  - HTTPS-only Cloud API URL except localhost local testing, plus private-host
    rejection for HTTPS/resolved Cloud API targets and guarded Cloud API
    connection lookups
  - remote link private-host checks at connection lookup time
  - GitHub Action token forwarding through environment instead of argv
  - debug token redaction
  - SVG label escaping
  - least-privilege workflow permissions and non-persisted checkout credentials
- Keep CI changes:
  - action metadata `node24`
  - official workflow actions updated to stable Node-24-era major tags
  - action toolkit dependencies updated and bundle regenerated
  - action build post-process for deterministic whitespace-clean bundled output
  - deterministic reliability blocking, live-network reliability advisory
  - docs sync script validates hardening invariants for README, workflows and
    action metadata
- Current pre-push checks are passing locally. Before commit/push, re-run if the
  diff changes:
  - run `npm test`
  - run `npm run docs:sync-check`
  - run YAML syntax validation for `.github/workflows/*.yml` and
    `action/action.yml`
  - run action checks:
    - `npm ci --no-audit --no-fund --ignore-scripts`
    - `npm run build`
    - `npm audit --omit=dev`
    - rerun `npm run build` and confirm it does not change the existing `dist`
      diff further
  - run `npm run reliability:pr`
  - run `npm pack --dry-run`
- `package.json`, `action/package.json`, `action/package-lock.json`, and
  `CHANGELOG.md` are locally prepared for `1.7.4`.
- Commit/push was approved by Lorenzo on 2026-06-08 and completed on `main`.
  Tags, npm publish, and remote branch deletion still require separate explicit
  approval.

### Phase 2 - Repo Hygiene Before Npm

- Delete remote branch `fase0/sicurezza-e-bugfix` after explicit approval.
- Confirm only `main` remains with `git ls-remote --heads origin`.
- Confirm latest GitHub `Docs Check` and push-triggered `Reliability Gate` are green after push.
- Re-check npm package contents with `npm pack --dry-run --json`.
- Confirm no generated ignored files are accidentally staged.
- Create and push tag `v1.7.4` only after the pushed commit is green and Lorenzo approves tagging.

### Phase 3 - Product Improvements From Pain Points

- Improve false-positive ergonomics:
  - clearer rule messages with "why this matters" and "how to suppress"
  - example config for docs folders that intentionally violate style rules
  - optional `--explain <rule>` command
- Improve stale-doc/drift value:
  - make freshness dates easier to configure by folder
  - add a docs-drift report section that maps changed code/config to affected docs
  - keep AI/cloud features opt-in and safe by default
- Improve link checking:
  - separate local links, anchors and external HTTP into clearly different result classes
  - support advisory external link mode in CLI/config, not only workflow policy
  - add better timeout summaries so users know whether a failure is product/docs or internet flake
- Improve maintainability:
  - split `src/index.mjs` into command parsing, scan orchestration and command handlers
  - split `test/guardrail.test.mjs` into CLI, rules, links, cloud/action and reliability files

### Phase 4 - Publish Preparation

- Verify npm account 2FA/provenance settings manually before publish.
- Local tarball install smoke test is already passing; run a clean clone smoke
  test after push if time allows.
- Run `npm pack --dry-run --json` and inspect packed files.
- Prepare release notes from `CHANGELOG.md`.
- Publish from a clean `main` checkout when Lorenzo is at home and explicitly approves `npm publish`.

### Phase 5 - Post-Publish

- Verify `npm view doclify-guardrail version` returns the new version.
- Install from npm in a temp directory and run:
  - `npx doclify-guardrail --version`
  - `npx doclify-guardrail README.md --strict`
- Confirm GitHub tag and npm version match.
- Update this file or archive it into release notes after the release is complete.
