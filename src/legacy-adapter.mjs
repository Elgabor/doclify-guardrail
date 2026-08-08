import { checkMarkdown } from './checker.mjs';
import { findSuppressions } from './suppressions.mjs';

function adaptFinding(finding, filePath) {
  return {
    ruleId: String(finding.code),
    severity: 'advisory',
    confidence: 'unverified',
    path: filePath,
    line: Number.isInteger(finding.line) ? finding.line : null,
    column: null,
    message: String(finding.message),
    evidence: null
  };
}

function checkWithLegacyEngine(content, options = {}) {
  const ignoreRules = options.ignoreRules instanceof Set
    ? options.ignoreRules
    : new Set(options.ignoreRules || []);
  const analysis = checkMarkdown(content, {
    filePath: options.path,
    absoluteFilePath: options.absolutePath
  });
  const legacyFindings = [...analysis.errors, ...analysis.warnings]
    .filter((finding) => !ignoreRules.has(finding.code));
  const findings = legacyFindings.map((finding) => adaptFinding(finding, options.path));

  return {
    file: {
      path: options.path,
      scanned: true,
      findings: findings.length,
      suppressions: findSuppressions(content)
    },
    findings
  };
}

export { checkWithLegacyEngine };
