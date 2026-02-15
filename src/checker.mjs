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

const PLACEHOLDER_PATTERNS = [
  { rx: /\bTODO\b/i,           msg: 'TODO marker found — remove before publishing' },
  { rx: /\bFIXME\b/i,          msg: 'FIXME marker found — remove before publishing' },
  { rx: /\bHACK\b/i,           msg: 'HACK marker found — remove before publishing' },
  { rx: /\bTBD\b/i,            msg: 'TBD (to be determined) marker found' },
  { rx: /\bWIP\b/i,            msg: 'WIP (work in progress) marker found' },
  { rx: /\bCHANGEME\b/i,       msg: 'CHANGEME marker found — update before publishing' },
  { rx: /\bPLACEHOLDER\b/i,    msg: 'PLACEHOLDER marker found — replace with actual content' },
  { rx: /\[insert\s+here\]/i,  msg: '"[insert here]" placeholder found' },
  { rx: /lorem ipsum/i,        msg: 'Lorem ipsum placeholder text found' },
  { rx: /\bxxx\b/i,            msg: '"xxx" placeholder found' }
];

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
    warnings.push(normalizeFinding('frontmatter', 'Missing frontmatter block at the beginning of the file.', 1, filePath));
  }

  // Rule: single-h1
  const h1Lines = [];
  lines.forEach((line, idx) => {
    if (/^#\s/.test(line)) {
      h1Lines.push(idx + 1);
    }
  });

  if (h1Lines.length === 0) {
    errors.push(normalizeFinding('single-h1', 'Missing H1 heading.', 1, filePath));
  } else if (h1Lines.length > 1) {
    const lineList = h1Lines.join(', ');
    for (const lineNum of h1Lines) {
      errors.push(normalizeFinding(
        'single-h1',
        `Found ${h1Lines.length} H1 headings (expected 1) at lines ${lineList}.`,
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
          `Line exceeds ${maxLineLength} characters (${line.length}).`,
          idx + 1,
          filePath
        )
      );
    }
  });

  // Rule: placeholder (uses stripped content)
  lines.forEach((line, idx) => {
    const cleanLine = stripInlineCode(line);
    for (const { rx, msg } of PLACEHOLDER_PATTERNS) {
      if (rx.test(cleanLine)) {
        warnings.push(normalizeFinding('placeholder', msg, idx + 1, filePath));
      }
    }
  });

  // Rule: insecure-link (uses stripped content)
  lines.forEach((line, idx) => {
    const cleanLine = stripInlineCode(line);

    // Inline markdown links: [text](http://...)
    const inlineMatches = cleanLine.match(/\[.*?\]\(http:\/\/[^)]+\)/g);
    if (inlineMatches) {
      for (const match of inlineMatches) {
        const url = match.match(/\((http:\/\/[^)]+)\)/)?.[1] || '';
        warnings.push(
          normalizeFinding('insecure-link', `Insecure link found: ${url} — use https:// instead`, idx + 1, filePath)
        );
      }
    }

    // Reference-style link definitions: [label]: http://...
    const refMatch = cleanLine.match(/^\[.*?\]:\s*(http:\/\/\S+)/);
    if (refMatch) {
      warnings.push(
        normalizeFinding('insecure-link', `Insecure link found: ${refMatch[1]} — use https:// instead`, idx + 1, filePath)
      );
    }

    // Bare URLs: http://... (not inside markdown link syntax)
    // Only check if no inline links were found on this line to avoid duplicates
    if (!inlineMatches && !refMatch) {
      const bareMatch = cleanLine.match(/\bhttp:\/\/\S+/g);
      if (bareMatch) {
        for (const url of bareMatch) {
          warnings.push(
            normalizeFinding('insecure-link', `Insecure link found: ${url} — use https:// instead`, idx + 1, filePath)
          );
        }
      }
    }
  });

  // Custom rules (uses stripped content)
  if (opts.customRules && opts.customRules.length > 0) {
    lines.forEach((line, idx) => {
      const cleanLine = stripInlineCode(line);
      for (const rule of opts.customRules) {
        rule.pattern.lastIndex = 0;
        if (rule.pattern.test(cleanLine)) {
          const bucket = rule.severity === 'error' ? errors : warnings;
          bucket.push(normalizeFinding(rule.id, rule.message, idx + 1, filePath));
        }
      }
    });
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

export { DEFAULTS, RULE_SEVERITY, normalizeFinding, checkMarkdown, stripCodeBlocks, stripInlineCode };
