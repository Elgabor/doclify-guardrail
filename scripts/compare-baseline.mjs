#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_WAIVER_METRICS = new Set([
  'newFindingsDelta',
  'p95ScanMs',
  'peakMemoryMb',
  'timeoutRate'
]);

function parseArgs(argv) {
  const args = {
    current: null,
    baseline: null,
    thresholds: null,
    waivers: null,
    report: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--current') {
      args.current = argv[++i];
      continue;
    }
    if (token === '--baseline') {
      args.baseline = argv[++i];
      continue;
    }
    if (token === '--thresholds') {
      args.thresholds = argv[++i];
      continue;
    }
    if (token === '--waivers') {
      args.waivers = argv[++i];
      continue;
    }
    if (token === '--report') {
      args.report = argv[++i];
      continue;
    }
    throw new Error(`Unknown option: ${token}`);
  }

  if (!args.current || !args.baseline || !args.thresholds || !args.waivers || !args.report) {
    throw new Error('Missing required options. Required: --current --baseline --thresholds --waivers --report');
  }
  return args;
}

function loadJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Unable to parse ${label} (${filePath}): ${err.message}`);
  }
}

function assertThresholds(thresholds) {
  if (!thresholds || typeof thresholds !== 'object') {
    throw new Error('Thresholds must be a JSON object');
  }
  if (thresholds.schemaVersion !== 1) {
    throw new Error(`Unsupported thresholds schemaVersion: ${thresholds.schemaVersion}`);
  }
  if (!thresholds.deterministic || !thresholds.network) {
    throw new Error('Thresholds must include deterministic and network sections');
  }
}

function ensureValidWaivers(waiversDoc) {
  if (!waiversDoc || typeof waiversDoc !== 'object') {
    throw new Error('Waivers must be a JSON object');
  }
  if (waiversDoc.schemaVersion !== 1) {
    throw new Error(`Unsupported waivers schemaVersion: ${waiversDoc.schemaVersion}`);
  }
  if (!Array.isArray(waiversDoc.waivers)) {
    throw new Error('waivers.json must define a waivers[] array');
  }
}

function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildWaiverIndex(waiversDoc, now = new Date()) {
  ensureValidWaivers(waiversDoc);
  const active = new Map();
  const ignoredExpired = [];
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  for (const waiver of waiversDoc.waivers) {
    if (!waiver.id || !waiver.repoId || !waiver.metric || !waiver.expiresOn) {
      throw new Error(`Invalid waiver entry: ${JSON.stringify(waiver)}`);
    }
    if (!waiver.owner || !waiver.reason) {
      throw new Error(`Waiver "${waiver.id}" must include non-empty owner and reason`);
    }
    if (!ALLOWED_WAIVER_METRICS.has(waiver.metric)) {
      throw new Error(`Waiver "${waiver.id}" has unsupported metric "${waiver.metric}"`);
    }

    const expiresAt = parseDateOnly(waiver.expiresOn);
    if (!expiresAt) {
      throw new Error(`Waiver "${waiver.id}" has invalid expiresOn "${waiver.expiresOn}"`);
    }

    if (expiresAt < today) {
      ignoredExpired.push(waiver.id);
      continue;
    }
    const key = `${waiver.repoId}:${waiver.metric}`;
    active.set(key, waiver);
  }

  return { active, ignoredExpired };
}

function pctDelta(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) return 0;
  if (baseline === 0) return current === 0 ? 0 : 100;
  return ((current - baseline) / baseline) * 100;
}

function round(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function metricViolation(repoId, metric, message, values) {
  return {
    repoId,
    metric,
    message,
    values
  };
}

function evaluateComparison(current, baseline, thresholds, waiverIndex) {
  if (!current || typeof current !== 'object' || !Array.isArray(current.repos)) {
    throw new Error('Current run file must contain repos[]');
  }
  if (!baseline || typeof baseline !== 'object' || !Array.isArray(baseline.repos)) {
    throw new Error('Baseline file must contain repos[]');
  }
  if (!current.profile) {
    throw new Error('Current run file must include profile');
  }

  const profileThresholds = thresholds[current.profile];
  if (!profileThresholds) {
    throw new Error(`No thresholds configured for profile "${current.profile}"`);
  }

  const baselineById = new Map(baseline.repos.map((repo) => [repo.id, repo]));
  const currentIds = new Set(current.repos.map((repo) => repo.id));
  const violations = [];

  for (const repo of current.repos) {
    const aggregate = repo.aggregate || {};
    const baseRepo = baselineById.get(repo.id);

    if (Number(aggregate.crashRatePct || 0) > Number(profileThresholds.maxCrashRatePct || 0)) {
      violations.push(metricViolation(
        repo.id,
        'crashRatePct',
        `Crash rate ${aggregate.crashRatePct}% exceeded threshold ${profileThresholds.maxCrashRatePct}%`,
        { current: aggregate.crashRatePct, threshold: profileThresholds.maxCrashRatePct }
      ));
    }

    if (current.profile === 'deterministic') {
      if (profileThresholds.requireDeterminism && !aggregate.deterministic) {
        violations.push(metricViolation(
          repo.id,
          'determinism',
          'Determinism check failed (fingerprints differ across runs)',
          { current: aggregate.uniqueFingerprintCount }
        ));
      }

      const categoryBudgets = profileThresholds.categoryP95BudgetMs || {};
      const budget = Number(categoryBudgets[repo.category]);
      if (Number.isFinite(budget) && Number(aggregate.p95ScanMs || 0) > budget) {
        violations.push(metricViolation(
          repo.id,
          'p95ScanMs',
          `p95 scan ${aggregate.p95ScanMs}ms exceeded category budget ${budget}ms`,
          { current: aggregate.p95ScanMs, threshold: budget, category: repo.category }
        ));
      }
    }

    if (current.profile === 'network') {
      if (Number(aggregate.timeoutRate || 0) > Number(profileThresholds.maxTimeoutRatePct || 0)) {
        violations.push(metricViolation(
          repo.id,
          'timeoutRate',
          `Timeout rate ${aggregate.timeoutRate}% exceeded threshold ${profileThresholds.maxTimeoutRatePct}%`,
          { current: aggregate.timeoutRate, threshold: profileThresholds.maxTimeoutRatePct }
        ));
      }
    }

    if (!baseRepo) {
      violations.push(metricViolation(
        repo.id,
        'baselineMissing',
        'Repository is missing from baseline dataset',
        {}
      ));
      continue;
    }

    const baseAgg = baseRepo.aggregate || {};
    const currP95 = Number(aggregate.p95ScanMs || 0);
    const baseP95 = Number(baseAgg.p95ScanMs || 0);
    const p95DeltaMs = currP95 - baseP95;
    const p95DeltaPct = pctDelta(currP95, baseP95);

    const p95PctLimit = Number(profileThresholds.maxP95RegressionPct);
    const p95MsLimit = Number(profileThresholds.maxP95RegressionMs);
    if (Number.isFinite(p95PctLimit) && Number.isFinite(p95MsLimit)) {
      if (p95DeltaPct > p95PctLimit || p95DeltaMs > p95MsLimit) {
        violations.push(metricViolation(
          repo.id,
          'p95ScanMs',
          `p95 regression exceeded limits (+${round(p95DeltaPct, 3)}%, +${round(p95DeltaMs, 3)}ms)`,
          {
            current: currP95,
            baseline: baseP95,
            deltaPct: round(p95DeltaPct, 3),
            deltaMs: round(p95DeltaMs, 3),
            maxPct: p95PctLimit,
            maxMs: p95MsLimit
          }
        ));
      }
    }

    const currPeak = Number(aggregate.peakMemoryMb || 0);
    const basePeak = Number(baseAgg.peakMemoryMb || 0);
    const peakDeltaPct = pctDelta(currPeak, basePeak);
    const peakPctLimit = Number(profileThresholds.maxPeakMemoryRegressionPct);
    if (Number.isFinite(peakPctLimit) && peakDeltaPct > peakPctLimit) {
      violations.push(metricViolation(
        repo.id,
        'peakMemoryMb',
        `Peak memory regression exceeded limit (+${round(peakDeltaPct, 3)}%)`,
        {
          current: currPeak,
          baseline: basePeak,
          deltaPct: round(peakDeltaPct, 3),
          maxPct: peakPctLimit
        }
      ));
    }

    const currentFindings = Number(aggregate.findingsCount || 0);
    const baselineFindings = Number(baseAgg.findingsCount || 0);
    const findingsDelta = currentFindings - baselineFindings;
    const maxFindingsDelta = Number(profileThresholds.maxNewFindingsDelta);
    if (Number.isFinite(maxFindingsDelta) && findingsDelta > maxFindingsDelta) {
      violations.push(metricViolation(
        repo.id,
        'newFindingsDelta',
        `New findings delta exceeded limit (+${findingsDelta})`,
        {
          current: currentFindings,
          baseline: baselineFindings,
          delta: findingsDelta,
          maxDelta: maxFindingsDelta
        }
      ));
    }
  }

  for (const baselineRepo of baseline.repos) {
    if (!currentIds.has(baselineRepo.id)) {
      violations.push(metricViolation(
        baselineRepo.id,
        'missingCurrentRepo',
        'Repository exists in baseline but is missing in current dataset',
        {}
      ));
    }
  }

  const decorated = violations.map((v) => {
    const key = `${v.repoId}:${v.metric}`;
    const waiver = waiverIndex.active.get(key) || null;
    return {
      ...v,
      waived: Boolean(waiver),
      waiverId: waiver?.id || null
    };
  });

  const effectiveFailures = decorated.filter((v) => !v.waived);
  return {
    status: effectiveFailures.length === 0 ? 'PASS' : 'FAIL',
    violations: decorated,
    effectiveFailures
  };
}

function renderMarkdownReport(result, context) {
  const lines = [];
  lines.push('# Doclify Reliability Gate Report');
  lines.push('');
  lines.push(`- Status: **${result.status}**`);
  lines.push(`- Profile: \`${context.profile}\``);
  lines.push(`- Current: \`${context.currentPath}\``);
  lines.push(`- Baseline: \`${context.baselinePath}\``);
  lines.push(`- Generated at: \`${context.generatedAt}\``);
  lines.push(`- Violations: **${result.violations.length}** (${result.effectiveFailures.length} blocking)`);
  if (context.ignoredExpiredWaivers.length > 0) {
    lines.push(`- Ignored expired waivers: ${context.ignoredExpiredWaivers.join(', ')}`);
  }
  lines.push('');

  if (result.violations.length === 0) {
    lines.push('No violations detected.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('| Repo | Metric | Status | Message |');
  lines.push('|------|--------|--------|---------|');
  for (const violation of result.violations) {
    const status = violation.waived ? `WAIVED (${violation.waiverId})` : 'BLOCKING';
    lines.push(`| \`${violation.repoId}\` | \`${violation.metric}\` | ${status} | ${violation.message} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function compareBaseline(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const currentPath = path.resolve(args.current);
  const baselinePath = path.resolve(args.baseline);
  const thresholdsPath = path.resolve(args.thresholds);
  const waiversPath = path.resolve(args.waivers);
  const reportPath = path.resolve(args.report);
  const jsonReportPath = reportPath.endsWith('.md') ? reportPath.slice(0, -3) + '.json' : reportPath + '.json';

  const current = loadJson(currentPath, 'current');
  const baseline = loadJson(baselinePath, 'baseline');
  const thresholds = loadJson(thresholdsPath, 'thresholds');
  const waiversDoc = loadJson(waiversPath, 'waivers');

  assertThresholds(thresholds);
  const waiverIndex = buildWaiverIndex(waiversDoc, new Date());
  const result = evaluateComparison(current, baseline, thresholds, waiverIndex);

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    profile: current.profile,
    currentPath: path.relative(process.cwd(), currentPath),
    baselinePath: path.relative(process.cwd(), baselinePath),
    status: result.status,
    summary: {
      violations: result.violations.length,
      blockingViolations: result.effectiveFailures.length,
      waivedViolations: result.violations.filter((v) => v.waived).length,
      ignoredExpiredWaivers: waiverIndex.ignoredExpired.length
    },
    violations: result.violations
  };

  const md = renderMarkdownReport(result, {
    profile: current.profile,
    currentPath: payload.currentPath,
    baselinePath: payload.baselinePath,
    generatedAt: payload.generatedAt,
    ignoredExpiredWaivers: waiverIndex.ignoredExpired
  });

  ensureParentDir(reportPath);
  ensureParentDir(jsonReportPath);
  fs.writeFileSync(reportPath, md, 'utf8');
  fs.writeFileSync(jsonReportPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  return result.status === 'PASS' ? 0 : 1;
}

const THIS_FILE = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
  compareBaseline().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`compare-baseline error: ${err.message}`);
      process.exit(2);
    }
  );
}

export {
  parseArgs,
  loadJson,
  assertThresholds,
  buildWaiverIndex,
  evaluateComparison,
  renderMarkdownReport,
  compareBaseline
};
