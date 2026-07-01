/**
 * Fetch Security Tests — Domain Allowlist & Private IP Blocking
 *
 * The network.fetch capability enforces:
 * 1. HTTPS-only (no HTTP, no ws://, no file://)
 * 2. Domain allowlist per mini app manifest
 * 3. Private/loopback IP blocking (RFC 1918 + loopback + link-local)
 * 4. Response size cap (1 MB)
 * 5. Dangerous header rejection (Authorization, Cookie, etc.)
 *
 * All network calls are made from the RN JS thread — the mini app never
 * has direct network access. This prevents the WebView from bypassing
 * Content Security Policy by routing all requests through the bridge.
 */

import {FetchHandler} from '../../src/bridge/capabilities/FetchHandler';
import {BridgeError} from '../../src/bridge/errors';
import type {MethodContext} from '../../src/bridge/CapabilityRouter';

const ctx = (allowlist: string[]): MethodContext => ({
  miniAppId: 'test-app',
  manifest: {
    miniAppId: 'test-app',
    capabilities: ['network.fetch'],
    domainAllowlist: allowlist,
    storageQuotaBytes: 1024,
  },
});

const execute = FetchHandler.methods.fetch.execute!.bind(FetchHandler.methods.fetch);
const validate = FetchHandler.methods.fetch.validatePayload!.bind(FetchHandler.methods.fetch);

// ─────────────────────────────────────────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────────────────────────────────────────

describe('FetchHandler — input validation', () => {
  it('rejects missing url', () => {
    expect(() => validate({})).toThrow(BridgeError);
  });

  it('rejects non-string url', () => {
    expect(() => validate({url: 123})).toThrow(BridgeError);
  });

  it('accepts valid url string', () => {
    expect(() => validate({url: 'https://example.com'})).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Protocol enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe('FetchHandler — HTTPS enforcement', () => {
  it('rejects http:// URLs', async () => {
    await expect(
      execute(ctx(['example.com']), {url: 'http://example.com/api'}),
    ).rejects.toMatchObject({code: 'FETCH_NOT_ALLOWED'});
  });

  it('rejects ws:// URLs', async () => {
    await expect(
      execute(ctx(['example.com']), {url: 'ws://example.com/socket'}),
    ).rejects.toMatchObject({code: 'FETCH_NOT_ALLOWED'});
  });

  it('rejects file:// URLs', async () => {
    await expect(
      execute(ctx(['example.com']), {url: 'file:///etc/passwd'}),
    ).rejects.toMatchObject({code: 'FETCH_NOT_ALLOWED'});
  });

  it('rejects javascript: URLs', async () => {
    await expect(
      execute(ctx(['']), {url: 'javascript:alert(1)'}),
    ).rejects.toMatchObject({code: 'FETCH_NOT_ALLOWED'});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Domain allowlist
// ─────────────────────────────────────────────────────────────────────────────

describe('FetchHandler — domain allowlist', () => {
  it('rejects domains not in allowlist', async () => {
    await expect(
      execute(ctx(['api.example.com']), {url: 'https://evil.com/steal'}),
    ).rejects.toMatchObject({code: 'FETCH_NOT_ALLOWED'});
  });

  it('allows exact domain match', async () => {
    const mockResponse = {
      status: 200,
      headers: {get: () => null, forEach: (_: any) => {}},
      text: async () => '{"ok":true}',
    };
    global.fetch = jest.fn().mockResolvedValueOnce(mockResponse) as any;

    await expect(
      execute(ctx(['api.example.com']), {url: 'https://api.example.com/data'}),
    ).resolves.toMatchObject({status: 200});
  });

  it('allows subdomain of allowlisted domain', async () => {
    const mockResponse = {
      status: 200,
      headers: {get: () => null, forEach: (_: any) => {}},
      text: async () => '{}',
    };
    global.fetch = jest.fn().mockResolvedValueOnce(mockResponse) as any;

    await expect(
      execute(ctx(['example.com']), {url: 'https://api.example.com/data'}),
    ).resolves.toMatchObject({status: 200});
  });

  it('rejects sibling domain that partially matches allowlisted domain', async () => {
    // evil-example.com should NOT match allowlist entry "example.com"
    await expect(
      execute(ctx(['example.com']), {url: 'https://evil-example.com/data'}),
    ).rejects.toMatchObject({code: 'FETCH_NOT_ALLOWED'});
  });

  it('rejects when allowlist is empty', async () => {
    await expect(
      execute(ctx([]), {url: 'https://example.com/data'}),
    ).rejects.toMatchObject({code: 'FETCH_NOT_ALLOWED'});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Private IP blocking
// ─────────────────────────────────────────────────────────────────────────────

describe('FetchHandler — private IP blocking', () => {
  const cases = [
    ['loopback IPv4', 'https://127.0.0.1/secret'],
    ['RFC 1918 10.x', 'https://10.0.0.1/internal'],
    ['RFC 1918 192.168.x', 'https://192.168.1.1/router'],
    ['RFC 1918 172.16-31.x', 'https://172.16.0.1/internal'],
    ['link-local', 'https://169.254.169.254/metadata'], // AWS metadata endpoint
    ['IPv6 loopback', 'https://[::1]/secret'],
  ];

  for (const [name, url] of cases) {
    it(`blocks ${name}: ${url}`, async () => {
      await expect(
        execute(ctx(['127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1',
                     '169.254.169.254', '[::1]']), {url}),
      ).rejects.toMatchObject({code: 'FETCH_NOT_ALLOWED'});
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Dangerous header rejection
// ─────────────────────────────────────────────────────────────────────────────

describe('FetchHandler — dangerous header rejection', () => {
  const dangerousHeaders = ['Authorization', 'Cookie', 'Set-Cookie', 'HOST'];

  for (const header of dangerousHeaders) {
    it(`rejects ${header} header`, async () => {
      await expect(
        execute(ctx(['example.com']), {
          url: 'https://example.com/api',
          headers: {[header]: 'evil-value'},
        }),
      ).rejects.toMatchObject({code: 'INVALID_PAYLOAD'});
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Response size cap
// ─────────────────────────────────────────────────────────────────────────────

describe('FetchHandler — response size cap', () => {
  it('rejects response larger than 1 MB via Content-Length header', async () => {
    const mockResponse = {
      status: 200,
      headers: {
        get: (name: string) => name.toLowerCase() === 'content-length' ? '2000000' : null,
        forEach: (_: any) => {},
      },
      text: async () => 'x'.repeat(2_000_000),
    };
    global.fetch = jest.fn().mockResolvedValueOnce(mockResponse) as any;

    await expect(
      execute(ctx(['example.com']), {url: 'https://example.com/huge'}),
    ).rejects.toMatchObject({code: 'PAYLOAD_TOO_LARGE'});
  });

  it('rejects response body exceeding 1 MB even without Content-Length', async () => {
    const bigBody = 'x'.repeat(1_048_577);
    const mockResponse = {
      status: 200,
      headers: {get: () => null, forEach: (_: any) => {}},
      text: async () => bigBody,
    };
    global.fetch = jest.fn().mockResolvedValueOnce(mockResponse) as any;

    await expect(
      execute(ctx(['example.com']), {url: 'https://example.com/big'}),
    ).rejects.toMatchObject({code: 'PAYLOAD_TOO_LARGE'});
  });
});
