import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const DEFAULT_HISTORY_FILE = '.doclify-history.json';

/**
 * Load score history from JSON file.
 * @param {string} [historyPath] - Path to history file
 * @returns {object[]} Array of history entries
 */
function loadHistory(historyPath = DEFAULT_HISTORY_FILE) {
  const resolved = path.resolve(historyPath);
  if (!fs.existsSync(resolved)) return [];
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Append a score entry to the history file.
 * @param {object} entry - { date, commit, avgScore, errors, warnings, filesScanned }
 * @param {string} [historyPath] - Path to history file
 */
function appendHistory(entry, historyPath = DEFAULT_HISTORY_FILE) {
  const resolved = path.resolve(historyPath);
  const history = loadHistory(resolved);
  history.push(entry);
  fs.writeFileSync(resolved, JSON.stringify(history, null, 2) + '\n', 'utf8');
}

/**
 * Get the current git commit hash (short).
 * @returns {string} Short commit hash or 'unknown'
 */
function getCurrentCommit() {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Check if the current score is a regression vs the last tracked entry.
 * @param {object[]} history - Score history array
 * @param {number} currentScore - Current average health score
 * @returns {{ regression: boolean, delta: number, prev: number, current: number }}
 */
function checkRegression(history, currentScore) {
  if (history.length === 0) {
    return { regression: false, delta: 0, prev: currentScore, current: currentScore };
  }
  const prev = history[history.length - 1].avgScore;
  const delta = currentScore - prev;
  return {
    regression: delta < 0,
    delta,
    prev,
    current: currentScore
  };
}

/**
 * Render an ASCII trend graph of score history.
 * @param {object[]} history - Score history array
 * @param {object} [opts]
 * @param {number} [opts.width=60] - Max width in columns
 * @param {number} [opts.height=8] - Height in rows
 * @param {boolean} [opts.ascii=false] - Use plain ASCII instead of Unicode bars
 * @returns {string} Multi-line string
 */
function renderTrend(history, opts = {}) {
  if (history.length === 0) return '  No data to display.';

  const { width = 60, height = 8, ascii = false } = opts;
  const bars = ascii ? [' ', '.', '-', '=', '#'] : [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const maxBars = bars.length - 1;

  // Take last N entries that fit in width
  const entries = history.slice(-width);
  const scores = entries.map(e => e.avgScore ?? 0);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;

  const lines = [];
  lines.push('');
  lines.push('  Score Trend');
  lines.push('');

  // Build the graph row by row (top to bottom)
  for (let row = height - 1; row >= 0; row--) {
    const threshold = (row / (height - 1)) * range + min;
    let line = '';
    for (const score of scores) {
      const normalized = ((score - min) / range) * maxBars;
      const barLevel = Math.round(normalized);
      const rowScore = ((score - min) / range) * (height - 1);
      if (rowScore >= row) {
        line += bars[Math.min(barLevel, maxBars)];
      } else {
        line += ' ';
      }
    }
    const label = row === height - 1 ? String(max).padStart(3) :
                  row === 0 ? String(min).padStart(3) : '   ';
    lines.push(`  ${label} │${line}│`);
  }

  // X-axis
  lines.push(`      └${'─'.repeat(scores.length)}┘`);

  // Date labels (first and last)
  if (entries.length >= 2) {
    const first = formatDate(entries[0].date);
    const last = formatDate(entries[entries.length - 1].date);
    const gap = Math.max(0, scores.length - first.length - last.length);
    lines.push(`       ${first}${' '.repeat(gap)}${last}`);
  } else if (entries.length === 1) {
    lines.push(`       ${formatDate(entries[0].date)}`);
  }

  // Summary line
  const latest = scores[scores.length - 1];
  const prev = scores.length >= 2 ? scores[scores.length - 2] : latest;
  const delta = latest - prev;
  const deltaStr = delta > 0 ? `+${delta}` : delta === 0 ? '±0' : String(delta);
  lines.push('');
  lines.push(`  Latest: ${latest}/100 (${deltaStr} vs previous)  ·  ${entries.length} data point${entries.length === 1 ? '' : 's'}`);
  lines.push('');

  return lines.join('\n');
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return dateStr ? String(dateStr).slice(0, 10) : '?';
  }
}

export { loadHistory, appendHistory, getCurrentCommit, checkRegression, renderTrend };
