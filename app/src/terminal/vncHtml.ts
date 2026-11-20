export const vncHtml = (url: string) => `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>
  html,body{margin:0;width:100%;height:100%;background:#0A0A0A;overflow:hidden;touch-action:none}
  body{display:flex;align-items:center;justify-content:center}
  img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;touch-action:none;user-select:none;-webkit-user-select:none}
  #keyboard{position:absolute;right:16px;bottom:16px;padding:8px 14px;border:0;border-radius:16px;background:#262626;color:#FAFAFA;font:13px -apple-system,system-ui,sans-serif}
  #input{position:absolute;opacity:0;left:0;bottom:0;width:1px;height:1px}
</style>
</head><body>
<img id="screen" alt="Mac desktop" draggable="false">
<button id="keyboard" type="button">Keyboard</button><textarea id="input" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Mac keyboard"></textarea>
<script>
(function(){
  var post = function(value){ window.ReactNativeWebView.postMessage(JSON.stringify(value)); };
  var screen = document.getElementById('screen');
  var input = document.getElementById('input');
  var socket = new WebSocket(${JSON.stringify(url)});
  socket.binaryType = 'blob';
  var objectUrl = null, connected = false, failed = false, held = false, urls = [];
  function revoke(url) {
    if (!url) return;
    URL.revokeObjectURL(url);
    urls = urls.filter(function(value){ return value !== url; });
  }
  socket.onmessage = function(event){
    if (typeof event.data === 'string') {
      try { var message = JSON.parse(event.data); if (message.error) { failed = true; post({t:'fail',m:message.error}); } } catch(e) {}
      return;
    }
    var next = URL.createObjectURL(event.data);
    var old = objectUrl;
    urls.push(next);
    objectUrl = next;
    screen.src = next;
    if (old) setTimeout(function(){ revoke(old); }, 2000);
  };
  screen.addEventListener('load', function(){ if (!connected) { connected = true; post({t:'connect'}); } });
  socket.onerror = function(){ if (!failed) { failed = true; post({t:'fail',m:'Could not connect to the Mac desktop.'}); } };
  socket.onclose = function(){ urls.slice().forEach(revoke); objectUrl = null; post({t:'disconnect',clean:!failed}); };
  function send(type, clientX, clientY, down) {
    if (socket.readyState !== WebSocket.OPEN) return;
    var rect = screen.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    var y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    socket.send(JSON.stringify({type:type,x:x,y:y,down:down}));
  }
  screen.addEventListener('pointerdown', function(e){ e.preventDefault(); screen.setPointerCapture(e.pointerId); held = true; send('mouse',e.clientX,e.clientY,true); });
  screen.addEventListener('pointermove', function(e){ if (held) send('move',e.clientX,e.clientY,true); });
  screen.addEventListener('pointerup', function(e){ e.preventDefault(); send('mouse',e.clientX,e.clientY,false); held = false; });
  screen.addEventListener('pointercancel', function(e){ send('mouse',e.clientX,e.clientY,false); held = false; });
  screen.addEventListener('wheel', function(e){ e.preventDefault(); if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type:'scroll',deltaY:e.deltaY})); }, {passive:false});
  document.getElementById('keyboard').addEventListener('click', function(){ input.focus(); });
  input.addEventListener('beforeinput', function(e){
    if (socket.readyState !== WebSocket.OPEN) return;
    if (e.inputType === 'deleteContentBackward') socket.send(JSON.stringify({type:'key',key:'Backspace'}));
    else if (e.inputType === 'insertLineBreak') socket.send(JSON.stringify({type:'key',key:'Enter'}));
    else if (e.data) socket.send(JSON.stringify({type:'key',text:e.data}));
    e.preventDefault();
  });
})();
</script></body></html>`;
