/**
 * Anticipated Attack: Cross-App PUSH Message Injection via Direction Confusion
 *
 * The bridge defines 8 message types across 2 directions:
 *   Guest → Host: REQUEST, NOTIFICATION, SUBSCRIBE, UNSUBSCRIBE, HANDSHAKE, ACK
 *   Host → Guest: RESPONSE, PUSH, HANDSHAKE_ACK
 *
 * Attack surface: If the host doesn't enforce message direction, a malicious guest
 * in App A can send a PUSH message targeting App B's subscription channel, or send
 * a RESPONSE with a fake correlationId to hijack App B's pending promise callback.
 *
 * Concrete scenario — cross-app market data manipulation:
 *   1. App A subscribes to channel "market.prices"
 *   2. App B subscribes to the same channel
 *   3. App A (compromised) sends: { type: 'PUSH', channel: 'market.prices', payload: {price: 0} }
 *   4. Without direction enforcement, App B's UI shows price = 0 (attacker-controlled)
 *   5. With direction enforcement, the message is silently dropped before token validation
 *
 * Defense: GUEST_ALLOWED_TYPES Set in BridgeHost.onMessage() — checked before token
 * validation so the attacker learns nothing from the rejection (no timing oracle).
 */

jest.mock('react-native-webview', () => ({
  __esModule: true,
  default: class MockWebView {},
}));

import {BridgeHost} from '../../src/bridge/BridgeHost';
import {CapabilityRouter} from '../../src/bridge/CapabilityRouter';
import {GUEST_ALLOWED_TYPES} from '../../src/bridge/protocol';

const DEMO_MANIFEST = {
  miniAppId: 'test-app',
  capabilities: [] as string[],
  domainAllowlist: [] as string[],
  storageQuotaBytes: 0,
};

function makeHost() {
  const router = new CapabilityRouter();
  const host = new BridgeHost(router);
  const dropped: string[] = [];
  host.onDropped = (reason: string) => dropped.push(reason);
  return {host, dropped};
}

function makeWebViewRef() {
  const injected: string[] = [];
  const ref = {
    current: {injectJavaScript: (code: string) => injected.push(code)},
  } as any;
  return {ref, injected};
}

