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

/**
 * Replace content inside fenced code blocks with empty lines.
 * Preserves line count so line numbers remain accurate.
 */
function stripCodeBlocks(content) {
  const lines = content.split('\n');
  const result = [];
  let inCodeBlock = false;
  let fenceChar = null;
  let fenceLen = 0;

  for (const line of lines) {
    if (!inCodeBlock) {
      const fenceMatch = line.match(/^(`{3,}|~{3,})/);
      if (fenceMatch) {
        inCodeBlock = true;
        fenceChar = fenceMatch[1][0];
        fenceLen = fenceMatch[1].length;
        result.push('');
      } else {
        result.push(line);
      }
    } else {
      const closeMatch = line.match(/^(`{3,}|~{3,})\s*$/);
      if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= fenceLen) {
        inCodeBlock = false;
        fenceChar = null;
        fenceLen = 0;
      }
      result.push('');
    }
  }

  return result.join('\n');
}

/**
 * Strip inline code from a single line for rule matching.
 */
function stripInlineCode(line) {
  return line.replace(/`[^`]+`/g, '');
}

function checkMarkdown(rawContent, opts = {}) {
  const maxLineLength = Number(opts.maxLineLength ?? DEFAULTS.maxLineLength);
  const filePath = opts.filePath || undefined;
  const errors = [];
  const warnings = [];

  // Strip code blocks for semantic rules
  const content = stripCodeBlocks(rawContent);
  const lines = content.split('\n');
  const rawLines = rawContent.split('\n');

  // Rule: frontmatter
  if (!rawContent.startsWith('---\n')) {
    warnings.push(normalizeFinding('frontmatter', 'Frontmatter non trovato in testa al file.', 1, filePath));
  }

  // Rule: single-h1
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

  // Rule: line-length (uses raw content — code block lines can still be too long)
  rawLines.forEach((line, idx) => {
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

  // Rule: placeholder (uses stripped content)
  const placeholders = [/\bTODO\b/i, /lorem ipsum/i, /\bxxx\b/i];
  lines.forEach((line, idx) => {
    const cleanLine = stripInlineCode(line);
    placeholders.forEach((rx) => {
      if (rx.test(cleanLine)) {
        warnings.push(normalizeFinding('placeholder', `Placeholder rilevato: ${rx}`, idx + 1, filePath));
      }
    });
  });

  // Rule: insecure-link (uses stripped content)
  lines.forEach((line, idx) => {
    const cleanLine = stripInlineCode(line);
    const matches = cleanLine.match(/\[.*?\]\(http:\/\/.*?\)/g);
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

export { DEFAULTS, RULE_SEVERITY, normalizeFinding, checkMarkdown, stripCodeBlocks, stripInlineCode };
