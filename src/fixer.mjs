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
  let inCodeBlock = false;
  let fenceChar = null;
  let fenceLen = 0;

  const processedLines = lines.map((line) => {
    // Track fenced code blocks (same logic as stripCodeBlocks in checker.mjs)
    if (!inCodeBlock) {
      const fenceMatch = line.match(/^(`{3,}|~{3,})/);
      if (fenceMatch) {
        inCodeBlock = true;
        fenceChar = fenceMatch[1][0];
        fenceLen = fenceMatch[1].length;
        return line;
      }
    } else {
      const closeMatch = line.match(/^(`{3,}|~{3,})\s*$/);
      if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= fenceLen) {
        inCodeBlock = false;
        fenceChar = null;
        fenceLen = 0;
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

export { autoFixInsecureLinks, isAmbiguousHttpUrl };