function makeEvent(data: object) {
  return {nativeEvent: {data: JSON.stringify(data)}} as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Direction Set Invariants
// ─────────────────────────────────────────────────────────────────────────────

describe('GUEST_ALLOWED_TYPES set', () => {
  const HOST_ONLY = ['RESPONSE', 'PUSH', 'HANDSHAKE_ACK'];
  const GUEST_ALLOWED = ['REQUEST', 'NOTIFICATION', 'SUBSCRIBE', 'UNSUBSCRIBE', 'HANDSHAKE', 'ACK'];

  it('excludes all host-only message types', () => {
    for (const type of HOST_ONLY) {
      expect(GUEST_ALLOWED_TYPES.has(type)).toBe(false);
    }
  });

  it('includes all legitimate guest message types', () => {
    for (const type of GUEST_ALLOWED) {
      expect(GUEST_ALLOWED_TYPES.has(type)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Silent Drop Tests (no response = no timing oracle for the attacker)
// ─────────────────────────────────────────────────────────────────────────────

describe('Host silently drops host-only message types from guest', () => {
  it('drops RESPONSE (prevents pending-promise hijack)', () => {
    const {host, dropped} = makeHost();
    const {ref} = makeWebViewRef();
    const {token} = host.registerWebView(ref, 'attacker', DEMO_MANIFEST);

    host.onMessage(makeEvent({
      type: 'RESPONSE',
      id: 'fake-correlation-id',
      sessionToken: token,
      version: '1.0',
      ok: true,
      result: {injected: 'data'},
      timestamp: Date.now(),
    }));

    expect(dropped).toContain('DIRECTION_VIOLATION');
  });

  it('drops PUSH (prevents cross-app channel pollution)', () => {
    const {host, dropped} = makeHost();
    const {ref} = makeWebViewRef();
    const {token} = host.registerWebView(ref, 'attacker', DEMO_MANIFEST);

    host.onMessage(makeEvent({
      type: 'PUSH',
      id: 'fake-push',
      sessionToken: token,
      version: '1.0',
      channel: 'market.prices',
      payload: {price: 0},
      timestamp: Date.now(),
    }));

    expect(dropped).toContain('DIRECTION_VIOLATION');
  });

  it('drops HANDSHAKE_ACK', () => {
    const {host, dropped} = makeHost();
    const {ref} = makeWebViewRef();
    const {token} = host.registerWebView(ref, 'attacker', DEMO_MANIFEST);

    host.onMessage(makeEvent({
      type: 'HANDSHAKE_ACK',
      id: 'fake-ack',
      sessionToken: token,
      version: '1.0',
      timestamp: Date.now(),
    }));

    expect(dropped).toContain('DIRECTION_VIOLATION');
  });

  it('does NOT inject any response back (silent drop, no oracle)', () => {
    const {host} = makeHost();
    const {ref, injected} = makeWebViewRef();
    const {token} = host.registerWebView(ref, 'attacker', DEMO_MANIFEST);

    host.onMessage(makeEvent({
      type: 'RESPONSE',
      id: 'x',
      sessionToken: token,
      version: '1.0',
      ok: true,
      result: null,
      timestamp: Date.now(),
    }));

    // No injectJavaScript call — attacker learns nothing
    expect(injected).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Direction check must fire BEFORE token validation
// This prevents a timing oracle: an attacker can't distinguish
// "wrong token" from "wrong direction" because direction is always checked first.
// ─────────────────────────────────────────────────────────────────────────────

describe('Direction check precedes token validation', () => {
  it('reports DIRECTION_VIOLATION (not TOKEN_INVALID) for host-only type with bad token', () => {
    const {host, dropped} = makeHost();
    const {ref} = makeWebViewRef();
    host.registerWebView(ref, 'victim', DEMO_MANIFEST);

    host.onMessage(makeEvent({
      type: 'RESPONSE',
      id: 'x',
      sessionToken: 'COMPLETELY_INVALID_TOKEN',
      version: '1.0',
      ok: true,
      result: null,
      timestamp: Date.now(),
    }));

    expect(dropped).toEqual(['DIRECTION_VIOLATION']);
    expect(dropped).not.toContain('TOKEN_INVALID');
  });

  it('reports DIRECTION_VIOLATION even with no sessionToken field', () => {
    const {host, dropped} = makeHost();
    const {ref} = makeWebViewRef();
    host.registerWebView(ref, 'victim', DEMO_MANIFEST);

    // No sessionToken — direction check should still fire first
    host.onMessage(makeEvent({
      type: 'PUSH',
      id: 'x',
      channel: 'any',
      payload: {},
      timestamp: Date.now(),
    }));

    expect(dropped).toEqual(['DIRECTION_VIOLATION']);
    expect(dropped).not.toContain('TOKEN_MISSING');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end cross-app PUSH injection scenario
// ─────────────────────────────────────────────────────────────────────────────

describe('Cross-app PUSH injection scenario', () => {
  it('victim WebView does NOT receive attacker PUSH to subscribed channel', async () => {
    const {host} = makeHost();
    const {ref: victimRef, injected: victimInjected} = makeWebViewRef();
    const {ref: attackerRef} = makeWebViewRef();

    const {token: victimToken} = host.registerWebView(victimRef, 'victim', {
      ...DEMO_MANIFEST, miniAppId: 'victim',
    });
    const {token: attackerToken} = host.registerWebView(attackerRef, 'attacker', {
      ...DEMO_MANIFEST, miniAppId: 'attacker',
    });

    // Victim legitimately subscribes
    host.onMessage(makeEvent({
      type: 'SUBSCRIBE',
      id: 'sub-1',
      sessionToken: victimToken,
      version: '1.0',
      channel: 'market.prices',
      timestamp: Date.now(),
    }));

    // Attacker attempts cross-app PUSH injection
    host.onMessage(makeEvent({
      type: 'PUSH',
      id: 'evil-push',
      sessionToken: attackerToken,
      version: '1.0',
      channel: 'market.prices',
      payload: {price: 0, source: 'attacker'},
      timestamp: Date.now(),
    }));

    await new Promise<void>(resolve => setTimeout(resolve, 20));

    // Victim's injectJavaScript was never called — queue is empty
    expect(victimInjected).toHaveLength(0);
  });

  it('legitimate host PUSH still reaches subscribed victim', async () => {
    const {host} = makeHost();
    const {ref: victimRef, injected: victimInjected} = makeWebViewRef();

    const {token: victimToken} = host.registerWebView(victimRef, 'victim', {
      ...DEMO_MANIFEST, miniAppId: 'victim',
    });

    host.onMessage(makeEvent({
      type: 'SUBSCRIBE',
      id: 'sub-1',
      sessionToken: victimToken,
      version: '1.0',
      channel: 'market.prices',
      timestamp: Date.now(),
    }));

    await new Promise<void>(resolve => setTimeout(resolve, 20));

    // Host sends a legitimate push
    host.push('market.prices', {price: 42, source: 'trusted-host'});

    await new Promise<void>(resolve => setTimeout(resolve, 10));

    // inject() double-stringifies so check for PUSH type + channel name
    const trustedPushReceived = victimInjected.some(
      code => code.includes('PUSH') && code.includes('market.prices'),
    );
    expect(trustedPushReceived).toBe(true);
  });
});
