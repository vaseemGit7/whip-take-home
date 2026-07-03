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

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [selected, setSelected] = useState(0);

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
      // Expected: "[WhipBridge JSI] getSync result: jsi-is-synchronous"
    } else {
      console.warn('[WhipBridge JSI] __whipStorage not installed');
    }
  }, []);

  const app = MINI_APPS[selected];

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <View style={styles.root}>
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
});

export default App;
