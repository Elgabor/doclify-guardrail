import path from 'node:path';

import { analyzeFences, getFenceOpen } from './fences.mjs';
import { parseCliInvocation } from './cli-contract.mjs';
import { decodeLocalPath } from './local-url.mjs';
import { isMarkdownPath } from './markdown-files.mjs';
import { anchorFor } from './repository-index.mjs';

const SHELL_FENCE_LANGUAGES = new Set(['sh', 'bash', 'shell', 'console', 'zsh', 'fish']);
const MAKE_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?::|\+|\?|!)?=.*/;
const MAKE_TARGET = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const MAKE_FLAG_OPTIONS = new Set([
  '--always-make', '--debug', '--environment-overrides', '--ignore-errors', '--keep-going',
  '--no-builtin-rules', '--no-builtin-variables', '--no-print-directory', '--print-data-base',
  '--question', '--silent', '--stop', '--touch', '--trace', '--version', '--warn-undefined-variables'
]);
const MAKE_VALUE_OPTIONS = new Set([
  '--assume-new', '--assume-old', '--directory', '--include-dir',
  '--new-file', '--old-file', '--what-if'
]);
// npm treats the event name as a literal key; shell metacharacters are not static evidence.
const NPM_DYNAMIC_MARKERS = /[*?\[\]{}$`<>]/;
const NPM_IMPLICIT_EVENTS = new Set(['env', 'restart', 'start']);

function claim(ruleId, line, message, fact, source) {
  return {
    ruleId,
    severity: 'blocking',
    confidence: 'verified',
    line,
    column: null,
    message,
    evidence: { fact, source }
  };
}

function normalizeWorkspacePath(value) {
  if (!value) return null;
  const portable = value.replace(/\\/g, '/');
  if (path.posix.isAbsolute(portable) || /^[A-Za-z]:\//.test(portable)) return null;
  const normalized = path.posix.normalize(portable);
  if (normalized === '..' || normalized.startsWith('../')) return null;
  return normalized === '.' ? null : normalized;
}

function isStaticWorkspaceSelector(value) {
  return Boolean(value && value !== '--' && !value.startsWith('-') && normalizeWorkspacePath(value));
}

function packageFor(index, workspaceName) {
  const selectorPath = normalizeWorkspacePath(workspaceName);
  return (index.workspacePackages || []).find((packageInfo) => packageInfo.name === workspaceName
    || (selectorPath && packageInfo.directory === selectorPath)) || null;
}

function isRootDocument(filePath) {
  return path.posix.dirname(filePath) === '.';
}

function unavailableWorkspaceSource(index) {
  const rootSource = index.packageSources?.get('package.json');
  if (rootSource && !['available', 'absent'].includes(rootSource.state)) return rootSource;
  return (index.workspaceSources || [])
    .find((candidate) => !['available', 'absent'].includes(candidate.state)) || null;
}

function resolvePackageClaim(index, workspaceName, filePath) {
  if (!workspaceName) {
    if (!isRootDocument(filePath)) return { manifest: null, source: null, unknown: false };
    return {
      manifest: index.rootPackage,
      source: index.packageSources?.get('package.json') || null,
      unknown: false
    };
  }
  const manifest = packageFor(index, workspaceName);
  if (manifest) return { manifest, source: index.packageSources?.get(manifest.path) || null, unknown: false };
  const selectorPath = normalizeWorkspacePath(workspaceName);
  if (selectorPath && (index.workspacePackages || [])
    .some((packageInfo) => packageInfo.directory.startsWith(`${selectorPath}/`))) {
    // npm parent-directory selectors can address multiple workspaces, outside this single-source rule.
    return { manifest: null, source: null, unknown: false };
  }
  if (!index.rootPackage && index.packageSources?.get('package.json')?.state === 'absent') {
    return { manifest: null, source: null, unknown: false };
  }
  const matchingSource = (index.workspaceSources || []).find((source) => selectorPath && source.directory === selectorPath);
  const source = matchingSource || unavailableWorkspaceSource(index);
  return { manifest: null, source, unknown: !source };
}

function evidenceDiagnostic(source) {
  if (!source || ['available', 'absent'].includes(source.state)) return null;
  const code = source.state === 'invalid'
    ? 'evidence-source-invalid'
    : source.state === 'unreadable' ? 'evidence-source-unreadable' : 'evidence-source-unavailable';
  const message = source.state === 'invalid'
    ? 'Evidence source is malformed and cannot support this claim.'
    : source.state === 'unreadable'
      ? 'Evidence source cannot be read and cannot support this claim.'
      : 'Evidence source is unavailable for this scan and cannot support this claim.';
  return { code, severity: 'error', path: source.path, message };
}

function normalizeAnchor(value) {
  try {
    return anchorFor(decodeURIComponent(value));
  } catch {
    return anchorFor(value);
  }
}

function staticCommandWords(text) {
  const words = [];
  let word = '';
  let quote = null;
  let escaped = false;
  const push = () => {
    if (word !== '') words.push(word);
    word = '';
  };
  for (const character of text) {
    if (escaped) {
      word += character;
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else word += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      push();
      continue;
    }
    if (';&|'.includes(character)) return null;
    if (character === '#' && word === '') break;
    word += character;
  }
  if (quote || escaped) return null;
  push();
  return words;
}

function workspaceOptionAt(words, index) {
  const token = words[index];
  if (token === '--workspace' || token === '-w') {
    return { value: words[index + 1], nextIndex: index + 2 };
  }
  if (token?.startsWith('--workspace=')) {
    return { value: token.slice('--workspace='.length), nextIndex: index + 1 };
  }
  if (token?.startsWith('-w=')) {
    return { value: token.slice(3), nextIndex: index + 1 };
  }
  return null;
}

function parseStaticNpmRun(words) {
  if (!words || words[0] !== 'npm') return null;
  let index = 1;
  let workspaceName = null;
  while (index < words.length && words[index] !== 'run') {
    const option = workspaceOptionAt(words, index);
    if (!option || workspaceName || !isStaticWorkspaceSelector(option.value)
      || NPM_DYNAMIC_MARKERS.test(option.value)) return null;
    workspaceName = option.value;
    index = option.nextIndex;
  }
  if (words[index] !== 'run') return null;
  const scriptName = words[index + 1];
  if (!scriptName || scriptName.startsWith('-') || NPM_DYNAMIC_MARKERS.test(scriptName)) return null;
  index += 2;
  let ifPresent = false;
  while (index < words.length && words[index] !== '--') {
    const option = workspaceOptionAt(words, index);
    if (option) {
      if (workspaceName || !isStaticWorkspaceSelector(option.value)
        || NPM_DYNAMIC_MARKERS.test(option.value)) return null;
      workspaceName = option.value;
    } else if (words[index] !== '--if-present') {
      return null;
    } else {
      ifPresent = true;
    }
    index = option ? option.nextIndex : index + 1;
  }
  return { workspaceName, scriptName, ifPresent };
}

function makeDirectory(current, value) {
  if (!value || path.posix.isAbsolute(value) || /[$`*?\[\]{}]/.test(value)) return null;
  const resolved = path.posix.normalize(path.posix.join(current, value));
  return resolved === '..' || resolved.startsWith('../') ? null : resolved;
}

