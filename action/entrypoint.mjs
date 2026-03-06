import * as core from '@actions/core';
import * as github from '@actions/github';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postPrComment } from './pr-comment.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '..', 'src', 'index.mjs');

function runDoclifyProcess(cliArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, cliArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        exitCode: typeof code === 'number' ? code : 1,
        stdout,
        stderr
      });
    });
  });
}

async function run() {
  try {
    const scanPath = core.getInput('path') || '.';
    const strict = core.getInput('strict') === 'true';
    const minScore = core.getInput('min-score');
    const checkLinks = core.getInput('check-links') === 'true';
    const checkFreshness = core.getInput('check-freshness') === 'true';
    const checkFrontmatter = core.getInput('check-frontmatter') === 'true';
    const format = core.getInput('format') || 'compact';
    const sarifEnabled = core.getInput('sarif') !== 'false';
    const sarifFile = core.getInput('sarif-file') || 'doclify.sarif';
    const prCommentEnabled = core.getInput('pr-comment') !== 'false';
    const token = core.getInput('token');

    // Build CLI args
    const cliArgs = [CLI, scanPath, '--json', '--ascii'];
    if (strict) cliArgs.push('--strict');
    if (minScore) cliArgs.push('--min-score', minScore);
    if (checkLinks) cliArgs.push('--check-links');
    if (checkFreshness) cliArgs.push('--check-freshness');
    if (checkFrontmatter) cliArgs.push('--check-frontmatter');
    if (sarifEnabled) cliArgs.push('--sarif', sarifFile);
    cliArgs.push('--format', format);

    // Run doclify CLI
    let output = null;
    let exitCode = 0;

    const proc = await runDoclifyProcess(cliArgs);
    exitCode = proc.exitCode;
    if (proc.stdout) {
      try {
        output = JSON.parse(proc.stdout);
      } catch {
        core.warning(`Doclify output was not valid JSON: ${proc.stderr || proc.stdout}`);
      }
    }

    // Set outputs
    if (output && output.summary) {
      core.setOutput('score', String(output.summary.avgHealthScore ?? 0));
      core.setOutput('status', output.summary.status ?? 'FAIL');
      core.setOutput('errors', String(output.summary.totalErrors ?? 0));
      core.setOutput('warnings', String(output.summary.totalWarnings ?? 0));
    }

    // Log summary to GitHub Actions
    if (output && output.summary) {
      const s = output.summary;
      core.info(`Score: ${s.avgHealthScore}/100 | Errors: ${s.totalErrors} | Warnings: ${s.totalWarnings} | Status: ${s.status}`);
    }

    // Post PR comment
    const ctx = github.context;
    if (prCommentEnabled && token && ctx.payload.pull_request && output) {
      try {
        const octokit = github.getOctokit(token);
        await postPrComment(octokit, {
          owner: ctx.repo.owner,
          repo: ctx.repo.repo,
          prNumber: ctx.payload.pull_request.number
        }, output);
        core.info('PR comment posted successfully');
      } catch (err) {
        core.warning(`Failed to post PR comment: ${err.message}`);
      }
    }

    // SARIF info
    if (sarifEnabled && existsSync(sarifFile)) {
      core.info(`SARIF report written to ${sarifFile}`);
      core.info('Add github/codeql-action/upload-sarif@v3 step to upload to Code Scanning');
    }

    // Set overall result
    if (exitCode !== 0) {
      const msg = output && output.summary
        ? `Quality gate failed: score ${output.summary.avgHealthScore}/100, ${output.summary.totalErrors} error(s)`
        : `Doclify exited with code ${exitCode}`;
      core.setFailed(msg);
    }
  } catch (err) {
    core.setFailed(`Doclify Action error: ${err.message}`);
  }
}

run();
