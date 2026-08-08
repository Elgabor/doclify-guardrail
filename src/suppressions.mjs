import { analyzeFences } from './fences.mjs';
import { normalizeLineEndings } from './text-normalize.mjs';

const DIRECTIVES = [
  { scope: 'file', pattern: /<!--\s*doclify-disable-file\s*(.*?)\s*-->/ },
  { scope: 'next-line', pattern: /<!--\s*doclify-disable-next-line\s*(.*?)\s*-->/ },
  { scope: 'block-end', pattern: /<!--\s*doclify-enable\s*(.*?)\s*-->/ },
  { scope: 'block-start', pattern: /<!--\s*doclify-disable\s*(.*?)\s*-->/ }
];

function parseRuleIds(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  return trimmed.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean);
}

function findSuppressions(content) {
  const lines = normalizeLineEndings(content).split('\n');
  const fences = analyzeFences(lines);
  const suppressions = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (fences.inFence[index]) continue;
    for (const directive of DIRECTIVES) {
      const match = lines[index].match(directive.pattern);
      if (!match) continue;
      suppressions.push({
        scope: directive.scope,
        rules: parseRuleIds(match[1]),
        line: index + 1
      });
      break;
    }
  }

  return suppressions;
}

export { findSuppressions };
