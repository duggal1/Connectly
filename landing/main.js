(()=>{
const $=s=>document.querySelector(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.add('js');
const S=["$ cd ~/Projects/api","$ claude","✻ Running the test suite…","  ✓ auth    12 passed","  ✓ sync    30 passed","$ git push origin main","  → pushed 3 commits"];
let out='',snap='',down=false,shut=false,tm;
const mt=$('#mt'),pt=$('#pt'),lk=$('#lk'),mac=$('#mac');
const fmt=s=>s.split('\n').slice(-16).join('\n').replace(/(^|\n)\$/g,'$1<span class="pr">$</span>');
const draw=()=>{mt.innerHTML=fmt(out);pt.innerHTML=fmt(down?snap:out)};
for(let i=0;i<12;i++)lk.append(document.createElement('i'));
const cs=[...lk.children];let h=0;
const paint=()=>cs.forEach((c,i)=>{c.className=down?(i==5||i==6?'bad':''):(i==h?'on':i==(h+11)%12?'tr':'')});
const say=(t,ms)=>{const p=$('#pn');p.textContent=t;p.classList.add('show');clearTimeout(say.t);if(ms)say.t=setTimeout(()=>p.classList.remove('show'),ms)};
const stat=()=>{$('#pst').textContent='Mac 86%, lid '+(shut?'closed':'open')+(down?'':' · echo '+echo+' ms');$('#rm').textContent=shut?'Closed':'Open'};
let echo=38;
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
$('#bl').onclick=()=>{shut=!shut;mac.classList.toggle('shut',shut);$('#bl').textContent=shut?'Open the lid':'Close the lid';stat();if(shut)say('Lid closed. Sessions still alive.',2400)};
async function demo(){for(;;){out='';draw();for(const l of S){if(l[0]=='$'){for(const c of l){out+=c;draw();await sleep(32+Math.random()*34)}out+='\n'}else{await sleep(380);out+=l+'\n'}draw();await sleep(240)}await sleep(3200)}}
if(reduce){out=S.join('\n');draw();cs.forEach(c=>c.className='tr')}
else{demo();setInterval(()=>{if(!down){h=(h+1)%12;paint()}},90);
 setInterval(()=>{echo=31+Math.round(Math.random()*14);if(!down){$('#re').textContent=echo+' ms';$('#m1').textContent=echo+' ms';stat()}},1200)}
// bento
const st=$('#strip');for(let i=0;i<96;i++){const c=document.createElement('i');c.style.setProperty('--k',i);if(i>=38&&i<48)c.className='bad';st.append(c)}
let t=300;const cd=$('#cd'),f=()=>cd.textContent=Math.floor(t/60)+':'+String(t%60).padStart(2,'0');
if(!reduce)setInterval(()=>{t=t<=0?300:t-1;f()},1000);
// reveal
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.15});
document.querySelectorAll('.rv').forEach(el=>io.observe(el));
// copy
$('#cp').onclick=async()=>{const b=$('#cp');try{await navigator.clipboard.writeText($('#cmd').textContent);b.textContent='Copied'}catch(e){b.textContent='Select it'}setTimeout(()=>b.textContent='Copy',1800)};
})();