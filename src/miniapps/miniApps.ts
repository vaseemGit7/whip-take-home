import {MiniAppManifest} from '../bridge/protocol';

export interface MiniApp {
  id: string;
  label: string;
  manifest: MiniAppManifest;
  html: string;
}

// ── Manifests ─────────────────────────────────────────────────────────────────

const DEMO_MANIFEST: MiniAppManifest = {
  miniAppId: 'demo',
  capabilities: ['storage.kv', 'device.haptics', 'network.fetch', 'push.subscribe'],
  domainAllowlist: ['httpbin.org', 'jsonplaceholder.typicode.com'],
  storageQuotaBytes: 1_048_576,
};

// Attacks 1–3, 6: only storage.kv (no fetch)
const ATK_STORAGE: MiniAppManifest = {
  miniAppId: 'atk-storage',
  capabilities: ['storage.kv'],
  domainAllowlist: [],
  storageQuotaBytes: 50_000,
};

// Attack 4 SSRF: has network.fetch but private IPs must still be blocked
const ATK_FETCH: MiniAppManifest = {
  miniAppId: 'atk-fetch',
  capabilities: ['network.fetch'],
  domainAllowlist: ['httpbin.org'],  // legitimate domain allowed; private IPs still blocked
  storageQuotaBytes: 0,
};

// Attack 5 cap bypass: only storage.kv → tries network.fetch and fabricated cap
const ATK_CAPBYPASS: MiniAppManifest = {
  miniAppId: 'atk-capbypass',
  capabilities: ['storage.kv'],
  domainAllowlist: [],
  storageQuotaBytes: 50_000,
};

// ── HTML ──────────────────────────────────────────────────────────────────────

