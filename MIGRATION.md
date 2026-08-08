# Doclify Guardrail v2 Migration Contract

Status: approved product decision; implementation in progress; not released

The current stable release is `doclify-guardrail@1.7.4`. This document records
the public-surface decisions for v2 so implementation can proceed without
hidden compatibility branches. It does not claim that every v2 command below
is implemented, and it does not announce an npm package or GitHub Action
release.

## Naming Decision

The v2 npm package remains `doclify-guardrail`. The canonical executable is
`doclify-guardrail`. The shorter `doclify` executable is removed in v2; users
who stay on `doclify-guardrail@1` keep both existing executables unchanged.

The exact v2 package and Action description is:

> Deterministic, local, read-only documentation integrity checks for Markdown
> repositories.

This wording intentionally makes no promise about Cloud services, generative
AI, or an affected-document review product.

### Name evidence

The technical collision check was performed on 2026-08-08. It is not a legal
or trademark clearance.

| Surface | Observed evidence | Decision |
| --- | --- | --- |
| npm `doclify-guardrail` | The registry reports `1.7.4` on `latest`. | Keep the owned package name. |
| npm `doclify` | The registry returns `404 Not Found`. | Do not claim the generic package name. |
| GitHub `Doclify` names | GitHub search returns several unrelated repositories named `Doclify`. | Keep the existing scoped repository identity. |
| PyPI `doclify` | PyPI publishes an unrelated `doclify` package with a `doclify` CLI. | Remove the short v2 executable to avoid a PATH collision. |
| `doclify.io` | An unrelated content-management product uses the name. | Do not position the product as plain `Doclify`. |

