const DEFAULT_HUMAN_FINDING_LIMIT = 50;

function terminalText(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, (character) => {
    if (character === '\n') return '\\n';
    if (character === '\r') return '\\r';
    if (character === '\t') return '\\t';
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
}

function xmlText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function statusLabel(result) {
  return result.status === 'fail' ? 'FAIL' : result.status === 'incomplete' ? 'INCOMPLETE' : 'PASS';
}

function findingsForPath(findings, filePath) {
  return findings.filter((finding) => finding.path === filePath);
}

function diagnosticsForPath(result, filePath) {
  return result.diagnostics.filter((diagnostic) => diagnostic.path === filePath);
}

function suppressionDescription(suppression) {
  const rules = suppression.rules == null ? 'all rules' : suppression.rules.join(', ');
  return `${suppression.scope} at line ${suppression.line} (${rules})`;
}

function limitedHumanFindings(result, options = {}) {
  if (options.all === true) return { findings: result.findings, omitted: 0 };
  const requestedLimit = Number(options.limit ?? DEFAULT_HUMAN_FINDING_LIMIT);
  const limit = Number.isInteger(requestedLimit) && requestedLimit >= 0
    ? requestedLimit
    : DEFAULT_HUMAN_FINDING_LIMIT;
  const findings = result.findings.slice(0, limit);
  return { findings, omitted: result.findings.length - findings.length };
}

function renderText(result, options = {}) {
  const lines = [`Doclify Guardrail ${terminalText(result.tool.version)}`, ''];
  const representedDiagnostics = new Set();
  const details = limitedHumanFindings(result, options);

  for (const file of result.files) {
    const fileFindings = findingsForPath(details.findings, file.path);
    const fileDiagnostics = diagnosticsForPath(result, file.path);
    for (const diagnostic of fileDiagnostics) representedDiagnostics.add(diagnostic);
    const hasBlocking = findingsForPath(result.findings, file.path)
      .some((finding) => finding.severity === 'blocking');
    const label = !file.scanned || fileDiagnostics.length > 0 ? 'ERROR' : hasBlocking ? 'FAIL' : 'PASS';
    lines.push(`${label} ${terminalText(file.path)}`);
    for (const finding of fileFindings) {
      const location = finding.line == null ? '' : `${finding.line}${finding.column == null ? '' : `:${finding.column}`}: `;
      lines.push(`  ${location}${finding.severity} [${terminalText(finding.ruleId)}] ${terminalText(finding.message)}`);
    }
    for (const suppression of file.suppressions) {
      lines.push(`  note [suppression] ${terminalText(suppressionDescription(suppression))}`);
    }
    for (const diagnostic of fileDiagnostics) {
      lines.push(`  error [${terminalText(diagnostic.code)}] ${terminalText(diagnostic.message)}`);
    }
  }

  for (const diagnostic of result.diagnostics) {
    if (representedDiagnostics.has(diagnostic)) continue;
    lines.push(`ERROR ${terminalText(diagnostic.path)}`);
    lines.push(`  error [${terminalText(diagnostic.code)}] ${terminalText(diagnostic.message)}`);
  }

  if (details.omitted > 0) {
    lines.push('', `${details.omitted} findings omitted; rerun with --all.`);
  }

  lines.push(
    '',
    `Summary: ${statusLabel(result)} | ${result.summary.filesScanned}/${result.summary.filesSelected} files scanned | ${plural(result.summary.blocking, 'blocking finding')} | ${plural(result.summary.advisory, 'advisory finding')} | ${plural(result.summary.diagnostics, 'diagnostic')} | ${result.complete ? 'complete' : 'incomplete'}`,
    ''
  );
  return lines.join('\n');
}

function renderCompact(result, options = {}) {
  const lines = [];
  const details = limitedHumanFindings(result, options);
  for (const finding of details.findings) {
    const location = finding.line == null
      ? finding.path
      : `${finding.path}:${finding.line}${finding.column == null ? '' : `:${finding.column}`}`;
    lines.push(`${terminalText(location)}: ${finding.severity} [${terminalText(finding.ruleId)}] ${terminalText(finding.message)}`);
  }
  for (const diagnostic of result.diagnostics) {
    lines.push(`${terminalText(diagnostic.path)}: error [${terminalText(diagnostic.code)}] ${terminalText(diagnostic.message)}`);
  }
  for (const file of result.files) {
    for (const suppression of file.suppressions) {
      lines.push(`${terminalText(file.path)}:${suppression.line}: note [suppression] ${terminalText(suppressionDescription(suppression))}`);
    }
  }
  if (details.omitted > 0) {
    lines.push(`${details.omitted} findings omitted; rerun with --all`);
  }
  lines.push(`summary: ${result.status}; ${result.summary.filesScanned}/${result.summary.filesSelected} files; ${result.summary.blocking} blocking; ${result.summary.advisory} advisory; ${result.summary.diagnostics} diagnostics; ${result.complete ? 'complete' : 'incomplete'}`);
  return `${lines.join('\n')}\n`;
}

function sarifRule(id, message, level) {
  return {
    id,
    name: id,
    shortDescription: { text: message },
    defaultConfiguration: { level }
  };
}

function renderSarifObject(result) {
  const rules = new Map();
  const results = [];
  for (const finding of result.findings) {
    const level = finding.severity === 'blocking' ? 'error' : 'warning';
    if (!rules.has(finding.ruleId)) {
      rules.set(finding.ruleId, sarifRule(finding.ruleId, finding.message, level));
    }
    const physicalLocation = {
      artifactLocation: { uri: finding.path }
    };
    if (finding.line != null) {
      physicalLocation.region = { startLine: finding.line };
      if (finding.column != null) physicalLocation.region.startColumn = finding.column;
    }
    results.push({
      ruleId: finding.ruleId,
      level,
      message: { text: finding.message },
      locations: [{ physicalLocation }],
      properties: {
        confidence: finding.confidence,
        evidence: finding.evidence
      }
    });
  }
  for (const diagnostic of result.diagnostics) {
    if (!rules.has(diagnostic.code)) {
      rules.set(diagnostic.code, sarifRule(diagnostic.code, diagnostic.message, 'error'));
    }
    results.push({
      ruleId: diagnostic.code,
      level: 'error',
      message: { text: diagnostic.message },
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: diagnostic.path }
        }
      }]
    });
  }
  const sortedRules = [...rules.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'Doclify Guardrail',
          semanticVersion: result.tool.version,
          informationUri: 'https://github.com/Elgabor/doclify-guardrail',
          rules: sortedRules
        }
      },
      artifacts: result.files.map((file) => ({
        location: { uri: file.path },
        roles: ['analysisTarget'],
        properties: {
          scanned: file.scanned,
          suppressions: file.suppressions
        }
      })),
      results,
      properties: {
        schemaVersion: result.schemaVersion,
        command: result.command,
        complete: result.complete,
        status: result.status,
        summary: result.summary
      }
    }]
  };
}

