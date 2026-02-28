const CODES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

let enabled = true;
let asciiMode = false;

function initColors(noColorFlag) {
  if (noColorFlag || !process.stderr.isTTY || process.env.NO_COLOR !== undefined) {
    enabled = false;
  }
}

function setAsciiMode(flag) {
  asciiMode = Boolean(flag);
}

function wrap(code, text) {
  if (!enabled) return text;
  return `${code}${text}${CODES.reset}`;
}

const c = {
  red: (t) => wrap(CODES.red, t),
  green: (t) => wrap(CODES.green, t),
  yellow: (t) => wrap(CODES.yellow, t),
  cyan: (t) => wrap(CODES.cyan, t),
  dim: (t) => wrap(CODES.dim, t),
  bold: (t) => wrap(CODES.bold, t)
};

const icons = {
  get pass() { return asciiMode ? '[PASS]' : '\u2713'; },
  get fail() { return asciiMode ? '[FAIL]' : '\u2717'; },
  get warn() { return asciiMode ? '[WARN]' : '\u26A0'; },
  get info() { return asciiMode ? '[INFO]' : '\u2139'; },
  get dot()  { return asciiMode ? '-' : '\u00B7'; }
};

function log(icon, message) {
  console.error(`  ${icon} ${message}`);
}

function printBanner(fileCount, version) {
  console.error('');
  console.error(`  ${c.bold('Doclify Guardrail')} ${c.dim(`v${version || '?'}`)}`);
  console.error('');
  log(c.cyan(icons.info), `Scanning ${c.bold(String(fileCount))} file${fileCount === 1 ? '' : 's'}...`);
}

function printResults(output) {
  const strict = output.strict;
  for (const fileResult of output.files) {
    const icon = fileResult.pass ? c.green(icons.pass) : c.red(icons.fail);
    const fileName = c.bold(fileResult.file);
    const score = fileResult.summary.healthScore != null ? c.dim(` [${fileResult.summary.healthScore}/100]`) : '';
    console.error(`  ${icon} ${fileName}${score}`);

    const allFindings = [
      ...fileResult.findings.errors,
      ...fileResult.findings.warnings
    ];

    for (const f of allFindings) {
      const lineStr = f.line != null ? c.dim(`:${f.line}`) : '';
      let sevLabel;
      if (f.severity === 'error') {
        sevLabel = c.red(`${icons.fail} error`);
      } else if (strict) {
        sevLabel = c.red(`${icons.fail} error [strict]`);
      } else {
        sevLabel = c.yellow(`${icons.warn} warning`);
      }
      console.error(`      ${sevLabel}  ${c.cyan(f.code)}${lineStr}  ${f.message}`);
    }
  }

  if (output.fileErrors) {
    for (const fe of output.fileErrors) {
      console.error(`  ${c.red(icons.fail)} ${c.bold(fe.file)}  ${c.red(fe.error)}`);
    }
  }

  console.error('');

  const s = output.summary;
  const parts = [];
  if (s.filesPassed > 0) parts.push(c.green(`${icons.pass} ${s.filesPassed} passed`));
  if (s.filesFailed > 0) parts.push(c.red(`${icons.fail} ${s.filesFailed} failed`));
  if (s.filesErrored > 0) parts.push(c.red(`${s.filesErrored} errored`));
  console.error(
    `  ${parts.join(c.dim(` ${icons.dot} `))} ${c.dim(icons.dot)} ${s.filesScanned} files scanned in ${c.dim(`${s.elapsed}s`)}`
  );

  const scoreValue = s.healthScore != null ? s.healthScore : s.avgHealthScore;
  if (scoreValue != null) {
    const scoreColor = scoreValue >= 90 ? c.green : scoreValue >= 60 ? c.yellow : c.red;
    console.error(`  ${scoreColor(`Health score: ${scoreValue}/100`)}`);
  }

  if (s.status === 'PASS') {
    console.error('');
    console.error(`  ${c.green(c.bold('All files passed!'))}`);
  }

  console.error('');
}

export { initColors, setAsciiMode, icons, c, log, printBanner, printResults };
