import { analyzeFences, getFenceOpen, isFenceClose } from './fences.mjs';

function isAmbiguousHttpUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const hasCustomPort = parsed.port && parsed.port !== '80';
    return isLocalhost || hasCustomPort;
  } catch {
    return true;
  }
}

function autoFixInsecureLinks(content) {
  const changes = [];
  const ambiguous = [];

  const lines = content.split('\n');
  let activeFence = null;

  const processedLines = lines.map((line) => {
    // Track fenced code blocks (same logic as stripCodeBlocks in checker.mjs)
    if (!activeFence) {
      const open = getFenceOpen(line);
      if (open) {
        activeFence = { char: open.char, length: open.length };
        return line;
      }
    } else {
      if (isFenceClose(line, activeFence)) {
        activeFence = null;
      }
      return line;
    }

    // Outside code blocks: replace http:// but skip inline code spans
    return line.replace(/(`[^`]*`)|http:\/\/\S+/g, (match, inlineCode) => {
      if (inlineCode) return inlineCode;

      const raw = match;
      const cleaned = raw.replace(/[),.;!?]+$/g, '');
      if (isAmbiguousHttpUrl(cleaned)) {
        ambiguous.push(cleaned);
        return raw;
      }

      const replaced = raw.replace('http://', 'https://');
      if (replaced !== raw) {
        changes.push({ from: cleaned, to: cleaned.replace('http://', 'https://') });
      }
      return replaced;
    });
  });

  const fixed = processedLines.join('\n');

  return {
    content: fixed,
    modified: fixed !== content,
    changes,
    ambiguous
  };
}

function autoFixFormatting(content) {
  const changes = [];
  let lines = content.split('\n');

  const firstFenceAnalysis = analyzeFences(lines);
  const inCode = firstFenceAnalysis.inFence;

  // Pass 1: line-level fixes
  lines = lines.map((line, i) => {
    if (inCode[i]) return line;
    let fixed = line;

    // Fix: trailing spaces
    const trimmed = fixed.replace(/[ \t]+$/, '');
    if (trimmed !== fixed) { changes.push({ rule: 'no-trailing-spaces', line: i + 1 }); fixed = trimmed; }

    // Fix: missing space after # in heading
    const atxMatch = fixed.match(/^(#{1,6})([^\s#])/);
    if (atxMatch) { changes.push({ rule: 'no-missing-space-atx', line: i + 1 }); fixed = atxMatch[1] + ' ' + fixed.slice(atxMatch[1].length); }

    // Fix: indented heading
    const indentMatch = fixed.match(/^(\s+)(#{1,6}\s)/);
    if (indentMatch) { changes.push({ rule: 'heading-start-left', line: i + 1 }); fixed = fixed.trimStart(); }

    // Fix: trailing punctuation in heading
    const hMatch = fixed.match(/^(#{1,6}\s+.+?)([.,:;!])$/);
    if (hMatch) { changes.push({ rule: 'no-trailing-punctuation-heading', line: i + 1 }); fixed = hMatch[1]; }

    // Fix: reversed links (text)[url] → [text](url)
    fixed = fixed.replace(/\(([^)]+)\)\[([^\]]+)\]/g, (match, text, url) => {
      changes.push({ rule: 'no-reversed-links', line: i + 1 });
      return `[${text}](${url})`;
    });

    // Fix: spaces in emphasis ** text ** → **text**
    fixed = fixed.replace(/\*\*\s+([^*]+?)\s+\*\*/g, (match, inner) => {
      changes.push({ rule: 'no-space-in-emphasis', line: i + 1 });
      return `**${inner}**`;
    });
    fixed = fixed.replace(/(?<!\*)\*\s+([^*]+?)\s+\*(?!\*)/g, (match, inner) => {
      changes.push({ rule: 'no-space-in-emphasis', line: i + 1 });
      return `*${inner}*`;
    });

    // Fix: spaces in links [ text ](url) → [text](url)
    fixed = fixed.replace(/\[\s+([^\]]*?)\s*\]\(/g, (match, text) => {
      changes.push({ rule: 'no-space-in-links', line: i + 1 });
      return `[${text}](`;
    });
    fixed = fixed.replace(/\]\(\s+([^)]*?)\s*\)/g, (match, url) => {
      changes.push({ rule: 'no-space-in-links', line: i + 1 });
      return `](${url})`;
    });

    // Fix: bare URLs → wrap in <>
    fixed = fixed.replace(/(`[^`]*`)|(?<![(<\[])\bhttps?:\/\/[^\s>)]+/g, (match, code) => {
      if (code) return code;
      // Don't wrap if already inside markdown link or reference
      changes.push({ rule: 'no-bare-urls', line: i + 1 });
      return `<${match}>`;
    });

    return fixed;
  });

  // Pass 2: multi-line fixes (blanks around headings/lists/fences, multiple blanks)
  const result = [];
  const isListItem = (l) => /^\s*[-*+]\s|^\s*\d+[.)]\s/.test(l);
  const isHeading = (l) => /^#{1,6}\s/.test(l);
  const secondFenceAnalysis = analyzeFences(lines);
  const inCode2 = secondFenceAnalysis.inFence;
  const openingFences = secondFenceAnalysis.opening;
  const closingFences = secondFenceAnalysis.closing;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const isBlank = line.trim() === '';
    const codeFlag = inCode2[i];
    const lastOutput = result[result.length - 1];
    const prevBlank = lastOutput === undefined || lastOutput.trim() === '';

    // Fix: multiple consecutive blanks (outside code blocks)
    if (isBlank && !codeFlag && prevBlank) {
      changes.push({ rule: 'no-multiple-blanks', line: i + 1 });
      continue; // skip extra blank
    }

    // Fix: blank before heading/list/fence (only if not already preceded by blank)
    if (!prevBlank && !isBlank) {
      const needsBlankBefore =
        (!codeFlag && isHeading(line)) ||
        (!codeFlag && isListItem(line) && i > 0 && !isListItem(lines[i - 1])) ||
        openingFences.has(i);
      if (needsBlankBefore) {
        const ruleId =
          openingFences.has(i)
            ? 'blanks-around-fences'
            : isHeading(line)
              ? 'blanks-around-headings'
              : 'blanks-around-lists';
        changes.push({ rule: ruleId, line: i + 1 });
        result.push('');
      }
    }

    result.push(line);

    // Fix: blank after heading/fence-close/last-list-item
    if (!isBlank) {
      const nextLine = lines[i + 1];
      const nextIsBlank = nextLine === undefined || nextLine.trim() === '';
      if (!nextIsBlank && nextLine !== undefined) {
        const nextCode = inCode2[i + 1];
        const needsBlankAfter =
          (!codeFlag && !nextCode && isHeading(line)) ||
          (!codeFlag && !nextCode && isListItem(line) && !isListItem(nextLine)) ||
          closingFences.has(i);

        if (needsBlankAfter) {
          const ruleId =
            closingFences.has(i)
              ? 'blanks-around-fences'
              : isHeading(line)
                ? 'blanks-around-headings'
                : 'blanks-around-lists';
          changes.push({ rule: ruleId, line: i + 1 });
          result.push('');
        }
      }
    }
  }

  // Fix: single trailing newline
  let fixed = result.join('\n');
  if (fixed.length > 0) {
    const trimmedEnd = fixed.replace(/\n+$/, '');
    if (trimmedEnd + '\n' !== fixed) {
      changes.push({ rule: 'single-trailing-newline', line: result.length });
      fixed = trimmedEnd + '\n';
    }
  }

  return {
    content: fixed,
    modified: fixed !== content,
    changes
  };
}

export { autoFixInsecureLinks, autoFixFormatting, isAmbiguousHttpUrl };