function findingLine(finding) {
  const location = finding.line == null ? '' : `:${finding.line}${finding.column == null ? '' : `:${finding.column}`}`;
  return `[${finding.severity.toUpperCase()}] ${finding.ruleId}${location} ${finding.message}`;
}

function renderJunit(result) {
  const orphanDiagnostics = result.diagnostics.filter(
    (diagnostic) => !result.files.some((file) => file.path === diagnostic.path)
  );
  const failures = result.files.filter((file) => findingsForPath(result.findings, file.path).some((finding) => finding.severity === 'blocking')).length;
  const errors = result.files.filter((file) => !file.scanned || diagnosticsForPath(result, file.path).length > 0).length + orphanDiagnostics.length;
  const tests = result.files.length + orphanDiagnostics.length;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="doclify-guardrail" tests="${tests}" failures="${failures}" errors="${errors}">`
  ];

  for (const file of result.files) {
    const fileFindings = findingsForPath(result.findings, file.path);
    const blocking = fileFindings.filter((finding) => finding.severity === 'blocking');
    const advisory = fileFindings.filter((finding) => finding.severity === 'advisory');
    const fileDiagnostic = diagnosticsForPath(result, file.path)[0];
    const notes = [
      ...advisory.map(findingLine),
      ...file.suppressions.map((suppression) => `[SUPPRESSION] ${suppressionDescription(suppression)}`)
    ];

    if (file.scanned && blocking.length === 0 && notes.length === 0) {
      lines.push(`  <testcase classname="doclify.guardrail" name="${xmlText(file.path)}"/>`);
      continue;
    }

    lines.push(`  <testcase classname="doclify.guardrail" name="${xmlText(file.path)}">`);
    if (!file.scanned || fileDiagnostic) {
      const message = fileDiagnostic?.message || 'File was not scanned.';
      lines.push(`    <error message="${xmlText(message)}">${xmlText(message)}</error>`);
    } else if (blocking.length > 0) {
      const message = plural(blocking.length, 'blocking finding');
      lines.push(`    <failure message="${xmlText(message)}">${xmlText(blocking.map(findingLine).join('\n'))}</failure>`);
    }
    if (notes.length > 0) {
      lines.push(`    <system-out>${xmlText(notes.join('\n'))}</system-out>`);
    }
    lines.push('  </testcase>');
  }

  for (const diagnostic of orphanDiagnostics) {
    lines.push(`  <testcase classname="doclify.guardrail.operational" name="${xmlText(diagnostic.path)}">`);
    lines.push(`    <error message="${xmlText(diagnostic.message)}">${xmlText(diagnostic.message)}</error>`);
    lines.push('  </testcase>');
  }

  lines.push('</testsuite>', '');
  return lines.join('\n');
}

function renderResult(result, options = {}) {
  const format = options.format || 'text';
  if (format === 'text') return renderText(result, options);
  if (format === 'compact') return renderCompact(result, options);
  if (format === 'json') return `${JSON.stringify(result, null, 2)}\n`;
  if (format === 'sarif') return `${JSON.stringify(renderSarifObject(result), null, 2)}\n`;
  if (format === 'junit') return renderJunit(result);
  throw new Error(`Unsupported result format: ${format}`);
}

export {
  renderResult,
  terminalText
};
