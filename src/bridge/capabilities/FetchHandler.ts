import {BridgeError, ErrorCode} from '../errors';
import type {CapabilityHandler, MethodContext} from '../CapabilityRouter';

const RESPONSE_SIZE_CAP = 1_048_576; // 1 MB

// RFC 1918 + loopback + link-local ranges
const PRIVATE_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

function isPrivateIp(host: string): boolean {
  return PRIVATE_PATTERNS.some(re => re.test(host));
}

function validateUrl(rawUrl: string, allowlist: string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BridgeError(ErrorCode.INVALID_PAYLOAD, 'invalid URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new BridgeError(ErrorCode.FETCH_NOT_ALLOWED, 'only HTTPS is permitted');
  }

  // WHATWG URL standard wraps IPv6 addresses in brackets in .hostname, e.g. "[::1]".
  // Strip the brackets before the private-IP pattern check.
  const rawHost = parsed.hostname.toLowerCase();
  const host = rawHost.startsWith('[') ? rawHost.slice(1, -1) : rawHost;

  if (isPrivateIp(host)) {
    throw new BridgeError(ErrorCode.FETCH_NOT_ALLOWED, 'private IP range not allowed');
  }

  const allowed = allowlist.some(entry => {
    const domain = entry.toLowerCase();
    return host === domain || host.endsWith('.' + domain);
  });

  if (!allowed) {
    throw new BridgeError(ErrorCode.FETCH_NOT_ALLOWED, 'domain not in allowlist');
  }
}

interface FetchPayload {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const DENIED_HEADERS = new Set(['host', 'authorization', 'cookie', 'set-cookie']);

export const FetchHandler: CapabilityHandler = {
  name: 'network.fetch',
  methods: {
    fetch: {
      validatePayload(payload) {
        const p = payload as {url?: unknown};
        if (typeof p?.url !== 'string' || !p.url) {
          throw new BridgeError(ErrorCode.INVALID_PAYLOAD, 'url must be a non-empty string');
        }
      },
      async execute(ctx: MethodContext, payload: unknown) {
        const {url, method = 'GET', headers = {}, body} = payload as FetchPayload;

        validateUrl(url, ctx.manifest.domainAllowlist);

        const upperMethod = method.toUpperCase();
        if (!ALLOWED_METHODS.has(upperMethod)) {
          throw new BridgeError(ErrorCode.INVALID_PAYLOAD, 'unsupported HTTP method');
        }

        for (const key of Object.keys(headers)) {
          if (DENIED_HEADERS.has(key.toLowerCase())) {
            throw new BridgeError(ErrorCode.INVALID_PAYLOAD, `header '${key}' is not allowed`);
          }
        }

        let response: Response;
        try {
          response = await fetch(url, {
            method: upperMethod,
            headers,
            body: body != null ? body : undefined,
          });
        } catch (err) {
          throw new BridgeError(ErrorCode.FETCH_FAILED, String(err));
        }

        // Check declared size before downloading body
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > RESPONSE_SIZE_CAP) {
          throw new BridgeError(ErrorCode.PAYLOAD_TOO_LARGE, 'response exceeds 1 MB limit');
        }

        let text: string;
        try {
          text = await response.text();
        } catch (err) {
          throw new BridgeError(ErrorCode.FETCH_FAILED, String(err));
        }

        if (text.length > RESPONSE_SIZE_CAP) {
          throw new BridgeError(ErrorCode.PAYLOAD_TOO_LARGE, 'response exceeds 1 MB limit');
        }

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        return {
          status: response.status,
          headers: responseHeaders,
          body: text,
        };
      },
    },
  },
};
