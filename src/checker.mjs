const DEFAULTS = {
  maxLineLength: 160,
  strict: false
};

const RULE_CATALOG = [
  { id: 'frontmatter',        severity: 'warning', description: 'Require YAML frontmatter block' },
  { id: 'single-h1',          severity: 'error',   description: 'Exactly one H1 heading per file' },
  { id: 'heading-hierarchy',  severity: 'warning', description: 'No skipped heading levels (H2 → H4)' },
  { id: 'duplicate-heading',  severity: 'warning', description: 'No duplicate headings at same level' },
  { id: 'line-length',        severity: 'warning', description: 'Max line length (default: 160 chars)' },
  { id: 'placeholder',        severity: 'warning', description: 'No TODO/FIXME/WIP/TBD markers' },
  { id: 'insecure-link',      severity: 'warning', description: 'No http:// links (use https://)' },
  { id: 'empty-link',         severity: 'warning', description: 'No empty link text or URL' },
  { id: 'img-alt',            severity: 'warning', description: 'Images must have alt text' },
  { id: 'dead-link',          severity: 'error',   description: 'No broken links (requires --check-links)' },
  { id: 'stale-doc',          severity: 'warning', description: 'Warn on stale docs (requires --check-freshness)' }
];

const RULE_SEVERITY = Object.fromEntries(RULE_CATALOG.map(r => [r.id, r.severity]));

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

