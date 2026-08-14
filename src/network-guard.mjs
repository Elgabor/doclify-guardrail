import { lookup } from 'node:dns/promises';
import net from 'node:net';

const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal'
]);

const NON_GLOBAL_IPS = new net.BlockList();
for (const [network, prefix, family] of [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['192.88.99.0', 24, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['64:ff9b:1::', 48, 'ipv6'],
  ['100::', 64, 'ipv6'],
  ['100:0:0:1::', 64, 'ipv6'],
  ['2001:2::', 48, 'ipv6'],
  ['2001:10::', 28, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
  ['3fff::', 20, 'ipv6'],
  ['5f00::', 16, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['fec0::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6']
]) {
  NON_GLOBAL_IPS.addSubnet(network, prefix, family);
}

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
  if (host === '192.0.0.9' || host === '192.0.0.10') return false;
  return NON_GLOBAL_IPS.check(host, 'ipv4');
}

function ipv4FromMappedIpv6(host) {
  const normalized = normalizeHost(host);
  const dotted = normalized.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) return dotted[1];

  const hex = normalized.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
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
  const mappedV4 = ipv4FromMappedIpv6(host);
  if (mappedV4 && isBlockedIpv4(mappedV4)) return true;
  return host === '::' || host === '::1' || NON_GLOBAL_IPS.check(host, 'ipv6');
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

export {
  blockedHostReason,
  createPrivateNetworkBlockingLookup,
  getBlockedRemoteUrlReason
};
