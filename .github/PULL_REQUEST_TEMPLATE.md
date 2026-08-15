## Summary

<!-- Describe the focused behavior or public documentation change. -->

## Verification

<!-- List the exact local checks you ran and their results. Mark non-applicable checks as N/A. -->

- [ ] `npm test`
- [ ] `npm run docs:sync-check` (when docs or rule contracts changed)
- [ ] `git diff --check`

## Scope checklist

- [ ] The change keeps the default execution local, read-only, and deterministic.
- [ ] Public examples describe shipped behavior rather than roadmap or adoption claims.
- [ ] Tests and documentation were updated together when a public contract changed.
- [ ] No credentials, private fixtures, generated reports, or unrelated files are included.
- [ ] Release, tag, publish, deployment, and other external actions are not part of this PR.

## Notes

<!-- Call out compatibility concerns, limitations, or follow-up work that is already tracked. -->
