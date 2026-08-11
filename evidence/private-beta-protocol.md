# Private beta evidence protocol

Status: `AWAITING_REAL_USERS`

This protocol defines the evidence required by task A4. It is not adoption
evidence, and the beta gate must remain open until real participants complete
the workflow. The repository currently contains no qualifying participant
results.

## Participants and consent

Recruit three to five developers who already use coding agents. Before each
session:

1. explain what will be recorded and obtain explicit consent;
2. assign an anonymous identifier such as `P01`;
3. record the manual check or existing toolchain step that Doclify may replace;
4. confirm that no repository content, path, organization name, credential, or
   personal data will be copied into the public evidence.

Participation is voluntary. Do not enable telemetry. A participant may stop or
withdraw their session at any time. If they withhold an individual finding,
omit the whole session from gate calculations rather than biasing a rate.

## Required workflow

Each participant runs the package on at least two real documentation changes.
Use an immutable package or commit reference supplied for the beta; record that
reference in the private session notes.

For each participant, record privately:

- anonymous participant identifier;
- named baseline step or toolchain check;
- repository category, using a broad label only;
- package or commit reference and Node version;
- start time and time of the first useful result;
- two change identifiers local to the study notes;
- every reviewed finding as `accepted`, `rejected`, or `missed`;
- whether Doclify replaced the named baseline step after the second change;
- defects, uncertainty, and the participant's decision in their own words.

`accepted` means the finding led to a documentation or repository correction.
`rejected` means the participant reviewed it and found it non-actionable.
`missed` means a relevant contradiction in the selected scope was found by the
participant or baseline process but not by Doclify.

Measure time to first useful result from the start of the first Doclify command
to the first completed scan that either leads to an accepted correction or is
explicitly judged to replace the named baseline step.

## Public aggregate

Only publish aggregate counts and anonymized, independently recreated fixtures.
The aggregate must state:

| Measure | Required gate |
| --- | --- |
| Participants completing two changes | at least 3 |
| Median time to first useful result | less than 5 minutes |
| Reviewed findings | at least 30 |
| Actionable findings | at least 70% |
| Participants replacing a named step | at least 3 |
| Private repository data in public fixtures | 0 |

Calculate actionable rate as `accepted / (accepted + rejected)`. Report missed
findings separately; never remove them from the record to improve the rate.
Show the participant count and denominator beside every aggregate percentage.

## Defect handling

Turn a reproducible defect into a public fixture only after recreating the
smallest equivalent case from scratch. The fixture must contain no copied text,
names, paths, URLs, package names, history, or metadata from the participant's
repository. Link the anonymous defect class to a normal issue or task; do not
patch a participant repository as part of evidence collection.

Before committing an aggregate, review it for accidental disclosure and obtain
participant approval for any quotation. Keep private notes outside this
repository. If any acceptance threshold is not met, record the observed result
and leave A4 and the beta.3 gate incomplete.
