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

  const fixed = content.replace(/http:\/\/\S+/g, (raw) => {
    const cleaned = raw.replace(/[),.;!?]+$/g, '');
    if (isAmbiguousHttpUrl(cleaned)) {
      ambiguous.push(cleaned);
      return raw;
    }

    const replaced = raw.replace('http://', 'https://');
    if (replaced !== raw) {
      changes.push({ from: raw, to: replaced });
    }
    return replaced;
  });

  return {
    content: fixed,
    modified: fixed !== content,
    changes,
    ambiguous
  };
}

export { autoFixInsecureLinks, isAmbiguousHttpUrl };