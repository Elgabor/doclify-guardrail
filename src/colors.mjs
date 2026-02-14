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

function initColors(noColorFlag) {
  if (noColorFlag || !process.stderr.isTTY || process.env.NO_COLOR !== undefined) {
    enabled = false;
  }
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

function printResults(output) {
  console.error('');

  for (const fileResult of output.files) {
    const icon = fileResult.pass ? c.green('\u2713') : c.red('\u2717');
    const fileName = c.bold(fileResult.file);
    console.error(`  ${icon} ${fileName}`);

    const allFindings = [
      ...fileResult.findings.errors,
      ...fileResult.findings.warnings
    ];

    for (const f of allFindings) {
      const lineStr = f.line != null ? c.dim(`:${f.line}`) : '';
      const sevLabel = f.severity === 'error'
        ? c.red(`\u2717 ${f.severity}`)
        : c.yellow(`\u26A0 ${f.severity}`);
      console.error(`      ${sevLabel}  ${c.cyan(f.code)}${lineStr}  ${f.message}`);
    }
  }

  if (output.fileErrors) {
    for (const fe of output.fileErrors) {
      console.error(`  ${c.red('\u2717')} ${c.bold(fe.file)}  ${c.red(fe.error)}`);
    }
  }

  console.error('');

  const s = output.summary;
  const parts = [];
  if (s.filesPassed > 0) parts.push(c.green(`\u2713 ${s.filesPassed} passed`));
  if (s.filesFailed > 0) parts.push(c.red(`\u2717 ${s.filesFailed} failed`));
  if (s.filesErrored > 0) parts.push(c.red(`${s.filesErrored} errored`));
  console.error(
    `  ${parts.join(c.dim(' \u00B7 '))} ${c.dim('\u00B7')} ${s.filesScanned} files scanned in ${c.dim(`${s.elapsed}s`)}`
  );
  console.error('');
}

export { initColors, c, printResults };
