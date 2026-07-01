import React, {useMemo} from 'react';
import {SafeAreaView, StatusBar, StyleSheet, useColorScheme, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {BridgeHost} from './src/bridge/BridgeHost';
import {CapabilityRouter} from './src/bridge/CapabilityRouter';
import {MiniAppContainer} from './src/components/MiniAppContainer';
import {MetricsOverlay} from './src/components/MetricsOverlay';
import {MiniAppManifest} from './src/bridge/protocol';
import {StorageHandler} from './src/bridge/capabilities/StorageHandler';
import {HapticsHandler} from './src/bridge/capabilities/HapticsHandler';
import {FetchHandler} from './src/bridge/capabilities/FetchHandler';
import NativeWhipMetrics from './src/native/NativeWhipMetrics';

const DEMO_MANIFEST: MiniAppManifest = {
  miniAppId: 'demo-app-001',
  capabilities: ['storage.kv', 'device.haptics', 'network.fetch'],
  domainAllowlist: ['httpbin.org', 'jsonplaceholder.typicode.com'],
  storageQuotaBytes: 1_048_576,
};

const DEMO_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, sans-serif; padding: 20px; background: #f5f5f5; margin: 0; }
    h2 { color: #1a1a2e; margin: 0 0 12px; font-size: 20px; }
    .status { padding: 10px 14px; border-radius: 8px; margin: 8px 0; font-size: 13px; font-weight: 500; }
    .ok      { background: #d4edda; color: #155724; }
    .err     { background: #f8d7da; color: #721c24; }
    .pending { background: #fff3cd; color: #856404; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
    button {
      padding: 10px 16px; border-radius: 8px; border: none;
      background: #4361ee; color: white; font-size: 14px;
      font-weight: 600; cursor: pointer; flex: 1; min-width: 100px;
    }
    button:active { opacity: 0.7; }
    #log { margin-top: 8px; }
  </style>
</head>
<body>
  <h2>WhipBridge Demo</h2>
  <div id="status" class="status pending">Connecting to bridge...</div>

  <div class="row">
    <button onclick="testStorage()">Test Storage</button>
    <button onclick="testHaptics()">Test Haptics</button>
    <button onclick="testFetch()">Test Fetch</button>
    <button onclick="testDenied()">Test Auth Denied</button>
  </div>
  <div id="log"></div>

  <script>
    var log = document.getElementById('log');
    var statusEl = document.getElementById('status');
    var ready = false;

    // Intercept __bridgeDispatch before BridgeClient overwrites it so we
    // can watch for HANDSHAKE_ACK, then restore the original.
    var _origDispatch = window.__bridgeDispatch;
    window.__bridgeDispatch = function(raw) {
      var msg = JSON.parse(raw);
      if (msg.type === 'HANDSHAKE_ACK' && msg.ok) {
        ready = true;
        statusEl.className = 'status ok';
        statusEl.textContent = 'Bridge connected (token validated)';
      }
      if (_origDispatch) { _origDispatch(raw); }
    };

    function addLog(msg, ok) {
      var div = document.createElement('div');
      div.className = 'status ' + (ok === true ? 'ok' : ok === false ? 'err' : 'pending');
      div.textContent = msg;
      log.prepend(div);
    }

    function ensureReady() {
      if (!ready) { addLog('Bridge not ready yet — try again', false); return false; }
      return true;
    }

    // ── storage.kv ────────────────────────────────────────────────
    function testStorage() {
      if (!ensureReady()) { return; }
      bridge.storage.set('greeting', 'hello from mini app!')
        .then(function() { return bridge.storage.get('greeting'); })
        .then(function(val) {
          addLog('storage.get("greeting") = ' + val, true);
          return bridge.storage.list();
        })
        .then(function(keys) {
          addLog('storage.list() = [' + keys.join(', ') + ']', true);
        })
        .catch(function(e) { addLog('Storage error: ' + e.message, false); });
    }

    // ── device.haptics ────────────────────────────────────────────
    function testHaptics() {
      if (!ensureReady()) { return; }
      bridge.haptics.impactMedium()
        .then(function() { addLog('Haptic fired: impactMedium', true); })
        .catch(function(e) { addLog('Haptics error: ' + e.message, false); });
    }

    // ── network.fetch ─────────────────────────────────────────────
    function testFetch() {
      if (!ensureReady()) { return; }
      addLog('Fetching https://httpbin.org/get ...', null);
      bridge.fetch('https://httpbin.org/get', { method: 'GET' })
        .then(function(res) {
          var r = JSON.parse(res.body);
          addLog('Fetch OK: status=' + res.status + ', url=' + r.url, true);
        })
        .catch(function(e) { addLog('Fetch error: ' + e.message, false); });
    }

    // ── capability gate test ──────────────────────────────────────
    function testDenied() {
      if (!ensureReady()) { return; }
      // Domain not in allowlist — should get FETCH_NOT_ALLOWED
      bridge.fetch('https://google.com/', { method: 'GET' })
        .then(function() { addLog('ERROR: should have been denied!', false); })
        .catch(function(e) { addLog('Correctly denied: ' + e.message, true); });
    }
  </script>
</body>
</html>`;

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  const bridgeHost = useMemo(() => {
    const router = new CapabilityRouter();
    router.register(StorageHandler);
    router.register(HapticsHandler);
    router.register(FetchHandler);
    const host = new BridgeHost(router);
    // Wire bridge callbacks → native metrics module
    host.onMetricsUpdate = (capability, latencyMs, ok) => {
      NativeWhipMetrics?.recordRequest(capability, latencyMs, ok);
    };
    host.onDropped = reason => {
      NativeWhipMetrics?.recordDropped(reason);
    };
    return host;
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <View style={styles.root}>
          <MiniAppContainer
            bridgeHost={bridgeHost}
            manifest={DEMO_MANIFEST}
            html={DEMO_HTML}
          />
          <MetricsOverlay bridgeHost={bridgeHost} />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});

export default App;
