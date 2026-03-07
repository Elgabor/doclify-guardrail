import { normalizeFinding } from './checker.mjs';
import { extractFrontmatter, normalizeLineEndings } from './text-normalize.mjs';

const DEFAULT_FRESHNESS_DAYS = 180;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeDocHealthScore({ errors = 0, warnings = 0 }) {
  const errorPenalty = errors * 20;
  const warningPenalty = warnings > 0
    ? 5 * Math.sqrt(warnings) + (warnings * 2)
    : 0;
  const raw = 100 - errorPenalty - warningPenalty;
  return clamp(Math.round(raw), 0, 100);
}

function parseIsoDate(value) {
  if (!value || typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/^['"]|['"]$/g, '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return null;
  const [yearStr, monthStr, dayStr] = cleaned.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getUTCFullYear() !== year
    || (date.getUTCMonth() + 1) !== month
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function findFreshnessDate(content) {
  const normalized = normalizeLineEndings(content);
  const frontmatter = extractFrontmatter(normalized);
  if (frontmatter) {
    const lines = frontmatter.body.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const m = line.match(/^\s*(updated|last_updated|lastModified|date)\s*:\s*(.+)\s*$/i);
      if (!m) continue;
      const parsed = parseIsoDate(m[2]);
      return {
        kind: parsed ? 'valid' : 'invalid',
        rawValue: String(m[2] || '').trim(),
        date: parsed,
        source: m[1],
        line: frontmatter.startLine + i
      };
    }
  }

  const lines = normalized.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/last\s*updated\s*:\s*(.+?)\s*$/i);
    if (!m) continue;
    const parsed = parseIsoDate(m[1]);
    return {
      kind: parsed ? 'valid' : 'invalid',
      rawValue: String(m[1] || '').trim(),
      date: parsed,
      source: 'last-updated',
      line: i + 1
    };
  }

  return { kind: 'missing', line: 1 };
}

function checkDocFreshness(content, opts = {}) {
  const sourceFile = opts.sourceFile || undefined;
  const now = opts.now instanceof Date ? opts.now : new Date();
  const maxAgeDays = Number.isInteger(opts.maxAgeDays) ? opts.maxAgeDays : DEFAULT_FRESHNESS_DAYS;
  const findings = [];

  const found = findFreshnessDate(content);
  if (found.kind === 'missing') {
    findings.push(normalizeFinding(
      'stale-doc',
      `No freshness date found. Add frontmatter \`updated: YYYY-MM-DD\` (max ${maxAgeDays} days).`,
      found.line,
      sourceFile
    ));
    return findings;
  }

  if (found.kind === 'invalid') {
    findings.push(normalizeFinding(
      'stale-doc',
      `Invalid freshness date "${found.rawValue}". Use a real calendar date in \`YYYY-MM-DD\` format.`,
      found.line,
      sourceFile
    ));
    return findings;
  }

  const ageDays = Math.floor((now.getTime() - found.date.getTime()) / 86400000);
  if (ageDays < 0) {
    findings.push(normalizeFinding(
      'stale-doc',
      `Freshness date is in the future: ${found.rawValue}. Use a date not later than today.`,
      found.line,
      sourceFile
    ));
    return findings;
  }
  if (ageDays > maxAgeDays) {
    findings.push(normalizeFinding(
      'stale-doc',
      `Document appears stale: ${ageDays} days old (max ${maxAgeDays}).`,
      found.line,
      sourceFile
    ));
  }

  return findings;
}

export { computeDocHealthScore, checkDocFreshness, DEFAULT_FRESHNESS_DAYS };
