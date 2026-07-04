import React, {useEffect, useMemo, useState} from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {BridgeHost} from './src/bridge/BridgeHost';
import {CapabilityRouter} from './src/bridge/CapabilityRouter';
import {MiniAppContainer} from './src/components/MiniAppContainer';
import {MetricsOverlay} from './src/components/MetricsOverlay';
import {StorageHandler} from './src/bridge/capabilities/StorageHandler';
import {HapticsHandler} from './src/bridge/capabilities/HapticsHandler';
import {FetchHandler} from './src/bridge/capabilities/FetchHandler';
import NativeWhipMetrics from './src/native/NativeWhipMetrics';
import {MINI_APPS} from './src/miniapps/miniApps';

function pct(arr: number[], p: number) {
  return arr[Math.min(Math.floor(arr.length * p), arr.length - 1)];
}

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [selected, setSelected] = useState(0);
  const [jsiResult, setJsiResult] = useState<string>('pending…');
  const [benchResult, setBenchResult] = useState<string | null>(null);

  const runBenchmark = async () => {
    const storage = (global as any).__whipStorage;
    if (!storage) { setBenchResult('JSI not installed'); return; }
    setBenchResult('running…');

    // JSI sync — 1 000 iterations
    const jsiUs: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      storage.getSync('__whip_jsi_demo__');
      jsiUs.push((performance.now() - t0) * 1000);
    }
    jsiUs.sort((a, b) => a - b);

    // Async baseline (setImmediate round-trip) — 100 iterations
    const asyncUs: number[] = [];
    for (let i = 0; i < 100; i++) {
      await new Promise<void>(resolve => {
        const t0 = performance.now();
        setImmediate(() => { asyncUs.push((performance.now() - t0) * 1000); resolve(); });
      });
    }
    asyncUs.sort((a, b) => a - b);

    const r =
      `JSI getSync   p50: ${pct(jsiUs, 0.5).toFixed(1)} µs   p99: ${pct(jsiUs, 0.99).toFixed(1)} µs\n` +
      `async (setImmediate) p50: ${pct(asyncUs, 0.5).toFixed(0)} µs   p99: ${pct(asyncUs, 0.99).toFixed(0)} µs`;
    console.log('[WhipBridge Bench]\n' + r);
    setBenchResult(r);
  };

  const bridgeHost = useMemo(() => {
    const router = new CapabilityRouter();
    router.register(StorageHandler);
    router.register(HapticsHandler);
    router.register(FetchHandler);
    const host = new BridgeHost(router);
    host.onMetricsUpdate = (capability, latencyMs, ok) => {
      NativeWhipMetrics?.recordRequest(capability, latencyMs, ok);
    };
    host.onDropped = reason => {
      NativeWhipMetrics?.recordDropped(reason);
    };
    return host;
  }, []);

  // JSI smoke-test: verify global.__whipStorage was installed by WhipJSIInstaller.
  // This runs in the Hermes runtime (RN JS thread) — NOT in a WebView context.
  // WebView JS contexts are isolated from Hermes by design (the security model).
  // The synchronous return proves no async hop or event-loop yield occurred.
  useEffect(() => {
    const storage = (global as any).__whipStorage;
    if (storage) {
      const val: string | null = storage.getSync('__whip_jsi_demo__');
      console.log('[WhipBridge JSI] getSync result:', val);
      setJsiResult(val ?? 'null');
    } else {
      console.warn('[WhipBridge JSI] __whipStorage not installed');
      setJsiResult('NOT INSTALLED');
    }
  }, []);

  const app = MINI_APPS[selected];

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <View style={styles.root}>
          {/* ── JSI smoke-test banner ── */}
          <View style={[styles.jsiBanner, jsiResult === 'jsi-is-synchronous' ? styles.jsiBannerOk : styles.jsiBannerFail]}>
            <Text style={styles.jsiBannerText}>JSI: {jsiResult}</Text>
          </View>

          {/* ── Benchmark ── */}
          <TouchableOpacity style={styles.benchBtn} onPress={runBenchmark}>
            <Text style={styles.benchBtnText}>Run JSI Benchmark</Text>
          </TouchableOpacity>
          {benchResult ? (
            <View style={styles.benchResult}>
              <Text style={styles.benchResultText}>{benchResult}</Text>
            </View>
          ) : null}

          {/* ── Tab bar ── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabBar}
            contentContainerStyle={styles.tabBarContent}>
            {MINI_APPS.map((m, i) => (
              <TouchableOpacity
                key={m.id}
                onPress={() => setSelected(i)}
                style={[styles.tab, i === selected && styles.tabActive]}>
                <Text
                  style={[styles.tabText, i === selected && styles.tabTextActive]}
                  numberOfLines={1}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── Mini app WebView — key forces full remount on switch ── */}
          <MiniAppContainer
            key={app.id}
            bridgeHost={bridgeHost}
            manifest={app.manifest}
            html={app.html}
          />

          <MetricsOverlay bridgeHost={bridgeHost} />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  tabBar: {flexGrow: 0, backgroundColor: '#1a1a2e'},
  tabBarContent: {paddingHorizontal: 8, paddingVertical: 6, gap: 6},
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#2a2a3e',
  },
  tabActive: {backgroundColor: '#4361ee'},
  tabText: {fontSize: 12, color: '#888', fontWeight: '600'},
  tabTextActive: {color: '#fff'},
  jsiBanner: {paddingHorizontal: 12, paddingVertical: 4},
  jsiBannerOk: {backgroundColor: '#1a3a1a'},
  jsiBannerFail: {backgroundColor: '#3a1a1a'},
  jsiBannerText: {fontSize: 11, color: '#aaa', fontFamily: 'Menlo'},
  benchBtn: {margin: 8, padding: 8, backgroundColor: '#2a2a3e', borderRadius: 8, alignItems: 'center'},
  benchBtnText: {color: '#4361ee', fontSize: 12, fontWeight: '600'},
  benchResult: {marginHorizontal: 8, padding: 8, backgroundColor: '#111', borderRadius: 6},
  benchResultText: {color: '#aaa', fontSize: 11, fontFamily: 'Menlo'},
});

export default App;
