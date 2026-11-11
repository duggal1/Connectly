export function vncHtml(url: string): string {
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>
  html,body{margin:0;height:100%;background:#000;color:#FAFAFA;font:15px -apple-system,system-ui,sans-serif;overflow:hidden}
  #s{position:absolute;inset:0}
  #f{position:absolute;inset:0;display:none;flex-direction:column;justify-content:center;gap:12px;padding:24px;background:#000}
  #f p{margin:0 0 4px;color:#A3A3A3;font-size:12px}
  #f input{height:48px;border:0;border-radius:8px;background:#101010;color:#FAFAFA;padding:0 16px;font-size:15px}
  #f button{height:44px;border:0;border-radius:22px;background:#2563EB;color:#FFF;font-size:15px;font-weight:500}
</style>
</head><body>
<div id="s"></div>
<div id="f">
  <p>Your Mac account name and password</p>
  <input id="u" placeholder="Account name" autocapitalize="none" autocorrect="off" spellcheck="false">
  <input id="p" type="password" placeholder="Password">
  <button id="go">Connect</button>
</div>
<script type="module">
  const post = (value) => window.ReactNativeWebView.postMessage(JSON.stringify(value));
  try {
    const { default: RFB } = await import('https://cdn.jsdelivr.net/npm/@novnc/novnc@1.5.0/core/rfb.js');
    const screen = document.getElementById('s');
    const form = document.getElementById('f');
    const username = document.getElementById('u');
    const password = document.getElementById('p');
    const rfb = new RFB(screen, ${JSON.stringify(url)}, { shared: true });
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.addEventListener('connect', () => post({ t: 'connect' }));
    rfb.addEventListener('disconnect', (event) => post({ t: 'disconnect', clean: !!event.detail.clean }));
    rfb.addEventListener('securityfailure', (event) => post({ t: 'fail', message: (event.detail && event.detail.reason) || 'Sign-in failed.' }));
    rfb.addEventListener('credentialsrequired', () => { form.style.display = 'flex'; });
    document.getElementById('go').onclick = () => {
      rfb.sendCredentials({ username: username.value, password: password.value });
      username.value = '';
      password.value = '';
      form.style.display = 'none';
    };
  } catch (error) {
    post({ t: 'fail', message: 'noVNC failed to load. The phone needs internet access.' });
  }
</script>
</body></html>`;
}
