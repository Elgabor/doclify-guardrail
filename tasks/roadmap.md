# Doclify Painpoint-Driven Implementation Roadmap

This document is an execution artifact, not a vision memo. It is grounded in the repository state verified on March 11, 2026, and it is optimized for one ICP first: open-source maintainers who own docs quality in active repositories, with a delivery team of 3-5 engineers.

## Current Product Reality

Doclify is technically stronger than its public footprint suggests, but its external signals do not yet earn market trust. The local workspace is at `1.7.1` (`package.json`), npm is at `1.7.0`, and GitHub latest release is still `v1.6.0` (published 2026-03-06). This release-channel split is not cosmetic: maintainers treat release coherence as a reliability proxy before they add anything to CI.

The core is real software, not a toy script. `src/index.mjs` is a 1,927-line orchestrator with scan, diff/staged, watch, fix, trend, reports, GitHub-facing outputs, auth, and cloud AI commands. `src/checker.mjs` is a 986-line regex-first engine with 35 built-in rules and inline suppression controls. Rule execution is deliberately split: core static checks run in `checker.mjs`, then opt-in post-passes run for dead links (`src/links.mjs`), freshness (`src/quality.mjs`), and drift (`src/drift.mjs`). The score formula is explicit and deterministic: `score = clamp(round(100 - errors*20 - (5*sqrt(warnings) + warnings*2)), 0, 100)`.

Reliability discipline is better than what most early-stage CLIs ship. The test suite passes at `235/235`. There is a corpus runner, deterministic and network baselines, waiver expiry policy, and threshold files (`bench/`, `scripts/run-corpus.mjs`, `docs/reliability-gate.md`). There is even a doc-sync guardrail (`scripts/check-docs-sync.mjs`) that prevents README/docs drift on rule count and action references.

Now the hard truth: distribution is weak and lags product quality. Doclify currently sits at 1 GitHub star and about 240 npm downloads/week. In the same week range, markdownlint is about 1.77M downloads/week, remark-lint about 324k, textlint about 105k, alex about 38k, markdown-it above 20M. This is not a quality gap only; it is an ecosystem and trust gap. Competitors own editor pathways, pre-commit pathways, and plugin pathways. Doclify currently owns none of these as a first-class surface.

Market signals are consistent across the required comparator set. markdownlint wins on distribution surface (CLI variants, action, editor integrations). remark-lint and textlint win on AST/plugin maturity and long-tail ecosystem breadth. Vale wins on prose intelligence positioning and broad editor/platform integration while keeping an OSS CLI core. alex has a narrower scope but still owns a clear inclusive-language niche, with long-running issue pressure around internationalization. markdown-it dominates as parser infrastructure with an enormous plugin ecosystem, not as a docs quality gate. lychee owns the specialized link-checking niche, with issue traffic concentrated on path/base-url UX, fragment handling, and high-volume performance/caching behavior. Also, "zero dependency" is true for the CLI package surface, but not for the full product envelope: the GitHub Action is a separate Node package with `@actions/core` and `@actions/github`. This is fine technically, but messaging must stop collapsing CLI constraints and distribution constraints into the same claim.

## Painpoint Map

### 1) False-positive trust

User Pain: maintainers stop using a linter after two or three incorrect high-friction findings, because review time is scarcer than tooling time.

Code/System Cause: the rule engine is regex-heavy and line-oriented; advanced intent rules (`duplicate-section-intent`, anchor heuristics, link title consistency) are useful but can drift on edge Markdown dialects and mixed-content docs. The project has no public false-positive taxonomy yet.

Business Impact: one false positive in CI has a direct cost, but repeated false positives create silent churn and uninstall.

Why It Blocks Growth: trust is a prerequisite for distribution. If maintainers do not trust findings, they do not wire the tool into pre-commit or required checks, so network effects never start.

### 2) Setup friction

User Pain: initial setup asks users to choose from many flags and semantics (`strict`, `min-score`, link/freshness/drift, multiple outputs, config chain) before they have seen first value.

Code/System Cause: `index.mjs` exposes a broad surface fast, but no opinionated setup profiles tied to maintainer jobs.

Business Impact: time-to-first-value stays high; trial users do one run and leave.

