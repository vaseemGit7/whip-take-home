import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import WebView, {WebViewMessageEvent} from 'react-native-webview';
import {BridgeHost} from '../bridge/BridgeHost';
import {MiniAppManifest} from '../bridge/protocol';

interface Props {
  bridgeHost: BridgeHost;
  manifest: MiniAppManifest;
  /** Inline HTML for the mini app — use this or uri, not both */
  html?: string;
  /** Remote URL for the mini app */
  uri?: string;
}

export function MiniAppContainer({bridgeHost, manifest, html, uri}: Props) {
  const webViewRef = useRef<WebView | null>(null);
  // Incrementing this key forces <WebView> to fully unmount and remount,
  // picking up the new injectedJavaScriptBeforeContentLoaded after a crash.
  const [crashKey, setCrashKey] = useState(0);

  // Register this WebView with the bridge before first render.
  // We use a ref so the token is stable across re-renders.
  const sessionRef = useRef<{token: string; injectedScript: string} | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = bridgeHost.registerWebView(
      webViewRef,
      manifest.miniAppId,
      manifest,
    );
  }

  useEffect(() => {
    // Re-register if Strict Mode double-mount removed our token
    if (!bridgeHost.hasToken(sessionRef.current?.token ?? '')) {
      sessionRef.current = bridgeHost.registerWebView(
        webViewRef,
        manifest.miniAppId,
        manifest,
      );
    }
    return () => {
      // Read token from ref at cleanup time so a post-crash re-registration
      // is also cleaned up correctly (not just the token captured at mount).
      if (sessionRef.current) {
        bridgeHost.cleanup(sessionRef.current.token);
        sessionRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeHost, manifest.miniAppId]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      bridgeHost.onMessage(event);
    },
    [bridgeHost],
  );

  // Shared crash handler for iOS (onContentProcessDidTerminate) and
  // Android (onRenderProcessGone). Cleans up the stale session, issues a
  // fresh token, then forces the WebView to remount so the new token is
  // delivered via injectedJavaScriptBeforeContentLoaded — avoiding the
  // "connecting forever" state caused by the old approach of reload() with
  // an already-invalidated token.
  const handleCrash = useCallback(() => {
    if (sessionRef.current) {
      bridgeHost.cleanup(sessionRef.current.token);
    }
    sessionRef.current = bridgeHost.registerWebView(
      webViewRef,
      manifest.miniAppId,
      manifest,
    );
    setCrashKey(k => k + 1);
  }, [bridgeHost, manifest]);

  const source = uri ? {uri} : {html: html ?? '<html><body></body></html>'};
  const {injectedScript} = sessionRef.current;

  return (
    <View style={styles.container}>
      <WebView
        key={crashKey}
        ref={webViewRef}
        source={source}
        onMessage={onMessage}
        injectedJavaScriptBeforeContentLoaded={injectedScript}
        onContentProcessDidTerminate={handleCrash}
        onRenderProcessGone={handleCrash}
        javaScriptEnabled
        domStorageEnabled={false}
        allowsInlineMediaPlayback={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
});
