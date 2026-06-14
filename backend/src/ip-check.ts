import dns from 'node:dns/promises';
import { logger } from './logger.js';

const PRIVATE_IPV4_RANGES: Array<[bigint, bigint]> = [
  [0x00000000n, 0x00ffffffn], // 0.0.0.0/8 (current network)
  [0x0a000000n, 0x0affffffn], // 10.0.0.0/8 (RFC 1918)
  [0x7f000000n, 0x7fffffffn], // 127.0.0.0/8 (loopback)
  [0xa9fe0000n, 0xa9feffffn], // 169.254.0.0/16 (link-local)
  [0xac100000n, 0xac1fffffn], // 172.16.0.0/12 (RFC 1918)
  [0xc0a80000n, 0xc0a8ffffn], // 192.168.0.0/16 (RFC 1918)
  [0xe0000000n, 0xefffffffn], // 224.0.0.0/4 (multicast)
  [0xf0000000n, 0xffffffffn], // 240.0.0.0/4 (reserved)
  [0x64400000n, 0x647fffffn], // 100.64.0.0/10 (CGNAT / RFC 6598)
  [0xc6120000n, 0xc613ffffn], // 198.18.0.0/15 (benchmarking / RFC 2544)
];

export function isPrivateIP(ip: string): boolean {
  const normalized = ip.trim();

  if (normalized.includes(':')) {
    return isPrivateIPv6(normalized);
  }

  return isPrivateIPv4(normalized);
}

function ipv4ToBigint(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0n;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8n) | BigInt(num);
  }
  return result;
}

function isPrivateIPv4(ip: string): boolean {
  const num = ipv4ToBigint(ip);
  if (num === null) return false;
  return PRIVATE_IPV4_RANGES.some(([start, end]) => num >= start && num <= end);
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (normalized === '::1') return true;

  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0' || normalized === '::0') return true;

  if (normalized.startsWith('fe80:')) return true;

  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  if (normalized.startsWith('ff')) return true;

  return false;
}

export function extractHostname(url: string): string | null {
  if (!url || !url.trim()) return null;

  let hostname: string;

  if (url.includes('://')) {
    try {
      const parsed = new URL(url);
      hostname = parsed.hostname;
    } catch {
      return null;
    }
  } else {
    const hostPart = url.split('/')[0].split('?')[0].split('#')[0];
    if (hostPart.startsWith('[') && hostPart.includes(']')) {
      hostname = hostPart.slice(1, hostPart.indexOf(']'));
    } else {
      hostname = hostPart.split(':')[0] || '';
    }
  }

  hostname = hostname.trim();
  if (!hostname) return null;

  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  return hostname;
}

export async function resolveHostToIPs(hostname: string): Promise<string[]> {
  const ips: string[] = [];
  try {
    const v4 = await dns.resolve4(hostname);
    ips.push(...v4);
  } catch {
    // IPv4 resolution failed, not necessarily an issue
  }
  try {
    const v6 = await dns.resolve6(hostname);
    ips.push(...v6);
  } catch {
    // IPv6 resolution failed, not necessarily an issue
  }
  return ips;
}

export async function validateBaseUrlForSSRF(baseUrl: string): Promise<{ safe: boolean; reason?: string }> {
  if (!baseUrl || !baseUrl.trim()) {
    return { safe: true };
  }

  const hostname = extractHostname(baseUrl);
  if (!hostname) {
    return { safe: false, reason: 'Invalid base URL format' };
  }

  if (isPrivateIP(hostname)) {
    return { safe: false, reason: 'Cannot use private/internal IP addresses' };
  }

  const resolvedIPs = await resolveHostToIPs(hostname);
  if (resolvedIPs.length === 0) {
    return { safe: true };
  }

  for (const ip of resolvedIPs) {
    if (isPrivateIP(ip)) {
      logger.warn('ssrf_private_ip_resolved', { hostname, ip });
      return { safe: false, reason: 'Cannot use private/internal IP addresses' };
    }
  }

  return { safe: true };
}

export function secureFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, redirect: 'error' });
}
