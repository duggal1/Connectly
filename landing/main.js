(()=>{
const $=s=>document.querySelector(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.add('js');

/* Logo resolver: give it a domain (data-logo) or a Simple Icons slug (data-si).
   Tries the sharpest source first, rejects tiny placeholder icons, falls through. */
const SI='https://cdn.simpleicons.org/';
const sources=el=>{
 if(el.dataset.si)return[SI+el.dataset.si];
 const d=el.dataset.logo;
 return['https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url='+encodeURIComponent('https://'+d)+'&size=256',
  'https://'+d+'/apple-touch-icon.png','https://icons.duckduckgo.com/ip3/'+d+'.ico']};
const tile=el=>{const l=(el.dataset.logo||el.dataset.si||'?')[0].toUpperCase();
 el.src='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#27272a"/><text x="32" y="32" dy=".35em" text-anchor="middle" font-family="system-ui,sans-serif" font-size="32" font-weight="600" fill="#fafafa">'+l+'</text></svg>');
 el.classList.add('ld')};
const hydrate=el=>{const q=sources(el);let i=0;
 const next=()=>{if(i>=q.length)return tile(el);const im=new Image();im.referrerPolicy='no-referrer';
  im.onload=()=>{if(!el.dataset.si&&im.naturalWidth<32)return next();el.src=im.src;el.classList.add('ld')};
  im.onerror=next;im.src=q[i++]};next()};
document.querySelectorAll('[data-logo],[data-si]').forEach(hydrate);

/* Demo: three agents driven from the phone */
const SC=[
{n:'claude',l:["$ cd ~/Projects/api","$ claude","✻ Claude Code","> fix the failing sync test","● Read(src/sync.ts)","● Update(src/sync.ts)","  ⎿ +4 −2 lines","● Bash(npm test)","  ⎿ ✓ 42 passed"]},
{n:'codex',l:["$ codex","> add retry to the upload client","• Explored src/upload.ts","• Edited src/upload.ts (+12 −3)","• Ran npm test","  ✓ 43 passed"]},
{n:'opencode',l:["$ opencode","> commit and push this","● git commit -m \"Add upload retry\"","● git push origin main","  → 3 commits pushed"]}];
let out='',snap='',down=false,shut=false,tm,echo=38;
const mt=$('#mt'),pt=$('#pt'),lk=$('#lk'),mac=$('#mac');
const fmt=s=>s.split('\n').slice(-16).join('\n').replace(/(^|\n)([$>●•✻])/g,'$1<span class="pr">$2</span>');
const draw=()=>{mt.innerHTML=fmt(out);pt.innerHTML=fmt(down?snap:out)};
const name=n=>{$('#ptab').textContent=n;$('#mcap').textContent='Mac · termd · '+n};
for(let i=0;i<12;i++)lk.append(document.createElement('i'));
const cs=[...lk.children];let h=0;
const paint=()=>cs.forEach((c,i)=>{c.className=down?(i==5||i==6?'bad':''):(i==h?'on':i==(h+11)%12?'tr':'')});
const say=(t,ms)=>{const p=$('#pn');p.textContent=t;p.classList.add('show');clearTimeout(say.t);if(ms)say.t=setTimeout(()=>p.classList.remove('show'),ms)};
const stat=()=>{$('#pst').textContent='Mac 86%, lid '+(shut?'closed':'open')+(down?'':' · echo '+echo+' ms');$('#rm').textContent=shut?'Closed':'Open'};
function setDown(v){
 if(v===down)return;down=v;if(v)snap=out;
 $('#ph').classList.toggle('dn',v);$('#ls').textContent=v?'Reconnecting':'Live';
 $('#rl').textContent=v?'Reconnecting':'Live';$('#re').textContent=v?'—':echo+' ms';
 $('#bd').textContent=v?'Restore now':'Drop signal';
 clearTimeout(tm);
 if(v){say('Reconnecting. Typing is held for 20 s.');tm=setTimeout(()=>setDown(false),4200)}else say('Resumed · 0 bytes lost',2200);
 paint();draw();stat();
}
$('#bd').onclick=()=>setDown(!down);
$('#bl').onclick=()=>{shut=!shut;mac.classList.toggle('shut',shut);$('#bl').textContent=shut?'Open the lid':'Close the lid';stat();if(shut)say('Lid closed. Sessions still alive.',2600)};
async function demo(){for(;;)for(const s of SC){out='';name(s.n);draw();
 for(const l of s.l){if(/^[$>]/.test(l)){for(const c of l){out+=c;draw();await sleep(30+Math.random()*32)}out+='\n'}else{await sleep(420);out+=l+'\n'}draw();await sleep(260)}
 await sleep(2600)}}
if(reduce){out=SC[0].l.join('\n');draw();cs.forEach(c=>c.className='tr')}
else{demo();setInterval(()=>{if(!down){h=(h+1)%12;paint()}},90);
 setInterval(()=>{echo=31+Math.round(Math.random()*14);if(!down){$('#re').textContent=echo+' ms';$('#m1').textContent=echo+' ms';stat()}},1200)}

/* Bento */
const st=$('#strip');for(let i=0;i<96;i++){const c=document.createElement('i');c.style.setProperty('--k',i);if(i>=38&&i<48)c.className='bad';st.append(c)}
let t=300;const cd=$('#cd'),f=()=>cd.textContent=Math.floor(t/60)+':'+String(t%60).padStart(2,'0');
if(!reduce)setInterval(()=>{t=t<=0?300:t-1;f()},1000);
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.15});
document.querySelectorAll('.rv').forEach(el=>io.observe(el));
$('#cp').onclick=async()=>{const b=$('#cp');try{await navigator.clipboard.writeText($('#cmd').textContent);b.textContent='Copied'}catch(e){b.textContent='Select it'}setTimeout(()=>b.textContent='Copy',1800)};

/* Inertial scrolling for wheels and trackpads. Touch keeps native momentum. */
if(!reduce&&matchMedia('(pointer:fine)').matches){
 let y=scrollY,to=y,raf=0;
 const max=()=>document.documentElement.scrollHeight-innerHeight;
 const tick=()=>{y+=(to-y)*.085;if(Math.abs(to-y)<.4){y=to;raf=0}else raf=requestAnimationFrame(tick);scrollTo({top:y,behavior:'instant'})};
 addEventListener('wheel',e=>{if(e.ctrlKey||e.defaultPrevented)return;e.preventDefault();to=Math.max(0,Math.min(max(),to+e.deltaY*(e.deltaMode?32:1)));if(!raf)raf=requestAnimationFrame(tick)},{passive:false});
 addEventListener('scroll',()=>{if(!raf)y=to=scrollY},{passive:true});
}
})();