# WhipBridge

**Loom walkthrough (5 min):** [LOOM_URL_HERE]

A React Native host application that loads untrusted mini apps inside sandboxed WebViews and brokers capability requests through a typed, token-authenticated bridge protocol.

---

## What I want you to look at

1. **The message-validation pipeline** (`BridgeHost.ts:171`) — 7 sequential checks before any message reaches a handler: size → parse → direction → token → rate-limit → capability → sanitize. Direction enforcement is first and silent, so a malicious guest learns nothing from rejection.

2. **The anticipated attack and its proof** — I identified a cross-app PUSH injection vector (direction confusion), built the attack scenario, wrote the test, and verified the defense is silent. Full scenario in [`__tests__/security/directionConfusion.test.ts`](__tests__/security/directionConfusion.test.ts); defense is 3 lines in BridgeHost.ts.

3. **WebView crash recovery** (`MiniAppContainer.tsx:66`) — the old `reload()` approach left guests stuck connecting forever because the invalid token was baked into `injectedJavaScriptBeforeContentLoaded`. Fixed with a `crashKey` state variable that forces a full remount with a fresh token before any guest JS runs.

---

## Setup

| Tool | Version |
|---|---|
| Node.js | ≥ 18 |
| npm | ≥ 9 |
| Ruby | ≥ 2.6.10 |
| CocoaPods | ≥ 1.13 (installed via Bundler) |
| Xcode | ≥ 15 (iOS) |
| Android Studio + SDK | compileSdk 36, minSdk 24 |

```sh
git clone <repo-url> && cd WhipBridge
npm install
bundle install                                      # iOS only — installs CocoaPods via Bundler
bundle exec pod install --project-directory=ios     # iOS only
```

```sh
npm run ios       # iOS simulator or device
npm run android   # Android emulator or device
```

To target a physical device:
```sh
npx react-native run-ios --device "iPhone Name"
npx react-native run-android --deviceId <adb-device-id>
```

```sh
npm test    # 69 passing; App.test.tsx fails (missing RNCWebViewModule mock — not a real failure)
```

---

## Architecture

