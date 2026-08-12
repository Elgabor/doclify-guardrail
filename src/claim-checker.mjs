import path from 'node:path';

import { analyzeFences, getFenceOpen } from './fences.mjs';
import { validateCliInvocation } from './cli-contract.mjs';
import { decodeLocalPath } from './local-url.mjs';
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
  '--assume-new', '--assume-old', '--directory', '--eval', '--include-dir', '--makefile',
  '--new-file', '--old-file', '--what-if'
]);

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

function packageFor(index, workspaceName) {
  if (!workspaceName) return index.rootPackage;
  return index.packages.get(workspaceName) || null;
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
    if (';&|'.includes(character)) {
      push();
      break;
    }
    if (character === '#' && word === '') break;
    word += character;
  }
  if (quote || escaped) return null;
  push();
  return words;
}

function makeDirectory(current, value) {
  if (!value || path.posix.isAbsolute(value) || /[$`*?\[\]{}]/.test(value)) return null;
  const resolved = path.posix.normalize(path.posix.join(current, value));
  return resolved === '..' || resolved.startsWith('../') ? null : resolved;
}

function parseMakeInvocation(words) {
  let directory = '.';
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
      if (!MAKE_VALUE_OPTIONS.has(longFlag)) return null;
      const value = attachedValue == null ? words[++index] : attachedValue;
      if (!value) return null;
      if (longFlag === '--makefile') return null;
      if (longFlag === '--directory') {
        directory = makeDirectory(directory, value);
        if (directory == null) return null;
      }
      continue;
    }

    if (token === '-C' || token.startsWith('-C')) {
      const value = token === '-C' ? words[++index] : token.slice(2);
      directory = makeDirectory(directory, value);
      if (directory == null) return null;
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
  return { directory, targets };
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
  const hasCommand = segments.some(({ text }) => /\b(?:npm(?:\s+--workspace(?:=|\s+)[^\s]+)?\s+run|make\s+|doclify-guardrail\s+)/.test(text));
  const hasAnchor = lines.some((line, offset) => !fences.inFence[offset]
    && /\[[^\]]*\]\([^\s)]+#[^\s)]+\)/.test(line));
  return { lines, fences, segments, hasClaims: hasCommand || hasAnchor };
}

function checkRepositoryClaims(analysis, index, filePath) {
  const findings = [];
  const seen = new Set();
  const add = (finding) => {
    const key = `${finding.ruleId}\0${finding.line}\0${finding.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(finding);
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
      if (!index.files.has(targetPath)) continue;
      const anchors = index.anchors.get(targetPath);
      const anchor = normalizeAnchor(fragment).toLowerCase();
      if (anchor && !anchors?.has(anchor)) {
        add(claim('local-link', lineNumber, `Missing local anchor: #${fragment}.`, `No anchor named #${fragment} was found in ${targetPath}.`, targetPath));
      }
    }
  }
  for (const { line: lineNumber, text: segment } of segments) {
    const npm = /\bnpm(?:\s+--workspace(?:=|\s+)([^\s]+))?\s+run\s+([A-Za-z0-9:_-]+)/g;
    let npmMatch;
    while ((npmMatch = npm.exec(segment)) !== null) {
      const workspaceName = npmMatch[1];
      const scriptName = npmMatch[2];
      const manifest = packageFor(index, workspaceName);
      if (workspaceName && !manifest) {
        add(claim('workspace-package', lineNumber, `Unknown workspace package: ${workspaceName}.`, `No workspace package named ${workspaceName} was found.`, 'workspace package.json manifests'));
        continue;
      }
      if (!manifest) continue;
      if (!manifest.scripts.has(scriptName)) {
        add(claim('package-script', lineNumber, `Unknown npm script: ${scriptName}.`, `No script named ${scriptName} was found in ${manifest.path}.`, manifest.path));
      }
    }

    const make = /\bmake\b/g;
    let makeMatch;
    while ((makeMatch = make.exec(segment)) !== null) {
      const words = staticCommandWords(segment.slice(makeMatch.index));
      const invocation = words && parseMakeInvocation(words);
      if (!invocation) continue;
      const makefile = index.makefiles.get(invocation.directory);
      if (!makefile) continue;
      for (const target of invocation.targets) {
        if (!makefile.acceptsUnknownTargets && !makefile.targets.has(target)
          && !makefile.patterns.some((pattern) => pattern.test(target))) {
          add(claim('make-target', lineNumber, `Unknown make target: ${target}.`, `No Makefile target named ${target} was found.`, makefile.path));
        }
      }
    }

    const cli = /\bdoclify-guardrail(?=\s)/g;
    let cliMatch;
    while ((cliMatch = cli.exec(segment)) !== null) {
      const commandText = segment.slice(cliMatch.index);
      if (/<[A-Za-z][^>]*>/.test(commandText)) continue;
      const words = staticCommandWords(commandText);
      if (!words) continue;
      const validation = validateCliInvocation(words.slice(1));
      if (!validation.valid) {
        add(claim('cli-contract', lineNumber, 'Invalid Doclify Guardrail invocation.', validation.message, 'src/cli-contract.mjs'));
      }
    }
  }
  return findings;
}

export { analyzeRepositoryClaims, checkRepositoryClaims };
