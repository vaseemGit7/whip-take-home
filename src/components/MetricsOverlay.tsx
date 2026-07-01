import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {BridgeHost, MetricsSnapshot} from '../bridge/BridgeHost';
import NativeWhipMetrics from '../native/NativeWhipMetrics';

interface Props {
  bridgeHost?: BridgeHost;
}

const POLL_INTERVAL_MS = 1000;

export function MetricsOverlay({bridgeHost}: Props) {
  const [snap, setSnap] = useState<MetricsSnapshot | null>(null);

  const refresh = useCallback(async () => {
    try {
      // Prefer JS-side snapshot (reliable); fall back to native module if no host provided
      const s: MetricsSnapshot | null | undefined = bridgeHost
        ? bridgeHost.getMetricsSnapshot()
        : await NativeWhipMetrics?.getSnapshot();
      if (s) {
        setSnap(s);
      }
    } catch {
      // Module unavailable (e.g. Storybook / tests)
    }
  }, [bridgeHost]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  if (!snap) {
    return null;
  }

  const capabilities = Object.keys(snap.p50ByCapability);
  const errorPct = (snap.errorRate * 100).toFixed(1);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>
        {`req/s: ${snap.reqPerSec}  err: ${errorPct}%  drops: ${snap.droppedTotal}`}
      </Text>
      {capabilities.map(cap => {
        const short = cap.split('.')[1] ?? cap;
        const p50 = snap.p50ByCapability[cap]?.toFixed(0) ?? '—';
        const p99 = snap.p99ByCapability[cap]?.toFixed(0) ?? '—';
        return (
          <Text key={cap} style={styles.row}>
            {`${short}: p50=${p50}ms  p99=${p99}ms`}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.80)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    gap: 2,
  },
  header: {
    color: '#00ff88',
    fontFamily: 'Menlo',
    fontSize: 12,
    fontWeight: '600',
  },
  row: {
    color: '#7af3c2',
    fontFamily: 'Menlo',
    fontSize: 11,
  },
});
