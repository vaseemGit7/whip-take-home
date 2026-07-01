import React, {useCallback, useEffect, useRef} from 'react';
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

  const {token, injectedScript} = sessionRef.current;

  useEffect(() => {
    // Re-register if Strict Mode double-mount removed our token
    if (!bridgeHost.hasToken(token)) {
      sessionRef.current = bridgeHost.registerWebView(
        webViewRef,
        manifest.miniAppId,
        manifest,
      );
    }
    return () => {
      bridgeHost.cleanup(token);
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeHost, manifest.miniAppId]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      bridgeHost.onMessage(event);
    },
    [bridgeHost],
  );

  // iOS: WebContent process crashed
  const onContentProcessDidTerminate = useCallback(() => {
    if (sessionRef.current) {
      bridgeHost.cleanup(sessionRef.current.token);
      sessionRef.current = null;
    }
    webViewRef.current?.reload();
  }, [bridgeHost]);

  // Android: renderer process crashed
  const onRenderProcessGone = useCallback(() => {
    if (sessionRef.current) {
      bridgeHost.cleanup(sessionRef.current.token);
      sessionRef.current = null;
    }
    webViewRef.current?.reload();
  }, [bridgeHost]);

  const source = uri ? {uri} : {html: html ?? '<html><body></body></html>'};

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={source}
        onMessage={onMessage}
        injectedJavaScriptBeforeContentLoaded={injectedScript}
        onContentProcessDidTerminate={onContentProcessDidTerminate}
        onRenderProcessGone={onRenderProcessGone}
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