function normalizeFinding(rule, message, line, source, severityOverride) {
  const finding = {
    code: rule,
    severity: severityOverride || RULE_SEVERITY[rule] || 'warning',
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

const SUPPRESS_NEXT_LINE_RX = /<!--\s*doclify-disable-next-line\s*(.*?)\s*-->/;
const SUPPRESS_BLOCK_START_RX = /<!--\s*doclify-disable\s*(.*?)\s*-->/;
const SUPPRESS_BLOCK_END_RX = /<!--\s*doclify-enable\s*(.*?)\s*-->/;
const SUPPRESS_FILE_RX = /<!--\s*doclify-disable-file\s*(.*?)\s*-->/;

function parseRuleIds(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null; // null means "all rules"
  return trimmed.split(/\s+/);
}

/**
 * Build a map of line numbers to sets of suppressed rule IDs.
 * Uses code-block-stripped lines so comments inside fences are ignored.
 * A suppressed set containing '*' means all rules are suppressed.
 */
function buildSuppressionMap(lines) {
  const suppressions = new Map();
  const activeDisables = new Map(); // ruleId → count (or '*' → count)

  function addSuppression(lineNum, ruleIds) {
    if (!suppressions.has(lineNum)) suppressions.set(lineNum, new Set());
    const set = suppressions.get(lineNum);
    if (ruleIds === null) {
      set.add('*');
    } else {
      for (const id of ruleIds) set.add(id);
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const nextLineMatch = line.match(SUPPRESS_NEXT_LINE_RX);
    if (nextLineMatch) {
      const ruleIds = parseRuleIds(nextLineMatch[1]);
      addSuppression(i + 2, ruleIds); // i is 0-based, line numbers are 1-based, next line = i+2
    }

    const blockStartMatch = line.match(SUPPRESS_BLOCK_START_RX);
    if (!nextLineMatch && blockStartMatch) {
      const ruleIds = parseRuleIds(blockStartMatch[1]);
      if (ruleIds === null) {
        activeDisables.set('*', (activeDisables.get('*') || 0) + 1);
      } else {
        for (const id of ruleIds) activeDisables.set(id, (activeDisables.get(id) || 0) + 1);
      }
      continue;
    }

    const blockEndMatch = line.match(SUPPRESS_BLOCK_END_RX);
    if (blockEndMatch) {
      const ruleIds = parseRuleIds(blockEndMatch[1]);
      if (ruleIds === null) {
        activeDisables.delete('*');
      } else {
        for (const id of ruleIds) {
          const count = activeDisables.get(id) || 0;
          if (count <= 1) activeDisables.delete(id);
          else activeDisables.set(id, count - 1);
        }
      }
      continue;
    }

    // Apply active block disables to this line
    if (activeDisables.size > 0) {
      const lineNum = i + 1;
      if (!suppressions.has(lineNum)) suppressions.set(lineNum, new Set());
      const set = suppressions.get(lineNum);
      for (const id of activeDisables.keys()) set.add(id);
    }
  }

  return suppressions;
}

function isSuppressed(suppressions, finding) {
  if (!finding.line) return false;
  const set = suppressions.get(finding.line);
  if (!set) return false;
  return set.has('*') || set.has(finding.code);
}

function checkMarkdown(rawContent, opts = {}) {
  const maxLineLength = Number(opts.maxLineLength ?? DEFAULTS.maxLineLength);
  const filePath = opts.filePath || undefined;

  // File-level suppression: <!-- doclify-disable-file [rules] -->
  const fileDisableMatch = rawContent.match(SUPPRESS_FILE_RX);
  let fileDisabledRules = null;
  if (fileDisableMatch) {
    const ruleIds = parseRuleIds(fileDisableMatch[1]);
    if (ruleIds === null) {
      // All rules disabled — short-circuit
      return { errors: [], warnings: [], summary: { errors: 0, warnings: 0 } };
    }
    fileDisabledRules = new Set(ruleIds);
  }

  const errors = [];
  const warnings = [];

  // Strip code blocks for semantic rules
  const content = stripCodeBlocks(rawContent);
  const lines = content.split('\n');
  const rawLines = rawContent.split('\n');

  // Build suppression map from inline comments (uses stripped content)
  const suppressions = buildSuppressionMap(lines);

  // Rule: frontmatter (opt-in via --check-frontmatter or config)
  if (opts.checkFrontmatter && !rawContent.startsWith('---\n')) {
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
    errors.push(normalizeFinding(
      'single-h1',
      `Found ${h1Lines.length} H1 headings (expected 1) at lines ${lineList}.`,
      h1Lines[0],
      filePath
    ));
  }

  // Rule: heading-hierarchy (h1→h3 without h2 is a skip)
  let prevLevel = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const hMatch = lines[i].match(/^(#{1,6})\s/);
    if (!hMatch) continue;
    const level = hMatch[1].length;
    if (prevLevel > 0 && level > prevLevel + 1) {
      warnings.push(normalizeFinding(
        'heading-hierarchy',
        `Heading level skipped: H${prevLevel} → H${level} (expected H${prevLevel + 1}).`,
        i + 1,
        filePath
      ));
    }
    prevLevel = level;
  }

  // Rule: duplicate-heading (scope-aware: H3-H6 scoped under nearest parent)
  const headingSeen = new Map();
  const parentStack = new Array(7).fill(''); // indices 1-6 for heading levels
  for (let i = 0; i < lines.length; i += 1) {
    const hMatch = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (!hMatch) continue;
    const level = hMatch[1].length;
    const text = hMatch[2].trim().toLowerCase();

    // Update parent stack: set current level and clear deeper levels
    parentStack[level] = text;
    for (let l = level + 1; l <= 6; l += 1) parentStack[l] = '';

    // H1-H2: global scope; H3-H6: scoped under parent chain
    let key;
    if (level <= 2) {
      key = `${level}:${text}`;
    } else {
      const scope = parentStack.slice(1, level).join('|');
      key = `${scope}|${level}:${text}`;
    }

    if (headingSeen.has(key)) {
      warnings.push(normalizeFinding(
        'duplicate-heading',
        `Duplicate heading "${hMatch[2].trim()}" (also at line ${headingSeen.get(key)}).`,
        i + 1,
        filePath
      ));
    } else {
      headingSeen.set(key, i + 1);
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

  // Rule: empty-link (uses stripped content, excludes images)
  lines.forEach((line, idx) => {
    const cleanLine = stripInlineCode(line);
    // [](url) — empty link text (but not ![](url) which is img-alt)
    if (/(?<!!)\[\]\([^)]+\)/.test(cleanLine)) {
      warnings.push(normalizeFinding('empty-link', 'Link has empty text: [](url).', idx + 1, filePath));
    }
    // [text]() — empty link URL
    if (/(?<!!)\[[^\]]+\]\(\s*\)/.test(cleanLine)) {
      warnings.push(normalizeFinding('empty-link', 'Link has empty URL: [text]().', idx + 1, filePath));
    }
  });

  // Rule: img-alt (uses stripped content)
  lines.forEach((line, idx) => {
    const cleanLine = stripInlineCode(line);
    if (/!\[\]\([^)]+\)/.test(cleanLine)) {
      warnings.push(normalizeFinding('img-alt', 'Image missing alt text: ![](url).', idx + 1, filePath));
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
          bucket.push(normalizeFinding(rule.id, rule.message, idx + 1, filePath, rule.severity));
        }
      }
    });
  }

  // Apply inline suppressions + file-level suppression
  const isFileSuppressed = (f) =>
    fileDisabledRules && (fileDisabledRules.has(f.code));
  const filteredErrors = errors.filter(f => !isSuppressed(suppressions, f) && !isFileSuppressed(f));
  const filteredWarnings = warnings.filter(f => !isSuppressed(suppressions, f) && !isFileSuppressed(f));

  return {
    errors: filteredErrors,
    warnings: filteredWarnings,
    summary: {
      errors: filteredErrors.length,
      warnings: filteredWarnings.length
    }
  };
}

export { DEFAULTS, RULE_SEVERITY, RULE_CATALOG, normalizeFinding, checkMarkdown, stripCodeBlocks, stripInlineCode };
