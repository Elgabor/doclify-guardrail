import path from 'node:path';

import { analyzeFences, getFenceOpen } from './fences.mjs';
import { anchorFor } from './repository-index.mjs';

const SHELL_FENCE_LANGUAGES = new Set(['sh', 'bash', 'shell', 'console', 'zsh', 'fish']);

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
        ? path.posix.normalize(path.posix.join(path.posix.dirname(filePath), target.split('?')[0]))
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

    const make = /\bmake\s+([A-Za-z0-9][A-Za-z0-9_.-]*)/g;
    let makeMatch;
    while ((makeMatch = make.exec(segment)) !== null) {
      const target = makeMatch[1];
      if (index.hasMakefile && !index.makeTargets.has(target)) {
        add(claim('make-target', lineNumber, `Unknown make target: ${target}.`, `No Makefile target named ${target} was found.`, 'Makefile target index'));
      }
    }

    const cli = /\bdoclify-guardrail\s+([a-z][a-z-]*)([^\n]*)/g;
    let cliMatch;
    while ((cliMatch = cli.exec(segment)) !== null) {
      const command = cliMatch[1];
      if (!index.cli.isSupportedCliCommand(command)) {
        add(claim('cli-contract', lineNumber, `Unknown Doclify Guardrail command: ${command}.`, `${command} is not in the static Doclify Guardrail CLI command set.`, 'src/cli-contract.mjs'));
      }
      for (const flag of cliMatch[2].matchAll(/--[a-z][a-z-]*/g)) {
        if (!index.cli.isSupportedCliFlag(flag[0])) {
          add(claim('cli-contract', lineNumber, `Unknown Doclify Guardrail flag: ${flag[0]}.`, `${flag[0]} is not in the static Doclify Guardrail CLI flag set.`, 'src/cli-contract.mjs'));
        }
      }
    }
  }
  return findings;
}

export { analyzeRepositoryClaims, checkRepositoryClaims };
