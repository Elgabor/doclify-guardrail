const DEFAULTS = {
  maxLineLength: 160,
  strict: false
};

const RULE_SEVERITY = {
  frontmatter: 'warning',
  'single-h1': 'error',
  'line-length': 'warning',
  placeholder: 'warning',
  'insecure-link': 'warning'
};

function normalizeFinding(rule, message, line, source) {
  const finding = {
    code: rule,
    severity: RULE_SEVERITY[rule] || 'warning',
    message
  };
  if (line != null) finding.line = line;
  if (source != null) finding.source = source;
  return finding;
}

function checkMarkdown(content, opts = {}) {
  const maxLineLength = Number(opts.maxLineLength ?? DEFAULTS.maxLineLength);
  const filePath = opts.filePath || undefined;
  const errors = [];
  const warnings = [];

  // Rule: frontmatter
  if (!content.startsWith('---\n')) {
    warnings.push(normalizeFinding('frontmatter', 'Frontmatter non trovato in testa al file.', 1, filePath));
  }

  // Rule: single-h1
  const lines = content.split('\n');
  const h1Lines = [];
  lines.forEach((line, idx) => {
    if (/^#\s/.test(line)) {
      h1Lines.push(idx + 1);
    }
  });

  if (h1Lines.length === 0) {
    errors.push(normalizeFinding('single-h1', 'Manca titolo H1.', 1, filePath));
  } else if (h1Lines.length > 1) {
    for (const lineNum of h1Lines) {
      errors.push(normalizeFinding(
        'single-h1',
        `Trovati ${h1Lines.length} H1 (consentito: 1).`,
        lineNum,
        filePath
      ));
    }
  }

  // Rule: line-length
  lines.forEach((line, idx) => {
    if (line.length > maxLineLength) {
      warnings.push(
        normalizeFinding(
          'line-length',
          `Linea ${idx + 1} oltre ${maxLineLength} caratteri (${line.length}).`,
          idx + 1,
          filePath
        )
      );
    }
  });

  // Rule: placeholder
  const placeholders = [/\bTODO\b/i, /lorem ipsum/i, /\bxxx\b/i];
  lines.forEach((line, idx) => {
    placeholders.forEach((rx) => {
      if (rx.test(line)) {
        warnings.push(normalizeFinding('placeholder', `Placeholder rilevato: ${rx}`, idx + 1, filePath));
      }
    });
  });

  // Rule: insecure-link
  lines.forEach((line, idx) => {
    const matches = line.match(/\[.*?\]\(http:\/\/.*?\)/g);
    if (matches) {
      for (const match of matches) {
        warnings.push(
          normalizeFinding('insecure-link', `Link HTTP non sicuro: ${match}`, idx + 1, filePath)
        );
      }
    }
  });

  return {
    errors,
    warnings,
    summary: {
      errors: errors.length,
      warnings: warnings.length
    }
  };
}

export { DEFAULTS, RULE_SEVERITY, normalizeFinding, checkMarkdown };
