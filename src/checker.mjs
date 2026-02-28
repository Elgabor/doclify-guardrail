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
  { id: 'stale-doc',          severity: 'warning', description: 'Warn on stale docs (requires --check-freshness)' },
  { id: 'no-trailing-spaces',          severity: 'warning', description: 'No trailing whitespace' },
  { id: 'no-multiple-blanks',          severity: 'warning', description: 'No multiple consecutive blank lines' },
  { id: 'single-trailing-newline',     severity: 'warning', description: 'File must end with a single newline' },
  { id: 'no-missing-space-atx',        severity: 'warning', description: 'Space required after # in headings' },
  { id: 'heading-start-left',          severity: 'warning', description: 'Headings must not be indented' },
  { id: 'no-trailing-punctuation-heading', severity: 'warning', description: 'No trailing punctuation in headings' },
  { id: 'blanks-around-headings',      severity: 'warning', description: 'Blank line required around headings' },
  { id: 'blanks-around-lists',         severity: 'warning', description: 'Blank line required around lists' },
  { id: 'blanks-around-fences',        severity: 'warning', description: 'Blank line required around fenced code blocks' },
  { id: 'fenced-code-language',        severity: 'warning', description: 'Fenced code blocks must specify a language' },
  { id: 'no-bare-urls',                severity: 'warning', description: 'URLs must be wrapped in <> or []()' },
  { id: 'no-reversed-links',           severity: 'warning', description: 'No reversed link syntax (text)[url]' },
  { id: 'no-space-in-emphasis',        severity: 'warning', description: 'No spaces inside emphasis markers' },
  { id: 'no-space-in-links',           severity: 'warning', description: 'No spaces inside link brackets' },
  { id: 'no-inline-html',              severity: 'warning', description: 'No inline HTML (opt-in via --check-inline-html)' },
  { id: 'no-empty-sections',            severity: 'warning', description: 'No empty sections (heading with no content before next heading)' },
  { id: 'heading-increment',            severity: 'warning', description: 'Heading levels should increment by one' },
  { id: 'no-duplicate-links',           severity: 'warning', description: 'No identical links repeated in same section' },
  { id: 'list-marker-consistency',       severity: 'warning', description: 'Consistent list markers (all - or all * or all +)' },
  { id: 'link-title-style',             severity: 'warning', description: 'Link titles should use consistent quotes' }
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

  // Rule: no-trailing-spaces (uses raw content)
  rawLines.forEach((line, idx) => {
    if (/[ \t]+$/.test(line)) {
      warnings.push(normalizeFinding('no-trailing-spaces', 'Trailing whitespace found.', idx + 1, filePath));
    }
  });

  // Rule: no-multiple-blanks (uses raw content)
  {
    let consecutiveBlanks = 0;
    rawLines.forEach((line, idx) => {
      if (line.trim() === '') {
        consecutiveBlanks += 1;
        if (consecutiveBlanks >= 2) {
          warnings.push(normalizeFinding('no-multiple-blanks', 'Multiple consecutive blank lines.', idx + 1, filePath));
        }
      } else {
        consecutiveBlanks = 0;
      }
    });
  }

  // Rule: single-trailing-newline (uses raw content)
  if (rawContent.length > 0) {
    if (!rawContent.endsWith('\n')) {
      warnings.push(normalizeFinding('single-trailing-newline', 'File must end with a single newline.', rawLines.length, filePath));
    } else if (rawContent.endsWith('\n\n')) {
      warnings.push(normalizeFinding('single-trailing-newline', 'File has multiple trailing newlines.', rawLines.length, filePath));
    }
  }

  // Rule: no-missing-space-atx (uses stripped content)
  lines.forEach((line, idx) => {
    if (/^#{1,6}[^\s#]/.test(line)) {
      warnings.push(normalizeFinding('no-missing-space-atx', 'Missing space after # in heading.', idx + 1, filePath));
    }
  });

  // Rule: heading-start-left (uses stripped content)
  lines.forEach((line, idx) => {
    if (/^\s+#{1,6}\s/.test(line)) {
      warnings.push(normalizeFinding('heading-start-left', 'Heading must start at the beginning of the line.', idx + 1, filePath));
    }
  });

  // Rule: no-trailing-punctuation-heading (uses stripped content)
  lines.forEach((line, idx) => {
    const hMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (hMatch) {
      const text = hMatch[1].trim();
      if (/[.,:;!]$/.test(text)) {
        warnings.push(normalizeFinding('no-trailing-punctuation-heading', `Heading has trailing punctuation: "${text.slice(-1)}".`, idx + 1, filePath));
      }
    }
  });

  // Rule: blanks-around-headings (uses stripped content)
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^#{1,6}\s/.test(lines[i])) continue;
    // Check line before heading (skip first line, skip frontmatter end)
    if (i > 0 && lines[i - 1].trim() !== '' && lines[i - 1] !== '---') {
      warnings.push(normalizeFinding('blanks-around-headings', 'Missing blank line before heading.', i + 1, filePath));
    }
    // Check line after heading
    if (i < lines.length - 1 && lines[i + 1].trim() !== '') {
      warnings.push(normalizeFinding('blanks-around-headings', 'Missing blank line after heading.', i + 1, filePath));
    }
  }

  // Rule: blanks-around-lists (uses stripped content)
  {
    const isListItem = (l) => /^\s*[-*+]\s|^\s*\d+[.)]\s/.test(l);
    for (let i = 0; i < lines.length; i += 1) {
      if (!isListItem(lines[i])) continue;
      // First list item — check blank before
      if (i > 0 && !isListItem(lines[i - 1]) && lines[i - 1].trim() !== '') {
        warnings.push(normalizeFinding('blanks-around-lists', 'Missing blank line before list.', i + 1, filePath));
      }
      // Last list item — check blank after
      if (i < lines.length - 1 && !isListItem(lines[i + 1]) && lines[i + 1].trim() !== '') {
        warnings.push(normalizeFinding('blanks-around-lists', 'Missing blank line after list.', i + 1, filePath));
      }
    }
  }

  // Rule: blanks-around-fences (uses raw content to detect fence lines)
  {
    let inFence = false;
    for (let i = 0; i < rawLines.length; i += 1) {
      const isFence = /^(`{3,}|~{3,})/.test(rawLines[i]);
      if (isFence && !inFence) {
        // Opening fence — check blank before
        inFence = true;
        if (i > 0 && rawLines[i - 1].trim() !== '') {
          warnings.push(normalizeFinding('blanks-around-fences', 'Missing blank line before code block.', i + 1, filePath));
        }
      } else if (isFence && inFence) {
        // Closing fence — check blank after
        inFence = false;
        if (i < rawLines.length - 1 && rawLines[i + 1].trim() !== '') {
          warnings.push(normalizeFinding('blanks-around-fences', 'Missing blank line after code block.', i + 1, filePath));
        }
      }
    }
  }

  // Rule: fenced-code-language (uses raw content)
  rawLines.forEach((line, idx) => {
    if (/^(`{3,}|~{3,})\s*$/.test(line)) {
      // Only flag opening fences (not closing ones). Check if we're not inside a fence.
      // Simple heuristic: count fences above this line
      let fenceCount = 0;
      for (let j = 0; j < idx; j += 1) {
        if (/^(`{3,}|~{3,})/.test(rawLines[j])) fenceCount += 1;
      }
      if (fenceCount % 2 === 0) {
        // Even count → this is an opening fence
        warnings.push(normalizeFinding('fenced-code-language', 'Fenced code block without language specification.', idx + 1, filePath));
      }
    }
  });

  // Rule: no-bare-urls (uses stripped content)
  lines.forEach((line, idx) => {
    const cleanLine = stripInlineCode(line);
    // Match bare URLs not inside []() or <>
    const bareRx = /(?<![(<\[])\bhttps?:\/\/[^\s>)]+/g;
    let m;
    while ((m = bareRx.exec(cleanLine)) !== null) {
      const url = m[0];
      const before = cleanLine.substring(0, m.index);
      // Skip if inside markdown link [text](url) or <url>
      if (/\]\($/.test(before) || before.endsWith('<')) continue;
      // Skip if inside reference-style [label]: url
      if (/^\[[^\]]*\]:\s*/.test(cleanLine)) continue;
      warnings.push(normalizeFinding('no-bare-urls', `Bare URL found: ${url} — wrap in <> or use [text](url).`, idx + 1, filePath));
    }
  });

  // Rule: no-reversed-links (uses stripped content)
  lines.forEach((line, idx) => {
    const cleanLine = stripInlineCode(line);
    if (/\([^)]+\)\[[^\]]+\]/.test(cleanLine)) {
      warnings.push(normalizeFinding('no-reversed-links', 'Reversed link syntax: (text)[url] should be [text](url).', idx + 1, filePath));
    }
  });

  // Rule: no-space-in-emphasis (uses stripped content)
  lines.forEach((line, idx) => {
    const cleanLine = stripInlineCode(line);
    if (/\*\*\s+[^*]+\s+\*\*/.test(cleanLine) || /\*\s+[^*]+\s+\*(?!\*)/.test(cleanLine)) {
      warnings.push(normalizeFinding('no-space-in-emphasis', 'Spaces inside emphasis markers — may not render correctly.', idx + 1, filePath));
    }
  });

  // Rule: no-space-in-links (uses stripped content)
  lines.forEach((line, idx) => {
    const cleanLine = stripInlineCode(line);
    if (/\[\s+[^\]]*\]\(/.test(cleanLine) || /\[[^\]]*\s+\]\(/.test(cleanLine)) {
      warnings.push(normalizeFinding('no-space-in-links', 'Spaces inside link text brackets.', idx + 1, filePath));
    }
    if (/\]\(\s+[^)]*\)/.test(cleanLine) || /\]\([^)]*\s+\)/.test(cleanLine)) {
      warnings.push(normalizeFinding('no-space-in-links', 'Spaces inside link URL parentheses.', idx + 1, filePath));
    }
  });

  // Rule: no-inline-html (opt-in via --check-inline-html or config)
  if (opts.checkInlineHtml) {
    lines.forEach((line, idx) => {
      const cleanLine = stripInlineCode(line);
      // Match HTML tags but skip comments (<!-- -->)
      if (/<[a-zA-Z/][^>]*>/.test(cleanLine) && !cleanLine.includes('<!--')) {
        warnings.push(normalizeFinding('no-inline-html', 'Inline HTML found.', idx + 1, filePath));
      }
    });
  }

  // Rule: no-empty-sections (heading followed immediately by another heading of SAME or HIGHER level)
  // Uses rawLines to avoid false positives on code blocks.
  // A heading followed by a deeper heading (subsection) is a valid container pattern.
  {
    let lastHeadingIdx = -1;
    let lastHeadingLevel = 0;
    let lastHeadingHadContent = true;
    for (let i = 0; i < rawLines.length; i += 1) {
      const line = rawLines[i];
      const hm = line.match(/^(#{1,6})\s/);
      if (hm) {
        const level = hm[1].length;
        if (lastHeadingIdx >= 0 && !lastHeadingHadContent && level <= lastHeadingLevel) {
          warnings.push(normalizeFinding('no-empty-sections', 'Empty section — heading has no content before next heading.', lastHeadingIdx + 1, filePath));
        }
        lastHeadingIdx = i;
        lastHeadingLevel = level;
        lastHeadingHadContent = false;
      } else if (line.trim() !== '' && lastHeadingIdx >= 0) {
        lastHeadingHadContent = true;
      }
    }
  }

  // Rule: heading-increment (heading level should only increase by 1)
  {
    let prevLevel = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(/^(#{1,6})\s/);
      if (m) {
        const level = m[1].length;
        if (prevLevel > 0 && level > prevLevel + 1) {
          warnings.push(normalizeFinding('heading-increment', `Heading level jumped from H${prevLevel} to H${level}.`, i + 1, filePath));
        }
        prevLevel = level;
      }
    }
  }

  // Rule: no-duplicate-links (same URL appearing multiple times)
  {
    const linkUrls = new Map();
    lines.forEach((line, idx) => {
      const cleanLine = stripInlineCode(line);
      const linkRx = /\[([^\]]*)\]\(([^)]+)\)/g;
      let lm;
      while ((lm = linkRx.exec(cleanLine)) !== null) {
        const url = lm[2].split(/[#?]/)[0].trim();
        if (url.length === 0) continue;
        if (linkUrls.has(url)) {
          warnings.push(normalizeFinding('no-duplicate-links', `Duplicate link: ${url} (also on line ${linkUrls.get(url)}).`, idx + 1, filePath));
        } else {
          linkUrls.set(url, idx + 1);
        }
      }
    });
  }

  // Rule: list-marker-consistency (all unordered lists should use same marker)
  {
    const markers = new Map();
    rawLines.forEach((line, idx) => {
      const m = line.match(/^(\s*)([-*+])\s/);
      if (m) {
        const marker = m[2];
        if (!markers.has(marker)) markers.set(marker, []);
        markers.get(marker).push(idx + 1);
      }
    });
    if (markers.size > 1) {
      // Find the most common marker
      let dominantMarker = '-';
      let maxCount = 0;
      for (const [marker, lineNums] of markers) {
        if (lineNums.length > maxCount) {
          maxCount = lineNums.length;
          dominantMarker = marker;
        }
      }
      for (const [marker, lineNums] of markers) {
        if (marker !== dominantMarker) {
          for (const lineNum of lineNums) {
            warnings.push(normalizeFinding('list-marker-consistency', `List marker '${marker}' differs from dominant '${dominantMarker}'.`, lineNum, filePath));
          }
        }
      }
    }
  }

  // Rule: link-title-style (link titles should use consistent quotes)
  {
    const titleStyles = new Map();
    lines.forEach((line, idx) => {
      const cleanLine = stripInlineCode(line);
      const rx = /\]\([^)]*\s+(["'])[^"']*\1\s*\)/g;
      let tm;
      while ((tm = rx.exec(cleanLine)) !== null) {
        const quoteChar = tm[1];
        if (!titleStyles.has(quoteChar)) titleStyles.set(quoteChar, []);
        titleStyles.get(quoteChar).push(idx + 1);
      }
    });
    if (titleStyles.size > 1) {
      let dominantQuote = '"';
      let maxCount = 0;
      for (const [q, lineNums] of titleStyles) {
        if (lineNums.length > maxCount) {
          maxCount = lineNums.length;
          dominantQuote = q;
        }
      }
      for (const [q, lineNums] of titleStyles) {
        if (q !== dominantQuote) {
          for (const lineNum of lineNums) {
            warnings.push(normalizeFinding('link-title-style', `Link title uses '${q}' but '${dominantQuote}' is dominant.`, lineNum, filePath));
          }
        }
      }
    }
  }

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
