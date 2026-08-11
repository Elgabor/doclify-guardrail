import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { DoclifyUsageError, runCheck } from './core.mjs';
import { isMarkdownPath } from './markdown-files.mjs';
import { renderResult, terminalText } from './result-renderers.mjs';
import { isV2Command, parseV2Args, renderV2Help } from './v2-command.mjs';
import { canonicalizeForBoundaryCheck, resolveWorkspacePath } from './workspace-path.mjs';

const MAX_STDIN_BYTES = 4 * 1024 * 1024;

function safeDiagnostic(error) {
  const code = error?.code || 'internal-error';
  const message = error instanceof DoclifyUsageError
    ? error.message
    : 'The command could not complete.';
  return `${terminalText(code)}: ${terminalText(message)}\n`;
}

function writeOperationalDiagnostics(result) {
  for (const diagnostic of result.diagnostics) {
    process.stderr.write(`${terminalText(diagnostic.path)}: error [${terminalText(diagnostic.code)}] ${terminalText(diagnostic.message)}\n`);
  }
}

function assertOutputDoesNotOverwriteInput(outputPath, result, workspace) {
  const canonical = (candidate) => {
    try {
      return fs.realpathSync(candidate);
    } catch {
      return path.resolve(candidate);
    }
  };
  const canonicalOutput = canonical(outputPath);
  let outputIdentity = null;
  try {
    const outputStat = fs.statSync(outputPath, { bigint: true });
    outputIdentity = `${outputStat.dev}:${outputStat.ino}`;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const file of result.files) {
    const inputPath = path.resolve(workspace, file.path);
    const canonicalInput = canonical(inputPath);
    let inputIdentity = null;
    try {
      const inputStat = fs.statSync(inputPath, { bigint: true });
      inputIdentity = `${inputStat.dev}:${inputStat.ino}`;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (canonicalOutput === canonicalInput || (outputIdentity != null && outputIdentity === inputIdentity)) {
      throw new DoclifyUsageError('output-overwrites-input', 'Output path must not overwrite a scanned document.');
    }
  }
}

function assertOutputOutsideGitMetadata(outputPath, workspace) {
  const canonicalOutput = canonicalizeForBoundaryCheck(outputPath);
  const canonicalWorkspace = canonicalizeForBoundaryCheck(workspace);
  if (canonicalOutput == null || canonicalWorkspace == null) {
    throw new DoclifyUsageError('output-outside-workspace', 'Output path could not be safely resolved.');
  }
  const segments = path.relative(canonicalWorkspace, canonicalOutput).split(path.sep);
  if (segments.some((segment) => segment.toLowerCase() === '.git')) {
    throw new DoclifyUsageError('output-in-git-directory', 'Output path must not write inside Git metadata.');
  }
}

function writeOutput(outputPath, rendered) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (isMarkdownPath(outputPath)) {
    try {
      fs.writeFileSync(outputPath, rendered, { encoding: 'utf8', flag: 'wx' });
      return;
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new DoclifyUsageError('output-exists', 'Refusing to overwrite an existing Markdown document.');
      }
      throw error;
    }
  }

  // Replacing the directory entry keeps repeatable reports from following links.
  const temporary = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${randomUUID()}.tmp`);
  let primaryError = null;
  try {
    fs.writeFileSync(temporary, rendered, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, outputPath);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (primaryError == null && error?.code !== 'ENOENT') throw error;
    }
  }
}

async function runV2Cli(argv) {
  let parsed;
  try {
    parsed = parseV2Args(argv);
    if (parsed.help) {
      process.stdout.write(renderV2Help(parsed.command));
      return 0;
    }

    const checkOptions = {
      command: parsed.command,
      cwd: process.cwd(),
      ignoreRules: parsed.ignoreRules,
      exclude: parsed.exclude,
      links: parsed.links
    };
    if (parsed.command === 'changed') {
      checkOptions.changed = parsed.staged ? { staged: true } : { base: parsed.base };
    } else {
      checkOptions.paths = parsed.paths;
    }
    if (parsed.config != null) checkOptions.config = parsed.config;
    if (parsed.purpose != null) checkOptions.purpose = parsed.purpose;
    if (parsed.siteRoot != null) checkOptions.siteRoot = parsed.siteRoot;
    if (parsed.externalLinks === true) checkOptions.externalLinks = true;
    if (parsed.stdinName != null) {
      const chunks = [];
      let size = 0;
      for await (const chunk of process.stdin) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_STDIN_BYTES) {
          throw new DoclifyUsageError('stdin-too-large', `stdin exceeds the ${MAX_STDIN_BYTES}-byte limit.`);
        }
        chunks.push(buffer);
      }
      checkOptions.stdin = { content: Buffer.concat(chunks).toString('utf8'), name: parsed.stdinName };
    }

    const { result, workspace } = await runCheck(checkOptions);
    const rendered = renderResult(result, { format: parsed.format, all: parsed.all });

    if (parsed.output) {
      let outputPath;
      try {
        outputPath = resolveWorkspacePath(path.resolve(process.cwd(), parsed.output), {
          workspace,
          label: 'Output path'
        });
      } catch {
        throw new DoclifyUsageError('output-outside-workspace', 'Output path must stay inside the workspace.');
      }
      assertOutputOutsideGitMetadata(outputPath, workspace);
      assertOutputDoesNotOverwriteInput(outputPath, result, workspace);
      writeOutput(outputPath, rendered);
    } else {
      process.stdout.write(rendered);
    }
    writeOperationalDiagnostics(result);
    return result.status === 'pass' ? 0 : 1;
  } catch (error) {
    process.stderr.write(safeDiagnostic(error));
    return 2;
  }
}

export {
  isV2Command,
  runV2Cli
};