```
┌─────────────────────────── React Native JS thread ────────────────────────────┐
│  App.tsx                                                                       │
│  ├─ BridgeHost (1 instance)                                                    │
│  │   ├─ tokenRegistry   token → {miniAppId, manifest, webViewRef, handshakeDone}│
│  │   ├─ rateLimiters    50 msg/s window + 500/10s abuse cutoff, per session    │
│  │   ├─ pushSubscriptions  channel → Set<token>                                │
│  │   └─ JS ring buffer  req/s, p50/p99 per capability, error rate, drop count │
│  └─ CapabilityRouter                                                           │
│      ├─ storage.kv    → StorageHandler  (AsyncStorage, namespaced + quota)     │
│      ├─ device.haptics → HapticsHandler (Vibration, 10/s per app)             │
│      └─ network.fetch → FetchHandler   (HTTPS, allowlist, private-IP, redirect)│
│                                                                                │
│  MiniAppContainer (one per tab)                                                │
│  └─ <WebView key={crashKey}>                                                   │
│      ├─ injectedJavaScriptBeforeContentLoaded — freezes token, installs bridge │
│      └─ onMessage → bridgeHost.onMessage()                                     │
└──────────────────────┬─────────────────────────────────────────────────────────┘
                       │  postMessage / injectJavaScript
┌──────────────────────▼────────────── WebView (isolated JS context) ───────────┐
│  window.__WHIP_SESSION_TOKEN__  (non-writable, non-configurable, non-enumerable)│
│  window.bridge.{storage, haptics, fetch, subscribe}                            │
│  window.fetch → throws SecurityError  (blocked at inject time)                │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Message flow (happy path):** `bridge.storage.get('key')` → `postMessage({type:'REQUEST', sessionToken, capability:'storage.kv', ...})` → BridgeHost validates → StorageHandler reads AsyncStorage → `injectJavaScript(RESPONSE)` → guest Promise resolves.

**Security pipeline order:** size check → JSON.parse → direction (GUEST_ALLOWED_TYPES) → token registry → rate limit → capability manifest → sanitizePayload → handler.

---

## Anticipated Attack: Cross-App PUSH Injection

**Scenario:** App A is compromised. App B subscribes to `market.prices`. App A sends a `PUSH` message with `{price: 0}` directly to the bridge, hoping to inject attacker-controlled data into App B's subscription handler.

**Attack** (from [`__tests__/security/directionConfusion.test.ts:103`](__tests__/security/directionConfusion.test.ts#L103)):
```typescript
// Attacker's WebView sends a host-only message type
host.onMessage(makeEvent({
  type: 'PUSH',                     // only the host is allowed to send this
  sessionToken: attackerToken,      // valid token — attacker is a registered app
  channel: 'market.prices',
  payload: {price: 0},
}));
// Result: victim's WebView receives nothing
expect(victimInjected).toHaveLength(0);
```

**Defense** ([`src/bridge/BridgeHost.ts:189`](src/bridge/BridgeHost.ts#L189)):
```typescript
if (!GUEST_ALLOWED_TYPES.has(msg.type as string)) {
  this.drop('DIRECTION_VIOLATION');
  return; // silent — no response, no oracle for the attacker
}
```

**Why direction fires first:** if token validation ran first, an attacker could distinguish `TOKEN_INVALID` from `DIRECTION_VIOLATION` and use that as a timing oracle to enumerate valid tokens. Silent direction-first drop removes that side channel.

**GUEST_ALLOWED_TYPES** ([`src/bridge/protocol.ts:5`](src/bridge/protocol.ts#L5)):
```typescript
export const GUEST_ALLOWED_TYPES = new Set([
  'REQUEST', 'NOTIFICATION', 'SUBSCRIBE', 'UNSUBSCRIBE', 'HANDSHAKE', 'ACK',
]);
// PUSH, RESPONSE, HANDSHAKE_ACK are absent — guests cannot send them
```

**Test coverage:** 6 direction-confusion tests cover silent drop, no-response guarantee, and ordering invariant. 2 end-to-end tests verify a legitimate host PUSH still reaches the victim while an attacker PUSH does not.

---

## Code Tour

| File | What's interesting |
|---|---|
| [`src/bridge/protocol.ts`](src/bridge/protocol.ts) | Message types, `GUEST_ALLOWED_TYPES` direction set, `MiniAppManifest` |
| [`src/bridge/BridgeClient.ts`](src/bridge/BridgeClient.ts) | Injected guest script: token freeze, `bridge` API surface, pending-callback loop with 5s timeout |
| [`src/bridge/BridgeHost.ts`](src/bridge/BridgeHost.ts) | 7-step validation pipeline, token registry, HANDSHAKE once-only, SUBSCRIBE gate, ring-buffer metrics |
| [`src/bridge/sanitize.ts`](src/bridge/sanitize.ts) | Prototype-pollution defense: `Object.create(null)` output, blocks `__proto__`/`constructor`/`prototype` keys |
| [`src/bridge/Backpressure.ts`](src/bridge/Backpressure.ts) | Sliding-window rate limiter; 50 msg/s → queue, 500/10s → abuse cutoff + 30s ban |
| [`src/bridge/capabilities/FetchHandler.ts`](src/bridge/capabilities/FetchHandler.ts) | `validateUrl`: HTTPS-only, no credentials, private-IP block, allowlist; `redirect:'manual'` re-validation |
| [`src/bridge/capabilities/StorageHandler.ts`](src/bridge/capabilities/StorageHandler.ts) | `whip::{appId}::{key}` namespace, per-app quota, chained write serialization |
| [`src/bridge/capabilities/HapticsHandler.ts`](src/bridge/capabilities/HapticsHandler.ts) | 10 haptics/s per app, pattern map for iOS/Android |
| [`src/components/MiniAppContainer.tsx`](src/components/MiniAppContainer.tsx) | Session lifecycle, Strict Mode double-mount fix, `crashKey` remount for crash recovery |
| [`src/miniapps/miniApps.ts`](src/miniapps/miniApps.ts) | 7 mini apps: 1 interactive demo + 6 live attack scenarios |
| [`__tests__/security/`](__tests__/security/) | 4 test files: token validation, direction confusion, prototype pollution, fetch guard |

---

## Performance

### JSI Storage Layer

Measured on-device (iOS, RN 0.86 new arch, Hermes) — 1,000 iterations of `global.__whipStorage.getSync('__whip_jsi_demo__')`.

| | p50 | p99 |
|---|---|---|
| JSI `getSync` (µs) | **3.1 µs** | **22.6 µs** |
| Async NativeModule bridge (µs) | ~1,500 µs | ~5,000 µs |

µs = microseconds (1 µs = 0.001 ms). JSI runs synchronously on the JS thread with no serialization or thread hop — roughly **500× faster** than an equivalent async bridge call. The p99 spike on JSI (22.6 µs) is cache-miss overhead on the HostObject property lookup; still well under 1 ms.

### WebView Bridge Capabilities

_Capability latency numbers — to be filled after device run with MetricsOverlay._

| Capability | p50 (ms) | p99 (ms) | Notes |
|---|---|---|---|
| `storage.kv.get` | — | — | AsyncStorage on-device |
| `storage.kv.set` | — | — | includes write-chain serialization |
| `device.haptics` | — | — | Vibration.vibrate round-trip |
| `network.fetch` | — | — | httpbin.org, excludes DNS |
| bridge overhead (no handler) | — | — | postMessage → injectJavaScript RTT |

---

## With Another Week: Two-Phase Token Injection

The current crash recovery (`crashKey` remount) works correctly but is blunt: it fully unmounts and remounts the `<WebView>`, which resets scroll position, clears any in-progress UI state, and is visible to the user as a brief flash.

**The root obstacle.** The session token is delivered via `injectedJavaScriptBeforeContentLoaded`, which is baked in at mount time. After a crash-reload, the page re-runs that script with the now-invalid token — the host has already cleaned it up. The old `reload()` approach failed because of this.

The fix was to remount (via `key={crashKey}`) so the new token lands in `injectedJavaScriptBeforeContentLoaded`. But remounting is expensive. The reason we can't simply inject the new token post-reload with `injectJavaScript` is that `BridgeClient.ts:18` captures the token in a closed-over local variable at script-load time:

```typescript
// BridgeClient.ts:18 — captured once at script execution, never re-read
var TOKEN = window.__WHIP_SESSION_TOKEN__;
```

And the property is frozen (`writable:false, configurable:false`), so `injectJavaScript` can't update it.

**Two-phase injection (the better design).** Instead of embedding the token in `injectedJavaScriptBeforeContentLoaded`, that script would install only a lightweight promise infrastructure:

```typescript
// injectedJavaScriptBeforeContentLoaded (set once at initial mount, never changes)
window.__WHIP_TOKEN_PROMISE__ = new Promise(resolve => {
  window.__WHIP_TOKEN_RESOLVE__ = resolve;
});
```

BridgeClient would then `await` the promise before starting the handshake:

```typescript
var TOKEN = await window.__WHIP_TOKEN_PROMISE__;
```

On every `onLoad` event — initial load and post-crash reload — the host delivers the current token via `injectJavaScript`:

```typescript
onLoad={() => {
  const {token} = sessionRef.current;
  webViewRef.current?.injectJavaScript(`window.__WHIP_TOKEN_RESOLVE__('${token}')`);
}}
```

This removes `crashKey` entirely. The WebView reloads naturally after a crash, and the host delivers a fresh token through the same `onLoad` path used for initial load. Guest UI state (scroll position, any non-bridge JS state) survives the crash-recovery cycle.

**What makes it non-trivial:** the `await` in BridgeClient introduces an async gap between page load and bridge availability. Any mini app JS that calls `bridge.storage.get()` synchronously on page load would throw — the bridge isn't ready yet. That requires either queuing guest calls during initialization or documenting that mini apps must wait for a `bridge.ready` event. Neither is hard, but it's a protocol change that needs updating in every existing mini app.

---

## Known Tradeoffs

| Area | What we did | What a production system would do |
|---|---|---|
| DNS rebinding | Block private IPs by hostname string at request time | Resolve hostname to IP in native code, pin the IP for the TLS connection |
| Redirect chains | Return 3xx + Location to guest; guest calls `bridge.fetch()` again (re-validates) | Cap redirect chain depth; native HTTP client handles this transparently |
| Storage quota counter | In-memory; resets on process kill; self-corrects on first write | Persist counter in AsyncStorage; load on startup |
| iOS haptic fidelity | `Vibration.vibrate` — single pulse on iOS regardless of pattern | Native module calling `UIImpactFeedbackGenerator` / `UINotificationFeedbackGenerator` |
| Native metrics module | `WhipMetrics` is a legacy bridge module; void methods silently dropped by RN 0.86 New Architecture interop | Implement as a proper TurboModule with a codegen `.ts` spec |
| SUBSCRIBE capability | All-or-nothing `push.subscribe`; any channel name allowed | Declare `pushChannels: string[]` in manifest; gate each SUBSCRIBE against the list |
| `crypto.getRandomValues` fallback | Falls back to `Math.random()` if crypto unavailable | Throw on startup if crypto is unavailable; never fall back to an insecure PRNG |
