const NO_LINKS = Object.freeze([]);

function isWhitespace(code) {
  return code === 0x20 || (code >= 0x09 && code <= 0x0d)
    || code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f
    || code === 0x3000 || code === 0xfeff;
}

// The three consumers deliberately recognize different URL grammars.
function scanInlineLinks(text, mode) {
  if (mode !== 'link' && mode !== 'claim' && mode !== 'heading') throw new Error('Unknown inline link mode.');
  const opening = text.indexOf('[');
  if (opening < 0 || text.indexOf('](', opening) < 0) return NO_LINKS;
  const ends = new Int32Array(text.length + 1).fill(-1);
  let nextClose = -1;
  for (let offset = text.length - 1; offset >= 0; offset -= 1) {
    const character = text[offset];
    if (character === ')') {
      ends[offset] = offset;
      nextClose = offset;
    } else if (mode === 'heading') {
      ends[offset] = nextClose;
    } else if (mode === 'link' && character === '(') {
      // A parenthesized group accepts anything up to its first closing paren.
      ends[offset] = nextClose < 0 ? -1 : ends[nextClose + 1];
    } else if (!isWhitespace(text.charCodeAt(offset))) {
      ends[offset] = ends[offset + 1];
    }
  }

  const links = [];
  let labelStart = -1;
  for (let offset = 0; offset < text.length; offset += 1) {
    if (text[offset] === '[' && labelStart < 0) labelStart = offset;
    if (text[offset] !== ']') continue;
    if (labelStart >= 0 && text[offset + 1] === '(') {
      const start = offset + 2;
      const end = ends[start];
      if (end >= start && (mode !== 'claim' || end > start)
        && (mode !== 'heading' || offset > labelStart + 1)) {
        links.push({
          index: labelStart, end: end + 1,
          label: text.slice(labelStart + 1, offset), url: text.slice(start, end)
        });
        offset = end;
      }
    }
    // Inner opening brackets share the same next ']' and suffix result.
    labelStart = -1;
  }
  return links;
}

export { scanInlineLinks };
