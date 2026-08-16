# External validation protocol

Status: `AWAITING_REAL_USERS`

This protocol defines the evidence required before Doclify Guardrail makes an
adoption or workflow-replacement claim. Passing repository tests, scanning
maintainer-owned repositories, npm downloads, and GitHub activity are not user
validation. The repository currently contains no qualifying participant
results.

## Phase A controlled precision evidence

The Phase A candidate was evaluated on 300 independently frozen, repository-derived
cases: 30 controlled contradictions and 30 valid or ambiguous negatives for each blocking
rule. Static facts came from fixed commits and blobs in 20 public repositories; cases were
recreated without copying repository prose or executing repository commands. Labels and
fixtures were frozen before the candidate ran in an offline, read-only Docker profile, and
all source checkouts remained unchanged.

| Rule | Positive | Negative | TP | FP | FN | Precision | Source repositories |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `local-link` | 30 | 30 | 30 | 0 | 0 | 100% | 10 |
| `package-script` | 30 | 30 | 30 | 0 | 0 | 100% | 10 |
| `workspace-package` | 30 | 30 | 30 | 0 | 0 | 100% | 10 |
| `make-target` | 30 | 30 | 30 | 0 | 0 | 100% | 10 |
| `cli-contract` | 30 | 30 | 30 | 0 | 0 | 100% | Not applicable; public grammar permutations |

All 150 positive cases had a paired repair that returned a clean result. The source set
covered public JavaScript/TypeScript monorepos and Make-based projects, including Apollo
Client, Redux Toolkit, Cypress, AWS SDK for JavaScript, Firebase, Socket.IO, Lerna, Gatsby,
Parcel, Redwood, Linux, FFmpeg, Neovim, Vim, Terraform, Prometheus, Grafana, Podman, Docker
CLI, and GitHub CLI.

This is controlled technical evidence for the declared static grammar, not an estimate of
precision on arbitrary prose or organic findings. It does not establish adoption, workflow
replacement, or user value. Those claims remain blocked on the real-user protocol below.

## Questions

The study must answer:

1. Can a developer adopt the stable package in less than five minutes?
2. Do blocking findings remain precise on repositories not used to build the
   rules?
3. Does Doclify replace or improve a named review step?
4. Do maintainers keep the check enabled after using it on real changes?
5. Which supported contradictions does Doclify miss?

## Participants and consent

Recruit five developers who already use coding agents and maintain repositories
with Markdown or MDX instructions. Before each session:

1. explain what will be recorded and obtain explicit consent;
2. assign an anonymous identifier such as `P01`;
3. record the manual check or existing toolchain step Doclify may replace;
4. confirm that no repository content, path, organization name, credential, or
   personal data will be copied into public evidence.

Participation is voluntary. Do not enable telemetry. A participant may stop or
withdraw a session at any time. If they withhold an individual finding, omit
the whole session from aggregate finding rates rather than biasing the result.

## Real-change observation

Across the participants, observe at least 20 real change sets, with at least two
completed by each participant. Each participant uses an immutable stable package
or commit reference and records it in private session notes.

Record privately:

- anonymous participant identifier;
- broad repository category;
- package or commit reference and Node version;
- start time and time of the first useful result;
- local change identifier;
- selected command and whether the scan was complete;
- every reviewed finding as `accepted` or `rejected`;
- every relevant supported contradiction found by the participant or baseline
  process but missed by Doclify;
- whether the named baseline step changed after repeated use;
- whether the repository still uses Doclify after two weeks;
- defects and uncertainty in the participant's own words.

`accepted` means the finding led to a documentation or repository correction.
`rejected` means the participant reviewed it and found it non-actionable.
A `miss` must name the supported rule family and the static evidence Doclify
could have used.

Measure time to first useful result from the first Doclify command to the first
completed scan that either causes an accepted correction or is explicitly
judged useful by the participant.

## Controlled challenge set

Organic high-signal findings may be rare. Do not manufacture a noisy adoption
rate by requiring many real mistakes. Evaluate precision and recall separately
with at least 30 expected contradictions and 30 valid or ambiguous negative
cases per blocking rule. Derive and independently recreate cases from at least
10 relevant repositories where the rule applies, using disposable copies or
synthetic fixtures.

The challenge set must:

- include positive, negative, and ambiguous cases for each blocking rule;
- remain separate from development fixtures;
- use repository copies or synthetic fixtures, never participant worktrees;
- contain no private text, names, paths, URLs, history, or metadata;
- record true positives, false positives, and false negatives per rule;
- include repairs that return the same fixture to a clean result.

A case used to design a rule cannot also be described as independent holdout
evidence.

## Public aggregate

Publish only aggregate counts and independently recreated fixtures.

| Measure | Required gate |
| --- | --- |
| Participants | 5 completing at least two real change sets each |
| Real change sets | at least 20 total |
| Median time to first useful result | less than 5 minutes |
| Independent challenge cases | at least 30 positive and 30 valid/ambiguous negative cases per blocking rule |
| Repository sources for recreated cases | at least 10 where applicable |
| Observed blocking precision | at least 95% per rule, with TP/FP/FN and denominator |
| Repositories retaining the check after two weeks | at least 3 |
| Participants reporting an improved or replaced named step | at least 3 |
| Private repository data in public fixtures | 0 |

Calculate actionable rate as `accepted / (accepted + rejected)` and show the
participant count and denominator. Report misses separately. Clean scans and
unsupported prose are not true negatives unless the protocol defined the
claim family before evaluation.

## Defect handling

Turn a reproducible defect into a public fixture only after recreating the
smallest equivalent case from scratch. Link the anonymous defect class to a
normal bug report. Do not patch a participant repository as part of evidence
collection and do not broaden an active fix with unrelated findings.

Before committing an aggregate, review it for accidental disclosure and obtain
participant approval for any quotation. Keep private notes outside this
repository.

## Decision

After the study, record one decision:

- `go`: the gate passes and repeated use supports the current direction;
- `revise`: a narrower user, rule set, or workflow may pass after another study;
- `stop`: Doclify does not replace a real check or cannot remain precise without
  disproportionate configuration.

If a threshold fails, publish the observed denominator and leave the validation
status open. Do not reinterpret local QA, package downloads, or a release as
adoption evidence.