Why It Blocks Growth: tools that win in OSS maintainer workflows typically offer one obvious path to "safe default in CI in 10 minutes."

### 3) Weak local feedback loop

User Pain: maintainers need actionable feedback before pushing, not only in CI logs.

Code/System Cause: watch mode exists, but there is no official editor integration and no maintained pre-commit package owned by Doclify. Incremental cache semantics for routine local re-runs are not a first-class contract yet.

Business Impact: low rerun frequency locally, high late-cycle CI failures, and slower habit formation.

Why It Blocks Growth: without local loop ownership, adoption depends on policy enforcement, not developer pull.

### 4) Lack of extensibility

User Pain: teams need custom policy beyond built-ins, but regex-only JSON custom rules are not enough for structural or AST-aware checks.

Code/System Cause: custom rules are loaded from static regex definitions (`src/rules-loader.mjs`) with no plugin runtime contract, no lifecycle hooks, and no stable semver story for third-party rule authors.

Business Impact: advanced teams migrate to ecosystems with plugin contracts (remark/textlint) once requirements evolve.

Why It Blocks Growth: no extensibility means Doclify can only win in narrow policy domains, and narrow domains do not compound adoption.

### 5) No clear editor/pre-commit ownership

User Pain: maintainers need one canonical "how we run this in PR and local hooks" package that is maintained by the same project.

Code/System Cause: README has examples, but no official `pre-commit` hook repo, no language-server bridge, and no editor extension path.

Business Impact: fragmented setup quality, higher support burden, lower repeatability across repos.

Why It Blocks Growth: distribution channels are products, not docs snippets.

### 6) Weak release/public trust signals

User Pain: users cannot quickly infer what version is safe and current.

Code/System Cause: local tags include `v1.7.0` and `v1.7.1`, npm has `1.7.0`, GitHub release stream stops at `v1.6.0`.

Business Impact: friction for enterprise and cautious OSS maintainers; slower CI pinning.

Why It Blocks Growth: trust decay at install time reduces adoption before technical evaluation starts.

### 7) Unclear paid value boundary

User Pain: users need to understand what stays free forever and what value is worth paying for.

Code/System Cause: AI command namespace exists, but major paid-intent commands are still placeholders (`ai fix`, `ai prioritize`, `ai coverage`), and packaging is not explicit yet.

Business Impact: no conversion path, only speculative interest.

Why It Blocks Growth: unclear boundary creates both OSS skepticism and low buyer urgency.

## Phase 0 (0-4 weeks): Trust and Product Integrity

### Painpoint

Release incoherence and false-positive trust debt are blocking adoption before feature depth is even evaluated.

### Implementation Streams

Stream A is release synchronization policy and automation: every shipped version must publish coherently to tag, GitHub release, npm, and action tag within 24 hours, with a single release manifest artifact. Stream B is reliability signal publication: publish deterministic/nightly benchmark report cards from `bench/out` in every release note. Stream C is finder-level false-positive triage: classify each false-positive issue by rule, dialect, and repro pattern, then ship weekly precision patches against the top two noisy rules. Stream D is CLI surface simplification planning: introduce profile-driven presets (`maintainer-safe`, `strict-ci`, `link-heavy`) while preserving current flags as compatibility aliases.

### Effort

About 18-22 engineer-weeks. Most work is tooling, release pipeline hardening, and triage instrumentation, not deep parser work.

### Dependencies

No external dependencies are required; this phase depends on internal release ownership and issue labeling discipline.

### Technical Risk

Low to medium. The main risk is underestimating triage throughput for noisy rule categories.

### Adoption KPI

Release coherence reaches 100% for all new versions (local tag = npm = GitHub release within 24 hours). First-pass success rate for new repos (scan completes with understandable, actionable output in first run) reaches at least 75%. False-positive-labeled issue share drops by at least 40% from the baseline measured in week 1.

### Conversion KPI

At least 8% of weekly active repositories opt into cloud-auth setup (`login` or token-based run) even before paid activation, proving trust in cloud path readiness.

### Gating Criteria

Phase 1 only starts when release coherence is stable for two consecutive releases and false-positive issue share is trending down for three consecutive weeks.

