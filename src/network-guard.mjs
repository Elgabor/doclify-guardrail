import { lookup } from 'node:dns/promises';
import net from 'node:net';

const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal'
]);

function normalizeHost(input) {
  if (!input) return '';
  let host = input.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (host.endsWith('.')) {
    host = host.slice(0, -1);
  }
  const zoneIndex = host.indexOf('%');
  if (zoneIndex >= 0) {
    host = host.slice(0, zoneIndex);
  }
  return host;
}

function isBlockedIpv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;

  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function ipv4FromMappedIpv6(host) {
  const normalized = normalizeHost(host);
  const dotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) return dotted[1];

  const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return null;

  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) {
    return null;
  }

  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff
  ].join('.');
}

function isBlockedIpv6(host) {
  if (host === '::' || host === '::1') return true;

  const mappedV4 = ipv4FromMappedIpv6(host);
  if (mappedV4 && isBlockedIpv4(mappedV4)) return true;

  const first = host.split(':')[0];
  const firstHextet = parseInt(first || '0', 16);
  if (!Number.isNaN(firstHextet)) {
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10
  }
  return false;
}

function blockedHostReason(host, resolvedIp = null) {
  const normalizedHost = normalizeHost(host);
  const candidateIp = normalizeHost(resolvedIp || normalizedHost);
  if (!normalizedHost) return null;

  const localHost = normalizedHost === 'localhost' || normalizedHost.endsWith('.localhost');
  if (localHost || METADATA_HOSTNAMES.has(normalizedHost)) {
    return resolvedIp
      ? `Blocked private host/IP (${normalizedHost} -> ${resolvedIp})`
      : `Blocked private host/IP (${normalizedHost})`;
  }

  const ipVersion = net.isIP(candidateIp);
  if (ipVersion === 4 && isBlockedIpv4(candidateIp)) {
    return resolvedIp
      ? `Blocked private host/IP (${normalizedHost} -> ${candidateIp})`
      : `Blocked private host/IP (${normalizedHost})`;
  }
  if (ipVersion === 6 && isBlockedIpv6(candidateIp)) {
    return resolvedIp
      ? `Blocked private host/IP (${normalizedHost} -> ${candidateIp})`
      : `Blocked private host/IP (${normalizedHost})`;
  }
  return null;
}

function normalizeDnsEntry(entry) {
  if (typeof entry === 'string') {
    return { address: normalizeHost(entry), family: net.isIP(entry) || 0 };
  }
  if (!entry || typeof entry.address !== 'string') return null;
  return {
    address: normalizeHost(entry.address),
    family: Number.isInteger(entry.family) ? entry.family : net.isIP(entry.address) || 0
  };
}

async function resolveAddresses(hostname, dnsCache, lookupFn = lookup) {
  const host = normalizeHost(hostname);
  if (dnsCache?.has(host)) {
    return dnsCache.get(host);
  }

  const promise = lookupFn(host, { all: true, verbatim: true })
    .then((entries) => entries.map((entry) => normalizeDnsEntry(entry)?.address).filter(Boolean))
    .catch(() => []);
  dnsCache?.set(host, promise);
  return promise;
}

async function getBlockedRemoteUrlReason(url, { dnsCache, lookupFn } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const host = normalizeHost(parsed.hostname);
  const directReason = blockedHostReason(host);
  if (directReason) return directReason;

  if (net.isIP(host) !== 0) return null;

  const cache = dnsCache instanceof Map ? dnsCache : new Map();
  const addresses = await resolveAddresses(host, cache, lookupFn);
  for (const address of addresses) {
    const reason = blockedHostReason(host, address);
    if (reason) return reason;
  }

  return null;
}

function createPrivateNetworkBlockingLookup({ lookupFn = lookup } = {}) {
  return async function privateNetworkBlockingLookup(hostname, options, callback) {
    try {
      const host = normalizeHost(hostname);
      const directReason = blockedHostReason(host);
      if (directReason) {
        throw new Error(directReason);
      }

      const lookupOptions = {
        ...options,
        verbatim: true
      };
      const result = await lookupFn(host, lookupOptions);
      const entries = Array.isArray(result) ? result : [result];
      const normalizedEntries = entries.map(normalizeDnsEntry).filter(Boolean);
      for (const entry of normalizedEntries) {
        const reason = blockedHostReason(host, entry.address);
        if (reason) {
          throw new Error(reason);
        }
      }

      if (lookupOptions.all) {
        callback(null, normalizedEntries);
        return;
      }

      const first = normalizedEntries[0];
      if (!first) {
        throw new Error(`Unable to resolve host: ${hostname}`);
      }
      callback(null, first.address, first.family);
    } catch (error) {
      callback(error);
    }
  };
}

function isLocalDevelopmentHost(hostname) {
  const host = normalizeHost(hostname);
  return host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '::1';
}

export {
  blockedHostReason,
  createPrivateNetworkBlockingLookup,
  getBlockedRemoteUrlReason,
  isLocalDevelopmentHost,
  normalizeHost,
  resolveAddresses
};
