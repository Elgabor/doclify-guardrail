import { compareText } from './text-order.mjs';

function compareOptionalNumber(left, right) {
  const a = Number.isInteger(left) ? left : Number.MAX_SAFE_INTEGER;
  const b = Number.isInteger(right) ? right : Number.MAX_SAFE_INTEGER;
  return a - b;
}

function compareFindings(left, right) {
  return compareText(left.path, right.path)
    || compareOptionalNumber(left.line, right.line)
    || compareOptionalNumber(left.column, right.column)
    || compareText(left.ruleId, right.ruleId)
    || compareText(left.message, right.message);
}

function compareDiagnostics(left, right) {
  return compareText(left.path, right.path)
    || compareText(left.code, right.code)
    || compareText(left.message, right.message);
}

function compareSuppressions(left, right) {
  return compareOptionalNumber(left.line, right.line)
    || compareText(left.scope, right.scope)
    || compareText((left.rules || []).join(','), (right.rules || []).join(','));
}

function normalizeFile(file) {
  return {
    path: String(file.path),
    scanned: Boolean(file.scanned),
    findings: file.scanned ? Number(file.findings || 0) : null,
    suppressions: [...(file.suppressions || [])]
      .map((suppression) => ({
        scope: String(suppression.scope),
        rules: suppression.rules == null ? null : [...suppression.rules].map(String).sort(compareText),
        line: Number(suppression.line)
      }))
      .sort(compareSuppressions)
  };
}

function createResult(options = {}) {
  const fullFiles = [...(options.files || [])]
    .map(normalizeFile)
    .sort((left, right) => compareText(left.path, right.path));
  const fullFindings = [...(options.findings || [])].sort(compareFindings);
  const fullDiagnostics = [...(options.diagnostics || [])].sort(compareDiagnostics);
  const blocking = fullFindings.filter((finding) => finding.severity === 'blocking').length;
  const advisory = fullFindings.length - blocking;
  const complete = fullDiagnostics.length === 0;
  const status = blocking > 0 ? 'fail' : complete ? 'pass' : 'incomplete';

  return {
    schemaVersion: 3,
    tool: {
      name: 'doclify-guardrail',
      version: String(options.toolVersion)
    },
    command: options.command === 'changed' ? 'changed' : 'check',
    complete,
    status,
    summary: {
      filesSelected: fullFiles.length,
      filesScanned: fullFiles.filter((file) => file.scanned).length,
      filesSkipped: fullFiles.filter((file) => !file.scanned).length,
      blocking,
      advisory,
      diagnostics: fullDiagnostics.length,
      filesWithSuppressions: fullFiles.filter((file) => file.suppressions.length > 0).length
    },
    files: fullFiles,
    findings: fullFindings,
    diagnostics: fullDiagnostics
  };
}

export {
  createResult
};