function parseMakeInvocation(words) {
  let directory = '.';
  let explicitDirectory = false;
  const targets = [];
  let optionsEnded = false;
  for (let index = 1; index < words.length; index += 1) {
    const token = words[index];
    if (MAKE_ASSIGNMENT.test(token)) continue;
    if (optionsEnded) {
      if (!MAKE_TARGET.test(token)) return null;
      targets.push(token);
      continue;
    }
    if (token === '--') {
      optionsEnded = true;
      continue;
    }
    if (!token.startsWith('-') || token === '-') {
      if (!MAKE_TARGET.test(token)) return null;
      targets.push(token);
      continue;
    }

    const [longFlag, attachedValue] = token.startsWith('--') ? token.split(/=(.*)/s, 2) : [null, null];
    if (longFlag) {
      if (MAKE_FLAG_OPTIONS.has(longFlag)) {
        if (attachedValue != null) return null;
        continue;
      }
      if (['--jobs', '--load-average', '--max-load', '--output-sync'].includes(longFlag)) {
        if (attachedValue == null && /^\d+(?:\.\d+)?$/.test(words[index + 1] || '')) index += 1;
        continue;
      }
      if (longFlag === '--makefile' || longFlag === '--eval') return null;
      if (!MAKE_VALUE_OPTIONS.has(longFlag)) return null;
      const value = attachedValue == null ? words[++index] : attachedValue;
      if (!value) return null;
      if (longFlag === '--directory') {
        directory = makeDirectory(directory, value);
        if (directory == null) return null;
        explicitDirectory = true;
      }
      continue;
    }

    if (token === '-C' || token.startsWith('-C')) {
      const value = token === '-C' ? words[++index] : token.slice(2);
      directory = makeDirectory(directory, value);
      if (directory == null) return null;
      explicitDirectory = true;
      continue;
    }
    if (token === '-f' || token.startsWith('-f')) return null;
    if (/^-[IW](?:.+)?$/.test(token)) {
      if (token.length === 2 && !words[++index]) return null;
      continue;
    }
    if (/^-(?:j|l|O)(?:\d+(?:\.\d+)?|none|line|target|recurse)?$/.test(token)) {
      if (token.length === 2 && /^\d+(?:\.\d+)?$/.test(words[index + 1] || '')) index += 1;
      continue;
    }
    if (/^-[bBdeikmnpqrsStvw]+$/.test(token)) continue;
    return null;
  }
  return { directory, explicitDirectory, targets };
}

