const RULE_CATALOG = [
  {
    id: 'local-link',
    severity: 'blocking',
    purpose: 'Verify explicit local paths and anchors in completely indexed Markdown files without network access.',
    evidence: 'The referenced path is resolved in the selected workspace; anchors use complete ATX, Setext, and static HTML anchor evidence.',
    remediation: 'Correct the target path or anchor, or remove the reference.'
  },
  {
    id: 'package-script',
    severity: 'blocking',
    purpose: 'Verify complete static npm run script names from a root document or one explicit workspace selector.',
    evidence: 'The literal script name is looked up in the applicable static package manifest index.',
    remediation: 'Use an existing script name or update the documented command.'
  },
  {
    id: 'workspace-package',
    severity: 'blocking',
    purpose: 'Verify one static exact npm --workspace or -w name/path against declared workspaces.',
    evidence: 'The selector is matched exactly by package name or workspace path in declared workspace package.json manifests.',
    remediation: 'Use a declared workspace package name or update the documentation.'
  },
  {
    id: 'make-target',
    severity: 'blocking',
    purpose: 'Verify static make targets from a root document or an explicit -C/--directory context.',
    evidence: 'The target name is looked up in static declarations from the selected Makefile; no make command is executed.',
    remediation: 'Use a declared Makefile target or update the documented command.'
  },
  {
    id: 'cli-contract',
    severity: 'blocking',
    purpose: 'Verify Doclify Guardrail commands and flags against its static CLI contract.',
    evidence: 'The command, flags, and positionals are compared with the in-package CLI grammar; no command is executed.',
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