const DEMO_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; padding: 16px; background: #f0f4ff; margin: 0; }
    h2 { font-size: 20px; color: #1a1a2e; margin: 0 0 4px; }
    .subtitle { font-size: 12px; color: #666; margin: 0 0 14px; }
    #bridge-status { font-size: 12px; padding: 8px 12px; border-radius: 20px; margin-bottom: 14px;
      display: inline-flex; align-items: center; gap: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #ccc; flex-shrink: 0; }
    .connecting { background: #fff3cd; color: #856404; }
    .connected   { background: #d4edda; color: #155724; }
    .connected .dot { background: #28a745; }
    .row { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
    button { flex: 1; min-width: 80px; padding: 11px 8px; border-radius: 8px; border: none;
      background: #4361ee; color: white; font-size: 13px; font-weight: 600; cursor: pointer; }
    button:active { opacity: 0.75; }
    button:disabled { background: #bbb; cursor: not-allowed; }
    #log { margin-top: 10px; }
    .entry { padding: 8px 12px; border-radius: 6px; margin-bottom: 6px; font-size: 12px; }
    .ok   { background: #d4edda; color: #155724; }
    .err  { background: #f8d7da; color: #721c24; }
    .info { background: #e2e8ff; color: #2d3a8c; font-family: monospace; }
  </style>
</head>
<body>
  <h2>WhipBridge Demo</h2>
  <p class="subtitle">Happy-path: storage · haptics · fetch · push subscription</p>
  <div id="bridge-status" class="connecting">
    <span class="dot"></span><span id="status-text">Connecting to bridge…</span>
  </div>
  <div class="row">
    <button id="b1" onclick="testStorage()" disabled>Storage</button>
    <button id="b2" onclick="testHaptics()" disabled>Haptics</button>
    <button id="b3" onclick="testFetch()"   disabled>Fetch</button>
    <button id="b4" onclick="testPush()"    disabled>Subscribe</button>
  </div>
  <div id="log"></div>
  <script>
    var ready = false;
    var _orig = window.__bridgeDispatch;
    window.__bridgeDispatch = function(raw) {
      var m = JSON.parse(raw);
      if (m.type === 'HANDSHAKE_ACK' && m.ok) {
        ready = true;
        document.getElementById('bridge-status').className = 'connected';
        document.getElementById('status-text').textContent = 'Bridge connected (token verified)';
        ['b1','b2','b3','b4'].forEach(function(id) {
          document.getElementById(id).disabled = false;
        });
      }
      if (_orig) _orig(raw);
    };
    function log(msg, cls) {
      var div = document.createElement('div');
      div.className = 'entry ' + (cls || 'info');
      div.textContent = msg;
      document.getElementById('log').prepend(div);
    }
    function testStorage() {
      bridge.storage.set('greeting', 'hello from mini app!')
        .then(function() { return bridge.storage.get('greeting'); })
        .then(function(val) {
          log('\\u2713 storage.get("greeting") = ' + val, 'ok');
          return bridge.storage.list();
        })
        .then(function(keys) { log('\\u2713 storage.list() = [' + keys.join(', ') + ']', 'ok'); })
        .catch(function(e) { log('\\u2717 Storage: ' + e.message, 'err'); });
    }
    function testHaptics() {
      bridge.haptics.impactMedium()
        .then(function() { log('\\u2713 haptics.impactMedium() fired', 'ok'); })
        .catch(function(e) { log('\\u2717 Haptics: ' + e.message, 'err'); });
    }
    function testFetch() {
      log('\\u23f3 Fetching https://jsonplaceholder.typicode.com/todos/1…', 'info');
      bridge.fetch('https://jsonplaceholder.typicode.com/todos/1', {method: 'GET'})
        .then(function(res) {
          var body = JSON.parse(res.body);
          log('\\u2713 fetch OK — status=' + res.status + '  title=' + body.title, 'ok');
        })
        .catch(function(e) { log('\\u2717 Fetch: ' + e.message, 'err'); });
    }
    function testPush() {
      bridge.subscribe('demo.ticker', function(payload) {
        log('\\ud83d\\udce9 PUSH on demo.ticker: ' + JSON.stringify(payload), 'ok');
      });
      log('\\u2713 Subscribed to demo.ticker — waiting for host push…', 'info');
    }
  </script>
</body>
</html>`;

const ATK1_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *{box-sizing:border-box}body{font-family:-apple-system,sans-serif;padding:14px;background:#0f0f1a;color:#e0e0e0;margin:0}
    h1{font-size:16px;color:#ff6b6b;margin:0 0 2px}.num{background:#ff4444;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;margin-right:4px}
    .sub{font-size:11px;color:#888;margin:0 0 12px}.threat{background:#1a0a0a;border:1px solid #662222;border-radius:6px;padding:10px 12px;font-size:11px;font-family:monospace;color:#ff9999;margin:10px 0;white-space:pre}
    button{width:100%;padding:13px;border-radius:8px;border:none;background:#cc2222;color:#fff;font-size:14px;font-weight:700;cursor:pointer;margin:10px 0}
    button:active{opacity:.8}.result{border-radius:8px;padding:12px 14px;margin:8px 0;display:none}.result.show{display:block}
    .blocked{background:#0a1f14;border:1px solid #00cc77}.blocked h3{color:#00cc77;font-size:13px;margin:0 0 6px}
    .vuln{background:#200a0a;border:1px solid #ff3333}.vuln h3{color:#ff3333;font-size:13px;margin:0 0 6px}
    .detail{font-family:monospace;font-size:10px;color:#aaa;margin-top:6px;white-space:pre-wrap}
    #bs{font-size:10px;color:#666;margin-bottom:10px}
  </style>
</head>
<body>
  <h1><span class="num">ATK 1</span> Prototype Pollution</h1>
  <p class="sub">Injects __proto__ into REQUEST payload to pollute Object.prototype on the host JS runtime.</p>
  <div id="bs">Bridge: connecting…</div>
  <div class="threat">Payload:
{ "__proto__": { "isAdmin": true, "role": "superuser" },
  "key": "pwn", "value": "hello" }
Goal: host processes payload → ({}).isAdmin === true</div>
  <button onclick="runAttack()">⚡ Launch Prototype Pollution</button>
  <div id="res" class="result"><h3>—</h3><p class="detail">—</p></div>
  <script>
    var _o=window.__bridgeDispatch;
    window.__bridgeDispatch=function(raw){var m=JSON.parse(raw);if(m.type==='HANDSHAKE_ACK')document.getElementById('bs').textContent='Bridge: connected ✓';if(_o)_o(raw);};
    function show(cls,t,d){var el=document.getElementById('res');el.className='result show '+cls;el.querySelector('h3').textContent=t;el.querySelector('.detail').textContent=d;}
    function runAttack(){
      show('blocked','⏳ Sending poisoned payload…','Waiting for host response…');
      var id='poison-'+Date.now(),tok=window.__WHIP_SESSION_TOKEN__;
      var prev=window.__bridgeDispatch;
      window.__bridgeDispatch=function(raw){
        var m=JSON.parse(raw);
        if(m.id===id){
          window.__bridgeDispatch=prev;
          var polluted=({}).isAdmin===true;
          if(polluted){show('vuln','🚨 ATTACK SUCCEEDED — Bridge VULNERABLE','Object.prototype.isAdmin===true');}
          else{show('blocked','✅ BLOCKED — sanitizePayload() stripped __proto__','Host response: ok='+m.ok+'\\nObject.prototype.isAdmin='+({}).isAdmin+' (clean)\\n\\nDefense: sanitize.ts → Object.create(null) + skip __proto__\\n__proto__ key never reached the StorageHandler.');}
        }
        if(prev)prev(raw);
      };
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'REQUEST',id:id,sessionToken:tok,capability:'storage.kv',method:'set',payload:{'__proto__':{isAdmin:true,role:'superuser'},key:'pwn',value:'hello'},version:'1.0',timestamp:Date.now()}));
    }
  </script>
</body></html>`;

const ATK2_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *{box-sizing:border-box}body{font-family:-apple-system,sans-serif;padding:14px;background:#0f0f1a;color:#e0e0e0;margin:0}
    h1{font-size:16px;color:#ff6b6b;margin:0 0 2px}.num{background:#ff4444;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;margin-right:4px}
    .sub{font-size:11px;color:#888;margin:0 0 10px}.scenario{font-size:11px;color:#bbb;background:#151525;border-radius:6px;padding:8px 10px;margin:8px 0;border-left:2px solid #4466cc}
    .threat{background:#1a0a0a;border:1px solid #662222;border-radius:6px;padding:10px 12px;font-size:11px;font-family:monospace;color:#ff9999;margin:10px 0;white-space:pre}
    button{width:100%;padding:13px;border-radius:8px;border:none;background:#cc2222;color:#fff;font-size:14px;font-weight:700;cursor:pointer;margin:8px 0}
    button:active{opacity:.8}.result{border-radius:8px;padding:12px 14px;margin:8px 0;display:none}.result.show{display:block}
    .blocked{background:#0a1f14;border:1px solid #00cc77}.blocked h3{color:#00cc77;font-size:13px;margin:0 0 6px}
    .vuln{background:#200a0a;border:1px solid #ff3333}.vuln h3{color:#ff3333;font-size:13px;margin:0 0 6px}
    .detail{font-family:monospace;font-size:10px;color:#aaa;margin-top:6px;white-space:pre-wrap}
    #bs{font-size:10px;color:#666;margin-bottom:10px}
  </style>
</head>
<body>
  <h1><span class="num">ATK 2</span> Direction Confusion</h1>
  <p class="sub">Guest sends a HOST_ONLY PUSH to inject fake data into a shared channel.</p>
  <div id="bs">Bridge: connecting…</div>
  <div class="scenario">Scenario: App A and App B subscribe to "market.prices". App A (attacker) sends a PUSH directly — without going through the host — to manipulate App B's price display.</div>
  <div class="threat">{ "type": "PUSH",   ← HOST_ONLY direction
  "channel": "market.prices",
  "payload": { "price": 0, "source": "attacker" } }</div>
  <button onclick="runAttack()">⚡ Inject Fake PUSH</button>
  <div id="res" class="result"><h3>—</h3><p class="detail">—</p></div>
  <script>
    var _o=window.__bridgeDispatch;
    window.__bridgeDispatch=function(raw){var m=JSON.parse(raw);if(m.type==='HANDSHAKE_ACK')document.getElementById('bs').textContent='Bridge: connected ✓';if(_o)_o(raw);};
    function show(cls,t,d){var el=document.getElementById('res');el.className='result show '+cls;el.querySelector('h3').textContent=t;el.querySelector('.detail').textContent=d;}
    function runAttack(){
      show('blocked','⏳ Sending PUSH from guest…','Waiting 2 s for response…');
      var id='push-'+Date.now(),got=false;
      var prev=window.__bridgeDispatch;
      window.__bridgeDispatch=function(raw){var m=JSON.parse(raw);if(m.id===id)got=true;if(prev)prev(raw);};
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'PUSH',id:id,sessionToken:window.__WHIP_SESSION_TOKEN__,channel:'market.prices',payload:{price:0,source:'attacker-app'},version:'1.0',timestamp:Date.now()}));
      setTimeout(function(){
        window.__bridgeDispatch=prev;
        if(got){show('vuln','🚨 ATTACK SUCCEEDED','Host responded to guest PUSH!');}
        else{show('blocked','✅ BLOCKED — Silent drop (DIRECTION_VIOLATION)','Guest sent: { type: "PUSH" } — a HOST_ONLY type\\nHost dropped BEFORE token check — no timing oracle.\\n\\nDefense: GUEST_ALLOWED_TYPES Set in BridgeHost.onMessage()\\nPUSH, RESPONSE, HANDSHAKE_ACK never allowed from guests.\\nDrop reason: DIRECTION_VIOLATION');}
      },2000);
    }
  </script>
</body></html>`;

const ATK3_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *{box-sizing:border-box}body{font-family:-apple-system,sans-serif;padding:14px;background:#0f0f1a;color:#e0e0e0;margin:0}
    h1{font-size:16px;color:#ff6b6b;margin:0 0 2px}.num{background:#ff4444;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;margin-right:4px}
    .sub{font-size:11px;color:#888;margin:0 0 12px}
    .threat{background:#1a0a0a;border:1px solid #662222;border-radius:6px;padding:10px 12px;font-size:11px;font-family:monospace;color:#ff9999;margin:10px 0;white-space:pre}
    .trow{font-size:10px;font-family:monospace;margin:4px 0;padding:6px 8px;background:#0e0e1e;border-radius:4px;border-left:2px solid #444}
    .real{border-left-color:#00cc77}.fake{border-left-color:#ff4444}
    button{width:100%;padding:11px;border-radius:8px;border:none;color:#fff;font-size:13px;font-weight:700;cursor:pointer;margin:5px 0}
    .btn-red{background:#cc2222}.btn-org{background:#883300}button:active{opacity:.8}
    .result{border-radius:8px;padding:12px 14px;margin:8px 0;display:none}.result.show{display:block}
    .blocked{background:#0a1f14;border:1px solid #00cc77}.blocked h3{color:#00cc77;font-size:13px;margin:0 0 6px}
    .vuln{background:#200a0a;border:1px solid #ff3333}.vuln h3{color:#ff3333;font-size:13px;margin:0 0 6px}
    .detail{font-family:monospace;font-size:10px;color:#aaa;margin-top:6px;white-space:pre-wrap}
    #bs{font-size:10px;color:#666;margin-bottom:10px}
  </style>
</head>
<body>
  <h1><span class="num">ATK 3</span> Token Forgery</h1>
  <p class="sub">Sends REQUEST with a forged 128-bit session token to impersonate another mini app.</p>
  <div id="bs">Bridge: connecting…</div>
  <div class="trow real">Real token:   <span id="rt">—</span></div>
  <div class="trow fake">Forged token: ffffffffffffffffffffffffffffffff</div>
  <div class="threat">{ "type": "REQUEST",
  "sessionToken": "ffffffffffffffffffffffffffffffff",
  "capability": "storage.kv", "method": "get",
  "payload": { "key": "secret" } }</div>
  <button class="btn-red" onclick="runForged()">⚡ Send Forged Token</button>
  <button class="btn-org" onclick="runMissing()">⚡ Send Missing Token</button>
  <div id="res" class="result"><h3>—</h3><p class="detail">—</p></div>
  <script>
    var _o=window.__bridgeDispatch;
    window.__bridgeDispatch=function(raw){var m=JSON.parse(raw);if(m.type==='HANDSHAKE_ACK'){document.getElementById('bs').textContent='Bridge: connected ✓';document.getElementById('rt').textContent=(window.__WHIP_SESSION_TOKEN__||'').slice(0,8)+'…';}if(_o)_o(raw);};
    function show(cls,t,d){var el=document.getElementById('res');el.className='result show '+cls;el.querySelector('h3').textContent=t;el.querySelector('.detail').textContent=d;}
    function wait(id,label,onNone){
      var got=false,prev=window.__bridgeDispatch;
      window.__bridgeDispatch=function(raw){var m=JSON.parse(raw);if(m.id===id)got=true;if(prev)prev(raw);};
      setTimeout(function(){window.__bridgeDispatch=prev;if(got){show('vuln','🚨 '+label,'Host responded!');}else{onNone();}},2000);
    }
    function runForged(){
      var id='forged-'+Date.now();
      show('blocked','⏳ Sending forged token…','Waiting 2 s…');
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'REQUEST',id:id,sessionToken:'ffffffffffffffffffffffffffffffff',capability:'storage.kv',method:'get',payload:{key:'secret'},version:'1.0',timestamp:Date.now()}));
      wait(id,'Forged token accepted!',function(){show('blocked','✅ BLOCKED — TOKEN_INVALID (silent drop)','Forged: ffffffffffffffffffffffffffffffff\\nNot in host token registry → silent drop.\\n\\nDefense: 128-bit random token, unguessable.\\nBrute-force prob: 1/2^128 ≈ 3×10⁻³⁹\\nNo response = no timing oracle for attacker.');});
    }
    function runMissing(){
      var id='missing-'+Date.now();
      show('blocked','⏳ Sending request with no token…','Waiting 2 s…');
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'REQUEST',id:id,capability:'storage.kv',method:'get',payload:{key:'secret'},version:'1.0',timestamp:Date.now()}));
      wait(id,'Missing token accepted!',function(){show('blocked','✅ BLOCKED — TOKEN_MISSING (silent drop)','No sessionToken field in message.\\nHost checks typeof sessionToken → falsy → drop.\\nDrop reason: TOKEN_MISSING');});
    }
  </script>
</body></html>`;

const ATK4_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *{box-sizing:border-box}body{font-family:-apple-system,sans-serif;padding:14px;background:#0f0f1a;color:#e0e0e0;margin:0}
    h1{font-size:16px;color:#ff6b6b;margin:0 0 2px}.num{background:#ff4444;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;margin-right:4px}
    .sub{font-size:11px;color:#888;margin:0 0 10px}
    .threat{background:#1a0a0a;border:1px solid #662222;border-radius:6px;padding:10px 12px;font-size:11px;font-family:monospace;color:#ff9999;margin:10px 0;white-space:pre}
    button{width:100%;padding:11px;border-radius:8px;border:none;background:#cc2222;color:#fff;font-size:13px;font-weight:700;cursor:pointer;margin:6px 0}button:active{opacity:.8}
    .trow{display:flex;align-items:center;gap:8px;padding:7px 10px;background:#141424;border-radius:6px;margin:4px 0;font-family:monospace;font-size:11px}
    .url{flex:1;color:#ffaa44}.badge{font-size:10px;padding:2px 6px;border-radius:3px;font-weight:700;min-width:64px;text-align:center}
    .bp{background:#333;color:#aaa}.bb{background:#0a3320;color:#00cc77}.bv{background:#3a0a0a;color:#ff4444}
    #summary{border-radius:8px;padding:10px 12px;margin:8px 0;display:none}#summary.show{display:block}
    #summary.blocked{background:#0a1f14;border:1px solid #00cc77}#summary h3{color:#00cc77;font-size:13px;margin:0 0 6px}
    .detail{font-family:monospace;font-size:10px;color:#aaa;margin-top:6px;white-space:pre-wrap}
    #bs{font-size:10px;color:#666;margin-bottom:10px}
  </style>
</head>
<body>
  <h1><span class="num">ATK 4</span> SSRF — Private IP Probe</h1>
  <p class="sub">Uses bridge.fetch() to probe private IP ranges: loopback, RFC 1918, AWS metadata, IPv6.</p>
  <div id="bs">Bridge: connecting…</div>
  <div class="threat">Goal: read internal services through the host network
  e.g. router admin, AWS EC2 metadata, Kubernetes API</div>
  <button onclick="runAll()">⚡ Probe All Private Targets</button>
  <div id="targets"></div>
  <div id="summary"><h3>—</h3><p class="detail">—</p></div>
  <script>
    var TARGETS=[
      {url:'https://127.0.0.1/',label:'Loopback (127.0.0.1)'},
      {url:'https://192.168.1.1/',label:'RFC 1918 — router'},
      {url:'https://10.0.0.1/',label:'RFC 1918 — 10.x'},
      {url:'https://172.16.0.1/',label:'RFC 1918 — 172.16.x'},
      {url:'https://169.254.169.254/latest/meta-data/',label:'AWS EC2 metadata'},
      {url:'https://[::1]/',label:'IPv6 loopback'},
    ];
    var _o=window.__bridgeDispatch;
    window.__bridgeDispatch=function(raw){var m=JSON.parse(raw);if(m.type==='HANDSHAKE_ACK'){document.getElementById('bs').textContent='Bridge: connected ✓';renderTargets();}if(_o)_o(raw);};
    function renderTargets(){
      var c=document.getElementById('targets');c.innerHTML='';
      TARGETS.forEach(function(t,i){var r=document.createElement('div');r.className='trow';r.innerHTML='<span class="url">'+t.url+'</span><span class="badge bp" id="b'+i+'">—</span>';c.appendChild(r);});
    }
    function setBadge(i,cls,txt){var b=document.getElementById('b'+i);if(b){b.className='badge '+cls;b.textContent=txt;}}
    function runAll(){
      var blocked=0,done=0;
      TARGETS.forEach(function(t,i){
        setBadge(i,'bp','⏳');
        bridge.fetch(t.url,{method:'GET'})
          .then(function(){setBadge(i,'bv','🚨 OPEN');})
          .catch(function(){blocked++;setBadge(i,'bb','✅ BLOCKED');})
          .finally(function(){done++;if(done===TARGETS.length)finish(blocked);});
      });
    }
    function finish(blocked){
      var el=document.getElementById('summary');
      el.className='show'+(blocked===TARGETS.length?' blocked':'');
      el.querySelector('h3').textContent=blocked===TARGETS.length?'✅ ALL '+TARGETS.length+' TARGETS BLOCKED':'🚨 '+(TARGETS.length-blocked)+' TARGETS REACHABLE';
      el.querySelector('.detail').textContent='Defense: FetchHandler.validateUrl()\\nChecks IP BEFORE network call:\\n  1. HTTPS-only\\n  2. RFC 1918 + loopback + link-local + IPv6 patterns\\n  3. Domain allowlist\\n\\nError: FETCH_NOT_ALLOWED\\nBlocked: '+blocked+'/'+TARGETS.length+' targets';
    }
  </script>
</body></html>`;

const ATK5_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *{box-sizing:border-box}body{font-family:-apple-system,sans-serif;padding:14px;background:#0f0f1a;color:#e0e0e0;margin:0}
    h1{font-size:16px;color:#ff6b6b;margin:0 0 2px}.num{background:#ff4444;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;margin-right:4px}
    .sub{font-size:11px;color:#888;margin:0 0 10px}
    .manifest{background:#0e1825;border:1px solid #1e4080;border-radius:6px;padding:10px 12px;font-size:11px;font-family:monospace;color:#88aaff;margin:10px 0;white-space:pre}
    .threat{background:#1a0a0a;border:1px solid #662222;border-radius:6px;padding:10px 12px;font-size:11px;font-family:monospace;color:#ff9999;margin:10px 0;white-space:pre}
    button{width:100%;padding:11px;border-radius:8px;border:none;color:#fff;font-size:13px;font-weight:700;cursor:pointer;margin:5px 0}
    .btn-red{background:#cc2222}.btn-org{background:#883300}button:active{opacity:.8}
    .result{border-radius:8px;padding:12px 14px;margin:8px 0;display:none}.result.show{display:block}
    .blocked{background:#0a1f14;border:1px solid #00cc77}.blocked h3{color:#00cc77;font-size:13px;margin:0 0 6px}
    .vuln{background:#200a0a;border:1px solid #ff3333}.vuln h3{color:#ff3333;font-size:13px;margin:0 0 6px}
    .detail{font-family:monospace;font-size:10px;color:#aaa;margin-top:6px;white-space:pre-wrap}
    #bs{font-size:10px;color:#666;margin-bottom:10px}
  </style>
</head>
<body>
  <h1><span class="num">ATK 5</span> Capability Gate Bypass</h1>
  <p class="sub">Manifest grants only storage.kv — tries network.fetch, fabricated cap, and ungated subscribe.</p>
  <div id="bs">Bridge: connecting…</div>
  <div class="manifest">This app's manifest (host-enforced):
{ "capabilities": ["storage.kv"] }
← no network.fetch, no push.subscribe!</div>
  <div class="threat">Attempt 1: bridge.fetch(https://httpbin.org/get) — needs "network.fetch"
Attempt 2: REQUEST { capability: "admin.reset" } — fabricated
Attempt 3: SUBSCRIBE { channel: "market.prices" } — needs "push.subscribe"</div>
  <button class="btn-red" onclick="tryFetch()">⚡ Try bridge.fetch (network.fetch)</button>
  <button class="btn-org" onclick="tryFake()" style="background:#883300;">⚡ Try admin.reset (fabricated)</button>
  <button class="btn-org" onclick="trySub()" style="background:#5c3a00;">⚡ Try subscribe (push.subscribe)</button>
  <div id="res" class="result"><h3>—</h3><p class="detail">—</p></div>
  <script>
    var _o=window.__bridgeDispatch;
    window.__bridgeDispatch=function(raw){var m=JSON.parse(raw);if(m.type==='HANDSHAKE_ACK')document.getElementById('bs').textContent='Bridge: connected ✓';if(_o)_o(raw);};
    function show(cls,t,d){var el=document.getElementById('res');el.className='result show '+cls;el.querySelector('h3').textContent=t;el.querySelector('.detail').textContent=d;}
    function tryFetch(){
      show('blocked','⏳ Attempting bridge.fetch…','');
      bridge.fetch('https://httpbin.org/get',{method:'GET'})
        .then(function(r){show('vuln','🚨 ATTACK SUCCEEDED','status='+r.status);})
        .catch(function(e){show('blocked','✅ BLOCKED — CAPABILITY_DENIED','Attempted: capability="network.fetch"\\nManifest: ["storage.kv"]\\n\\nError: '+e.code+'\\nDefense: manifest.capabilities.includes("network.fetch")===false\\nManifest contents NOT leaked in error response.');});
    }
    function tryFake(){
      show('blocked','⏳ Sending admin.reset…','');
      var id='fake-'+Date.now(),prev=window.__bridgeDispatch;
      window.__bridgeDispatch=function(raw){var m=JSON.parse(raw);if(m.id===id){window.__bridgeDispatch=prev;if(m.ok){show('vuln','🚨 admin.reset executed!','');}else{show('blocked','✅ BLOCKED — CAPABILITY_DENIED','Attempted: capability="admin.reset"\\nError: '+(m.error&&m.error.code)+'\\n\\nFabricated caps blocked at two layers:\\n  1. Not in this app\\'s manifest\\n  2. No handler in CapabilityRouter');}}if(prev)prev(raw);};
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'REQUEST',id:id,sessionToken:window.__WHIP_SESSION_TOKEN__,capability:'admin.reset',method:'execute',payload:{},version:'1.0',timestamp:Date.now()}));
    }
    function trySub(){
      show('blocked','⏳ Sending SUBSCRIBE without push.subscribe cap…','');
      var id='sub-'+Date.now(),prev=window.__bridgeDispatch;
      window.__bridgeDispatch=function(raw){var m=JSON.parse(raw);if(m.id===id){window.__bridgeDispatch=prev;if(m.ok===false){show('blocked','✅ BLOCKED — CAPABILITY_DENIED (push.subscribe not in manifest)','Attempted: SUBSCRIBE channel="market.prices"\\nError: '+(m.error&&m.error.code)+'\\n\\nWithout push.subscribe cap, app cannot:\\n  · enroll in host push channels\\n  · receive host-initiated data streams\\n\\nDefense: manifest.capabilities.includes("push.subscribe")===false\\nHost returns CAPABILITY_DENIED before adding token to subscription map.');}else{show('vuln','🚨 ATTACK SUCCEEDED — Subscription accepted without capability','App is now enrolled in market.prices channel!');}}if(prev)prev(raw);};
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'SUBSCRIBE',id:id,sessionToken:window.__WHIP_SESSION_TOKEN__,version:'1.0',channel:'market.prices',timestamp:Date.now()}));
    }
  </script>
</body></html>`;

const ATK6_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *{box-sizing:border-box}body{font-family:-apple-system,sans-serif;padding:14px;background:#0f0f1a;color:#e0e0e0;margin:0}
    h1{font-size:16px;color:#ff6b6b;margin:0 0 2px}.num{background:#ff4444;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;margin-right:4px}
    .sub{font-size:11px;color:#888;margin:0 0 10px}
    .threat{background:#1a0a0a;border:1px solid #662222;border-radius:6px;padding:10px 12px;font-size:11px;font-family:monospace;color:#ff9999;margin:10px 0;white-space:pre}
    .meter{background:#141424;border-radius:6px;padding:10px 12px;margin:10px 0}
    .meter label{font-size:11px;color:#888;display:block;margin-bottom:6px}
    input[type=range]{width:100%;accent-color:#ff4444}
    .size{font-size:15px;font-family:monospace;font-weight:700;margin-top:4px}
    .over{color:#ff4444}.under{color:#00cc77}
    button{width:100%;padding:11px;border-radius:8px;border:none;background:#cc2222;color:#fff;font-size:13px;font-weight:700;cursor:pointer;margin:6px 0}button:active{opacity:.8}
    .result{border-radius:8px;padding:12px 14px;margin:8px 0;display:none}.result.show{display:block}
    .blocked{background:#0a1f14;border:1px solid #00cc77}.blocked h3{color:#00cc77;font-size:13px;margin:0 0 6px}
    .vuln{background:#200a0a;border:1px solid #ff3333}.vuln h3{color:#ff3333;font-size:13px;margin:0 0 6px}
    .detail{font-family:monospace;font-size:10px;color:#aaa;margin-top:6px;white-space:pre-wrap}
    #bs{font-size:10px;color:#666;margin-bottom:10px}
  </style>
</head>
<body>
  <h1><span class="num">ATK 6</span> Oversized Payload DoS</h1>
  <p class="sub">Sends a message exceeding the 64 KB limit to cause OOM or freeze the bridge parser.</p>
  <div id="bs">Bridge: connecting…</div>
  <div class="threat">Goal: huge JSON → host JSON.parse blocks JS thread → DoS
Limit: MAX_RAW_BYTES = 65,536 (checked BEFORE JSON.parse)</div>
  <div class="meter">
    <label>Payload size: <span id="slabel">70 KB</span></label>
    <input type="range" id="sl" min="10" max="200" value="70" oninput="upd()">
    <div class="size over" id="sdisplay">70,000 B — ABOVE LIMIT ⛔</div>
  </div>
  <button onclick="runAttack()">⚡ Send Oversized Message</button>
  <div id="res" class="result"><h3>—</h3><p class="detail">—</p></div>
  <script>
    var LIMIT=65536;
    var _o=window.__bridgeDispatch;
    window.__bridgeDispatch=function(raw){var m=JSON.parse(raw);if(m.type==='HANDSHAKE_ACK')document.getElementById('bs').textContent='Bridge: connected ✓';if(_o)_o(raw);};
    function upd(){
      var kb=parseInt(document.getElementById('sl').value,10),bytes=kb*1000;
      document.getElementById('slabel').textContent=kb+' KB';
      var d=document.getElementById('sdisplay');
      if(bytes>LIMIT){d.className='size over';d.textContent=bytes.toLocaleString()+' B — ABOVE LIMIT ⛔';}
      else{d.className='size under';d.textContent=bytes.toLocaleString()+' B — under limit ✓';}
    }
    function show(cls,t,d){var el=document.getElementById('res');el.className='result show '+cls;el.querySelector('h3').textContent=t;el.querySelector('.detail').textContent=d;}
    function runAttack(){
      var kb=parseInt(document.getElementById('sl').value,10),target=kb*1000;
      var pad=Math.max(0,target-180),bigVal='X'.repeat(pad);
      var raw=JSON.stringify({type:'REQUEST',id:'big-x',sessionToken:window.__WHIP_SESSION_TOKEN__,capability:'storage.kv',method:'set',payload:{key:'x',value:bigVal},version:'1.0',timestamp:Date.now()});
      var actual=raw.length,shouldDrop=actual>LIMIT;
      show('blocked','⏳ Sending '+(actual/1000).toFixed(1)+' KB…','actual='+actual.toLocaleString()+' B   limit='+LIMIT.toLocaleString()+' B');
      var id='big-'+Date.now(),got=false,prev=window.__bridgeDispatch;
      window.__bridgeDispatch=function(r){var m=JSON.parse(r);if(m.id===id)got=true;if(prev)prev(r);};
      // Re-build with real id for detection
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'REQUEST',id:id,sessionToken:window.__WHIP_SESSION_TOKEN__,capability:'storage.kv',method:'set',payload:{key:'x',value:bigVal},version:'1.0',timestamp:Date.now()}));
      setTimeout(function(){
        window.__bridgeDispatch=prev;
        if(shouldDrop){
          if(!got){show('blocked','✅ BLOCKED — Dropped before JSON.parse (PAYLOAD_TOO_LARGE)','Sent: '+actual.toLocaleString()+' bytes\\nLimit: '+LIMIT.toLocaleString()+' bytes\\n\\nDefense: BridgeHost checks raw.length FIRST.\\nCost to bridge: O(1) comparison.\\nJSON.parse never called — zero parse cost.\\nDrop reason: PAYLOAD_TOO_LARGE');}
          else{show('vuln','🚨 ATTACK SUCCEEDED — Oversized message parsed!','Parsed '+actual.toLocaleString()+' bytes despite size check!');}
        }else{show('blocked','Message under limit — increase slider above 65 KB','Sent: '+actual.toLocaleString()+' B  Limit: '+LIMIT.toLocaleString()+' B');}
      },2000);
    }
  </script>
</body></html>`;

// ── Exported mini app list ─────────────────────────────────────────────────────

export const MINI_APPS: MiniApp[] = [
  {id: 'demo',  label: '✓ Demo',         manifest: DEMO_MANIFEST,  html: DEMO_HTML},
  {id: 'atk1',  label: '① Prototype',    manifest: ATK_STORAGE,    html: ATK1_HTML},
  {id: 'atk2',  label: '② Direction',    manifest: ATK_STORAGE,    html: ATK2_HTML},
  {id: 'atk3',  label: '③ Token',        manifest: ATK_STORAGE,    html: ATK3_HTML},
  {id: 'atk4',  label: '④ SSRF',         manifest: ATK_FETCH,      html: ATK4_HTML},
  {id: 'atk5',  label: '⑤ Cap Bypass',   manifest: ATK_CAPBYPASS,  html: ATK5_HTML},
  {id: 'atk6',  label: '⑥ Oversize',     manifest: ATK_STORAGE,    html: ATK6_HTML},
];
