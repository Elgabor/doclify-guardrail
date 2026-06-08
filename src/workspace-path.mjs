import fs from 'node:fs';
import path from 'node:path';

function canonicalizeForBoundaryCheck(targetPath) {
  const resolved = path.resolve(targetPath);
  if (fs.existsSync(resolved)) {
    try {
      return fs.realpathSync(resolved);
    } catch {
      return resolved;
    }
  }

  const parentDir = path.dirname(resolved);
  try {
    const canonicalParent = fs.realpathSync(parentDir);
    return path.join(canonicalParent, path.basename(resolved));
  } catch {
    return resolved;
  }
}

function isDescendantOrSame(candidatePath, basePath) {
  const resolvedCandidate = canonicalizeForBoundaryCheck(candidatePath);
  const resolvedBase = canonicalizeForBoundaryCheck(basePath);
  const rel = path.relative(resolvedBase, resolvedCandidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveWorkspacePath(targetPath, options = {}) {
  const workspace = path.resolve(options.workspace || process.cwd());
  const label = options.label || 'Output path';
  const resolvedPath = path.resolve(targetPath);
  if (!isDescendantOrSame(resolvedPath, workspace)) {
    throw new Error(`${label} must be inside workspace: ${resolvedPath}`);
  }
  return resolvedPath;
}

export {
  isDescendantOrSame,
  resolveWorkspacePath
};
