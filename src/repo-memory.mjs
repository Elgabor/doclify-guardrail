import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, getDoclifyHome } from './repo.mjs';

function sanitizeFingerprint(fingerprint) {
  return String(fingerprint || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function getRepoMemoryPath(repoMetadata) {
  return path.join(getDoclifyHome(), 'repos', sanitizeFingerprint(repoMetadata?.fingerprint), 'memory.json');
}

function createDefaultRepoMemory(repoMetadata) {
  return {
    schemaVersion: 1,
    repoFingerprint: repoMetadata?.fingerprint || 'unknown',
    updatedAt: null,
    terms: [],
    headingPatterns: [],
    linkTitlePatterns: [],
    acceptedFixes: [],
    suppressions: []
  };
}

function loadRepoMemory(repoMetadata) {
  const filePath = getRepoMemoryPath(repoMetadata);
  if (!fs.existsSync(filePath)) {
    return createDefaultRepoMemory(repoMetadata);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      ...createDefaultRepoMemory(repoMetadata),
      ...parsed
    };
  } catch {
    return createDefaultRepoMemory(repoMetadata);
  }
}

function saveRepoMemory(repoMetadata, memory) {
  const filePath = getRepoMemoryPath(repoMetadata);
  ensureDir(path.dirname(filePath));
  const next = {
    ...createDefaultRepoMemory(repoMetadata),
    ...memory,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
  return filePath;
}

export {
  createDefaultRepoMemory,
  getRepoMemoryPath,
  loadRepoMemory,
  saveRepoMemory
};
