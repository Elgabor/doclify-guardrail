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

function appliesTo(ruleIds, ruleId) {
  return ruleIds === null || Array.isArray(ruleIds) && ruleIds.includes(ruleId);
}

function createSuppressionMatcher(content) {
  const lines = normalizeLineEndings(content).split('\n');
  const fences = analyzeFences(lines);
  const suppressions = [];
  const fileRules = [];
  const nextLine = new Map();
  const blocks = [];
  const active = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (fences.inFence[index]) continue;
    const line = lines[index];
    const fileMatch = line.match(DIRECTIVES[0].pattern);
    if (fileMatch) {
      const rules = parseRuleIds(fileMatch[1]);
      suppressions.push({ scope: 'file', rules, line: index + 1 });
      fileRules.push(rules);
      continue;
    }
    const nextMatch = line.match(DIRECTIVES[1].pattern);
    if (nextMatch) {
      const rules = parseRuleIds(nextMatch[1]);
      suppressions.push({ scope: 'next-line', rules, line: index + 1 });
      nextLine.set(index + 2, rules);
      continue;
    }
    const endMatch = line.match(DIRECTIVES[2].pattern);
    if (endMatch) {
      const rules = parseRuleIds(endMatch[1]);
      for (let activeIndex = active.length - 1; activeIndex >= 0; activeIndex -= 1) {
        if (rules == null || active[activeIndex].rules == null || active[activeIndex].rules.some((id) => rules.includes(id))) {
          active.splice(activeIndex, 1)[0].end = index + 1;
          break;
        }
      }
      suppressions.push({ scope: 'block-end', rules, line: index + 1 });
      continue;
    }
    const startMatch = line.match(DIRECTIVES[3].pattern);
    if (startMatch) {
      const rules = parseRuleIds(startMatch[1]);
      const block = { rules, start: index + 1, end: Number.POSITIVE_INFINITY };
      active.push(block);
      blocks.push(block);
      suppressions.push({ scope: 'block-start', rules, line: index + 1 });
    }
  }
  return {
    suppressions,
    isSuppressed(ruleId, lineNumber) {
      return fileRules.some((rules) => appliesTo(rules, ruleId))
        || appliesTo(nextLine.get(lineNumber), ruleId)
        || blocks.some((block) => lineNumber >= block.start && lineNumber < block.end && appliesTo(block.rules, ruleId));
    }
  };
}

function isSuppressed(content, ruleId, lineNumber) {
  return createSuppressionMatcher(content).isSuppressed(ruleId, lineNumber);
}

export { createSuppressionMatcher, findSuppressions, isSuppressed };
