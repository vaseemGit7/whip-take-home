import {RefObject} from 'react';
declare var crypto: {getRandomValues: (array: Uint8Array) => Uint8Array};
import WebView, {WebViewMessageEvent} from 'react-native-webview';
import {
  CURRENT_VERSION,
  GUEST_ALLOWED_TYPES,
  MiniAppManifest,
  BridgeHandshakeAck,
  BridgePush,
  BridgeRequest,
  BridgeSubscribe,
  BridgeUnsubscribe,
} from './protocol';
import {BridgeError, ErrorCode} from './errors';
import {CapabilityRouter} from './CapabilityRouter';
import {RateLimiter} from './Backpressure';
import {getFullInjectedScript} from './BridgeClient';
import {sanitizePayload} from './sanitize';

export interface MetricsSnapshot {
  reqPerSec: number;
  p50ByCapability: {[key: string]: number};
  p99ByCapability: {[key: string]: number};
  errorRate: number;
  droppedTotal: number;
}

const MAX_RAW_BYTES = 65_536;

interface TokenEntry {
  miniAppId: string;
  manifest: MiniAppManifest;
  webViewRef: RefObject<WebView | null>;
  handshakeDone: boolean;
}

function generateToken(): string {
  try {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return Array.from({length: 32}, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  }
}

function generateId(): string {
  try {
    const array = new Uint8Array(8);
    crypto.getRandomValues(array);
    return Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

const LATENCY_CAP = 500;

export class BridgeHost {
  private tokenRegistry = new Map<string, TokenEntry>();
  private pushSubscriptions = new Map<string, Set<string>>(); // channel → Set<token>
  private rateLimiters = new Map<string, RateLimiter>(); // token → RateLimiter

  // JS-side ring-buffer metrics — reliable, no native dependency
  private _timestamps: number[] = [];       // epoch ms of each request (trimmed to last 5 s)
  private _latencies  = new Map<string, number[]>(); // capability → latency samples
  private _totals     = new Map<string, number>();
  private _errors     = new Map<string, number>();
  private _dropped    = 0;

  // Forwarded to native module when available
  onMetricsUpdate?: (capability: string, latencyMs: number, ok: boolean) => void;
  onDropped?: (reason: string) => void;

  constructor(public readonly router: CapabilityRouter) {}

  // ── JS-side metrics ───────────────────────────────────────────────────────

  private trackRequest(capability: string, latencyMs: number, ok: boolean): void {
    const now = Date.now();

    // Timestamps ring — keep last 5 s
    this._timestamps.push(now);
    while (this._timestamps.length > 0 && now - this._timestamps[0] > 5000) {
      this._timestamps.shift();
    }

    // Latency ring buffer per capability
    const lats = this._latencies.get(capability) ?? [];
    lats.push(latencyMs);
    if (lats.length > LATENCY_CAP) { lats.shift(); }
    this._latencies.set(capability, lats);

    this._totals.set(capability, (this._totals.get(capability) ?? 0) + 1);
    if (!ok) {
      this._errors.set(capability, (this._errors.get(capability) ?? 0) + 1);
    }
  }

  private drop(reason: string): void {
    this._dropped++;
    this.onDropped?.(reason);
  }

  getMetricsSnapshot(): MetricsSnapshot {
    const now = Date.now();
    const reqPerSec = this._timestamps.filter(ts => now - ts <= 1000).length;

    const p50ByCapability: {[key: string]: number} = {};
    const p99ByCapability: {[key: string]: number} = {};

    for (const [cap, lats] of this._latencies) {
      if (lats.length === 0) { continue; }
      const sorted = [...lats].sort((a, b) => a - b);
      const n = sorted.length;
      p50ByCapability[cap] = sorted[Math.min(Math.floor(n / 2), n - 1)];
      p99ByCapability[cap] = sorted[Math.min(Math.floor(n * 0.99), n - 1)];
    }

    let totalReqs = 0, totalErrors = 0;
    for (const v of this._totals.values()) { totalReqs += v; }
    for (const v of this._errors.values()) { totalErrors += v; }

    return {
      reqPerSec,
      p50ByCapability,
      p99ByCapability,
      errorRate: totalReqs > 0 ? totalErrors / totalReqs : 0,
      droppedTotal: this._dropped,
    };
  }

  registerWebView(
    webViewRef: RefObject<WebView | null>,
    miniAppId: string,
    manifest: MiniAppManifest,
  ): {token: string; injectedScript: string} {
    const token = generateToken();
    this.tokenRegistry.set(token, {miniAppId, manifest, webViewRef, handshakeDone: false});
    this.rateLimiters.set(
      token,
      new RateLimiter(() => {
        console.warn(`[BridgeHost] Sustained abuse from miniAppId=${miniAppId}`);
        this.cleanup(token);
      }),
    );
    return {token, injectedScript: getFullInjectedScript(token)};
  }

  hasToken(token: string): boolean {
    return this.tokenRegistry.has(token);
  }

  cleanup(token: string): void {
    for (const [channel, tokens] of this.pushSubscriptions) {
      tokens.delete(token);
      if (tokens.size === 0) {
        this.pushSubscriptions.delete(channel);
      }
    }
    this.tokenRegistry.delete(token);
    this.rateLimiters.delete(token);
  }

  onMessage(event: WebViewMessageEvent): void {
    const raw = event.nativeEvent.data;

    // 1. Size check — before parsing to prevent OOM on giant payloads
    if (raw.length > MAX_RAW_BYTES) {
      this.drop('PAYLOAD_TOO_LARGE');
      return;
    }

    // 2. Parse
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.drop('PARSE_ERROR');
      return;
    }

    // 3. Direction enforcement — first security check, silent drop
    if (!GUEST_ALLOWED_TYPES.has(msg.type as string)) {
      this.drop('DIRECTION_VIOLATION');
      return;
    }

    // 4. Token validation
    const sessionToken = msg.sessionToken as string | undefined;
    if (!sessionToken) {
      this.drop('TOKEN_MISSING');
      return;
    }

    const entry = this.tokenRegistry.get(sessionToken);
    if (!entry) {
      this.drop('TOKEN_INVALID');
      return;
    }

    const {miniAppId, manifest, webViewRef} = entry;

    // 5. Rate limit
    const limiter = this.rateLimiters.get(sessionToken)!;
    const limitResult = limiter.check(Date.now());

    if (limitResult === 'abuse') {
      limiter.triggerAbuse();
      return;
    }

    if (limitResult === 'reject') {
      if (msg.id) {
        this.respond(webViewRef, {
          type: 'RESPONSE',
          id: msg.id as string,
          version: CURRENT_VERSION,
          ok: false,
          error: {code: ErrorCode.RATE_LIMITED, message: ErrorCode.RATE_LIMITED},
          timestamp: Date.now(),
        });
      }
      this.drop('RATE_LIMITED');
      return;
    }

    const task = () =>
      this.routeMessage(msg, miniAppId, manifest, webViewRef, sessionToken);

    if (limitResult === 'queue') {
      limiter.enqueue(task);
    } else {
      task().catch(() => {});
    }
  }

  push(channel: string, payload: unknown): void {
    const tokens = this.pushSubscriptions.get(channel);
    if (!tokens) {
      return;
    }

    const pushMsg: BridgePush = {
      type: 'PUSH',
      id: generateId(),
      version: CURRENT_VERSION,
      channel,
      payload,
      timestamp: Date.now(),
    };

    for (const token of tokens) {
      const e = this.tokenRegistry.get(token);
      if (e) {
        this.inject(e.webViewRef, pushMsg);
      }
    }
  }

  private async routeMessage(
    msg: Record<string, unknown>,
    miniAppId: string,
    manifest: MiniAppManifest,
    webViewRef: RefObject<WebView | null>,
    sessionToken: string,
  ): Promise<void> {
    const type = msg.type as string;

    if (type === 'HANDSHAKE') {
      const entry = this.tokenRegistry.get(sessionToken);
      if (!entry || entry.handshakeDone) {
        this.drop('DUPLICATE_HANDSHAKE');
        return;
      }
      entry.handshakeDone = true;
      const ack: BridgeHandshakeAck = {
        type: 'HANDSHAKE_ACK',
        id: (msg.id as string) || generateId(),
        version: CURRENT_VERSION,
        negotiatedVersion: CURRENT_VERSION,
        ok: true,
        timestamp: Date.now(),
      };
      this.inject(webViewRef, ack);
      return;
    }

    if (type === 'SUBSCRIBE') {
      const sub = msg as unknown as BridgeSubscribe;
      if (!manifest.capabilities.includes('push.subscribe')) {
        this.respond(webViewRef, {
          type: 'RESPONSE',
          id: sub.id || generateId(),
          version: CURRENT_VERSION,
          ok: false,
          error: {code: ErrorCode.CAPABILITY_DENIED, message: ErrorCode.CAPABILITY_DENIED},
          timestamp: Date.now(),
        });
        return;
      }
      if (sub.channel) {
        if (!this.pushSubscriptions.has(sub.channel)) {
          this.pushSubscriptions.set(sub.channel, new Set());
        }
        this.pushSubscriptions.get(sub.channel)!.add(sessionToken);
      }
      return;
    }

    if (type === 'UNSUBSCRIBE') {
      const unsub = msg as unknown as BridgeUnsubscribe;
      if (manifest.capabilities.includes('push.subscribe') && unsub.channel) {
        this.pushSubscriptions.get(unsub.channel)?.delete(sessionToken);
      }
      return;
    }

    if (type === 'NOTIFICATION' || type === 'ACK') {
      // Fire-and-forget — no response
      return;
    }

    if (type === 'REQUEST') {
      await this.handleRequest(
        msg as unknown as BridgeRequest,
        miniAppId,
        manifest,
        webViewRef,
      );
    }
  }

  private async handleRequest(
    req: BridgeRequest,
    miniAppId: string,
    manifest: MiniAppManifest,
    webViewRef: RefObject<WebView | null>,
  ): Promise<void> {
    const {id, capability, method} = req;
    const t0 = Date.now();

    // Capability check against manifest
    if (!manifest.capabilities.includes(capability)) {
      this.respond(webViewRef, {
        type: 'RESPONSE',
        id,
        version: CURRENT_VERSION,
        ok: false,
        // Opaque code only — do not leak manifest contents
        error: {code: ErrorCode.CAPABILITY_DENIED, message: ErrorCode.CAPABILITY_DENIED},
        timestamp: Date.now(),
      });
      const latDenied = Date.now() - t0;
      this.trackRequest(capability, latDenied, false);
      this.onMetricsUpdate?.(capability, latDenied, false);
      return;
    }

    const payload = sanitizePayload(req.payload);

    try {
      const result = await this.router.route({miniAppId, manifest}, capability, method, payload);
      this.respond(webViewRef, {
        type: 'RESPONSE',
        id,
        version: CURRENT_VERSION,
        ok: true,
        result,
        timestamp: Date.now(),
      });
      const latOk = Date.now() - t0;
      this.trackRequest(capability, latOk, true);
      this.onMetricsUpdate?.(capability, latOk, true);
    } catch (err) {
      const code =
        err instanceof BridgeError ? err.code : ('UNKNOWN_ERROR' as ErrorCode);
      this.respond(webViewRef, {
        type: 'RESPONSE',
        id,
        version: CURRENT_VERSION,
        ok: false,
        error: {code, message: code},
        timestamp: Date.now(),
      });
      const latErr = Date.now() - t0;
      this.trackRequest(capability, latErr, false);
      this.onMetricsUpdate?.(capability, latErr, false);
    }
  }

  private respond(
    webViewRef: RefObject<WebView | null>,
    msg: Parameters<typeof this.inject>[1],
  ): void {
    this.inject(webViewRef, msg);
  }

  private inject(webViewRef: RefObject<WebView | null>, msg: object): void {
    const json = JSON.stringify(msg);
    // Double-stringify so the JSON becomes a safe JS string literal argument
    const safeArg = JSON.stringify(json);
    webViewRef.current?.injectJavaScript(
      `window.__bridgeDispatch(${safeArg}); true;`,
    );
  }
}
