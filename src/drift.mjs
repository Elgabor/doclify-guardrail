import fs from 'node:fs';
import path from 'node:path';
import { isMarkdownPath } from './markdown-files.mjs';

const TOKEN_STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'into', 'your', 'docs', 'doc', 'guide',
  'using', 'used', 'file', 'files', 'path', 'paths', 'text', 'readme',
  'markdown', 'config', 'value', 'values', 'option', 'options'
]);

const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.yaml', '.yml',
  '.toml', '.sh', '.bash', '.zsh', '.env', '.ini', '.md', '.mdx', '.txt'
]);

const RISK_THRESHOLDS = {
  high: 70,
  medium: 50,
  low: 35
};

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function clampNumber(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function relativeToRoot(filePath, repoRoot = process.cwd()) {
  const relative = path.relative(repoRoot, filePath);
  return relative.startsWith('..') ? filePath : (relative || path.basename(filePath));
}

function splitCamelCase(token) {
  return token.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function tokenizeText(text) {
  const matches = String(text || '').match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) || [];
  const tokens = [];
  for (const match of matches) {
    const expanded = splitCamelCase(match).split(/[^A-Za-z0-9]+/g);
    for (const token of expanded) {
      const normalized = token.toLowerCase();
      if (normalized.length < 3) continue;
      if (TOKEN_STOPWORDS.has(normalized)) continue;
      tokens.push(normalized);
    }
  }
  return uniq(tokens);
}

function collectMatches(regex, text, mapper = (value) => value) {
  const matches = [];
  const source = String(text || '');
  const pattern = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  let match;
  while ((match = pattern.exec(source)) !== null) {
    matches.push(mapper(match[1] ?? match[0], match));
  }
  return uniq(matches);
}

function isLikelyTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) {
    return true;
  }
  const base = path.basename(filePath).toLowerCase();
  return ['dockerfile', 'makefile'].includes(base);
}

