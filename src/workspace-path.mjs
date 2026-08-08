import fs from 'node:fs';
import path from 'node:path';

function canonicalizeForBoundaryCheck(targetPath, seenLinks = new Set()) {
  const resolved = path.resolve(targetPath);

  let current = resolved;
  const remainder = [];
  while (true) {
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code !== 'ENOENT') return null;
      const parent = path.dirname(current);
      if (parent === current) return null;
      remainder.unshift(path.basename(current));
      current = parent;
      continue;
    }

    if (stat.isSymbolicLink()) {
      if (seenLinks.has(current)) return null;
      const nextSeenLinks = new Set(seenLinks);
      nextSeenLinks.add(current);
      let linkTarget;
      try {
        linkTarget = fs.readlinkSync(current);
      } catch {
        return null;
      }
      const resolvedTarget = path.resolve(path.dirname(current), linkTarget);
      return canonicalizeForBoundaryCheck(path.join(resolvedTarget, ...remainder), nextSeenLinks);
    }

    try {
      return path.join(fs.realpathSync(current), ...remainder);
    } catch {
      return null;
    }
  }
}

function isDescendantOrSame(candidatePath, basePath) {
  const resolvedCandidate = canonicalizeForBoundaryCheck(candidatePath);
  const resolvedBase = canonicalizeForBoundaryCheck(basePath);
  if (resolvedCandidate == null || resolvedBase == null) return false;
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
