# Contributing

Doclify Guardrail is a local, read-only Markdown and MDX integrity checker.
Contributions should keep that default clear: avoid network access, hidden
writes, credential handling, and claims that cannot be reproduced from the
repository.

## Before changing code or docs

- Search existing issues first. Open one focused issue before changing behavior
  or adding a feature; a small documentation correction can go directly to a
  pull request.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md),
  never in a public issue.
- Read the relevant public contract in `README.md`, `MIGRATION.md`, and
  `action/action.yml`.
- Keep changes focused on one behavior or documentation correction. Record an
  unrelated problem separately instead of expanding the current pull request.
- For a false positive, include a minimal synthetic document, the static source
  Doclify inspected, and why the syntax is ambiguous or valid.
- Do not include credentials, private fixtures, generated local reports, or
  unrelated formatting changes.
- Use a temporary directory for repository fixtures and generated files.

## Local checks

The package keeps `engines: >=20`; Node.js 20 reached end of life on
2026-04-30 and remains accepted for compatibility. Use a maintained Node.js
22, 24, or 26 LTS release. Correctness CI covers 20.20.2, 22.23.4, 24.22.2,
and 26.13.0. Docs Check owns the Node 24 correctness, network, performance and
documentation gates; Reliability covers the other three runtimes and Node 26
network checks. Both run on pull requests and pushes to main, cancelling
superseded runs on the same ref.

The root package has no runtime dependencies. The full suite also exercises the
Action source, so install its locked dependencies without lifecycle scripts:

```sh
npm --prefix action ci --no-audit --no-fund --ignore-scripts
npm test
npm run test:network
npm run test:performance
npm run docs:sync-check
node --test .github/scripts/verify-release.test.mjs
git diff --check
npm pack --dry-run --json
```

Use the controlled local-network checks when changing network behavior. Do not
use live services or real credentials in tests.

When changing the GitHub Action source or its dependencies, install and build
from `action/`, then review the generated bundle and license file:

```sh
npm --prefix action ci --no-audit --no-fund --ignore-scripts
npm --prefix action run build
npm --prefix action audit --omit=dev
```

The committed `action/dist/` files must match the source build. A bundle
rebuild is not a release or publication.

## Release preparation

The manual `.github/workflows/release.yml` workflow is prepared for
[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).
Before dispatch, a maintainer must configure the GitHub environment `npm`
with required approval and main-only deployment protection, and the npm
Trusted Publisher for owner `Elgabor`, repository `doclify-guardrail`, workflow
filename `release.yml`, and environment `npm`, allowing `npm publish`.

Dispatch only from `main` with an existing annotated `v<major>.<minor>.<patch>`
tag. The workflow checks that its commit is an ancestor of `origin/main` and
that the package version matches the tag. Tests and pack inspection run in a
job with read-only permissions. The separate publish job rechecks the tested
commit and tag object, uses Node.js 26.13.0 with npm >=11.5.1, and has OIDC
permission only there. It requires no npm token. Preparing or merging the
workflow does not authorize dispatch or publication.

## Documentation

Public examples should describe shipped behavior only. Keep command examples
local and deterministic, and update `CHANGELOG.md` for released changes rather
than adding roadmap or adoption statements. The evidence demo in
`examples/evidence-demo/` provides a small clean and broken fixture.

## Pull requests

Open a pull request with a concise explanation of the behavior or public
contract being changed. Link the issue when one exists, include the checks you
ran, and call out known limitations. Use the repository pull request template;
release, tag, publish, and deployment actions are separate maintainer actions.