function safeReadText(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const stats = fs.statSync(filePath);
    if (stats.size > 256 * 1024) return '';
    if (!isLikelyTextFile(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function normalizePathKey(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function classifyRisk(score, options = {}) {
  const strongSignal = options.strongSignal !== false;
  if (score >= RISK_THRESHOLDS.high && strongSignal) return 'high';
  if (score >= RISK_THRESHOLDS.medium && strongSignal) return 'medium';
  if (score >= RISK_THRESHOLDS.low) return 'low';
  return null;
}

function extractDocumentSignals(content, filePath, repoRoot) {
  const relativePath = relativeToRoot(filePath, repoRoot);
  const headings = collectMatches(/^#{1,6}\s+(.+)$/gm, content, (value) => value.trim());
  const inlineCode = collectMatches(/`([^`\n]+)`/g, content, (value) => value.trim());
  const flags = collectMatches(/(--[a-z0-9-]+)/gi, content, (value) => value.toLowerCase());
  const versions = collectMatches(/\b(v?\d+\.\d+(?:\.\d+)?)\b/g, content, (value) => value.toLowerCase());
  const paths = collectMatches(/(\.?\.?\/[A-Za-z0-9._/-]+)/g, content, (value) => value);
  const endpoints = collectMatches(/(\/[A-Za-z0-9._/-]{3,})/g, content, (value) => value);
  const linkTargets = collectMatches(/\[[^\]]+\]\(([^)\s]+)\)/g, content, (value) => value);
  const tokens = uniq([
    ...tokenizeText(relativePath),
    ...tokenizeText(headings.join(' ')),
    ...tokenizeText(inlineCode.join(' ')),
    ...tokenizeText(linkTargets.join(' ')),
    ...tokenizeText(content)
  ]);

  return {
    file: filePath,
    relativePath,
    headings,
    inlineCode,
    flags,
    versions,
    paths: uniq([...paths, ...linkTargets.filter((target) => target.includes('/'))]),
    endpoints,
    tokens
  };
}

function extractCodeSignals(change, repoRoot) {
  const content = safeReadText(change.path);
  const relativePath = relativeToRoot(change.path, repoRoot);
  const previousPath = change.previousPath ? relativeToRoot(change.previousPath, repoRoot) : null;
  const exportNames = collectMatches(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g, content, (value) => value);
  const assignmentNames = collectMatches(/\b(?:function|class|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g, content, (value) => value);
  const flags = collectMatches(/(--[a-z0-9-]+)/gi, content, (value) => value.toLowerCase());
  const versions = collectMatches(/\b(v?\d+\.\d+(?:\.\d+)?)\b/g, content, (value) => value.toLowerCase());
  const endpoints = collectMatches(/(\/[A-Za-z0-9._/-]{3,})/g, content, (value) => value);
  const paths = collectMatches(/(["'`])(\.?\.?\/[A-Za-z0-9._/-]+)\1/g, content, (_, match) => match[2]);
  const basename = path.basename(change.path);
  const tokens = uniq([
    ...tokenizeText(relativePath),
    ...tokenizeText(previousPath || ''),
    ...tokenizeText(exportNames.join(' ')),
    ...tokenizeText(assignmentNames.join(' ')),
    ...tokenizeText(content),
    ...tokenizeText(basename)
  ]);

  return {
    ...change,
    relativePath,
    previousRelativePath: previousPath,
    exportNames: uniq([...exportNames, ...assignmentNames]).slice(0, 32),
    flags,
    versions,
    endpoints,
    paths,
    tokens
  };
}

function intersect(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function sharedPathSegments(docSignals, codeSignals) {
  const docParts = tokenizeText(docSignals.relativePath);
  const codeParts = tokenizeText(codeSignals.relativePath + ' ' + (codeSignals.previousRelativePath || ''));
  return intersect(docParts, codeParts);
}

function createScoreBreakdown() {
  return {
    flags: 0,
    endpoints: 0,
    symbols: 0,
    path: 0,
    tokens: 0,
    versions: 0,
    bonus: 0,
    penalty: 0
  };
}

function mergeBreakdowns(left, right) {
  return {
    flags: left.flags + right.flags,
    endpoints: left.endpoints + right.endpoints,
    symbols: left.symbols + right.symbols,
    path: left.path + right.path,
    tokens: left.tokens + right.tokens,
    versions: left.versions + right.versions,
    bonus: left.bonus + right.bonus,
    penalty: left.penalty + right.penalty
  };
}

function mean(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isTopLevelHighSignalDoc(relativePath) {
  const basename = path.basename(relativePath).toLowerCase();
  return basename.startsWith('readme') || basename.startsWith('changelog');
}

function buildChangedMarkdownSet(changedFiles, repoRoot) {
  const keys = new Set();
  for (const entry of changedFiles) {
    if (!entry) continue;
    for (const candidate of [entry.path, entry.previousPath]) {
      if (!candidate || !isMarkdownPath(candidate)) continue;
      keys.add(normalizePathKey(relativeToRoot(candidate, repoRoot)));
    }
  }
  return keys;
}

function computeConfidence({
  score,
  strongSignal,
  strongSignalTypes,
  matchedSignals,
  docModified
}) {
  let confidence = 0.18;
  confidence += Math.min(0.36, strongSignalTypes * 0.18);
  confidence += Math.min(0.22, (score / 100) * 0.22);
  confidence += Math.min(0.14, matchedSignals * 0.04);
  if (!strongSignal) confidence = Math.min(confidence, 0.45);
  if (docModified) confidence -= 0.07;
  return Number(clampNumber(confidence, 0, 1).toFixed(2));
}

function scoreCandidate(docSignals, codeSignals) {
  let score = 0;
  const reasons = [];
  const matchedTokens = [];
  const scoreBreakdown = createScoreBreakdown();

  const sharedFlags = intersect(docSignals.flags, codeSignals.flags);
  if (sharedFlags.length > 0) {
    const contribution = 36 + Math.min(12, sharedFlags.length * 4);
    score += contribution;
    scoreBreakdown.flags += contribution;
    reasons.push(`shared flag${sharedFlags.length === 1 ? '' : 's'}: ${sharedFlags.slice(0, 3).join(', ')}`);
    matchedTokens.push(...sharedFlags);
  }

  const sharedEndpoints = intersect(docSignals.endpoints, codeSignals.endpoints);
  if (sharedEndpoints.length > 0) {
    const contribution = 32 + Math.min(12, sharedEndpoints.length * 4);
    score += contribution;
    scoreBreakdown.endpoints += contribution;
    reasons.push(`shared endpoint${sharedEndpoints.length === 1 ? '' : 's'}: ${sharedEndpoints.slice(0, 2).join(', ')}`);
    matchedTokens.push(...sharedEndpoints);
  }

  const sharedVersions = intersect(docSignals.versions, codeSignals.versions);
  if (sharedVersions.length > 0) {
    const contribution = 10;
    score += contribution;
    scoreBreakdown.versions += contribution;
    reasons.push(`shared version marker: ${sharedVersions.slice(0, 2).join(', ')}`);
    matchedTokens.push(...sharedVersions);
  }

  const sharedSymbols = intersect(docSignals.tokens, tokenizeText(codeSignals.exportNames.join(' ')));
  if (sharedSymbols.length > 0) {
    const contribution = 20 + Math.min(12, sharedSymbols.length * 4);
    score += contribution;
    scoreBreakdown.symbols += contribution;
    reasons.push(`shared symbol${sharedSymbols.length === 1 ? '' : 's'}: ${sharedSymbols.slice(0, 3).join(', ')}`);
    matchedTokens.push(...sharedSymbols);
  }

  const tokenOverlap = intersect(docSignals.tokens, codeSignals.tokens).slice(0, 6);
  if (tokenOverlap.length > 0) {
    const contribution = Math.min(20, tokenOverlap.length * 3);
    score += contribution;
    scoreBreakdown.tokens += contribution;
    reasons.push(`shared tokens: ${tokenOverlap.slice(0, 4).join(', ')}`);
    matchedTokens.push(...tokenOverlap);
  }

  const pathOverlap = sharedPathSegments(docSignals, codeSignals);
  if (pathOverlap.length > 0) {
    const contribution = Math.min(18, 6 + pathOverlap.length * 3);
    score += contribution;
    scoreBreakdown.path += contribution;
    reasons.push(`path overlap: ${pathOverlap.slice(0, 3).join(', ')}`);
    matchedTokens.push(...pathOverlap);
  }

  const basename = path.basename(codeSignals.relativePath);
  let referencesChangedFile = false;
  if (docSignals.paths.some((value) => value.includes(basename)) || docSignals.inlineCode.some((value) => value.includes(basename))) {
    const contribution = 30;
    score += contribution;
    scoreBreakdown.path += contribution;
    reasons.push(`doc references changed file ${basename}`);
    matchedTokens.push(basename);
    referencesChangedFile = true;
  }

  const strongSignal = sharedFlags.length > 0 || sharedEndpoints.length > 0 || referencesChangedFile;
  const finalScore = clampNumber(Math.round(score), 0, 100);
  return {
    score: finalScore,
    risk: classifyRisk(finalScore, { strongSignal }),
    strongSignal,
    reasons: uniq(reasons),
    matchedTokens: uniq(matchedTokens).slice(0, 8),
    scoreBreakdown
  };
}

function compareRisk(left, right) {
  const priority = { high: 3, medium: 2, low: 1, null: 0 };
  return priority[left] - priority[right];
}

function analyzeDriftOffline(options) {
  const {
    changedFiles = [],
    targetFiles = [],
    repoMetadata = { root: process.cwd(), fingerprint: 'unknown' },
    threshold = null,
    gatingScope = 'all'
  } = options;

  const repoRoot = repoMetadata.root || process.cwd();
  const changedMarkdownSet = buildChangedMarkdownSet(changedFiles, repoRoot);
  const codeChanges = changedFiles
    .filter((entry) => entry?.path && !isMarkdownPath(entry.path))
    .map((entry) => extractCodeSignals(entry, repoRoot))
    .filter((entry) => entry.tokens.length > 0 || entry.flags.length > 0 || entry.endpoints.length > 0 || entry.exportNames.length > 0);

  const docs = targetFiles
    .filter((filePath) => isMarkdownPath(filePath) && fs.existsSync(filePath))
    .map((filePath) => extractDocumentSignals(fs.readFileSync(filePath, 'utf8'), filePath, repoRoot));

  const aggregated = new Map();
  for (const docSignals of docs) {
    for (const codeSignals of codeChanges) {
      const candidate = scoreCandidate(docSignals, codeSignals);
      if (!candidate.score) continue;

      const current = aggregated.get(docSignals.file) || {
        doc: docSignals,
        candidates: [],
        changedFiles: []
      };

      current.candidates.push(candidate);
      current.changedFiles.push({
        file: codeSignals.relativePath,
        status: codeSignals.status,
        score: candidate.score,
        risk: candidate.risk,
        strongSignal: candidate.strongSignal,
        reasons: candidate.reasons.slice(0, 3)
      });
      aggregated.set(docSignals.file, current);
    }
  }

  const alerts = [...aggregated.values()]
    .map((entry) => {
      const sortedCandidates = entry.candidates.sort((left, right) => right.score - left.score);
      const top2 = sortedCandidates.slice(0, 2);
      const top3 = sortedCandidates.slice(0, 3);
      if (top3.length === 0) return null;

      const maxTop2 = Math.max(...top2.map((candidate) => candidate.score));
      const avgTop3 = mean(top3.map((candidate) => candidate.score));
      const baseScore = (0.7 * maxTop2) + (0.3 * avgTop3);
      const docModified = changedMarkdownSet.has(normalizePathKey(entry.doc.relativePath));
      const strongSignal = top3.some((candidate) => candidate.strongSignal);
      const strongSignalTypes = new Set();
      for (const candidate of top3) {
        if (candidate.scoreBreakdown.flags > 0) strongSignalTypes.add('flags');
        if (candidate.scoreBreakdown.endpoints > 0) strongSignalTypes.add('endpoints');
        if (candidate.reasons.some((reason) => reason.includes('doc references changed file'))) strongSignalTypes.add('filename');
      }
      const bonus = strongSignal && isTopLevelHighSignalDoc(entry.doc.relativePath) ? 8 : 0;
      const penalty = docModified ? 25 : 0;
      const score = clampNumber(Math.round(baseScore + bonus - penalty), 0, 100);
      const risk = classifyRisk(score, { strongSignal });
      if (!risk) return null;

      const mergedBreakdown = top3
        .map((candidate) => candidate.scoreBreakdown)
        .reduce((acc, breakdown) => mergeBreakdowns(acc, breakdown), createScoreBreakdown());
      const reasons = uniq(
        top3.flatMap((candidate) => candidate.reasons)
      );
      if (docModified) {
        reasons.push('doc modified in diff (reduced risk)');
      }
      if (bonus > 0) {
        reasons.push('top-level doc signal bonus applied');
      }
      const scoreBreakdown = {
        flags: mergedBreakdown.flags,
        endpoints: mergedBreakdown.endpoints,
        symbols: mergedBreakdown.symbols,
        path: mergedBreakdown.path,
        tokens: mergedBreakdown.tokens,
        versions: mergedBreakdown.versions,
        bonus,
        penalty: -penalty,
        base: Number(baseScore.toFixed(2)),
        final: score
      };
      const scope = docModified ? 'modified' : 'unmodified';
      const confidence = computeConfidence({
        score,
        strongSignal,
        strongSignalTypes: strongSignalTypes.size,
        matchedSignals: top3.length,
        docModified
      });
      return {
        doc: entry.doc.relativePath,
        score,
        risk,
        scope,
        confidence,
        reasons: reasons.slice(0, 4),
        matchedTokens: uniq(top3.flatMap((candidate) => candidate.matchedTokens)).slice(0, 8),
        scoreBreakdown,
        changedFiles: entry.changedFiles
          .sort((left, right) => right.score - left.score)
          .slice(0, 5)
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);

  const highestRisk = alerts.reduce((acc, alert) => compareRisk(alert.risk, acc) > 0 ? alert.risk : acc, null);
  const alertsByScope = {
    modified: alerts.filter((alert) => alert.scope === 'modified').length,
    unmodified: alerts.filter((alert) => alert.scope === 'unmodified').length
  };
  const highestRiskByScope = {
    modified: alerts
      .filter((alert) => alert.scope === 'modified')
      .reduce((acc, alert) => compareRisk(alert.risk, acc) > 0 ? alert.risk : acc, null),
    unmodified: alerts
      .filter((alert) => alert.scope === 'unmodified')
      .reduce((acc, alert) => compareRisk(alert.risk, acc) > 0 ? alert.risk : acc, null)
  };
  const effectiveScope = gatingScope === 'unmodified' ? 'unmodified' : 'all';
  const gatingRisk = effectiveScope === 'all' ? highestRisk : highestRiskByScope.unmodified;
  const thresholdRank = threshold ? compareRisk(gatingRisk, threshold) : 0;

  return {
    mode: 'offline',
    repoFingerprint: repoMetadata.fingerprint,
    status: threshold && thresholdRank >= 0 ? 'FAIL' : 'PASS',
    threshold,
    summary: {
      changedFiles: changedFiles.length,
      changedCodeFiles: codeChanges.length,
      candidateDocs: docs.length,
      alerts: alerts.length,
      high: alerts.filter((alert) => alert.risk === 'high').length,
      medium: alerts.filter((alert) => alert.risk === 'medium').length,
      low: alerts.filter((alert) => alert.risk === 'low').length,
      highestRisk,
      alertsByScope,
      highestRiskByScope,
      gatingScope: effectiveScope,
      gatingRisk
    },
    alerts
  };
}

export {
  analyzeDriftOffline,
  classifyRisk
};
