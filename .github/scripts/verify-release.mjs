import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024
  }).trim();
}

try {
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Release dispatch must run from refs/heads/main.');
  }
  const tag = process.env.RELEASE_TAG || '';
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    throw new Error('Release tag must be a stable v<major>.<minor>.<patch> tag.');
  }
  const reference = `refs/tags/${tag}`;
  if (git(['cat-file', '-t', reference]) !== 'tag') {
    throw new Error('Release requires an annotated tag.');
  }
  const tagObject = git(['rev-parse', '--verify', reference]);
  const commit = git(['rev-parse', '--verify', `${reference}^{commit}`]);
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{40}$/.test(tagObject)) {
    throw new Error('Release references must resolve to full Git object IDs.');
  }
  git(['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main']);
  if ((process.env.EXPECTED_COMMIT && process.env.EXPECTED_COMMIT !== commit)
    || (process.env.EXPECTED_TAG_OBJECT && process.env.EXPECTED_TAG_OBJECT !== tagObject)) {
    throw new Error('Release tag changed after validation.');
  }
  const manifest = JSON.parse(git(['show', `${commit}:package.json`]));
  if (manifest.name !== 'doclify-guardrail' || manifest.private === true || `v${manifest.version}` !== tag) {
    throw new Error('Release package name/version must match the requested public release tag.');
  }
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `commit=${commit}\ntag-object=${tagObject}\n`);
  }
  console.log(`Release verified: ${tag} at ${commit} (annotated tag ${tagObject}).`);
} catch (error) {
  console.error(`Release verification failed: ${error.message}`);
  process.exitCode = 1;
}
