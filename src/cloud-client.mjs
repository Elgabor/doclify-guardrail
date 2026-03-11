import { resolveApiKey, resolveApiUrl } from './auth-store.mjs';

const DEFAULT_API_URL = 'https://api.doclify.app';

class CloudError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'CloudError';
    this.status = options.status ?? null;
    this.details = options.details;
  }
}

function normalizeApiUrl(apiUrl = null) {
  const chosen = resolveApiUrl(apiUrl) || DEFAULT_API_URL;
  const parsed = new URL(chosen);
  return parsed.toString().replace(/\/+$/, '');
}

async function requestJson(options) {
  const {
    apiUrl = null,
    pathName,
    method = 'GET',
    body = undefined,
    apiKey = null,
    timeoutMs = 4000,
    retries = 1
  } = options;

  const resolvedApiUrl = normalizeApiUrl(apiUrl);
  const resolvedApiKey = resolveApiKey(apiKey);
  const target = new URL(pathName.replace(/^\//, ''), `${resolvedApiUrl}/`);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        accept: 'application/json'
      };
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
      }
      if (resolvedApiKey) {
        headers.authorization = `Bearer ${resolvedApiKey}`;
      }

      const response = await fetch(target, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      clearTimeout(timer);

      const text = await response.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }

      if (response.ok) {
        return parsed ?? {};
      }

      const message = parsed?.error || parsed?.message || `Cloud request failed (${response.status})`;
      if (response.status >= 500 && attempt < retries) {
        continue;
      }
      throw new CloudError(message, { status: response.status, details: parsed ?? text });
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof CloudError) {
        throw error;
      }
      if (attempt < retries) {
        continue;
      }
      if (error?.name === 'AbortError') {
        throw new CloudError(`Cloud request timed out after ${timeoutMs}ms`, { status: 504 });
      }
      throw new CloudError(error?.message || 'Unable to reach Doclify Cloud');
    }
  }

  throw new CloudError('Cloud request failed unexpectedly');
}

async function verifyApiKey(options = {}) {
  const apiKey = resolveApiKey(options.apiKey);
  if (!apiKey) {
    throw new CloudError('Missing API key', { status: 401 });
  }

  return requestJson({
    apiUrl: options.apiUrl,
    pathName: '/v1/auth/verify-key',
    method: 'POST',
    apiKey,
    body: {
      apiKey
    },
    timeoutMs: options.timeoutMs ?? 4000,
    retries: options.retries ?? 0
  });
}

async function requestAiDrift(options = {}) {
  return requestJson({
    apiUrl: options.apiUrl,
    pathName: '/v1/ai/drift',
    method: 'POST',
    apiKey: options.apiKey,
    body: options.payload,
    timeoutMs: options.timeoutMs ?? 8000,
    retries: options.retries ?? 1
  });
}

export {
  CloudError,
  DEFAULT_API_URL,
  normalizeApiUrl,
  requestAiDrift,
  requestJson,
  verifyApiKey
};
