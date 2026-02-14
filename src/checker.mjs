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

function normalizeFinding(rule, message) {
  return {
    code: rule,
    severity: RULE_SEVERITY[rule] || 'warning',
    message
  };
}

function checkMarkdown(content, opts = {}) {
  const maxLineLength = Number(opts.maxLineLength ?? DEFAULTS.maxLineLength);
  const errors = [];
  const warnings = [];

  if (!content.startsWith('---\n')) {
    warnings.push(normalizeFinding('frontmatter', 'Frontmatter non trovato in testa al file.'));
  }

  const h1Matches = content.match(/^#\s.+$/gm) || [];
  if (h1Matches.length === 0) {
    errors.push(normalizeFinding('single-h1', 'Manca titolo H1.'));
  } else if (h1Matches.length > 1) {
    errors.push(normalizeFinding('single-h1', `Trovati ${h1Matches.length} H1 (consentito: 1).`));
  }

  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.length > maxLineLength) {
      warnings.push(
        normalizeFinding(
          'line-length',
          `Linea ${idx + 1} oltre ${maxLineLength} caratteri (${line.length}).`
        )
      );
    }
  });

  const placeholders = [/\bTODO\b/i, /lorem ipsum/i, /\bxxx\b/i];
  placeholders.forEach((rx) => {
    if (rx.test(content)) {
      warnings.push(normalizeFinding('placeholder', `Placeholder rilevato: ${rx}`));
    }
  });

  const insecureLinks = content.match(/\[.*?\]\(http:\/\/.*?\)/g) || [];
  if (insecureLinks.length > 0) {
    warnings.push(
      normalizeFinding('insecure-link', `Link HTTP non sicuri rilevati: ${insecureLinks.length}`)
    );
  }

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
