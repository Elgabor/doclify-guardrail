import fs from 'node:fs';
import path from 'node:path';

import { analyzeFences } from './fences.mjs';
import { isMarkdownPath } from './markdown-files.mjs';
import { compareText } from './text-order.mjs';

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'coverage', 'dist', 'build', '.next', '.cache']);
const MAKEFILE_PRIORITY = new Map([['GNUmakefile', 0], ['makefile', 1], ['Makefile', 2]]);
const MAKEFILE_ASSIGNMENT = /^\s*(?:(?:override|export|private)\s+)*[A-Za-z_][A-Za-z0-9_]*\s*(?::::=|::=|:=|\+=|\?=|!=|=)/;
const MAKEFILE_INCLUDE = /^\s*(?:-?include|sinclude)\s+/;
const STATIC_MAKE_TARGET = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

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
  const text = String(content);
  const lines = text.split(/\r?\n/);
  const anchors = new Set();
  const counts = new Map();
  const addAnchor = (value) => {
    const base = anchorFor(value);
    if (!base) return;
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  };
  const hasFence = /(^|\r?\n)[ \t]{0,3}(?:`{3,}|~{3,})/.test(text);
  const hasSetext = /(^|\r?\n)[^\r\n]+\r?\n[ \t]*(?:=+|-+)[ \t]*(?:\r?\n|$)/.test(text);
  const fences = analyzeFences(lines);
  const visibleText = lines.filter((line, index) => !fences.inFence[index]).join('\n');
  const hasHtmlAnchor = /<[^>\r\n]*[\s/](?:id|name)\s*=/i.test(visibleText);
  const hasMultilineHtmlAnchor = /<[^>\r\n]*\r?\n[^>]*(?:\bid|\bname)\s*=/i.test(visibleText);
  const hasDynamicTag = lines.some((line, index) => !fences.inFence[index]
    && /<[A-Za-z][^>\r\n]*\{[^>\r\n]*>/i.test(line));
  const hasUnclosedTag = lines.some((line, index) => !fences.inFence[index]
    && /<[A-Za-z][^>]*$/.test(line));
  if (!hasFence && !hasSetext && !hasHtmlAnchor && !hasMultilineHtmlAnchor
    && !hasDynamicTag && !hasUnclosedTag) {
    for (const line of lines) {
      const atx = line.match(/^#{1,6}\s+(.+)$/);
      if (atx) addAnchor(atx[1]);
    }
    return { anchors, complete: true };
  }

  const hasUnclosedFence = fences.opening.size > fences.closing.size;
  let complete = !hasMultilineHtmlAnchor && !hasUnclosedFence && !hasDynamicTag && !hasUnclosedTag;
  for (let index = 0; index < lines.length; index += 1) {
    if (fences.inFence[index]) continue;
    const line = lines[index];
    const atx = line.match(/^#{1,6}\s+(.+)$/);
    if (atx) addAnchor(atx[1]);
    const setext = lines[index + 1]?.match(/^\s*(?:=+|-+)\s*$/);
    if (line.trim() && setext && !fences.inFence[index + 1]) addAnchor(line.trim());

    for (const tagMatch of line.matchAll(/<[^>]*>/g)) {
      const tag = tagMatch[0];
      if (tag.startsWith('<!--')) continue;
      for (const attribute of tag.matchAll(/(?:^|[\s/])(id|name)\s*=\s*/gi)) {
        const valueStart = attribute.index + attribute[0].length;
        const quote = tag[valueStart];
        if (quote !== '"' && quote !== "'") {
          complete = false;
          continue;
        }
        const valueEnd = tag.indexOf(quote, valueStart + 1);
        if (valueEnd < 0) {
          complete = false;
          continue;
        }
        addAnchor(tag.slice(valueStart + 1, valueEnd));
      }
    }
  }
  return { anchors, complete };
}

function makeTargetsFor(content) {
  const targets = new Set();
  const patterns = [];
  let acceptsUnknownTargets = false;
  for (const line of String(content).split(/\r?\n/)) {
    if (MAKEFILE_ASSIGNMENT.test(line)) continue;
    const phony = line.match(/^\s*\.PHONY\s*:\s*([^#]*)/);
    if (phony) {
      for (const target of phony[1].trim().split(/\s+/)) {
        if (STATIC_MAKE_TARGET.test(target)) targets.add(target);
      }
      continue;
    }
    const match = line.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*(?:\s+[A-Za-z0-9][A-Za-z0-9_.-]*)*)\s*:/);
    if (!match) {
      if (/^\s*\.DEFAULT\s*:/.test(line) || MAKEFILE_INCLUDE.test(line)) {
        acceptsUnknownTargets = true;
      }
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

function readJsonSource(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return { state: error?.code === 'ENOENT' ? 'absent' : 'unreadable', manifest: null };
  }
  try {
    const manifest = JSON.parse(text);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return { state: 'invalid', manifest: null };
    }
    return { state: 'available', manifest };
  } catch {
    return { state: 'invalid', manifest: null };
  }
}

function addPackage(index, absolutePath, workspace) {
  const relative = portable(path.relative(workspace, absolutePath));
  const directory = portable(path.dirname(path.relative(workspace, absolutePath))) || '.';
  const source = readJsonSource(absolutePath);
  index.packageSources.set(relative, { path: relative, state: source.state });
  if (source.state !== 'available') return null;
  const { manifest } = source;
  const name = typeof manifest.name === 'string' && manifest.name ? manifest.name : null;
  const scripts = manifest.scripts && typeof manifest.scripts === 'object' && !Array.isArray(manifest.scripts)
    ? new Set(Object.keys(manifest.scripts).filter((scriptName) => typeof manifest.scripts[scriptName] === 'string'))
    : new Set();
  const packageInfo = { path: relative, directory, name, scripts };
  if (relative === 'package.json') index.rootPackage = packageInfo;
  if (name) index.packages.set(name, packageInfo);
  return { manifest, packageInfo };
}

function workspacePatterns(manifest) {
  const raw = Array.isArray(manifest?.workspaces)
    ? manifest.workspaces
    : Array.isArray(manifest?.workspaces?.packages) ? manifest.workspaces.packages : [];
  return raw.filter((value) => typeof value === 'string' && value.length > 0)
    .map((value) => value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''));
}

function workspacePatternMatches(directory, pattern) {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern.startsWith('**/', index)) {
      expression += '(?:.*/)?';
      index += 2;
    } else if (pattern.startsWith('**', index)) {
      expression += '.*';
      index += 1;
    } else if (pattern[index] === '*') {
      expression += '[^/]*';
    } else {
      expression += pattern[index].replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${expression}$`).test(directory);
}

