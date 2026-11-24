package deck

import (
	"encoding/json"
	"fmt"
)

// BuildBridgeInitJS returns the JavaScript injected into pokeidle.io/app BEFORE page scripts execute.
// It:
//  1. Isolates `sessao`, `id-dispositivo`, and `cfg-ultra` in-memory per window via Storage.prototype
//     so up to 4 accounts can run side-by-side without clobbering each other's localStorage.
//  2. Proxies `window.WebSocket` so same-host connections (`wss://pokeidle.io`) route through
//     the Go backend's Caminho 1 WS Bridge (`ws://127.0.0.1:<port>/bridge/<accId>?s=<secret>`).
//  3. Optionally activates prefers-reduced-motion (`motion.js` technique from pokeidleDeck).
func BuildBridgeInitJS(accID int, nick, token, deviceID string, bridgePort int, bridgeSecret string, reduceMotion, ultra bool) string {
	sessBytes, _ := json.Marshal(map[string]any{
		"nick":  nick,
		"token": token,
	})
	sessJSON := string(sessBytes)
	devBytes, _ := json.Marshal(deviceID)
	devJSON := string(devBytes)
	bridgeURL := fmt.Sprintf("ws://127.0.0.1:%d/bridge/%d?s=%s", bridgePort, accID, bridgeSecret)
	bridgeURLBytes, _ := json.Marshal(bridgeURL)

	ultraVal := "0"
	if ultra {
		ultraVal = "1"
	}

	return fmt.Sprintf(`(function() {
  if (window.__pokeMngrBridgeInstalled) return;
  window.__pokeMngrBridgeInstalled = true;

  // 1. Per-window virtualized session keys (avoids cross-account localStorage clobbering)
  try {
    var mem = {
      'sessao': %q,
      'id-dispositivo': %s,
      'cfg-ultra': %q
    };
    var origGet = Storage.prototype.getItem;
    var origSet = Storage.prototype.setItem;
    var origRem = Storage.prototype.removeItem;
    Storage.prototype.getItem = function(k) {
      if (this === window.localStorage && Object.prototype.hasOwnProperty.call(mem, k)) {
        return mem[k];
      }
      return origGet.call(this, k);
    };
    Storage.prototype.setItem = function(k, v) {
      if (this === window.localStorage && Object.prototype.hasOwnProperty.call(mem, k)) {
        mem[k] = String(v);
        return;
      }
      return origSet.call(this, k, v);
    };
    Storage.prototype.removeItem = function(k) {
      if (this === window.localStorage && Object.prototype.hasOwnProperty.call(mem, k)) {
        return;
      }
      return origRem.call(this, k);
    };
  } catch (e) {}

  // 2. Proxy window.WebSocket -> Go Bridge (Caminho 1)
  var NativeWS = window.WebSocket;
  var BRIDGE_URL = %s;
  window.WebSocket = new Proxy(NativeWS, {
    construct: function(target, args, newTarget) {
      try {
        var rawUrl = String(args[0] || '');
        if (rawUrl.indexOf('pokeidle.io') !== -1 || rawUrl.indexOf(location.host) !== -1) {
          var nextArgs = args.slice();
          nextArgs[0] = BRIDGE_URL;
          return Reflect.construct(target, nextArgs, newTarget);
        }
      } catch (e) {}
      return Reflect.construct(target, args, newTarget);
    }
  });

  // 3. Optional Reduce Motion (from pokeidleDeck)
  var REDUCE = %t;
  if (REDUCE) {
    try {
      var origMM = window.matchMedia.bind(window);
      window.matchMedia = function(q) {
        if (typeof q === 'string' && q.indexOf('prefers-reduced-motion') !== -1) {
          var m = q.indexOf('reduce') !== -1;
          return {
            matches: m, media: q, onchange: null,
            addListener: function(){}, removeListener: function(){},
            addEventListener: function(){}, removeEventListener: function(){},
            dispatchEvent: function(){ return false; }
          };
        }
        return origMM(q);
      };
    } catch (e) {}
  }
})();`, sessJSON, string(devJSON), ultraVal, string(bridgeURLBytes), reduceMotion)
}

// BookmarkletSnippet matches pokeidle-manager-online's 1-click session extractor from pokeidle.io/app.
const BookmarkletSnippet = `javascript:(()=>{try{const s=JSON.parse(localStorage.getItem('sessao')||'null');const d=localStorage.getItem('id-dispositivo')||'';if(!s||!s.nick||!s.token){alert('Entre na sua conta no pokeidle.io/app primeiro.');return;}const txt=JSON.stringify({nick:s.nick,token:s.token,dispositivo:d});navigator.clipboard.writeText(txt).then(()=>alert('Conta '+s.nick+' copiada! Volte ao PokeMngr e cole.')).catch(()=>prompt('Copie o texto abaixo:',txt));}catch(e){alert('Erro ao ler sessão: '+e);}})();`