Sources: [npm package](https://registry.npmjs.org/doclify-guardrail),
[npm short-name lookup](https://registry.npmjs.org/doclify),
[GitHub repository search](https://github.com/search?q=doclify&type=repositories),
[PyPI package](https://pypi.org/project/doclify/), and
[doclify.io](https://doclify.io/).

## Compatibility Boundary

- `doclify-guardrail@1` remains on the npm `latest` dist-tag until a stable v2
  release is separately authorized and verified.
- Any v2 beta uses the npm `next` dist-tag and therefore requires an explicit
  install or upgrade.
- `Elgabor/doclify-guardrail/action@v1` remains on the v1 implementation and
  contract. It is never repointed to the v2 core.
- A future Action v2 uses a separate `@v2` line. That line does not exist yet.
- Removed v1 surfaces fail with a stable migration error when the owning v2
  task removes them. They are not silently accepted or emulated.
- The v2 result envelope uses `schemaVersion: 3`. Version 2 is already the
  public JSON schema number emitted by v1.7.4 and cannot be reused for a
  different result shape.

## Package and Executable Migration

| v1 surface | Decision | v2 destination |
| --- | --- | --- |
| npm package `doclify-guardrail` | Maintain | Same package name. |
| executable `doclify-guardrail` | Maintain | Canonical executable in examples, help, errors, and generated instructions. |
| executable `doclify` | Remove | Use `doclify-guardrail`; the v1 executable remains available only on `@1`. |
| Node.js `>=20` | Maintain | Node.js 20 remains the minimum supported runtime. |
| package export `.` | Remove | Package-root imports fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`; use the explicit API subpath. |
| package export `./api` | Migrate | Keep `doclify-guardrail/api` with the reduced v2 API below. |

After upgrading to v2, a shell invocation of `doclify` may resolve to an
unrelated executable, including the PyPI package named `doclify`, instead of
failing with `command not found`. Replace scripts and local commands with
`doclify-guardrail` before upgrading.

No package name, executable, export map, version, description, or dist-tag is
changed by this decision-only task.

## CLI Migration

### Commands and target selection

| v1 surface | Decision | v2 destination |
| --- | --- | --- |
| `doclify [files...]` or `doclify-guardrail [files...]` | Migrate | `doclify-guardrail check [paths...]` |
| no target, which scans the current directory | Maintain | `doclify-guardrail check` scans the selected workspace. |
| `--dir <path>` | Migrate | Pass the directory as a positional path to `check`. |
| `--diff` | Migrate | `doclify-guardrail changed --base <ref>` |
| `--base <ref>` | Maintain | `changed --base <ref>` |
| `--staged` | Migrate | `doclify-guardrail changed --staged` |
| stdin unsupported | Add | `check - --stdin-name <name>`; the name is required. |
| no rule explanation command | Add | `doclify-guardrail explain <rule-id>` |

`changed` discovers the Git root once from the invocation directory and runs
the selected diff there. Result paths are relative to that Git root, so the
same invocation produces the same machine result from the repository root or
one of its subdirectories, including linked worktrees. `check` paths remain
relative to its selected `cwd` workspace.

Both changed selectors include tracked added, copied, modified, and renamed
Markdown files. Rename results use only the current path. Deleted, untracked,
and ignored files are not scanned. Filename parsing is zero-delimited, so
spaces, non-ASCII text, tabs, and newlines do not change selection. Missing Git,
a non-repository directory, an unknown base ref, and other Git failures use the
stable `git-unavailable`, `not-a-git-repository`, `unknown-base-ref`, and
`git-failed` usage-error codes.

### Scan policy and configuration flags

| v1 flag | Decision | v2 destination |
| --- | --- | --- |
| `--strict` | Remove | Blocking is determined by evidence-backed severity; advisory findings do not become blocking through a global switch. |
| `--min-score <n>` | Remove | Use blocking, advisory, and operational counts; v2 has no health score. |
| `--max-line-length <n>` | Remove | Use a dedicated style linter. |
| `--config <path>` | Maintain | Explicit v2 configuration path. |
| `--rules <path>` | Remove | Regex rule plugins are not part of the v2 core; future policy work is not promised by this migration. |
| `--ignore-rules <list>` | Maintain | Explicit local rule override. |
| `--exclude <list>` | Maintain | Explicit path exclusion inside the selected workspace. |
| `--check-links` | Migrate | Local link integrity is part of the core; use `--external-links` to opt into network checks. |
| `--allow-private-links` | Remove | V2 does not expose a switch that weakens private, loopback, link-local, or metadata-address protections. |
| `--site-root <path>` | Maintain | Root for local root-relative link resolution, contained within the selected workspace. |
| `--link-allow-list <list>` | Maintain | Applies only when `--external-links` is present. |
| `--link-timeout-ms <n>` | Maintain | Applies only when `--external-links` is present. |
| `--link-concurrency <n>` | Maintain | Applies only when `--external-links` is present. |
| `--check-freshness` | Remove | Time-based freshness heuristics are not part of the v2 integrity core. |
| `--freshness-max-days <n>` | Remove | No replacement in the v2 integrity core. |
| `--check-frontmatter` | Remove | Generic frontmatter style enforcement is not part of the v2 integrity core. |
| `--check-inline-html` | Remove | Use an MDX/Markdown-aware style or security tool for this policy. |

### Writes, output, and terminal flags

| v1 flag | Decision | v2 destination |
| --- | --- | --- |
| `--fix` | Remove | No integrated document rewriting in v2. |
| `--dry-run` | Remove | No fixer to preview. |
| `--report [path]` | Remove | Markdown report generation is not part of the v2 core. |
| `--junit [path]` | Migrate | `--format junit` writes to stdout; add `--output <path>` for an explicit file write. |
| `--sarif [path]` | Migrate | `--format sarif` writes to stdout; add `--output <path>` for an explicit file write. |
| `--badge [path]` | Remove | V2 has no health score or badge. |
| `--badge-label <text>` | Remove | V2 has no badge. |
| `--json` | Migrate | `--format json` |
| `--format default` | Migrate | `--format text` |
| `--format compact` | Maintain | `--format compact` |
| no output limit flag | Add | Text and compact finding details are capped by default; `--all` shows every finding. Machine formats remain complete. |
| no common output path | Add | `--output <path>` is the only explicit report-file write. |
| `--no-color` | Maintain | Accepted for compatibility; v2 human-readable output is always color-free. |
| `--ascii` | Remove | V2 human output uses portable text without a separate ASCII mode. |
| `--debug` | Remove | Operational errors remain structured; no unbounded debug stream is part of the public contract. |
| `-h`, `--help` | Maintain | Help for the selected command. |
| `-v`, `--version` | Maintain | Print the package version. |
| `--list-rules` | Remove | V2 does not preserve rule enumeration; use `explain <rule-id>` for a known supported rule. |

### Setup, watch, score, Cloud, and AI surfaces

| v1 surface | Decision | v2 destination |
| --- | --- | --- |
| `init` | Migrate | `init --print`; it does not write. |
| `init --force` | Remove | `init --write` is the explicit write and refuses to hide an existing configuration. |
| `--watch` | Remove | Re-run `check` or `changed` from the caller's existing watch workflow. |
| `--track` | Remove | No score history in v2. |
| `--trend` | Remove | No score trend in v2. |
| `--fail-on-regression` | Remove | No score regression gate in v2. |
| `login --key <apiKey>` and its `--api-url`/`--json` flags | Remove | No Cloud login or credential store in v2. |
| `whoami` and its `--json` flag | Remove | No Cloud identity in v2. |
| `logout` | Remove | No Cloud credential store in v2. |
| `--push` | Remove | No Cloud score push in v2. |
| `--project-id <id>` | Remove | No Cloud project binding in v2. |
| `--api-url <url>` | Remove | No Cloud API in the v2 core. |
| `--token <apiKey>` | Remove | No Cloud token input in the v2 core. |
| `--ai-drift` | Remove | No Drift Guard compatibility path in the v2 core. |
| `--ai-mode <mode>` | Remove | No AI engine mode in the v2 core. |
| `--fail-on-drift <level>` | Remove | No heuristic drift gate in the v2 core. |
| `--fail-on-drift-scope <scope>` | Remove | No heuristic drift gate in the v2 core. |
| `ai drift [target]` and its `--diff`, `--staged`, `--base`, `--mode`, `--json`, `--fail-on-drift`, `--fail-on-drift-scope`, `--api-url`, and `--token` flags | Remove | No compatibility command in v2. |
| `ai memory export` and its `--json` flag | Remove | No repository memory surface in v2. |
| reserved `ai fix`, `ai prioritize`, and `ai coverage` commands | Remove | Unsupported stubs do not migrate. |

### Exit codes and output channels

| v1 surface | Decision | v2 destination |
| --- | --- | --- |
| exit `0` | Maintain | Complete scan with no blocking or operational findings. |
| exit `1` | Migrate | Blocking findings, or a partial scan whose structured result remains usable. There is no strict-mode warning gate. |
| exit `2` | Migrate | Invalid usage or configuration, or a total execution failure with no usable scan result. |
| human output on stderr | Migrate | Text and compact results move to stdout; operational diagnostics remain on stderr. |
| JSON on stdout | Maintain | Emit exactly one valid JSON document, with no human logs in that document. |
| SARIF and JUnit written to implicit or flag-specific files | Migrate | Emit exactly one valid document in the selected format on stdout unless `--output` names an explicit file. |
| operational diagnostics on stderr | Maintain | Stderr never carries a second machine result and does not alter the structured stdout document. |
| `--output <path>` | Add | Write the selected result format to that explicit path; operational diagnostics remain on stderr. |

## V2 Result Contract

The explicit `check` and `changed` command paths use one deterministic result
model. The legacy no-command v1 path continues to emit `schemaVersion: 2` until
its separately documented removal; consumers must not treat the two envelopes
as interchangeable.

The v2 envelope contains:

- `schemaVersion: 3` and the exact tool name and package version;
- `command`, `complete`, and `status`;
- stable summary counts for selected, scanned, and skipped files, blocking and
  advisory findings, operational diagnostics, and files with suppressions;
- a sorted `files` list that distinguishes scanned files, skipped files, and
  files containing suppression directives;
- one sorted, flat `findings` list with rule id, severity, confidence, path,
  position, message, and evidence;
- a separate sorted `diagnostics` list for operational failures.

`status` is `fail` when blocking findings exist, `incomplete` when no blocking
finding exists but any selected target could not be scanned, and `pass` only
when the scan is complete with no blocking finding. A skipped file reports
`findings: null`, never zero. V1 checker findings are exposed only as
`advisory`, with `confidence: unverified` and `evidence: null`, until a later
rule task supplies the precision and proof required for blocking severity.

The result arrays and every machine format are complete. Text and compact cap
finding details at 50 by default, report how many findings were omitted, and
accept `--all` to show every finding. Operational diagnostics are never
truncated. Volatile ids, timestamps, and timings are not part of the result;
JUnit has no generated timestamp.

Directory recursion does not follow symbolic links. Markdown file links are
scanned when their resolved target remains inside the selected workspace;
broken links and links outside that boundary are operational diagnostics.

The programmatic entry point is asynchronous and returns exactly the result
serialized by the CLI for the same paths and options:

```js
import { check } from 'doclify-guardrail/api';

const result = await check({
  paths: ['README.md'],
  cwd: process.cwd()
});

const changedResult = await check({
  command: 'changed',
  changed: { base: 'origin/main' },
  cwd: process.cwd()
});
```

Partial scans, including scans where every selected file is unreadable, resolve
with an incomplete result. Invalid usage or configuration and failures with no
usable target or diagnostic reject with an error carrying a stable `code`; no
second public error-class export is required.

## Programmatic API Migration

The v2 package has no package-root import. The only public programmatic entry
point is `doclify-guardrail/api`. Its `check` function returns the same
`schemaVersion: 3` result model observed by the CLI.

| v1 export | Current import | Decision | v2 destination |
| --- | --- | --- | --- |
| `lint` | `doclify-guardrail/api` | Migrate | `check`, returning the shared v2 result model. |
| `fix` | `doclify-guardrail/api` | Remove | No write API. |
| `score` | `doclify-guardrail/api` | Remove | No health score. |
| `RULE_CATALOG` | `doclify-guardrail/api` | Remove | Use the stable rule ids in results and the CLI `explain` command. |
| `checkMarkdown` | package root | Remove | Use `check` from `doclify-guardrail/api`. |
| `parseArgs` | package root | Remove | Internal CLI implementation. |
| `resolveOptions` | package root | Remove | Internal configuration implementation. |
| `resolveFileOptions` | package root | Remove | Internal configuration implementation. |
| `findParentConfigs` | package root | Remove | Internal filesystem implementation. |
| `runCli` | package root | Remove | Internal CLI implementation. |
| `buildFileResult` | package root | Remove | Internal result implementation. |
| `buildOutput` | package root | Remove | Internal result implementation. |

Removing the package-root export means `import 'doclify-guardrail'` fails in
v2. The executables are independent of the export map and remain addressable
through the package `bin` field.

## Configuration, Environment, and Generated Files

| v1 surface | Decision | v2 destination |
| --- | --- | --- |
| `.doclify-guardrail.json` | Maintain | Same configuration filename and hierarchical lookup, with deterministic repository-contained resolution. |
| `ignoreRules` | Maintain | Same suppression mechanism; removed or renamed rule ids require migration and unknown ids are rejected. |
| `exclude` | Maintain | Same purpose, contained within the selected workspace. |
| `siteRoot` | Maintain | Same purpose, contained within the Git root when available and otherwise within the selected workspace. |
| `linkAllowList` | Maintain | Same purpose for explicit external-link checks. |
| `linkTimeoutMs` | Maintain | Same purpose for explicit external-link checks. |
| `linkConcurrency` | Maintain | Same purpose for explicit external-link checks. |
| `checkLinks` | Remove | No configuration file can enable network access; use the explicit CLI `--external-links` flag or API `externalLinks: true`. |
| `strict`, `maxLineLength`, `checkFreshness`, `freshnessMaxDays`, `checkFrontmatter`, and `checkInlineHtml` | Remove | No v2 core replacement. |
| `push` and `projectId` | Remove | No Cloud configuration in v2. |
| `doclify-disable-next-line`, `doclify-disable`/`doclify-enable`, and `doclify-disable-file` comments | Maintain | The prefix and scopes remain; removed or renamed rule ids require migration and unknown ids are rejected. |
| `DOCLIFY_TOKEN`, `DOCLIFY_API_URL`, and `DOCLIFY_PROJECT_ID` | Remove | No Cloud credentials or project binding in v2. |
| `DOCLIFY_HOME` and `DOCLIFY_REPO_ID` | Remove | No repository memory or hidden per-user state in the v2 core. |
| `NO_COLOR` | Maintain | Accepted for compatibility; v2 human-readable output is always color-free. |
| `.doclify-history.json` | Remove | No score history. |
| `doclify-report.md` | Remove | No implicit Markdown report. |
| `doclify-junit.xml` | Migrate | Written only through `--format junit --output <path>`. |
| `doclify.sarif` | Migrate | Written only through `--format sarif --output <path>`. |
| `doclify-badge.svg` | Remove | No score badge. |
| local auth state under `.doclify/` | Remove | No Cloud credential store. |

Automatic configuration lookup starts at the Git root and applies files from
that root through the scanned file's directory. Without Git, lookup starts at
the selected workspace and never reads a parent directory, including a user
home. Each configuration file is read at most once per scan and no Git process
is created per file.

Scalars use the closest configuration value. `ignoreRules`, `exclude`, and
`linkAllowList` are additive and deduplicated. Relative `siteRoot` and `exclude`
values use the directory containing the configuration that declares them;
nested exclusions apply only below that directory and prune traversal before
an excluded subtree is read. Explicit CLI and API options apply last. Selected
documents remain contained within the selected workspace. `siteRoot` remains
inside the Git root when one is available and otherwise inside the selected
workspace, so repository-root link resolution is stable when `check` runs from
a subdirectory.

`--config <path>` and API `config` select exactly one required file, resolved
from the invocation directory, inside the Git root when available and otherwise
inside the workspace, and disable automatic hierarchy. Removed v1 keys fail with
`config-removed-key`; unknown keys fail with `config-unknown-key`; missing,
malformed, and out-of-bound explicit configuration use `config-not-found`,
`config-invalid`, and `config-outside-workspace`. V1 configuration is not
silently accepted by the explicit v2 commands.

Configuration is untrusted input and cannot opt into external requests.
`externalLinks` is therefore not a configuration key; only the explicit CLI
flag or API option enables remote checks. Configuration may tune
`linkAllowList`, `linkTimeoutMs`, and `linkConcurrency`, but those values remain
inert while external checks are disabled.

## GitHub Action Migration

Every input and output below remains unchanged for
`Elgabor/doclify-guardrail/action@v1`. The v2 destination applies only to a
future, separately tested `@v2` Action.

### Inputs

| Action v1 input | Decision for Action v2 | v2 destination |
| --- | --- | --- |
| `path` | Maintain | Single selected path passed to `check`. |
| `strict` | Remove | Evidence-backed blocking severity is the gate. |
| `min-score` | Remove | V2 has no health score. |
| `check-links` | Migrate | `external-links`; local integrity checks are part of the core. |
| `check-freshness` | Remove | No freshness heuristic in the v2 core. |
| `check-frontmatter` | Remove | No generic frontmatter style gate in the v2 core. |
| `ai-drift` | Remove | No Drift Guard in the v2 core. |
| `ai-mode` | Remove | No AI mode in the v2 core. |
| `fail-on-drift` | Remove | No heuristic drift gate in the v2 core. |
| `fail-on-drift-scope` | Remove | No heuristic drift gate in the v2 core. |
| `api-url` | Remove | No Cloud API in the v2 core. |
| `doclify-token` | Remove | The base v2 Action requires no Doclify token. |
| `push` | Remove | No Cloud score push. |
| `project-id` | Remove | No Cloud project binding. |
| `format` | Migrate | `text`, `compact`, `json`, `sarif`, or `junit`, backed by one result model. |
| `sarif` | Migrate | Set `format: sarif`. |
| `sarif-file` | Migrate | Set the explicit v2 `output` input. |
| `pr-comment` | Remove | The v2 Action emits annotations and outputs without a default PR-comment write. |
| `token` | Remove | The base v2 Action does not request a GitHub token for PR comments. |
| `output` (new in v2) | Add | Explicit destination for the selected machine or human result format. |

### Outputs

| Action v1 output | Decision for Action v2 | v2 destination |
| --- | --- | --- |
| `score` | Remove | No health score. |
| `status` | Maintain | PASS or FAIL derived from the shared v2 result. |
| `errors` | Remove | Read blocking and operational counts from the v2 result artifact. |
| `warnings` | Remove | Read advisory counts from the v2 result artifact. |

The Action v1 bundle, metadata, inputs, outputs, runtime behavior, and tags are
not changed or rebuilt by this decision-only migration contract.

## MDX Boundary

MDX is not a first-class v2 syntax. Files ending in `.mdx` are selected but use
the limited `fragment` preset by default:

- no `single-h1` requirement;
- JSX, imports, exports, and expressions are treated as opaque content and are
  never executed;
- prose rules do not inspect JSX markup;
- only deterministic checks that are safe on the Markdown portions run;
- Doclify does not claim to validate MDX syntax or dynamic references.

First-class MDX parsing would require separate evidence, fixtures, dependency
review, and an explicit product decision.

## Migration Examples

Stay on the current v1 contract:

```sh
npm install --save-dev doclify-guardrail@^1
npx doclify README.md
```

The planned v2 opt-in is:

```sh
npm install --save-dev doclify-guardrail@next
npx doclify-guardrail check README.md
```

The second example is not executable until a v2 beta is implemented,
authorized for publication on `next`, and verified from the npm registry.

Existing Action users remain on:

```yaml
- uses: Elgabor/doclify-guardrail/action@v1
```

There is no supported `@v2` Action reference yet.
