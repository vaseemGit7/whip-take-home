// Returns the JavaScript string injected into the WebView.
// This runs in the WebView's untrusted JS context — it is plain JS, not TypeScript.
// The token is already on window.__WHIP_SESSION_TOKEN__ before this script executes.

export function getTokenInjectionScript(token: string): string {
  // Validate token contains only hex chars before embedding
  if (!/^[0-9a-f]{32}$/.test(token)) {
    throw new Error('Invalid token format');
  }
  return `(function(){Object.defineProperty(window,'__WHIP_SESSION_TOKEN__',{value:'${token}',writable:false,configurable:false,enumerable:false});})();`;
}

export function getBridgeClientScript(): string {
  return `
(function() {
  'use strict';

  var TOKEN = window.__WHIP_SESSION_TOKEN__;
  var VERSION = '1.0';
  var MAX_PENDING = 20;
  var TIMEOUT_MS = 5000;

  var pendingCallbacks = new Map(); // id → { resolve, reject, timeoutId }
  var pushListeners = new Map();    // channel → callback

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function post(msg) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  // Entry point for all host → guest messages.
  // Host calls: window.__bridgeDispatch(JSON.stringify(msg))
  window.__bridgeDispatch = function(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.type === 'RESPONSE') {
      var cb = pendingCallbacks.get(msg.id);
      if (!cb) return;
      clearTimeout(cb.timeoutId);
      pendingCallbacks.delete(msg.id);
      if (msg.ok) {
        cb.resolve(msg.result);
      } else {
        var err = new Error(msg.error ? msg.error.code : 'BRIDGE_ERROR');
        err.code = msg.error ? msg.error.code : 'BRIDGE_ERROR';
        cb.reject(err);
      }

    } else if (msg.type === 'PUSH') {
      var listener = pushListeners.get(msg.channel);
      if (listener) {
        try { listener(msg.payload); } catch (e) { /* guest errors don't crash the bridge */ }
      }

    } else if (msg.type === 'HANDSHAKE_ACK') {
      if (!msg.ok) {
        console.error('[WhipBridge] Handshake failed:', msg.error);
      }
    }
  };

  function request(capability, method, payload) {
    if (pendingCallbacks.size >= MAX_PENDING) {
      return Promise.reject(new Error('MAX_CONCURRENT_EXCEEDED'));
    }
    return new Promise(function(resolve, reject) {
      var id = uuid();
      var timeoutId = setTimeout(function() {
        pendingCallbacks.delete(id);
        reject(new Error('TIMEOUT'));
      }, TIMEOUT_MS);
      pendingCallbacks.set(id, { resolve: resolve, reject: reject, timeoutId: timeoutId });
      post({ type: 'REQUEST', id: id, sessionToken: TOKEN, version: VERSION,
             capability: capability, method: method, payload: payload || {},
             timestamp: Date.now() });
    });
  }

  // Public API exposed to mini app code
  window.bridge = Object.freeze({
    storage: Object.freeze({
      get:    function(key)        { return request('storage.kv', 'get',    { key: key }); },
      set:    function(key, value) { return request('storage.kv', 'set',    { key: key, value: value }); },
      delete: function(key)        { return request('storage.kv', 'delete', { key: key }); },
      list:   function()           { return request('storage.kv', 'list',   {}); },
    }),
    haptics: Object.freeze({
      impactLight:         function() { return request('device.haptics', 'impactLight', {}); },
      impactMedium:        function() { return request('device.haptics', 'impactMedium', {}); },
      impactHeavy:         function() { return request('device.haptics', 'impactHeavy', {}); },
      notificationSuccess: function() { return request('device.haptics', 'notificationSuccess', {}); },
      notificationWarning: function() { return request('device.haptics', 'notificationWarning', {}); },
      notificationError:   function() { return request('device.haptics', 'notificationError', {}); },
      selectionChanged:    function() { return request('device.haptics', 'selectionChanged', {}); },
    }),
    fetch: function(url, opts) {
      return request('network.fetch', 'fetch', {
        url: url,
        method: (opts && opts.method) || 'GET',
        headers: (opts && opts.headers) || {},
        body: (opts && opts.body) || null,
      });
    },
    subscribe: function(channel, callback) {
      pushListeners.set(channel, callback);
      post({ type: 'SUBSCRIBE', id: uuid(), sessionToken: TOKEN, version: VERSION,
             channel: channel, timestamp: Date.now() });
    },
    unsubscribe: function(channel) {
      pushListeners.delete(channel);
      post({ type: 'UNSUBSCRIBE', id: uuid(), sessionToken: TOKEN, version: VERSION,
             channel: channel, timestamp: Date.now() });
    },
    emit: function(event, payload) {
      post({ type: 'NOTIFICATION', id: uuid(), sessionToken: TOKEN, version: VERSION,
             event: event, payload: payload || {}, timestamp: Date.now() });
    },
  });

  // Block direct network access — all network must go through bridge.fetch
  try {
    Object.defineProperty(window, 'fetch', {
      get: function() { throw new Error('SecurityError: Use bridge.fetch()'); },
      configurable: false, enumerable: false,
    });
  } catch(e) { /* already non-configurable */ }

  try {
    window.XMLHttpRequest = function() {
      throw new Error('SecurityError: Use bridge.fetch()');
    };
  } catch(e) {}

  // Initial handshake — tells host which protocol version this client supports
  post({ type: 'HANDSHAKE', id: uuid(), sessionToken: TOKEN,
         guestVersion: VERSION, timestamp: Date.now() });

})();
`;
}

export function getFullInjectedScript(token: string): string {
  return getTokenInjectionScript(token) + '\n' + getBridgeClientScript();
}
