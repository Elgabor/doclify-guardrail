/**
 * Doclify Guardrail — Programmatic API
 *
 * Usage:
 *   import { lint, fix, score } from 'doclify-guardrail/api';
 *
 *   const result = lint('# Hello\n\nWorld\n');
 *   const fixed  = fix('##Bad heading\n');
 *   const s      = score({ errors: 0, warnings: 3 });
 */

import { checkMarkdown, RULE_CATALOG } from './checker.mjs';
import { autoFixInsecureLinks, autoFixFormatting } from './fixer.mjs';
import { computeDocHealthScore } from './quality.mjs';

/**
 * Lint a Markdown string and return findings.
 * @param {string} content - Markdown content
 * @param {object} [opts]
 * @param {number} [opts.maxLineLength=160]
 * @param {string} [opts.filePath='<input>']
 * @param {boolean} [opts.checkFrontmatter=false]
 * @param {boolean} [opts.checkInlineHtml=false]
 * @param {Array}  [opts.customRules=[]]
 * @param {Set|string[]} [opts.ignoreRules=[]]
 * @returns {{ errors: object[], warnings: object[], healthScore: number, pass: boolean }}
 */
function lint(content, opts = {}) {
  const {
    maxLineLength = 160,
    filePath = '<input>',
    checkFrontmatter = false,
    checkInlineHtml = false,
    customRules = [],
    ignoreRules = []
  } = opts;

  const ignore = ignoreRules instanceof Set ? ignoreRules : new Set(ignoreRules);

  const analysis = checkMarkdown(content, {
    maxLineLength,
    filePath,
    customRules,
    checkFrontmatter,
    checkInlineHtml
  });

  let errors = analysis.errors;
  let warnings = analysis.warnings;

  if (ignore.size > 0) {
    errors = errors.filter(f => !ignore.has(f.code));
    warnings = warnings.filter(f => !ignore.has(f.code));
  }

  const healthScore = computeDocHealthScore({
    errors: errors.length,
    warnings: warnings.length
  });

  const strict = Boolean(opts.strict);
  const pass = errors.length === 0 && (!strict || warnings.length === 0);

  return { errors, warnings, healthScore, pass };
}

/**
 * Auto-fix a Markdown string and return the fixed content.
 * @param {string} content - Markdown content
 * @returns {{ content: string, modified: boolean, changes: object[] }}
 */
function fix(content) {
  // 1. Insecure links first
  const linkResult = autoFixInsecureLinks(content);
  let current = linkResult.content;
  const allChanges = linkResult.changes.map(ch => ({ rule: 'insecure-link', ...ch }));

  // 2. Formatting fixes
  const formatResult = autoFixFormatting(current);
  current = formatResult.content;
  allChanges.push(...formatResult.changes);

  return {
    content: current,
    modified: current !== content,
    changes: allChanges
  };
}

/**
 * Compute a health score from error/warning counts.
 * @param {{ errors: number, warnings: number }} counts
 * @returns {number} Score 0-100
 */
function score(counts) {
  return computeDocHealthScore(counts);
}

export { lint, fix, score, RULE_CATALOG };
