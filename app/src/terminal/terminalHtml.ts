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
const TERMINAL_HTML_TEMPLATE = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
<style>
  html,body{margin:0;height:100%;background:#000000;overflow:hidden;overscroll-behavior:none;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
  #t{position:absolute;top:0;left:0;right:0;bottom:0;padding:6px 8px;box-sizing:border-box;touch-action:none}
  .xterm-viewport{overflow:hidden!important;overscroll-behavior:none;-webkit-overflow-scrolling:touch;background:#000000!important}
</style>
</head><body>
<div id="t"></div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-canvas@0.7.0/lib/addon-canvas.js"></script>
<script>
(function(){
  var REMOTE = __CONNECTLY_REMOTE__;
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
    scrollback: __CONNECTLY_SCROLLBACK__, scrollOnUserInput: false, allowProposedApi: true
  });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  var host = document.getElementById('t');
  term.open(host);

  try { if (typeof CanvasAddon !== 'undefined') term.loadAddon(new CanvasAddon.CanvasAddon()); } catch(e){}

  var remoteCopyMode = false, remoteNewOutput = false;
  var away = false, unread = false;
  var touchDown = false, touchMoved = false;
  var touchY = 0, touchTime = 0, velocity = 0, remainder = 0, flushTimer = 0, pending = 0, fling = 0;

  function reportScroll(){
    post({t:'scrollState', away:away, unread:unread || remoteNewOutput, remote:REMOTE, copyMode:remoteCopyMode});
  }
  function atBottom(){
    var b = term.buffer.active;
    return !b || b.viewportY >= b.baseY;
  }
  function updateLocalScroll(){
    if (REMOTE) return;
    away = !atBottom();
    if (!away) unread = false;
    reportScroll();
  }
  term.onScroll(updateLocalScroll);

  function lineHeight(){ return Math.max(8, host.clientHeight / Math.max(1, term.rows)); }
  function flushRemoteScroll(){
    flushTimer = 0;
    if (!pending) return;
    var count = pending;
    pending = 0;
    post({t:'scroll', dir:count < 0 ? 'up' : 'down', lines:Math.abs(count)});
  }
  function moveLines(delta){
    remainder += delta / lineHeight();
    var count = remainder < 0 ? Math.ceil(remainder) : Math.floor(remainder);
    if (!count) return;
    remainder -= count;
    if (!REMOTE) {
      term.scrollLines(count);
      updateLocalScroll();
      return;
    }
    if (count > 0 && !remoteCopyMode) return;
    pending += count;
    if (!flushTimer) flushTimer = setTimeout(flushRemoteScroll, 50);
  }

  host.addEventListener('touchstart', function(e){
    if (e.touches.length !== 1) { touchDown = false; return; }
    cancelAnimationFrame(fling);
    touchDown = true; touchMoved = false; velocity = 0; remainder = 0;
    touchY = e.touches[0].clientY; touchTime = performance.now();
  }, {passive:true});
  host.addEventListener('touchmove', function(e){
    if (!touchDown || e.touches.length !== 1) return;
    e.preventDefault();
    var nextY = e.touches[0].clientY, nextTime = performance.now();
    var fingerDelta = touchY - nextY;
    if (!touchMoved && Math.abs(fingerDelta) < 6) return;
    touchMoved = true;
    var dt = Math.max(1, nextTime - touchTime);
    var scrollDelta = fingerDelta;
    velocity = 0.72 * velocity + 0.28 * (scrollDelta / dt);
    touchY = nextY; touchTime = nextTime;
    moveLines(scrollDelta);
  }, {passive:false});
  host.addEventListener('touchend', function(e){
    if (!touchDown) return;
    touchDown = false;
    if (!touchMoved) { e.preventDefault(); term.focus(); return; }
    if (performance.now() - touchTime > 80) return;
    var speed = velocity * 16;
    (function coast(){
      if (Math.abs(speed) < 0.28) return;
      moveLines(speed); speed *= 0.93;
      fling = requestAnimationFrame(coast);
    })();
  }, {passive:false});
  host.addEventListener('touchcancel', function(){ touchDown = false; });
  host.addEventListener('wheel', function(e){
    e.preventDefault();
    moveLines(e.deltaY);
  }, {passive:false, capture:true});

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
  window.__w = function(b){
    var follow = REMOTE || atBottom();
    term.write(unb64(b), function(){
      if (follow && !remoteCopyMode) term.scrollToBottom();
      else if (!REMOTE) { unread = true; away = true; reportScroll(); }
      if (pend) {
        var d = performance.now() - pend;
        pend = 0;
        if (d < 1000) post({t:'echo', ms: Math.round(d)});
      }
    });
  };
  window.__reset = function(){ term.reset(); };
  window.__mode = function(m, fresh){
    remoteCopyMode = !!m; remoteNewOutput = !!fresh;
    if (!remoteCopyMode) { term.scrollToBottom(); unread = false; }
    reportScroll();
  };
  window.__scrollBottom = function(){
    if (REMOTE) post({t:'scrollLive'});
    else { term.scrollToBottom(); away = false; unread = false; reportScroll(); }
  };
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

export function buildTerminalHtml(remote: boolean): string {
  return TERMINAL_HTML_TEMPLATE
    .replace('__CONNECTLY_REMOTE__', remote ? 'true' : 'false')
    .replace('__CONNECTLY_SCROLLBACK__', remote ? '0' : '5000');
}

export const TERMINAL_HTML = buildTerminalHtml(false);