### Phase 0 Task Backlog and Definition of Done

| Task | Work | Definition of Done |
|---|---|---|
| P0-T1 Release Sync Pipeline | Build a single release pipeline that checks and publishes version coherence across git tag, npm package, GitHub release, and Action tag. | A release job fails on any version mismatch and produces one signed release manifest artifact; two consecutive releases pass with full coherence. |
| P0-T2 Release Channel Reconciliation | Align lagging public channels to current shipped state, including missing release artifacts and release notes. | `v1.7.0` and `v1.7.1` are visible and complete on GitHub releases, npm and docs reference the same current stable version, and release checklist is automated. |
| P0-T3 Reliability Signal Publication | Turn `bench/out` outputs into release-facing reliability reports with deterministic and network trend summaries. | Each release note includes benchmark snapshot links and pass/fail thresholds; report generation is CI-driven and reproducible from one command. |
| P0-T4 False-Positive Triage Loop | Add issue template labels and taxonomy (`rule_id`, `dialect`, `repro`, `severity`) and weekly triage cadence. | 95% of new trust issues are triaged within 72 hours and linked to a reproducible fixture or an explicit “not reproducible” outcome. |
| P0-T5 Precision Rule Hardening | Patch the two noisiest rules weekly based on triage data and add regression fixtures. | False-positive issue share drops at least 40% from baseline and each patched rule has at least one new failing-then-passing fixture in test suite. |
| P0-T6 CLI Profile Plan | Define profile-based onboarding (`maintainer-safe`, `strict-ci`, `link-heavy`) with compatibility mapping to existing flags. | Profile spec is published, CLI compatibility tests pass with old flags unchanged, and one experimental profile can run end-to-end behind a feature flag. |

## Phase 1 (weeks 4-10): OSS Maintainer Adoption Loop

### Painpoint

Doclify is not yet embedded in the maintainer daily loop (pre-commit, review, rerun).

### Implementation Streams

Stream A is pre-commit-first distribution: ship and maintain an official pre-commit hook package and a one-command bootstrap for common docs repos. Stream B is reviewer-friendly outputs: default PR output should collapse noise and surface file-level score deltas, highest-risk findings, and direct fix suggestions; SARIF/JUnit stay machine-facing. Stream C is incremental local loop: implement content-hash cache and changed-file short-circuit for standard scan runs, with explicit invalidation rules. Stream D is templates for maintainer workflows: publish ready-to-apply templates for docs-only repos, mixed monorepos, and MDX-heavy sites.

### Effort

About 24-30 engineer-weeks, mostly in CLI UX, cache mechanics, and distribution packaging.

### Dependencies

Phase 0 trust signals must be stable. Template work depends on real sample repositories and feedback loops.

### Technical Risk

Medium. Cache invalidation mistakes can produce stale results and erode trust if contract semantics are not explicit.

### Adoption KPI

Median time-to-first-value drops below 10 minutes from install to first green CI run. Weekly active repositories reach 1,500. Local rerun frequency reaches at least 2.2 runs per active repository per week.

### Conversion KPI

At least 12% of active repositories enable one cloud-adjacent workflow (auth plus drift mode usage), creating a qualified pipeline for paid conversion in Phase 3.

### Gating Criteria

Phase 2 starts only when weekly active repositories sustain above 1,500 for four consecutive weeks and cache correctness regression rate is below 0.5%.

### Phase 1 Task Backlog and Definition of Done

| Task | Work | Definition of Done |
|---|---|---|
| P1-T1 Official Pre-commit Distribution | Ship and maintain an official pre-commit integration package owned by Doclify with versioned docs and examples. | Maintainers can enable Doclify in pre-commit with one copy-paste snippet; integration tests validate staged-file behavior across Linux/macOS. |
| P1-T2 Maintainer Bootstrap Command | Add guided setup command for docs repos (config, CI template, recommended defaults). | A new repo reaches first successful CI run in under 10 minutes median in internal dogfooding trials. |
| P1-T3 Reviewer-Friendly Output Mode | Introduce review-focused output showing file score deltas, high-risk findings first, and direct fix pointers. | PR comment/action output is reduced in noise by measured line count while preserving all blocking findings; maintainer usability score improves in feedback survey. |
| P1-T4 Incremental Cache Engine | Implement content-hash cache and changed-file short-circuit for local reruns with explicit invalidation rules. | Cache hit/miss metrics are exposed in JSON output, correctness regression stays below 0.5%, and rerun wall time improves by at least 35% on benchmark repos. |
| P1-T5 Workflow Templates | Publish templates for docs-only, monorepo, and MDX-heavy setups with tested CI snippets. | Three template paths are documented and verified by CI smoke tests on reference repositories. |
| P1-T6 Adoption Telemetry Baseline | Instrument time-to-first-value, weekly active repos, and rerun frequency without collecting content payloads. | KPI dashboards update daily, include data-quality checks, and support phase gate decisions without manual spreadsheet work. |

