// The three consumers deliberately recognize different URL grammars.
function scanInlineLinks(text, mode) {
  if (!['link', 'claim', 'heading'].includes(mode)) throw new Error('Unknown inline link mode.');
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
    } else if (!/\s/.test(character)) {
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
