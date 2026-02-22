import { normalizeFinding } from './checker.mjs';

const DEFAULT_FRESHNESS_DAYS = 180;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeDocHealthScore({ errors = 0, warnings = 0 }) {
  const raw = 100 - (errors * 25) - (warnings * 8);
  return clamp(Math.round(raw), 0, 100);
}

function extractFrontmatter(content) {
  if (!content.startsWith('---\n')) return null;
  const endIdx = content.indexOf('\n---\n', 4);
  if (endIdx === -1) return null;
  return {
    body: content.slice(4, endIdx),
    startLine: 2
  };
}

function parseIsoDate(value) {
  if (!value || typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/^['"]|['"]$/g, '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return null;
  const date = new Date(`${cleaned}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function findFreshnessDate(content) {
  const frontmatter = extractFrontmatter(content);
  if (frontmatter) {
    const lines = frontmatter.body.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const m = line.match(/^\s*(updated|last_updated|lastModified|date)\s*:\s*(.+)\s*$/i);
      if (!m) continue;
      const parsed = parseIsoDate(m[2]);
      if (parsed) {
        return {
          date: parsed,
          source: m[1],
          line: frontmatter.startLine + i
        };
      }
    }
  }

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/last\s*updated\s*:\s*(\d{4}-\d{2}-\d{2})/i);
    if (!m) continue;
    const parsed = parseIsoDate(m[1]);
    if (parsed) {
      return { date: parsed, source: 'last-updated', line: i + 1 };
    }
  }

  return null;
}

function checkDocFreshness(content, opts = {}) {
  const sourceFile = opts.sourceFile || undefined;
  const now = opts.now instanceof Date ? opts.now : new Date();
  const maxAgeDays = Number.isInteger(opts.maxAgeDays) ? opts.maxAgeDays : DEFAULT_FRESHNESS_DAYS;
  const findings = [];

  const found = findFreshnessDate(content);
  if (!found) {
    findings.push(normalizeFinding(
      'stale-doc',
      `No freshness date found. Add frontmatter \`updated: YYYY-MM-DD\` (max ${maxAgeDays} days).`,
      1,
      sourceFile
    ));
    return findings;
  }

  const ageDays = Math.floor((now.getTime() - found.date.getTime()) / 86400000);
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
