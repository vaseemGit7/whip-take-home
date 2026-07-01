/**
 * Token Validation — Identity Verification Tests
 *
 * The host assigns each WebView a random 128-bit session token on registration.
 * The token is injected via injectedJavaScriptBeforeContentLoaded before any
 * guest JS runs — guests cannot observe, forge, or replay tokens from other sessions.
 *
 * Every inbound message must include the token. The host validates it against
 * its registry. Missing or unknown tokens are silently dropped.
 */

jest.mock('react-native-webview', () => ({
  __esModule: true,
  default: class MockWebView {},
}));

import {BridgeHost} from '../../src/bridge/BridgeHost';
import {CapabilityRouter} from '../../src/bridge/CapabilityRouter';

const MANIFEST = {
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

function makeRef() {
  const injected: string[] = [];
  const ref = {
    current: {injectJavaScript: (code: string) => injected.push(code)},
  } as any;
  return {ref, injected};
}

function makeEvent(data: object) {
  return {nativeEvent: {data: JSON.stringify(data)}} as any;
}

describe('Token validation', () => {
  it('drops message with no sessionToken field', () => {
    const {host, dropped} = makeHost();
    const {ref} = makeRef();
    host.registerWebView(ref, 'test-app', MANIFEST);

    host.onMessage(makeEvent({
      type: 'HANDSHAKE',
      id: 'x',
      version: '1.0',
      timestamp: Date.now(),
      // sessionToken deliberately omitted
    }));

    expect(dropped).toContain('TOKEN_MISSING');
  });

  it('drops message with null sessionToken', () => {
    const {host, dropped} = makeHost();
    const {ref} = makeRef();
    host.registerWebView(ref, 'test-app', MANIFEST);

    host.onMessage(makeEvent({
      type: 'HANDSHAKE',
      id: 'x',
      sessionToken: null,
      version: '1.0',
      timestamp: Date.now(),
    }));

    expect(dropped).toContain('TOKEN_MISSING');
  });

  it('drops message with unknown/forged token', () => {
    const {host, dropped} = makeHost();
    const {ref} = makeRef();
    host.registerWebView(ref, 'test-app', MANIFEST);

    host.onMessage(makeEvent({
      type: 'HANDSHAKE',
      id: 'x',
      sessionToken: 'ffffffffffffffffffffffffffffffff', // valid format, wrong value
      version: '1.0',
      timestamp: Date.now(),
    }));

    expect(dropped).toContain('TOKEN_INVALID');
  });

  it('drops message with token from a different (cleaned-up) session', () => {
    const {host, dropped} = makeHost();
    const {ref} = makeRef();
    const {token} = host.registerWebView(ref, 'test-app', MANIFEST);

    // Simulate WebView being unloaded / session ended
    host.cleanup(token);

    host.onMessage(makeEvent({
      type: 'HANDSHAKE',
      id: 'x',
      sessionToken: token,
      version: '1.0',
      timestamp: Date.now(),
    }));

    expect(dropped).toContain('TOKEN_INVALID');
  });

  it('accepts valid token from registered session', async () => {
    const {host, dropped} = makeHost();
    const {ref, injected} = makeRef();
    const {token} = host.registerWebView(ref, 'test-app', MANIFEST);

    host.onMessage(makeEvent({
      type: 'HANDSHAKE',
      id: 'hs-001',
      sessionToken: token,
      version: '1.0',
      guestVersion: '1.0',
      timestamp: Date.now(),
    }));

    await new Promise<void>(resolve => setTimeout(resolve, 10));

    // Should have received HANDSHAKE_ACK
    expect(dropped).toHaveLength(0);
    expect(injected.some(code => code.includes('HANDSHAKE_ACK'))).toBe(true);
  });

  it('tokens are unique across registrations', () => {
    const {host} = makeHost();
    const {ref: ref1} = makeRef();
    const {ref: ref2} = makeRef();

    const {token: t1} = host.registerWebView(ref1, 'app-1', {...MANIFEST, miniAppId: 'app-1'});
    const {token: t2} = host.registerWebView(ref2, 'app-2', {...MANIFEST, miniAppId: 'app-2'});

    expect(t1).not.toEqual(t2);
    expect(t1).toHaveLength(32); // 128-bit hex
    expect(t2).toHaveLength(32);
  });

  it('hasToken reflects registration and cleanup state', () => {
    const {host} = makeHost();
    const {ref} = makeRef();
    const {token} = host.registerWebView(ref, 'test-app', MANIFEST);

    expect(host.hasToken(token)).toBe(true);
    host.cleanup(token);
    expect(host.hasToken(token)).toBe(false);
  });
});