function makefileContextFor(invocation, filePath) {
  if (invocation.explicitDirectory) return { directory: invocation.directory };
  // A Markdown path is not a shell cwd; only a root document has an observable root context.
  return isRootDocument(filePath) ? { directory: '.' } : null;
}

function analyzeRepositoryClaims(content) {
  const lines = String(content).split(/\r?\n/);
  const fences = analyzeFences(lines);
  const segments = [];
  let activeFence = null;
  for (let offset = 0; offset < lines.length; offset += 1) {
    const line = lines[offset];
    if (fences.opening.has(offset)) {
      const open = getFenceOpen(line);
      activeFence = open ? open.info.trim().split(/\s+/, 1)[0].toLowerCase() : null;
      continue;
    }
    if (fences.closing.has(offset)) {
      activeFence = null;
      continue;
    }
    if (fences.inFence[offset]) {
      if (SHELL_FENCE_LANGUAGES.has(activeFence)) segments.push({ line: offset + 1, text: line });
      continue;
    }
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      segments.push({ line: offset + 1, text: match[1] });
    }
  }
  const hasCommand = segments.some(({ text }) => /\bnpm\b|\bmake\s+|\bdoclify-guardrail\s+/.test(text));
  const hasAnchor = lines.some((line, offset) => !fences.inFence[offset]
    && /\[[^\]]*\]\([^\s)]+#[^\s)]+\)/.test(line));
  return { lines, fences, segments, hasClaims: hasCommand || hasAnchor };
}

