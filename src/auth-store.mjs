import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, getDoclifyHome } from './repo.mjs';

function getAuthFilePath() {
  return path.join(getDoclifyHome(), 'auth.json');
}

function loadAuthState() {
  const filePath = getAuthFilePath();
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function saveAuthState(state) {
  const filePath = getAuthFilePath();
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
  return filePath;
}

function clearAuthState() {
  const filePath = getAuthFilePath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  return filePath;
}

function resolveApiKey(explicit = null) {
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit.trim();
  }
  if (typeof process.env.DOCLIFY_TOKEN === 'string' && process.env.DOCLIFY_TOKEN.trim().length > 0) {
    return process.env.DOCLIFY_TOKEN.trim();
  }
  return loadAuthState()?.apiKey || null;
}

function resolveApiUrl(explicit = null) {
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit.trim();
  }
  if (typeof process.env.DOCLIFY_API_URL === 'string' && process.env.DOCLIFY_API_URL.trim().length > 0) {
    return process.env.DOCLIFY_API_URL.trim();
  }
  return loadAuthState()?.apiUrl || null;
}

export {
  clearAuthState,
  getAuthFilePath,
  loadAuthState,
  resolveApiKey,
  resolveApiUrl,
  saveAuthState
};
