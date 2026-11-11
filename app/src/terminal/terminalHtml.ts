import type { Palette } from '../theme/tokens';

export function xtermTheme(p: Palette) {
  const dark = p.mode === 'dark';
  return {
    bg: p.bg,
    xterm: {
      background: p.bg,
      foreground: p.text,
      cursor: p.accent,
      cursorAccent: p.bg,
      selectionBackground: 'rgba(37,99,235,0.30)',
      black: dark ? '#171717' : '#0A0A0A',
      red: dark ? '#FB7185' : '#E11D48',
      green: dark ? '#4ADE80' : '#16A34A',
      yellow: dark ? '#FDBA74' : '#B45309',
      blue: dark ? '#7CA7FF' : '#2563EB',
      magenta: dark ? '#C4A1FF' : '#7C3AED',
      cyan: dark ? '#5EEAD4' : '#0F766E',
      white: dark ? '#E5E5E5' : '#666666',
      brightBlack: dark ? '#737373' : '#8A8A8A',
      brightRed: dark ? '#FDA4AF' : '#F43F5E',
      brightGreen: dark ? '#86EFAC' : '#22C55E',
      brightYellow: dark ? '#FED7AA' : '#D97706',
      brightBlue: dark ? '#A5C0FF' : '#3B82F6',
      brightMagenta: dark ? '#DAC7FF' : '#8B5CF6',
      brightCyan: dark ? '#99F6E4' : '#14B8A6',
      brightWhite: dark ? '#FAFAFA' : '#0A0A0A',
    },
  };
}

// xterm.js loads from jsDelivr (pinned). It needs internet. Vendor it for offline use.
export const TERMINAL_HTML = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
<style>
  html,body{margin:0;height:100%;background:#000000;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
  #t{position:absolute;top:0;left:0;right:0;bottom:0;padding:6px 8px;box-sizing:border-box}
  .xterm-viewport{overscroll-behavior:contain}
</style>
</head><body>
<div id="t"></div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-canvas@0.7.0/lib/addon-canvas.js"></script>
<script>
(function(){
  var rn = window.ReactNativeWebView;
  var post = function(o){ rn.postMessage(typeof o === 'string' ? o : JSON.stringify(o)); };
  window.onerror = function(m){ post({t:'fatal', m:String(m)}); };
  if (typeof Terminal === 'undefined' || typeof FitAddon === 'undefined') {
    post({t:'fatal', m:'xterm.js failed to load. The phone needs internet access.'});
    return;
  }
  var term = new Terminal({
    fontFamily: 'Menlo, "SF Mono", Consolas, "Roboto Mono", monospace',
    fontSize: 13, lineHeight: 1.15, cursorBlink: false, cursorStyle: 'block',
    scrollback: 5000, allowProposedApi: true
  });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  var host = document.getElementById('t');
  term.open(host);

  try { if (typeof CanvasAddon !== 'undefined') term.loadAddon(new CanvasAddon.CanvasAddon()); } catch(e){}

  function unb64(b){ var s=atob(b), u=new Uint8Array(s.length); for (var i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u; }

  var pend = 0;
  term.onData(function(d){
    var n = performance.now();
    if (!pend || n - pend > 1000) pend = n;
    post('i' + d);
  });
  term.onBinary(function(d){ post('b' + d); });
  term.onBell(function(){ post({t:'bell'}); });
  term.onTitleChange(function(s){ post({t:'title', s:s}); });

  var rt = null;
  function doFit(){ try { fit.fit(); } catch(e){} post({t:'resize', cols:term.cols, rows:term.rows}); }
  new ResizeObserver(function(){ clearTimeout(rt); rt = setTimeout(doFit, 60); }).observe(host);
  document.body.addEventListener('touchend', function(){ term.focus(); });

  window.__w = function(b){
    term.write(unb64(b), function(){
      if (pend) {
        var d = performance.now() - pend;
        pend = 0;
        if (d < 1000) post({t:'echo', ms: Math.round(d)});
      }
    });
  };
  window.__reset = function(){ term.reset(); };
  window.__theme = function(t){ term.options.theme = t.xterm; document.body.style.background = t.bg; document.documentElement.style.background = t.bg; };
  window.__paste = function(s){ term.paste(s); };
  window.__sel = function(){ post({t:'sel', s:term.getSelection()}); };
  window.__focus = function(){ term.focus(); };
  window.__blur = function(){ term.blur(); if (document.activeElement) document.activeElement.blur(); };

  try { fit.fit(); } catch(e){}
  post({t:'ready', cols:term.cols, rows:term.rows});
})();
</script>
</body></html>`;