function matchesWorkspaceManifest(relativePath, patterns) {
  const directory = path.posix.dirname(relativePath);
  return patterns.some((pattern) => workspacePatternMatches(directory, pattern));
}

function excludedPathMayContainWorkspace(relativePath, patterns) {
  const directory = relativePath.endsWith('/package.json')
    ? path.posix.dirname(relativePath)
    : relativePath;
  if (matchesWorkspaceManifest(`${directory}/package.json`, patterns)) return true;
  return patterns.some((pattern) => {
    const prefix = pattern.split('*', 1)[0].replace(/\/+$/, '');
    return prefix && (directory === prefix
      || directory.startsWith(`${prefix}/`)
      || prefix.startsWith(`${directory}/`));
  });
}

function buildRepositoryIndex(workspace, { isExcluded = () => false } = {}) {
  const index = {
    files: new Set(),
    anchors: new Map(),
    packages: new Map(),
    workspacePackages: [],
    packageSources: new Map(),
    workspaceSources: [],
    anchorSources: new Map(),
    makeSources: new Map(),
    excludedPaths: new Set(),
    excludedDirectories: new Set(),
    unreadableDirectories: new Set(),
    rootPackage: null,
    makefiles: new Map()
  };

  const packageCandidates = [];
  function walk(directory) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      index.unreadableDirectories.add(portable(path.relative(workspace, directory)) || '.');
      return;
    }
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (isExcluded(absolutePath, { directory: entry.isDirectory() })) {
        const excludedPath = portable(path.relative(workspace, absolutePath));
        index.excludedPaths.add(excludedPath);
        if (entry.isDirectory()) {
          index.excludedDirectories.add(excludedPath);
          if (!index.makeSources.has(excludedPath)) {
            index.makeSources.set(excludedPath, { path: excludedPath, state: 'excluded', priority: Number.MAX_SAFE_INTEGER });
          }
        } else if (MAKEFILE_PRIORITY.has(entry.name)) {
          const makeDirectory = portable(path.relative(workspace, path.dirname(absolutePath))) || '.';
          const priority = MAKEFILE_PRIORITY.get(entry.name);
          const current = index.makeSources.get(makeDirectory);
          if (!current || priority < current.priority) {
            index.makeSources.set(makeDirectory, { path: excludedPath, state: 'excluded', priority });
          }
        }
        continue;
      }
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = portable(path.relative(workspace, absolutePath));
      index.files.add(relative);
      if (entry.name === 'package.json') packageCandidates.push(absolutePath);
      if (MAKEFILE_PRIORITY.has(entry.name)) {
        const directory = portable(path.relative(workspace, path.dirname(absolutePath))) || '.';
        const priority = MAKEFILE_PRIORITY.get(entry.name);
        const current = index.makeSources.get(directory);
        if (!current || priority < current.priority) {
          try {
            index.makefiles.set(directory, {
              path: relative,
              ...makeTargetsFor(fs.readFileSync(absolutePath, 'utf8'))
            });
            index.makeSources.set(directory, { path: relative, state: 'available', priority });
          } catch {
            index.makefiles.delete(directory);
            index.makeSources.set(directory, { path: relative, state: 'unreadable', priority });
          }
        }
      }
      if (isMarkdownPath(entry.name)) {
        try {
          const anchorAnalysis = anchorsFor(fs.readFileSync(absolutePath, 'utf8'));
          index.anchors.set(relative, anchorAnalysis.anchors);
          index.anchorSources.set(relative, {
            path: relative,
            state: anchorAnalysis.complete ? 'available' : 'unavailable'
          });
        } catch {
          index.anchorSources.set(relative, { path: relative, state: 'unreadable' });
        }
      }
    }
  }

  walk(workspace);
  const rootCandidate = packageCandidates.find((candidate) => portable(path.relative(workspace, candidate)) === 'package.json');
  let rootResult = null;
  if (rootCandidate) {
    rootResult = addPackage(index, rootCandidate, workspace);
  } else {
    const rootExcluded = index.excludedPaths.has('package.json');
    const state = rootExcluded ? 'excluded' : 'absent';
    index.packageSources.set('package.json', { path: 'package.json', state });
  }
  const patterns = workspacePatterns(rootResult?.manifest);
  for (const directory of index.unreadableDirectories) {
    if (!index.makeSources.has(directory)) {
      index.makeSources.set(directory, { path: directory, state: 'unreadable', priority: Number.MAX_SAFE_INTEGER });
    }
    if (directory !== '.' && excludedPathMayContainWorkspace(directory, patterns)) {
      index.workspaceSources.push({ path: directory, directory, state: 'unreadable' });
    }
  }
  for (const excludedPath of index.excludedPaths) {
    const isManifest = excludedPath === 'package.json' || excludedPath.endsWith('/package.json');
    if ((isManifest || index.excludedDirectories.has(excludedPath))
      && excludedPath !== 'package.json'
      && excludedPathMayContainWorkspace(excludedPath, patterns)) {
      const directory = isManifest ? portable(path.posix.dirname(excludedPath)) : excludedPath;
      index.workspaceSources.push({ path: excludedPath, directory, state: 'excluded' });
    }
  }
  for (const candidate of packageCandidates) {
    const relative = portable(path.relative(workspace, candidate));
    if (relative === 'package.json') continue;
    const result = addPackage(index, candidate, workspace);
    if (!matchesWorkspaceManifest(relative, patterns)) continue;
    const source = index.packageSources.get(relative);
    index.workspaceSources.push({
      path: relative,
      directory: result?.packageInfo.directory || portable(path.dirname(relative)),
      state: source?.state || 'unreadable'
    });
    if (result?.packageInfo) index.workspacePackages.push(result.packageInfo);
  }
  index.workspaceSources.sort((left, right) => compareText(left.path, right.path));
  return index;
}

export { anchorFor, buildRepositoryIndex };
