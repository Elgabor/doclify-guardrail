# Security policy

Doclify Guardrail scans locally, read-only, and offline by default. Writes
require an explicit output or initialization option. Remote-link checks require
`--external-links` and retain private-network protections.

## Supported versions

| Release line | Security support |
| --- | --- |
| Latest `2.0.x` release | Supported |
| `2.0.0-beta.*` and older prereleases | Not supported; upgrade to stable v2 |
| v1 package and frozen v1 Action | Not actively supported; reports are accepted, but migration to v2 may be the resolution |

## Reporting a vulnerability

Please report security vulnerabilities privately through
[GitHub's private vulnerability reporting](https://github.com/Elgabor/doclify-guardrail/security/advisories/new).
Do not open a public issue for an undisclosed vulnerability.

Include, when safe to share:

- the affected version, command, or Action input;
- a minimal reproduction without credentials or private data;
- the expected and observed behavior; and
- the impact and any practical mitigation.

Redact tokens, API keys, repository secrets, personal data, and private URLs
from reports and reproductions. Do not send live credentials to the project.

## Security boundaries

Markdown, MDX, configuration, Git paths, remote responses, and rendered output
are treated as untrusted input. The project must not execute documented
commands, let selected paths escape the workspace, mix human logs into machine
stdout, or contact the network without explicit opt-in. Remote checks must
continue to reject non-global destinations before and during connection.

The v2 CLI, `doclify-guardrail/api`, and the v2 GitHub Action share the same
local result model. The v1 Action is a separate frozen contract; migration
information is in [MIGRATION.md](MIGRATION.md).