function checkRepositoryClaims(analysis, index, filePath, { allowCommandClaims = true } = {}) {
  const findings = [];
  const diagnostics = [];
  const seen = new Set();
  const seenDiagnostics = new Set();
  const add = (finding) => {
    const key = `${finding.ruleId}\0${finding.line}\0${finding.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(finding);
    }
  };
  const addDiagnostic = (diagnostic) => {
    if (!diagnostic) return;
    const key = `${diagnostic.code}\0${diagnostic.path}`;
    if (!seenDiagnostics.has(key)) {
      seenDiagnostics.add(key);
      diagnostics.push(diagnostic);
    }
  };

  const { lines, fences, segments } = analysis;
  for (const [offset, line] of lines.entries()) {
    const lineNumber = offset + 1;
    if (fences.inFence[offset]) continue;
    for (const linkMatch of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const url = linkMatch[1];
      if (!url.includes('#') || /^(?:https?:|mailto:|tel:|data:|javascript:|\/)/i.test(url)) continue;
      const [target, fragment] = url.split('#', 2);
      const targetPath = target
        ? path.posix.normalize(path.posix.join(path.posix.dirname(filePath), decodeLocalPath(target)))
        : filePath;
      if (!index.files.has(targetPath)) {
        const excluded = [...(index.excludedPaths || [])].find((excludedPath) => targetPath === excludedPath
          || targetPath.startsWith(`${excludedPath}/`));
        if (excluded) addDiagnostic(evidenceDiagnostic({ path: targetPath, state: 'excluded' }));
        continue;
      }
      if (!isMarkdownPath(targetPath)) continue;
      const anchorSource = index.anchorSources?.get(targetPath) || { path: targetPath, state: 'unavailable' };
      if (anchorSource.state !== 'available') {
        addDiagnostic(evidenceDiagnostic(anchorSource));
        continue;
      }
      const anchors = index.anchors.get(targetPath);
      const anchor = normalizeAnchor(fragment).toLowerCase();
      if (anchor && !anchors?.has(anchor)) {
        add(claim('local-link', lineNumber, `Missing local anchor: #${fragment}.`, `No anchor named #${fragment} was found in ${targetPath}.`, targetPath));
      }
    }
  }
  if (!allowCommandClaims) return { findings, diagnostics };

  for (const { line: lineNumber, text: segment } of segments) {
    const staticWords = staticCommandWords(segment);
    const npm = parseStaticNpmRun(staticWords);
    if (npm) {
      const { workspaceName, scriptName, ifPresent } = npm;
      const packageClaim = resolvePackageClaim(index, workspaceName, filePath);
      addDiagnostic(evidenceDiagnostic(packageClaim.source));
      if (packageClaim.source && packageClaim.source.state !== 'available') continue;
      if (workspaceName && !packageClaim.manifest) {
        if (packageClaim.unknown) {
          add(claim('workspace-package', lineNumber, `Unknown workspace package: ${workspaceName}.`, `No workspace package named ${workspaceName} was found.`, 'workspace package.json manifests'));
        }
        continue;
      }
      if (!packageClaim.manifest || ifPresent) continue;
      if (!packageClaim.manifest.scripts.has(scriptName) && !NPM_IMPLICIT_EVENTS.has(scriptName)) {
        add(claim('package-script', lineNumber, `Unknown npm script: ${scriptName}.`, `No script named ${scriptName} was found in ${packageClaim.manifest.path}.`, packageClaim.manifest.path));
      }
    }

    const invocation = staticWords?.[0] === 'make' ? parseMakeInvocation(staticWords) : null;
    if (invocation) {
      const makefileContext = makefileContextFor(invocation, filePath);
      if (makefileContext) {
        const makefile = index.makefiles.get(makefileContext.directory);
        if (!makefile) {
          addDiagnostic(evidenceDiagnostic(index.makeSources?.get(makefileContext.directory)));
        } else {
          for (const target of invocation.targets) {
            if (!makefile.acceptsUnknownTargets && !makefile.targets.has(target)
              && !makefile.patterns.some((pattern) => pattern.test(target))) {
              add(claim('make-target', lineNumber, `Unknown make target: ${target}.`, `No Makefile target named ${target} was found.`, makefile.path));
            }
          }
        }
      }
    }

    const cliIndex = staticWords?.[0] === 'doclify-guardrail'
      ? 0
      : staticWords?.[0] === 'npx' && staticWords[1] === 'doclify-guardrail' ? 1 : -1;
    if (cliIndex >= 0 && staticWords.length > cliIndex + 1 && !/<[A-Za-z][^>]*>/.test(segment)) {
      const invocation = parseCliInvocation(staticWords.slice(cliIndex + 1));
      if (!invocation.valid) {
        add(claim('cli-contract', lineNumber, 'Invalid Doclify Guardrail invocation.', invocation.message, 'src/cli-contract.mjs'));
      }
    }
  }
  return { findings, diagnostics };
}

export { analyzeRepositoryClaims, checkRepositoryClaims };
