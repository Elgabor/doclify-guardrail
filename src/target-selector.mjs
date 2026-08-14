import fs from 'node:fs';
import path from 'node:path';

import { miniGlob } from './glob.mjs';
import { isMarkdownPath } from './markdown-files.mjs';
import { compareText } from './text-order.mjs';
import { getReadContainment, isDescendantOrSame } from './workspace-path.mjs';

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'Pods',
  '.symlinks',
  '.plugin_symlinks',
  '.dart_tool',
  'vendor',
  'build',
  'dist',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  'ephemeral'
]);

class TargetSelectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TargetSelectionError';
    this.code = code;
  }
}

function toPortablePath(value) {
  return String(value).split(path.sep).join('/');
}

function relativePath(filePath, workspace) {
  const relative = path.relative(workspace, filePath);
  return toPortablePath(relative || '.');
}

function selectionDiagnostic(code, target, message) {
  return {
    code,
    severity: 'error',
    path: toPortablePath(target),
    message
  };
}

function walkDirectory(dirPath, workspace, shouldExclude, paths, diagnostics) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (error) {
    diagnostics.push(selectionDiagnostic(
      'directory-unreadable',
      relativePath(dirPath, workspace),
      `Unable to read directory (${error?.code || 'UNKNOWN'}).`
    ));
    return;
  }

  entries.sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const absolute = path.join(dirPath, entry.name);
    const relative = relativePath(absolute, workspace);
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    if (entry.isDirectory()) {
      if (shouldExclude(absolute, { directory: true })) continue;
      walkDirectory(absolute, workspace, shouldExclude, paths, diagnostics);
      continue;
    }
    if (shouldExclude(absolute)) continue;
    if (entry.isFile() && isMarkdownPath(entry.name)) {
      paths.push(absolute);
      continue;
    }
    if (!entry.isSymbolicLink() || !isMarkdownPath(entry.name)) continue;

    let targetStat;
    try {
      targetStat = fs.statSync(absolute);
    } catch (error) {
      diagnostics.push(selectionDiagnostic(
        'target-unreadable',
        relative,
        `Unable to inspect symbolic link target (${error?.code || 'UNKNOWN'}).`
      ));
      continue;
    }
    if (!isDescendantOrSame(absolute, workspace)) {
      diagnostics.push(selectionDiagnostic(
        'target-outside-workspace',
        relative,
        'Symbolic link target is outside the workspace.'
      ));
      continue;
    }
    if (targetStat.isFile()) {
      paths.push(absolute);
    } else {
      diagnostics.push(selectionDiagnostic(
        'target-unsupported',
        relative,
        'Markdown symbolic link target must be a file.'
      ));
    }
  }
}

function assertContained(candidate, workspace) {
  const containment = getReadContainment(candidate, workspace);
  if (containment === 'inside') return;
  if (containment === 'indeterminate') {
    try {
      if (getReadContainment(fs.realpathSync(candidate), workspace) === 'inside') return;
    } catch (error) {
      if (['EACCES', 'EPERM'].includes(error?.code)) return;
    }
  }
  throw new TargetSelectionError(
    containment === 'outside' ? 'target-outside-workspace' : 'target-unreadable',
    containment === 'outside'
      ? 'Selected paths must stay inside the workspace.'
      : 'Selected path could not be safely resolved.'
  );
}

function selectTargets(options = {}) {
  const workspace = path.resolve(options.cwd || process.cwd());
  const targets = Array.isArray(options.paths) ? options.paths : ['.'];
  const shouldExclude = typeof options.isExcluded === 'function'
    ? options.isExcluded
    : () => false;
  const selected = [];
  const diagnostics = [];

  for (const rawTarget of targets) {
    const target = String(rawTarget);
    if (target.includes('*')) {
      const wildcardIndex = target.indexOf('*');
      const prefix = target.slice(0, wildcardIndex);
      const prefixPath = path.resolve(workspace, prefix || '.');
      assertContained(prefixPath, workspace);
      let matches;
      try {
        matches = miniGlob(target, workspace);
      } catch (error) {
        diagnostics.push(selectionDiagnostic(
          'target-unreadable',
          target,
          `Unable to inspect target (${error?.code || 'UNKNOWN'}).`
        ));
        continue;
      }
      const contained = matches.filter((candidate) => getReadContainment(candidate, workspace) === 'inside');
      const usable = contained.filter((candidate) => {
        return isMarkdownPath(candidate) && !shouldExclude(candidate);
      });
      if (usable.length === 0) {
        diagnostics.push(selectionDiagnostic(
          'target-unmatched',
          target,
          'No Markdown files matched target.'
        ));
      } else {
        selected.push(...usable);
      }
      continue;
    }

    const absolute = path.resolve(workspace, target);
    assertContained(absolute, workspace);
    let stat;
    try {
      stat = fs.statSync(absolute);
    } catch {
      if (isMarkdownPath(absolute)) {
        if (!shouldExclude(absolute)) selected.push(absolute);
      } else {
        diagnostics.push(selectionDiagnostic(
          'target-unreadable',
          target,
          'Target does not exist or cannot be inspected.'
        ));
      }
      continue;
    }

    if (stat.isDirectory()) {
      if (!shouldExclude(absolute, { directory: true })) {
        walkDirectory(absolute, workspace, shouldExclude, selected, diagnostics);
      }
    } else if (stat.isFile() && isMarkdownPath(absolute)) {
      if (!shouldExclude(absolute)) selected.push(absolute);
    } else {
      diagnostics.push(selectionDiagnostic(
        'target-unsupported',
        target,
        'Target must be a Markdown or MDX file or a directory.'
      ));
    }
  }

  const paths = [...new Set(selected.map((candidate) => path.resolve(candidate)))]
    .sort((left, right) => compareText(relativePath(left, workspace), relativePath(right, workspace)));
  return { workspace, paths, diagnostics };
}

export {
  TargetSelectionError,
  relativePath,
  selectTargets
};
