import fs from 'node:fs';
import path from 'node:path';

function parseRegexQuantifier(pattern, startIndex) {
  const ch = pattern[startIndex];
  const maybeLazy = pattern[startIndex + 1] === '?';

  if (ch === '*' || ch === '+' || ch === '?') {
    if (ch === '+') {
      return { min: 1, max: Infinity, length: maybeLazy ? 2 : 1 };
    }
    if (ch === '*') {
      return { min: 0, max: Infinity, length: maybeLazy ? 2 : 1 };
    }
    return { min: 0, max: 1, length: maybeLazy ? 2 : 1 };
  }

  if (ch !== '{') return null;

  let idx = startIndex + 1;
  if (idx >= pattern.length || !/\d/.test(pattern[idx])) return null;

  while (idx < pattern.length && /\d/.test(pattern[idx])) idx += 1;
  const min = Number(pattern.slice(startIndex + 1, idx));

  let max = min;
  if (pattern[idx] === ',') {
    idx += 1;
    const maxStart = idx;
    while (idx < pattern.length && /\d/.test(pattern[idx])) idx += 1;
    const maxPart = pattern.slice(maxStart, idx);
    max = maxPart === '' ? Infinity : Number(maxPart);
  }

  if (pattern[idx] !== '}') return null;
  idx += 1;

  if (pattern[idx] === '?') idx += 1;

  return {
    min,
    max,
    length: idx - startIndex
  };
}

function allowsMultipleRepeats(quantifier) {
  return quantifier.max === Infinity || quantifier.max > 1;
}

function isVariableLengthQuantifier(quantifier) {
  return quantifier.max === Infinity || quantifier.min !== quantifier.max;
}

function hasNestedQuantifierRisk(pattern) {
  const groups = [{ hasVariableQuantifier: false }];
  let inCharClass = false;
  let lastToken = null;

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];

    if (ch === '\\') {
      i += 1;
      lastToken = { type: 'atom' };
      continue;
    }

    if (inCharClass) {
      if (ch === ']') inCharClass = false;
      continue;
    }

    if (ch === '[') {
      inCharClass = true;
      lastToken = { type: 'atom' };
      continue;
    }

    if (ch === '(') {
      groups.push({ hasVariableQuantifier: false });
      lastToken = null;
      continue;
    }

    if (ch === ')') {
      if (groups.length <= 1) {
        lastToken = { type: 'atom' };
        continue;
      }

      const closedGroup = groups.pop();
      groups[groups.length - 1].hasVariableQuantifier ||= closedGroup.hasVariableQuantifier;
      lastToken = {
        type: 'group',
        hasVariableQuantifier: closedGroup.hasVariableQuantifier
      };
      continue;
    }

    const quantifier = parseRegexQuantifier(pattern, i);
    if (quantifier) {
      if (
        lastToken?.type === 'group'
        && lastToken.hasVariableQuantifier
        && allowsMultipleRepeats(quantifier)
      ) {
        return true;
      }

      if (isVariableLengthQuantifier(quantifier)) {
        groups[groups.length - 1].hasVariableQuantifier = true;
      }

      i += quantifier.length - 1;
      lastToken = { type: 'quantifier' };
      continue;
    }

    lastToken = { type: 'atom' };
  }

  return false;
}

function assertRegexIsSafe(pattern, ruleId) {
  if (hasNestedQuantifierRisk(pattern)) {
    throw new Error(`Rule "${ruleId}": unsafe regex pattern (possible ReDoS via nested quantifier)`);
  }
}

/**
 * Load and validate custom rules from a JSON file.
 * @param {string} rulesPath - path to JSON rules file
 * @returns {Array} - validated rules with compiled RegExp
 */
function loadCustomRules(rulesPath) {
  const resolved = path.resolve(rulesPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Rules file not found: ${resolved}`);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid JSON in rules file (${resolved}): ${err.message}`);
  }

  if (!raw || !Array.isArray(raw.rules)) {
    throw new Error(`Rules file must contain { "rules": [...] }`);
  }

  return raw.rules.map((rule, index) => validateCustomRule(rule, index));
}

function validateCustomRule(rule, index) {
  if (!rule.id || typeof rule.id !== 'string') {
    throw new Error(`Rule at index ${index}: missing or invalid "id"`);
  }
  if (!rule.pattern || typeof rule.pattern !== 'string') {
    throw new Error(`Rule "${rule.id}": missing or invalid "pattern"`);
  }
  if (!rule.message || typeof rule.message !== 'string') {
    throw new Error(`Rule "${rule.id}": missing or invalid "message"`);
  }

  const severity = rule.severity || 'warning';
  if (severity !== 'error' && severity !== 'warning') {
    throw new Error(`Rule "${rule.id}": severity must be "error" or "warning"`);
  }

  assertRegexIsSafe(rule.pattern, rule.id);

  let compiledRegex;
  try {
    compiledRegex = new RegExp(rule.pattern, rule.flags || 'gi');
  } catch (err) {
    throw new Error(`Rule "${rule.id}": invalid regex pattern: ${err.message}`);
  }

  return {
    id: rule.id,
    severity,
    pattern: compiledRegex,
    message: rule.message
  };
}

export { loadCustomRules };
