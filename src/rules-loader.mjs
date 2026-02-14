import fs from 'node:fs';
import path from 'node:path';

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