## Phase 2 (weeks 10-18): Extensibility That Actually Scales

### Painpoint

Regex-only customization caps product depth and pushes advanced teams to other ecosystems.

### Implementation Streams

Stream A is plugin interface v1 design: stable runtime hooks, metadata, severity contracts, and deterministic execution order. Stream B is AST-backed execution path introduction: keep regex path for speed and compatibility, but add parser-backed rule contexts for structure-aware checks and MDX-safe behavior. Stream C is versioned rule/runtime contracts: semver policy for plugin API, rule capabilities, and deprecation windows. Stream D is migration bridge: existing JSON regex rules continue to run, but can be wrapped as plugin adapters to avoid ecosystem breakage.

### Effort

About 34-42 engineer-weeks, because this phase touches architecture, compatibility, and long-term ecosystem contracts.

### Dependencies

Requires stable cache semantics and output schema discipline from Phase 1, plus robust fixture coverage for MD/MDX variants.

### Technical Risk

High. Parser selection and AST abstraction mistakes can overcomplicate the core or degrade performance if not constrained.

### Adoption KPI

At least 20 externally maintained plugin/rule packs published or migrated to plugin API v1, with at least 25% of active repositories using one custom plugin.

### Conversion KPI

Cloud conversion-qualified repositories (repos with plugin usage plus drift usage) reach 400, proving that advanced workflows correlate with willingness to pay.

### Gating Criteria

Phase 3 starts only when plugin API v1 is documented, compatibility tests cover old regex rules, and performance budget regression stays under 15% on deterministic corpus p95.

### Phase 2 Task Backlog and Definition of Done

| Task | Work | Definition of Done |
|---|---|---|
| P2-T1 Plugin API v1 Spec | Define plugin lifecycle hooks, rule metadata schema, severity contract, and deterministic execution order. | API spec is versioned, published, and accompanied by a reference plugin and contract tests. |
| P2-T2 Plugin Runtime Loader | Build runtime loader with isolation guards (timeouts, controlled capabilities, deterministic ordering). | Loader runs reference plugins deterministically, enforces timeout limits, and surfaces machine-readable plugin failure reasons. |
| P2-T3 AST Execution Path | Introduce parser-backed rule context while preserving current regex path for compatibility and speed. | At least three built-in rules run on AST path behind feature flag with parity tests and p95 performance regression under 15%. |
| P2-T4 Legacy Rule Adapter | Provide adapter to run current JSON regex custom rules through plugin runtime without breaking users. | Existing custom rule files execute unchanged in compatibility mode and migration warnings are explicit and suppressible. |
| P2-T5 Contract Versioning Policy | Define semver and deprecation windows for plugin runtime, output schema, and rule capability flags. | Version policy is documented, enforced in CI checks, and every breaking change proposal requires migration notes. |
| P2-T6 Ecosystem Starter Kits | Publish plugin author templates, fixtures, and CI recipes to reduce third-party onboarding friction. | At least five external maintainers publish compatible plugins using starter kit within phase window. |

## Phase 3 (weeks 18-26): Paid Conversion Layer

### Painpoint

Without a hard free-vs-paid boundary, pricing feels arbitrary and adoption trust collapses.

### Implementation Streams

