const RULE_CATALOG = [
  {
    id: 'local-link',
    severity: 'blocking',
    purpose: 'Verify local Markdown links and anchors without network access.',
    evidence: 'The referenced path or anchor is resolved against the selected workspace.',
    remediation: 'Correct the target path or anchor, or remove the reference.'
  },
  {
    id: 'package-script',
    severity: 'blocking',
    purpose: 'Verify explicit npm run commands against package.json scripts.',
    evidence: 'The script name is looked up in the static package manifest index.',
    remediation: 'Use an existing script name or update the documented command.'
  },
  {
    id: 'workspace-package',
    severity: 'blocking',
    purpose: 'Verify explicit npm workspace selectors against declared workspaces.',
    evidence: 'The package name is looked up in workspace package.json manifests.',
    remediation: 'Use a declared workspace package name or update the documentation.'
  },
  {
    id: 'make-target',
    severity: 'blocking',
    purpose: 'Verify explicit make targets against the repository Makefile.',
    evidence: 'The target name is looked up in static Makefile declarations.',
    remediation: 'Use a declared Makefile target or update the documented command.'
  },
  {
    id: 'cli-contract',
    severity: 'blocking',
    purpose: 'Verify Doclify Guardrail commands and flags against its static CLI contract.',
    evidence: 'The command and flag are compared with the in-package CLI contract; no command is executed.',
    remediation: 'Use a documented Doclify Guardrail command or flag.'
  },
  {
    id: 'external-link',
    severity: 'advisory',
    purpose: 'Report an explicitly requested remote-link check that could not be verified.',
    evidence: 'The network result is reported without treating a transient remote failure as a local fact.',
    remediation: 'Verify the remote destination or rerun when the network is available.'
  }
];

const RULES_BY_ID = new Map(RULE_CATALOG.map((rule) => [rule.id, rule]));
const DEFAULT_RULE_CATALOG = RULE_CATALOG.filter((rule) => rule.severity === 'blocking');

export { DEFAULT_RULE_CATALOG, RULE_CATALOG, RULES_BY_ID };
