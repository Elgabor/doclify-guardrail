import fs from 'node:fs';
import path from 'node:path';

import { isMarkdownPath } from './markdown-files.mjs';
import { compareText } from './text-order.mjs';

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'coverage', 'dist', 'build', '.next', '.cache']);
const MAKEFILE_PRIORITY = new Map([['GNUmakefile', 0], ['makefile', 1], ['Makefile', 2]]);

function portable(value) {
  return value.split(path.sep).join('/');
}

function anchorFor(heading) {
  return heading
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function anchorsFor(content) {
  const anchors = new Set();
  const counts = new Map();
  for (const line of String(content).split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+)$/);
    if (!match) continue;
    const base = anchorFor(match[1]);
    if (!base) continue;
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

function makeTargetsFor(content) {
  const targets = new Set();
  const patterns = [];
  let acceptsUnknownTargets = false;
  for (const line of String(content).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*(?:\s+[A-Za-z0-9][A-Za-z0-9_.-]*)*)\s*:/);
    if (!match) {
      if (/^\s*\.DEFAULT\s*:/.test(line)) acceptsUnknownTargets = true;
      const pattern = line.match(/^\s*([^:#\s]*%[^:#\s]*)\s*:/)?.[1];
      if (pattern) {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('%', '.*');
        patterns.push(new RegExp(`^${escaped}$`));
      }
      continue;
    }
    for (const target of match[1].split(/\s+/)) targets.add(target);
  }
  return { targets, patterns, acceptsUnknownTargets };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function addPackage(index, absolutePath, workspace) {
  const manifest = readJson(absolutePath);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return;
  const relative = portable(path.relative(workspace, absolutePath));
  const scripts = manifest.scripts && typeof manifest.scripts === 'object' && !Array.isArray(manifest.scripts)
    ? new Set(Object.keys(manifest.scripts).filter((name) => typeof manifest.scripts[name] === 'string'))
    : new Set();
  const packageInfo = { path: relative, scripts };
  if (relative === 'package.json') index.rootPackage = packageInfo;
  if (typeof manifest.name === 'string' && manifest.name) index.packages.set(manifest.name, packageInfo);
}

function workspacePatterns(manifest) {
  const raw = Array.isArray(manifest?.workspaces)
    ? manifest.workspaces
    : Array.isArray(manifest?.workspaces?.packages) ? manifest.workspaces.packages : [];
  return raw.filter((value) => typeof value === 'string' && value.length > 0)
    .map((value) => value.replace(/\\/g, '/').replace(/\/$/, ''));
}

function matchesWorkspaceManifest(relativePath, patterns) {
  const directory = path.posix.dirname(relativePath);
  return patterns.some((pattern) => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped}$`).test(directory);
  });
}

function buildRepositoryIndex(workspace, { isExcluded = () => false } = {}) {
  const index = {
    files: new Set(),
    anchors: new Map(),
    packages: new Map(),
    rootPackage: null,
    makefiles: new Map()
  };

  const packageCandidates = [];
  function walk(directory) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (isExcluded(absolutePath, { directory: entry.isDirectory() })) continue;
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = portable(path.relative(workspace, absolutePath));
      index.files.add(relative);
      if (entry.name === 'package.json') packageCandidates.push(absolutePath);
      if (MAKEFILE_PRIORITY.has(entry.name)) {
        try {
          const directory = portable(path.relative(workspace, path.dirname(absolutePath))) || '.';
          const current = index.makefiles.get(directory);
          if (!current || MAKEFILE_PRIORITY.get(entry.name) < MAKEFILE_PRIORITY.get(path.basename(current.path))) {
            index.makefiles.set(directory, {
              path: relative,
              ...makeTargetsFor(fs.readFileSync(absolutePath, 'utf8'))
            });
          }
        } catch {
          // An unreadable optional evidence source is not a negative claim.
        }
      }
      if (isMarkdownPath(entry.name)) {
        try {
          index.anchors.set(relative, anchorsFor(fs.readFileSync(absolutePath, 'utf8')));
        } catch {
          // The scan will report selected unreadable documents separately.
        }
      }
    }
  }

  walk(workspace);
  const rootManifestPath = path.join(workspace, 'package.json');
  addPackage(index, rootManifestPath, workspace);
  const rootManifest = readJson(rootManifestPath);
  const patterns = workspacePatterns(rootManifest);
  for (const candidate of packageCandidates) {
    const relative = portable(path.relative(workspace, candidate));
    if (relative !== 'package.json' && matchesWorkspaceManifest(relative, patterns)) {
      addPackage(index, candidate, workspace);
    }
  }
  return index;
}

export { anchorFor, buildRepositoryIndex };