Stream A is strict boundary enforcement: OSS core remains free forever for scan/fix/rules/output/CI surfaces; paid scope is cloud intelligence only. Stream B is paid intelligence features: repository memory over time, guided fix workflows ranked by acceptance likelihood, and drift prioritization tied to historical breakage patterns. Stream C is packaging and billing: maintainer plan per repo/month with included run quota and transparent overage; team plan per organization with shared quotas, policy controls, and audit trails. Stream D is conversion telemetry: instrument the OSS-to-paid funnel at workflow boundaries, not marketing events.

### Effort

About 30-38 engineer-weeks across cloud APIs, billing integration, workflow UX, and governance controls.

### Dependencies

Needs plugin/runtime contracts from Phase 2 and durable auth/session model already present in the CLI.

### Technical Risk

Medium to high. The biggest risk is building paid features that feel like optional dashboards instead of daily maintainer leverage.

### Adoption KPI

Cloud-active repositories reach 2,000, with weekly guided-fix workflow usage above 30% among cloud-active maintainers.

### Conversion KPI

Paid conversion reaches 6-9% of cloud-active repositories within 90 days. Target pricing starts at approximately EUR 24/repo/month for maintainers (2,500 cloud runs included, then usage overage) and EUR 129/org/month entry for teams with pooled quotas.

### Gating Criteria

Phase 4 starts only if paid churn at day 90 stays below 5% and at least 35% of paid users accept one guided fix recommendation per month.

### Phase 3 Task Backlog and Definition of Done

| Task | Work | Definition of Done |
|---|---|---|
| P3-T1 Free vs Paid Boundary Enforcement | Encode and document immutable boundary: OSS local guardrails free, cloud intelligence paid. | Pricing page, README, and CLI help are consistent; no free feature is silently moved to paid scope without a published migration policy. |
| P3-T2 Repository Memory Service | Implement cloud-backed repository memory (accepted fixes, drift history, policy memory) with export support. | Memory APIs are live, export endpoint works, and data retention/security controls are documented and tested. |
| P3-T3 Guided Fix Workflow | Build ranked fix recommendations tied to prior acceptance patterns and maintainer review flow. | Users can request prioritized fix plans, apply recommendations, and acceptance telemetry is captured end-to-end. |
| P3-T4 Drift Prioritization Intelligence | Add cloud ranking model that prioritizes likely-doc-drift findings by impact and confidence. | Cloud drift output shows ranked rationale with confidence, and high-risk precision beats offline baseline on validation set. |
| P3-T5 Billing, Quotas, and Metering | Implement per-repo and per-org packaging, included run quotas, overage metering, and billing events. | Plans can be subscribed, usage is metered correctly in reconciliation tests, quota exhaustion behavior is explicit and non-destructive. |
| P3-T6 Conversion Funnel Instrumentation | Track OSS-to-cloud-to-paid journey through product events, not marketing-only events. | Funnel dashboard exposes activation, trial-to-paid, and 90-day retention with cohort views used in weekly reviews. |

## Phase 4 (6-12 months): Distribution and Defensible Moat

### Painpoint

The product can work, but without channel ownership and data compounding it remains replaceable.

### Implementation Streams

Stream A is editor and review integrations: first-party VS Code extension, pre-commit package maturity, and Git provider native review annotations. Stream B is CI ecosystem breadth: maintained integrations for GitHub, GitLab, and lightweight wrappers for common monorepo task runners. Stream C is evidence-based benchmark publication: recurring public benchmark reports against representative docs corpora with explicit false-positive precision and performance metrics. Stream D is community rule-pack ecosystem: certified rule packs, compatibility badges, and strict plugin quality gates.

### Effort

About 42-56 engineer-weeks, mostly integration and ecosystem maintenance work.

### Dependencies

Depends on stable plugin API, cloud intelligence maturity, and reliable release operations.

### Technical Risk

Medium. Integration sprawl can consume capacity if certification and compatibility policy are not strict.

### Adoption KPI

Weekly active repositories exceed 8,000, with at least 40% running Doclify in both local and CI contexts.

### Conversion KPI

Paid penetration reaches 10-14% of cloud-active repositories, with expansion revenue driven by multi-repo team plans rather than one-off seats.

### Gating Criteria

This phase is considered successful only if growth is compounding without support-ticket explosion: support load per 1,000 active repos must fall quarter over quarter.

### Phase 4 Task Backlog and Definition of Done

