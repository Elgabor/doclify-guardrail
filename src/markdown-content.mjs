import { getFenceOpen, isFenceClose } from './fences.mjs';

function stripCodeBlocks(content) {
  const lines = String(content).split('\n');
  const result = [];
  let activeFence = null;
  for (const line of lines) {
    if (!activeFence) {
      const open = getFenceOpen(line);
      if (open) {
        activeFence = { char: open.char, length: open.length };
        result.push('');
      } else {
        result.push(line);
      }
    } else {
      if (isFenceClose(line, activeFence)) activeFence = null;
      result.push('');
    }
  }
  return result.join('\n');
}

function stripInlineCode(line) {
  return String(line).replace(/`[^`]+`/g, '');
}

export { stripCodeBlocks, stripInlineCode };
