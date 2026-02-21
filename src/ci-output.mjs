import fs from 'node:fs';
import path from 'node:path';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeHealthScore(summary = {}) {
  const files = Math.max(Number(summary.filesScanned || 0), 1);
  const errors = Number(summary.totalErrors || 0);
  const warnings = Number(summary.totalWarnings || 0);

  const weightedPenalty = ((errors * 22) + (warnings * 6)) / files;
  return clamp(Math.round(100 - weightedPenalty), 0, 100);
}

function escapeXml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function makeFindingLine(finding) {
  const lineRef = finding.line != null ? `:${finding.line}` : '';
  return `[${finding.severity?.toUpperCase?.() || 'WARNING'}] ${finding.code}${lineRef} ${finding.message}`;
}

function generateJUnitXml(output) {
  const timestamp = new Date().toISOString();
  const suites = [];

  const tests = output.files.length + (output.fileErrors?.length || 0);
  const failures = output.files.filter((f) => f.findings.errors.length > 0 || f.findings.warnings.length > 0).length;
  const errors = output.fileErrors?.length || 0;

  suites.push('<?xml version="1.0" encoding="UTF-8"?>');
  suites.push(
    `<testsuite name="doclify-guardrail" tests="${tests}" failures="${failures}" errors="${errors}" time="${output.summary.elapsed}" timestamp="${timestamp}">`
  );

  for (const fileResult of output.files) {
    suites.push(`  <testcase classname="doclify.guardrail" name="${escapeXml(fileResult.file)}">`);

    const findings = [
      ...fileResult.findings.errors,
      ...fileResult.findings.warnings
    ];

    if (findings.length > 0) {
      const detail = findings.map(makeFindingLine).join('\n');
      suites.push(`    <failure message="${escapeXml(`${fileResult.summary.errors} errors, ${fileResult.summary.warnings} warnings`)}">${escapeXml(detail)}</failure>`);
    }

    suites.push('  </testcase>');
  }

  for (const fileError of output.fileErrors || []) {
    suites.push(`  <testcase classname="doclify.guardrail" name="${escapeXml(fileError.file)}">`);
    suites.push(`    <error message="${escapeXml(fileError.error)}">${escapeXml(fileError.error)}</error>`);
    suites.push('  </testcase>');
  }

  suites.push('</testsuite>');
  suites.push('');
  return suites.join('\n');
}

function collectRuleCatalog(output) {
  const seen = new Map();

  for (const fileResult of output.files) {
    for (const finding of [...fileResult.findings.errors, ...fileResult.findings.warnings]) {
      if (!seen.has(finding.code)) {
        seen.set(finding.code, {
          id: finding.code,
          name: finding.code,
          shortDescription: { text: finding.code },
          help: { text: finding.message || finding.code },
          defaultConfiguration: {
            level: finding.severity === 'error' ? 'error' : 'warning'
          }
        });
      }
    }
  }

  if ((output.fileErrors || []).length > 0 && !seen.has('file-error')) {
    seen.set('file-error', {
      id: 'file-error',
      name: 'file-error',
      shortDescription: { text: 'Unreadable file' },
      help: { text: 'Doclify could not read this file.' },
      defaultConfiguration: { level: 'error' }
    });
  }

  return Array.from(seen.values());
}

function generateSarifJson(output) {
  const results = [];

  for (const fileResult of output.files) {
    const findings = [
      ...fileResult.findings.errors,
      ...fileResult.findings.warnings
    ];

    for (const finding of findings) {
      const level = finding.severity === 'error' ? 'error' : 'warning';
      const location = {
        physicalLocation: {
          artifactLocation: { uri: fileResult.file }
        }
      };

      if (finding.line != null) {
        location.physicalLocation.region = { startLine: finding.line };
      }

      results.push({
        ruleId: finding.code,
        level,
        message: { text: finding.message },
        locations: [location]
      });
    }
  }

  for (const fileError of output.fileErrors || []) {
    results.push({
      ruleId: 'file-error',
      level: 'error',
      message: { text: fileError.error },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: fileError.file }
          }
        }
      ]
    });
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Doclify Guardrail',
            semanticVersion: output.version,
            informationUri: 'https://github.com/Elgabor/doclify-guardrail',
            rules: collectRuleCatalog(output)
          }
        },
        results
      }
    ]
  };
}

function badgeColor(score) {
  if (score >= 90) return '#4c1';
  if (score >= 75) return '#97CA00';
  if (score >= 60) return '#dfb317';
  if (score >= 40) return '#fe7d37';
  return '#e05d44';
}

function formatBadgeValue(score) {
  return `${score}/100`;
}

function badgeWidth(text) {
  return Math.max(42, 7 * text.length + 12);
}

function generateBadgeSvg(score, label = 'docs health') {
  const value = formatBadgeValue(score);
  const leftWidth = badgeWidth(label);
  const rightWidth = badgeWidth(value);
  const totalWidth = leftWidth + rightWidth;
  const valueX = leftWidth + (rightWidth / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${value}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftWidth}" height="20" fill="#555"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${badgeColor(score)}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${Math.round(leftWidth / 2)}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${Math.round(leftWidth / 2)}" y="14">${label}</text>
    <text x="${Math.round(valueX)}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${Math.round(valueX)}" y="14">${value}</text>
  </g>
</svg>
`;
}

function generateJUnitReport(output, options) {
  const junitPath = path.resolve(options.junitPath);
  const xml = generateJUnitXml(output);
  fs.writeFileSync(junitPath, xml, 'utf8');
  return junitPath;
}

function generateSarifReport(output, options) {
  const sarifPath = path.resolve(options.sarifPath);
  const sarif = generateSarifJson(output);
  fs.writeFileSync(sarifPath, JSON.stringify(sarif, null, 2), 'utf8');
  return sarifPath;
}

function generateBadge(output, options = {}) {
  const label = (options.label || 'docs health').trim() || 'docs health';
  const badgePath = path.resolve(options.badgePath || 'doclify-badge.svg');
  const score = computeHealthScore(output.summary || {});
  const svg = generateBadgeSvg(score, label);
  fs.writeFileSync(badgePath, svg, 'utf8');
  return {
    badgePath,
    score
  };
}

export {
  computeHealthScore,
  generateJUnitXml,
  generateSarifJson,
  generateBadgeSvg,
  generateJUnitReport,
  generateSarifReport,
  generateBadge
};