| Task | Work | Definition of Done |
|---|---|---|
| P4-T1 VS Code Integration | Build first-party VS Code extension with diagnostics, quick-fix entry points, and profile-aware configuration. | Extension is published, supports inline diagnostics from Doclify runs, and reaches stable adoption with crash/error budget under target. |
| P4-T2 CI Ecosystem Expansion | Ship maintained integrations for GitHub and GitLab plus wrappers for common monorepo runners. | Integration guides are tested in CI matrix and installation success rate exceeds 90% in onboarding telemetry. |
| P4-T3 Public Benchmark Program | Publish recurring benchmark reports comparing precision, performance, and stability on representative corpora. | Quarterly benchmark reports are public, reproducible from tagged datasets, and include methodology and raw artifacts. |
| P4-T4 Rule-Pack Certification Program | Create compatibility/certification pipeline for community rule packs and quality badges. | Certification CI is live, badge criteria are public, and at least ten community packs are certified without manual exceptions. |
| P4-T5 Moat Data Layer | Operationalize repository memory plus accepted-fix history plus drift intelligence as compounding product substrate. | Retrieval APIs power both OSS-adjacent and paid workflows, and recommendation quality improves with longitudinal usage data. |
| P4-T6 Support Scalability System | Build support triage automation, issue taxonomy, and self-serve diagnostics for integrations/plugins. | Support load per 1,000 active repos declines quarter-over-quarter while satisfaction scores remain stable or improve. |

## Monetization Design

The boundary must be explicit and boring: static linting, scoring, fixing, reporting, and CI outputs remain open-source and free. Paid value starts only where historical intelligence matters: repository memory evolution, guided fixes ranked by prior acceptance, and drift prioritization informed by change history. The lock-in strategy is not file hostage tactics. It is workflow intelligence accumulated over time and reused every week.

Conversion path is straightforward: teams adopt free CLI in CI, enable cloud auth for drift insights, then hit usage moments where historical guidance saves review hours. At that point, paying is cheaper than continued manual triage.

To keep prioritization honest, backlog ordering must combine user pain, adoption leverage, and conversion leverage under engineering cost:

```text
priority_score = ((pain_severity * affected_repos) + (adoption_lift * 2) + (conversion_lift * 3) - trust_risk) / engineer_weeks
ship_if(priority_score >= threshold && false_positive_risk <= max_risk)
```

### Planned Public Interfaces

| Interface | Contract Intent | Status |
|---|---|---|
| Plugin API v1 | Deterministic rule hooks with semver guarantees and compatibility tests | planned |
| Output schema versioning policy | Additive-only changes inside a major schema, explicit migration notes on major bumps | planned |
| Cache behavior contract | Defined invalidation keys, TTL semantics, and correctness guarantees | planned |
| Cloud feature boundary | Formal split between free local guardrails and paid cloud intelligence endpoints | planned |

## Execution Model (3-5 engineers)

This roadmap assumes one small team with hard focus discipline, not a platform org. A 3-engineer baseline can run with one runtime owner (scanner/checker/fixer), one ecosystem owner (distribution/integrations/release), and one cloud owner (auth/AI/billing). A 5-engineer variant adds a dedicated plugin-runtime owner and a dedicated growth instrumentation owner.

Delivery cadence should be two-week iterations with one explicit gate review at the end of each phase. Work-in-progress must stay capped: at most one major architectural stream and one distribution stream in flight at the same time. If a stream misses its KPI gate, the next phase does not start. The goal is compounding reliability and adoption, not parallel feature theater.

## The Honest Assessment

Doclify is not early because of missing functionality. It is early because it has not converted technical depth into trusted distribution. The product already has meaningful capability: 35 built-in rules, deterministic scoring, strong test coverage, drift analysis, and CI outputs. But in this category, capability is table stakes. Winning comes from trust, low-friction workflow embedding, and ecosystem contracts others can build on.

If this roadmap is executed with discipline, Doclify can become a default docs-quality gate for OSS maintainers and then convert the most serious maintainers into paying teams through cloud intelligence. If execution drifts into feature accumulation without release coherence, false-positive reduction, and integration ownership, adoption will stall and paid conversion will remain aspirational.
