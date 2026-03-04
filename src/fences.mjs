const FENCE_OPEN_RX = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;

function getFenceOpen(line) {
  const match = line.match(FENCE_OPEN_RX);
  if (!match) return null;
  return {
    char: match[1][0],
    length: match[1].length,
    info: match[2] || ''
  };
}

function isFenceClose(line, activeFence) {
  if (!activeFence) return false;
  const marker = activeFence.char === '`' ? '`' : '~';
  const rx = new RegExp(`^[ \\t]{0,3}${marker}{${activeFence.length},}[ \\t]*$`);
  return rx.test(line);
}

function analyzeFences(lines) {
  const inFence = new Array(lines.length).fill(false);
  const opening = new Set();
  const closing = new Set();
  let activeFence = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const open = !activeFence ? getFenceOpen(line) : null;
    if (open) {
      opening.add(i);
      inFence[i] = true;
      activeFence = { char: open.char, length: open.length };
      continue;
    }

    if (activeFence) {
      inFence[i] = true;
      if (isFenceClose(line, activeFence)) {
        closing.add(i);
        activeFence = null;
      }
    }
  }

  return { inFence, opening, closing };
}

export { getFenceOpen, isFenceClose, analyzeFences };
