import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  config: {
    DATABASE_URL: 'postgres://localhost/test',
    SETTINGS_ENCRYPTION_KEY: 'enc-key',
  },
  ANTHROPIC_API_VERSION: '2023-06-01',
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  summarizeText: (s: string) => s.slice(0, 40),
}));

vi.mock('node:dns/promises');

import dns from 'node:dns/promises';
import {
  isPrivateIP,
  extractHostname,
  validateBaseUrlForSSRF,
  secureFetch,
} from './ip-check.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('isPrivateIP', () => {
  // IPv4 private ranges
  it('detects 0.0.0.0/8 as private (current network)', () => {
    expect(isPrivateIP('0.0.0.0')).toBe(true);
    expect(isPrivateIP('0.255.255.255')).toBe(true);
  });

  it('detects 10.0.0.0/8 as private (RFC 1918 class A)', () => {
    expect(isPrivateIP('10.0.0.0')).toBe(true);
    expect(isPrivateIP('10.255.255.255')).toBe(true);
    expect(isPrivateIP('10.10.10.10')).toBe(true);
  });

  it('detects 127.0.0.0/8 as private (loopback)', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('127.255.255.255')).toBe(true);
  });

  it('detects 169.254.0.0/16 as private (link-local)', () => {
    expect(isPrivateIP('169.254.0.0')).toBe(true);
    expect(isPrivateIP('169.254.255.255')).toBe(true);
    expect(isPrivateIP('169.254.169.254')).toBe(true);
  });

  it('detects 172.16.0.0/12 as private (RFC 1918 class B)', () => {
    expect(isPrivateIP('172.16.0.0')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
  });

  it('does not flag 172.32.0.0 as private (outside RFC 1918 class B)', () => {
    expect(isPrivateIP('172.32.0.0')).toBe(false);
    expect(isPrivateIP('172.15.255.255')).toBe(false);
  });

  it('detects 192.168.0.0/16 as private (RFC 1918 class C)', () => {
    expect(isPrivateIP('192.168.0.0')).toBe(true);
    expect(isPrivateIP('192.168.255.255')).toBe(true);
    expect(isPrivateIP('192.168.1.1')).toBe(true);
  });

  it('detects 224.0.0.0/4 as private (multicast)', () => {
    expect(isPrivateIP('224.0.0.0')).toBe(true);
    expect(isPrivateIP('239.255.255.255')).toBe(true);
  });

  it('detects 240.0.0.0/4 as private (reserved)', () => {
    expect(isPrivateIP('240.0.0.0')).toBe(true);
    expect(isPrivateIP('255.255.255.255')).toBe(true);
  });

  it('detects 100.64.0.0/10 as private (CGNAT)', () => {
    expect(isPrivateIP('100.64.0.0')).toBe(true);
    expect(isPrivateIP('100.127.255.255')).toBe(true);
    expect(isPrivateIP('100.100.100.100')).toBe(true);
  });

  it('detects 198.18.0.0/15 as private (benchmarking)', () => {
    expect(isPrivateIP('198.18.0.0')).toBe(true);
    expect(isPrivateIP('198.19.255.255')).toBe(true);
  });

  it('recognizes public IPv4 addresses', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('93.184.216.34')).toBe(false);
    expect(isPrivateIP('203.0.113.1')).toBe(false);
  });

  it('rejects invalid IPv4 format gracefully', () => {
    expect(isPrivateIP('not.an.ip')).toBe(false);
    expect(isPrivateIP('256.0.0.1')).toBe(false);
    expect(isPrivateIP('10.0.0')).toBe(false);
    expect(isPrivateIP('')).toBe(false);
  });

  // IPv6 private ranges
  it('detects ::1 as private (loopback)', () => {
    expect(isPrivateIP('::1')).toBe(true);
  });

  it('detects :: as private (unspecified)', () => {
    expect(isPrivateIP('::')).toBe(true);
  });

  it('detects fe80::/10 as private (link-local)', () => {
    expect(isPrivateIP('fe80::1')).toBe(true);
    expect(isPrivateIP('fe80::a00:27ff:fe4e:66a1')).toBe(true);
  });

  it('detects fc00::/7 as private (unique local)', () => {
    expect(isPrivateIP('fc00::1')).toBe(true);
    expect(isPrivateIP('fd00::1')).toBe(true);
  });

  it('detects ff00::/8 as private (multicast)', () => {
    expect(isPrivateIP('ff00::1')).toBe(true);
    expect(isPrivateIP('ff02::1')).toBe(true);
  });

  it('recognizes public IPv6 addresses', () => {
    expect(isPrivateIP('2001:4860:4860::8888')).toBe(false);
    expect(isPrivateIP('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });
});

describe('extractHostname', () => {
  it('extracts hostname from full URL', () => {
    expect(extractHostname('https://api.openai.com/v1')).toBe('api.openai.com');
    expect(extractHostname('http://example.com:8080/path')).toBe('example.com');
    expect(extractHostname('https://10.0.0.1/v1/models')).toBe('10.0.0.1');
  });

  it('extracts hostname from URL without protocol', () => {
    expect(extractHostname('localhost:8080/v1')).toBe('localhost');
    expect(extractHostname('192.168.1.1:11434')).toBe('192.168.1.1');
  });

  it('handles bracketed IPv6', () => {
    expect(extractHostname('http://[::1]:8080/v1')).toBe('::1');
    expect(extractHostname('http://[2001:db8::1]:8080')).toBe('2001:db8::1');
    expect(extractHostname('[fe80::1]:11434/v1')).toBe('fe80::1');
  });

  it('returns null for empty input', () => {
    expect(extractHostname('')).toBe(null);
    expect(extractHostname('   ')).toBe(null);
  });

  it('returns hostname without query params or fragments', () => {
    expect(extractHostname('api.example.com?key=val')).toBe('api.example.com');
    expect(extractHostname('api.example.com#section')).toBe('api.example.com');
  });
});

describe('validateBaseUrlForSSRF', () => {
  it('returns safe for empty baseUrl', async () => {
    const result = await validateBaseUrlForSSRF('');
    expect(result.safe).toBe(true);
  });

  it('returns safe for undefined-like empty string', async () => {
    const result = await validateBaseUrlForSSRF('   ');
    expect(result.safe).toBe(true);
  });

  it('returns not safe for directly-embedded private IPv4 address', async () => {
    const result = await validateBaseUrlForSSRF('https://10.0.0.1/v1');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('private/internal');
  });

  it('returns not safe for directly-embedded private IPv6 address', async () => {
    const result = await validateBaseUrlForSSRF('http://[::1]:8080/v1');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('private/internal');
  });

  it('returns not safe for directly-embedded link-local IPv4', async () => {
    const result = await validateBaseUrlForSSRF('https://169.254.169.254/latest/meta-data');
    expect(result.safe).toBe(false);
  });

  it('returns safe for public IP in URL', async () => {
    const result = await validateBaseUrlForSSRF('https://8.8.8.8/v1');
    expect(result.safe).toBe(true);
  });

  it('returns not safe when DNS resolves to a private IP', async () => {
    vi.mocked(dns.resolve4).mockResolvedValue(['10.0.0.1']);
    vi.mocked(dns.resolve6).mockRejectedValue(new Error('no v6'));

    const result = await validateBaseUrlForSSRF('https://internal.example.com/v1');
    expect(result.safe).toBe(false);
  });

  it('returns safe when DNS resolves only to public IPs', async () => {
    vi.mocked(dns.resolve4).mockResolvedValue(['8.8.8.8']);
    vi.mocked(dns.resolve6).mockRejectedValue(new Error('no v6'));

    const result = await validateBaseUrlForSSRF('https://api.example.com/v1');
    expect(result.safe).toBe(true);
  });

  it('returns safe when DNS resolution fails (no IPs)', async () => {
    vi.mocked(dns.resolve4).mockRejectedValue(new Error('ENOTFOUND'));
    vi.mocked(dns.resolve6).mockRejectedValue(new Error('ENOTFOUND'));

    const result = await validateBaseUrlForSSRF('https://nonexistent.example.com/v1');
    expect(result.safe).toBe(true);
  });

  it('returns not safe when DNS resolves localhost to loopback', async () => {
    vi.mocked(dns.resolve4).mockResolvedValue(['127.0.0.1']);
    vi.mocked(dns.resolve6).mockResolvedValue(['::1']);

    const result = await validateBaseUrlForSSRF('localhost:8080');
    expect(result.safe).toBe(false);
  });
});

describe('secureFetch', () => {
  it('passes redirect: "error" to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await secureFetch('https://example.com', { method: 'GET' });
    expect(fetchMock).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ redirect: 'error', method: 'GET' }));
  });

  it('overrides any pre-existing redirect option', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await secureFetch('https://example.com', { redirect: 'follow' });
    expect(fetchMock).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ redirect: 'error' }));
  });

  it('returns the fetch response', async () => {
    const response = { ok: true, status: 200 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const result = await secureFetch('https://example.com');
    expect(result).toBe(response);
  });
});
