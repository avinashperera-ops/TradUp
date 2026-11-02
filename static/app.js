const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const S={user:null,h:[],sum:null,w:[],fc:null,cur:'USD',pick:null};
let pChart,fChart,searchT;
const isCse=s=>/\.(CSE|LK|CM)$/.test(s||'');
const num=(v,d=2)=>Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const money=(v,sym)=>(v<0?'-':'')+(isCse(sym)?'LKR ':'$')+num(Math.abs(v));
const pct=v=>(v>=0?'+':'')+Number(v).toFixed(2)+'%';
const cls=v=>v>=0?'up':'down';
const badge=v=>`<span class="badge ${v>=0?'':'down'}">${pct(v)}</span>`;
const big=v=>{const p=Math.abs(v).toFixed(2).split('.');const pre=S.cur==='LKR'?'<span class="cur">LKR</span> ':'$';return `<span>${v<0?'-':''}${pre}${Number(p[0]).toLocaleString('en-US')}<span class="dim">.${p[1]}</span></span>`};
const csym=()=>S.cur==='LKR'?'LKR ':'$';
const fmtD=(s,full)=>new Date(s+'T00:00:00').toLocaleDateString('en-US',full?{month:'short',day:'numeric',year:'numeric'}:{month:'short',day:'2-digit'});
const css=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
async function api(p,o={}){
  const r=await fetch(p,{credentials:'same-origin',method:o.method||'GET',headers:{'Content-Type':'application/json'},body:o.body?JSON.stringify(o.body):undefined});
  if(r.status===401){location.href='/login';throw new Error('auth')}
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(typeof d.detail==='string'?d.detail:'Please check your input');
  return d;
}
const cross={id:'cross',afterDraw(c){const a=c.tooltip?.getActiveElements?.();if(a&&a.length){const x=a[0].element.x,{top,bottom}=c.chartArea,g=c.ctx;g.save();g.strokeStyle='rgba(167,139,250,.5)';g.beginPath();g.moveTo(x,top);g.lineTo(x,bottom);g.stroke();g.restore()}}};
const grad=(c,col)=>{const a=c.chart.chartArea;if(!a)return null;const g=c.chart.ctx.createLinearGradient(0,a.top,0,a.bottom);g.addColorStop(0,col);g.addColorStop(1,'rgba(139,92,246,0)');return g};
const narrow=()=>window.innerWidth<600;
const axes=()=>({x:{grid:{display:false},ticks:{color:css('--mut'),maxTicksLimit:narrow()?5:10,callback(v){return fmtD(this.getLabelForValue(v))}}},
  y:{grid:{color:css('--line'),borderDash:[4,4]},ticks:{color:css('--mut'),callback:v=>(S.cur==='LKR'?'':'$')+Intl.NumberFormat('en',{notation:'compact'}).format(v)}}});

/* ---------- navigation & theme ---------- */
function go(v){
  $$('.view').forEach(e=>e.classList.toggle('on',e.id==='v-'+v));
  $$('.nav[data-v]').forEach(e=>e.classList.toggle('on',e.dataset.v===v));
  $('#title').textContent=v;location.hash=v;window.scrollTo(0,0);
  if(v==='market'&&!$('#overview').children.length)loadOverview();
}
function setTheme(t){document.documentElement.dataset.theme=t;localStorage.setItem('theme',t);
  $$('.theme button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
  if(S.user){loadChart();if(S.fc)drawForecast()}}

/* ---------- data loading ---------- */
async function loadHoldings(){
  const d=await api('/api/holdings'+(S.pick?'?currency='+S.pick:''));S.h=d.holdings;S.sum=d.summary;
  const s=S.sum;S.cur=s.currency;
  const cs=$('#cur');cs.hidden=s.currencies.length<2;cs.innerHTML=s.currencies.map(c=>`<option ${c===S.cur?'selected':''}>${c}</option>`).join('');
  $('#s1').innerHTML=big(s.value);
  $('#s2').innerHTML=`<span class="${cls(s.day)}">${big(s.day)}</span> ${badge(s.day_pct)}`;
  $('#s3').innerHTML=`<span class="${cls(s.pl)}">${big(s.pl)}</span> ${badge(s.pl_pct)}`;
  $('#inv').innerHTML=big(s.cost)+(s.cost?' '+badge(s.pl_pct):'');
  const top=S.h.filter(h=>h.currency===S.cur).sort((a,b)=>b.value-a.value).slice(0,4);
  $('#invlist').innerHTML=top.length?top.map(h=>`<div class="li"><span>${esc(h.name)}</span><span><span class="mut sm">${money(h.value,h.symbol)}</span> <span class="${cls(h.pl_pct)}">${h.pl_pct>=0?'↑':'↓'} ${Math.abs(h.pl_pct).toFixed(1)}%</span></span></div>`).join(''):'<div class="mut sm">Your top holdings will appear here.</div>';
  $('#positions').innerHTML=S.h.length?S.h.slice(0,6).map(h=>`<div class="pos"><div class="ava">${esc(h.symbol.slice(0,2))}</div><div class="nm"><b>${esc(h.name)}</b><span class="mut sm">${esc(h.sector)}</span></div><div class="r"><b>${money(h.value,h.symbol)}</b><span class="sm ${cls(h.pl_pct)}">${pct(h.pl_pct)}</span></div></div>`).join(''):'<div class="empty">No positions yet.</div>';
  const c=$('#cnt');c.hidden=!S.h.length;c.textContent=S.h.length;
  $('#assetsTable').innerHTML=S.h.length?`<table><tr><th>Asset</th><th>Shares</th><th>Buy price</th><th>Price</th><th>Value</th><th>P/L</th><th>Bought</th><th></th></tr>${S.h.map(h=>`<tr><td><b>${esc(h.symbol)}</b><div class="mut xs">${esc(h.name)}</div></td><td>${num(h.shares,4).replace(/\.?0+$/,'')}</td><td>${money(h.buy_price,h.symbol)}</td><td>${money(h.price,h.symbol)}</td><td>${money(h.value,h.symbol)}</td><td class="${cls(h.pl)}">${money(h.pl,h.symbol)} (${pct(h.pl_pct)})</td><td>${fmtD(h.buy_date,1)}</td><td><button class="mut" data-del="${h.id}">✕</button></td></tr>`).join('')}</table>`:'<div class="empty">You haven\'t added any assets yet.</div>';
}
async function loadWatch(){
  S.w=await api('/api/watchlist');
  const card=(w,rm)=>`<div class="scard">${rm?`<button class="x" data-wdel="${w.id}" title="Remove">✕</button>`:''}<div><b>${esc(w.name)}</b><div class="mut sm">${w.start===w.end?'Today':fmtD(w.start)+' – '+fmtD(w.end)}</div></div><div class="row"><div><b>${money(w.price,w.symbol)}</b><div class="mut xs">${money(w.price_then,w.symbol)}</div></div>${badge(w.change_pct)}</div><button class="mut xs" style="text-align:left" data-an="${esc(w.symbol)}">${esc(w.symbol)} · Analyze →</button></div>`;
  $('#top4').innerHTML=S.w.length?S.w.slice(0,4).map(w=>card(w)).join(''):'<div class="card empty" style="grid-column:1/-1">Add tickers to your watchlist to track 30-day performance here.</div>';
  $('#wGrid').innerHTML=S.w.length?S.w.map(w=>card(w,1)).join(''):'<div class="card empty" style="grid-column:1/-1">Your watchlist is empty.</div>';
}
/* TradUp hero chart: glow line, gradient area, crosshair + triangle + pill, glowing point, bold active label */
const tradPlugin={
  id:'trad',
  beforeDatasetDraw(c,a){if(a.index===1){c.ctx.save();c.ctx.shadowColor='rgba(167,139,250,.95)';c.ctx.shadowBlur=22}},
  afterDatasetDraw(c,a){if(a.index===1)c.ctx.restore()},
  afterEvent(c,args){
    const e=args.event;let idx=c._idx??null;
    if(e.type==='mouseout')idx=null;
    else if(['mousemove','touchmove','touchstart','click'].includes(e.type)){
      const a=c.chartArea;
      if(e.x>=a.left&&e.x<=a.right&&e.y>=a.top-34&&e.y<=a.bottom+30){
        idx=Math.max(0,Math.min(c.data.labels.length-1,Math.round(c.scales.x.getValueForPixel(e.x))));
      }else idx=null;
    }
    if(idx!==(c._idx??null)){c._idx=idx;c._ax=idx==null?null:c.scales.x.getPixelForValue(idx);if(c._onIdx)c._onIdx(idx);c.update('none')}
  },
  afterDatasetsDraw(c){
    if(c._idx==null)return;
    const i=c._idx,ctx=c.ctx,a=c.chartArea,pt=c.getDatasetMeta(1).data[i];if(!pt)return;
    const x=pt.x,y=pt.y,vals=c.data.datasets[1].data;
    ctx.save();
    const g=ctx.createLinearGradient(0,a.top-26,0,a.bottom);g.addColorStop(0,'rgba(255,255,255,.95)');g.addColorStop(1,'rgba(255,255,255,.1)');
    ctx.strokeStyle=g;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,a.top-18);ctx.lineTo(x,a.bottom);ctx.stroke();
    const rg=ctx.createRadialGradient(x,y,0,x,y,28);rg.addColorStop(0,'rgba(244,114,255,.7)');rg.addColorStop(1,'rgba(168,85,247,0)');
    ctx.fillStyle=rg;ctx.beginPath();ctx.arc(x,y,28,0,Math.PI*2);ctx.fill();
    ctx.shadowColor='#e879f9';ctx.shadowBlur=16;ctx.fillStyle='#f5d0fe';ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();
    ctx.shadowBlur=0;
    ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(x-7,a.top-31);ctx.lineTo(x+7,a.top-31);ctx.lineTo(x,a.top-18);ctx.closePath();ctx.fill();
    const ch=i>0&&vals[i-1]?(vals[i]/vals[i-1]-1)*100:0,txt=(ch>=0?'+':'')+ch.toFixed(1)+'%';
    ctx.font='600 14px Inter,-apple-system,sans-serif';
    const w=ctx.measureText(txt).width+34,h=34,px=x-w/2,py=a.top-12,r=h/2;
    ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(px+r,py);ctx.arcTo(px+w,py,px+w,py+h,r);ctx.arcTo(px+w,py+h,px,py+h,r);ctx.arcTo(px,py+h,px,py,r);ctx.arcTo(px,py,px+w,py,r);ctx.closePath();ctx.fill();
    ctx.fillStyle='#14102b';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(txt,x,py+h/2+1);
    ctx.font='700 12px Inter,-apple-system,sans-serif';ctx.fillStyle=css('--text');
    ctx.fillText(fmtD(c.data.labels[i]),x,c.scales.x.top+13);
    ctx.restore();
  }
};
async function loadChart(){
  const d=await api('/api/portfolio/history?days='+$('#range').value+'&currency='+S.cur);
  $('#chartEmpty').hidden=d.length>0;
  if(pChart){pChart.destroy();pChart=null}
  if(!d.length){$('#cval').innerHTML=big(0);return}
  const vals=d.map(x=>x.value),costs=d.map(x=>x.cost);
  const avg=vals.map((_,i)=>{const s=vals.slice(Math.max(0,i-6),i+1);return s.reduce((p,q)=>p+q,0)/s.length});
  const first=vals[0],last=vals[vals.length-1];
  const head=i=>{const v=i==null?last:vals[i];$('#cval').innerHTML=big(v)+(first?badge((v/first-1)*100):'')};
  head(null);
  const area=(c,top,bot)=>{const a=c.chart.chartArea;if(!a)return null;const g=c.chart.ctx.createLinearGradient(0,a.top,0,a.bottom);g.addColorStop(0,top);g.addColorStop(1,bot);return g};
  const base={pointRadius:0,pointHoverRadius:0,cubicInterpolationMode:'monotone',tension:.4};
  pChart=new Chart($('#pChart'),{type:'line',data:{labels:d.map(x=>x.date),datasets:[
    {...base,label:'area',data:vals,borderWidth:0,fill:true,backgroundColor:c=>area(c,'rgba(139,92,246,.42)','rgba(91,33,182,0)')},
    {...base,label:'Total value',data:vals,borderColor:'#b9a5ff',borderWidth:4,fill:false},
    {...base,label:'7-day average',data:avg,borderColor:'#6366f1',borderWidth:1.8,fill:true,backgroundColor:c=>area(c,'rgba(79,70,229,.16)','rgba(79,70,229,0)')},
    {...base,label:'Invested',data:costs,borderColor:'#d58bc5',borderWidth:1.6,fill:false}]},
   options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:36}},animation:{duration:600},
    plugins:{legend:{display:false},tooltip:{enabled:false}},
    scales:{
     x:{grid:{display:false},border:{display:false},ticks:{maxTicksLimit:narrow()?5:10,maxRotation:0,font:{size:12},
        color:c=>{const ch=c.chart;if(ch._ax==null||c.index==null)return css('--mut');return Math.abs(ch.scales.x.getPixelForValue(c.index)-ch._ax)<46?'transparent':css('--mut')},
        callback(v){return fmtD(this.getLabelForValue(v))}}},
     y:{grace:'8%',grid:{color:css('--line'),borderDash:[5,5],drawTicks:false},border:{display:false},
        ticks:{color:css('--mut'),font:{size:12},padding:12,maxTicksLimit:narrow()?6:8,callback:v=>Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(v)}}}},
   plugins:[tradPlugin]});
  pChart._onIdx=head;
}
async function loadOverview(){
  try{const d=await api('/api/market/overview');
   $('#overview').innerHTML=d.map(x=>`<div class="card"><div class="mut sm">${esc(x.name)}</div><div style="font-size:22px;font-weight:600;margin:8px 0">${num(x.price)}</div>${badge(x.change_pct)}</div>`).join('')||'<div class="mut">Market overview unavailable right now.</div>'}catch{}
}
function notifs(){
  const m=new Map();[...S.h,...S.w].forEach(x=>{if(Math.abs(x.day_change_pct)>=2)m.set(x.symbol,x.day_change_pct)});
  $('#bell').classList.toggle('dot',m.size>0);
  $('#notifs').innerHTML=m.size?[...m].map(([s,c])=>`<button data-an="${esc(s)}"><b>${esc(s)}</b><span class="${cls(c)}">${pct(c)} today</span></button>`).join(''):'<div class="mut sm" style="padding:12px">No big moves (±2%) in your assets today.</div>';
}
async function refresh(){await Promise.all([loadHoldings(),loadWatch()]);notifs();loadChart()}

/* ---------- forecast / market ---------- */
function drawForecast(){
  const d=S.fc,H=d.history,F=d.forecast,n=H.length;
  const labels=[...H.map(x=>x.date),...F.map(x=>x.date)],pad=a=>[...Array(n).fill(null),...a];
  const line=[...H.map(x=>x.close)];
  const fc=[...Array(n-1).fill(null),H[n-1].close,...F.map(x=>x.yhat)];
  const up=pad(F.map(x=>x.upper)),lo=pad(F.map(x=>x.lower));
  if(fChart)fChart.destroy();
  fChart=new Chart($('#fChart'),{type:'line',data:{labels,datasets:[
   {label:'Historical',data:line,borderColor:'#8b5cf6',borderWidth:2.5,tension:.3,pointRadius:0},
   {label:'AI Forecast',data:fc,borderColor:'#38bdf8',borderWidth:2.5,borderDash:[5,5],tension:.3,pointRadius:0},
   {label:'Upper',data:up,borderColor:'transparent',pointRadius:0,fill:false},
   {label:'Lower',data:lo,borderColor:'transparent',pointRadius:0,fill:'-1',backgroundColor:'rgba(139,92,246,.14)'}]},
   options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},spanGaps:false,
    plugins:{legend:{labels:{color:css('--mut'),filter:i=>!['Upper','Lower'].includes(i.text)}},tooltip:{filter:i=>!['Upper','Lower'].includes(i.dataset.label),callbacks:{title:i=>fmtD(i[0].label,1)}}},scales:axes()},plugins:[cross]});
}
async function analyze(sym,cse){
  go('market');
  if(sym)$('#m-sym').value=sym;
  if(typeof cse==='boolean')$('#m-cse').checked=cse;
  const btn=$('#m-go');btn.disabled=true;btn.textContent='Running…';$('#m-err').textContent='';
  try{
    const d=await api(`/api/forecast?symbol=${encodeURIComponent($('#m-sym').value.trim())}&days=${$('#m-h').value}&cse=${$('#m-cse').checked}`);
    S.fc=d;$('#m-out').hidden=false;$('#m-title').textContent='Market Intelligence: '+d.symbol;
    const o=d.outlook,lab={1:'BUY',[-1]:'SELL',0:'HOLD'}[o.signal],cl=o.signal>0?'b':o.signal<0?'s':'h';
    $('#m-outlook').innerHTML=`<div><span class="mut xs">Latest close</span><b>${money(o.last,d.symbol)}</b></div><div><span class="mut xs">Signal</span><b><span class="sigpill ${cl}">${lab}</span></b></div><div><span class="mut xs">Expected by horizon</span><b class="${cls(o.expected_pct)}">${pct(o.expected_pct)}</b></div><div><span class="mut xs">95% range</span><b>${num(o.range_low)} – ${num(o.range_high)}</b></div>`;
    $('#m-sig').innerHTML=`<table><tr><th>Timestamp</th><th>Projected price</th><th>SMA 20</th><th>SMA 50</th><th>Signal</th></tr>${d.forecast.slice(-5).map(r=>`<tr><td>${fmtD(r.date,1)}</td><td>${num(r.yhat)}</td><td>${num(r.sma20)}</td><td>${num(r.sma50)}</td><td><span class="sigpill ${r.signal>0?'b':r.signal<0?'s':'h'}">${{1:'BUY','-1':'SELL',0:'HOLD'}[r.signal]}</span></td></tr>`).join('')}</table>`;
    drawForecast();
  }catch(e){$('#m-err').textContent=e.message}
  btn.disabled=false;btn.textContent='Run live analysis';
}
function csv(name,rows){
  if(!rows.length)return;const k=Object.keys(rows[0]);
  const t=[k.join(','),...rows.map(r=>k.map(c=>r[c]).join(','))].join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t],{type:'text/csv'}));a.download=name;a.click();
}


/*PURE-START*/
function okDate(y,m,d){return(m>=1&&m<=12&&d>=1&&d<=31&&y>1990&&y<2100)?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null}
function cellNorm(v){if(v instanceof Date){return isNaN(v)?'':new Date(v.getTime()+43200000).toISOString().slice(0,10)}if(v==null)return'';return typeof v==='number'?v:String(v).trim()}
function toNum(v){if(typeof v==='number')return isFinite(v)?v:null;const s=String(v??'').replace(/rs\.?|lkr|usd|\$|₨|,|\s/gi,'');const m=s.match(/^\(?(-?\d+(?:\.\d+)?)\)?$/);if(!m)return null;const x=parseFloat(m[1]);return /^\(/.test(s)?-Math.abs(x):x}
function toDate(v){if(typeof v==='number')return null;const s=String(v??'').trim();let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return okDate(+m[1],+m[2],+m[3]);
  m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);if(m){let a=+m[1],b=+m[2],y=+m[3];if(y<100)y+=2000;let d=a,mo=b;if(a<=12&&b>12){mo=a;d=b}return okDate(y,mo,d)}return null}
const KW={sym:/symbol|ticker|security|scrip|stock|company|counter|instrument|code|name/i,qty:/qty|quantity|shares|units|holding|balance|volume/i,price:/price|cost|avg|average|bought|buy|purchase|rate/i,date:/date|bought on|purchased/i};
function findHeader(g){let best=0,bi=0;for(let i=0;i<Math.min(g.length,40);i++){let s=0;const r=g[i]||[];for(const c of r){const t=typeof c==='string'?c:'';if(!t)continue;if(KW.sym.test(t))s++;if(KW.qty.test(t))s++;if(KW.price.test(t))s++;if(KW.date.test(t))s++}
  if(r.filter(c=>typeof c==='string'&&c).length>=3)s+=1;if(s>best){best=s;bi=i}}return bi}
function colStats(rows,ci){let n=0,num=0,int=0,date=0,tick=0;for(const r of rows){const v=r[ci];if(v===''||v==null)continue;n++;const x=toNum(v);if(x!=null){num++;if(Number.isInteger(x))int++}if(toDate(v))date++;
  if(/^[A-Z]{2,6}(\.[A-Z0-9]{1,6})?$/.test(String(v).trim().toUpperCase()))tick++}const k=n||1;return{n,num:num/k,int:int/k,date:date/k,tick:tick/k}}
function autoMap(grid,hdr){
  const head=grid[hdr]||[],width=Math.max(head.length,...grid.slice(hdr,hdr+60).map(r=>r.length),0);
  const rows=grid.slice(hdr+1,hdr+201).filter(r=>r.filter(c=>c!=='').length>=2);
  const cols=[];for(let ci=0;ci<width;ci++)cols.push({ci,t:String(head[ci]??'').toLowerCase(),st:colStats(rows,ci)});
  const symS=c=>{let s=0;if(/symbol|ticker|security|scrip|instrument|counter/.test(c.t))s+=8;else if(/company|stock|code|name/.test(c.t))s+=5;s+=c.st.tick*10;if(c.st.num>.5)s-=20;if(c.st.date>.5)s-=20;if(!c.st.n)s-=50;return s};
  const qtyS=c=>{const t=c.t.trim();let s=0;if(/^(qty|quantity|shares|units|no\.? of shares|number of shares|no\.? of units)$/.test(t))s+=12;else if(/qty|quantity|shares|units/.test(t))s+=8;else if(/holding|balance|volume/.test(t))s+=3;
    if(/%|price|value|cost|amount|gain|loss|change|unsettled|available|cleared/.test(t))s-=10;if(c.st.num<.5)s-=30;else s+=4+(c.st.int>.8?3:0);return s};
  const prS=c=>{const t=c.t;let s=0;if(/bought|buy(ing)?\s*price|avg|average|purchase|entry|acquisition|cost\s*price|unit\s*cost|price\s*paid/.test(t))s+=10;else if(/price|rate/.test(t))s+=3;else if(/cost/.test(t))s+=2;
    if(/mkt|market|current|last|ltp|close|traded|today|b\.?e\.?s|break|total|value|portfolio|%|gain|loss|change|commission|proceeds/.test(t))s-=12;if(c.st.num<.8)s-=30;else s+=3;return s};
  const coS=c=>{const t=c.t;let s=0;if(/total cost|invested|book (value|cost)|cost basis|purchase value|buy value|portfolio|amount invested|^amount$/.test(t))s+=8;if(/mkt|market|current|gain|loss|change|%|price|traded/.test(t))s-=12;if(c.st.num<.8)s-=30;return s};
  const dS=c=>{let s=0;if(/date|bought on|purchased on/.test(c.t))s+=8;if(c.st.date>.5)s+=8;else s-=30;return s};
  const used=new Set(),pick=(fn,min)=>{let b=-1,bs=min;for(const c of cols){if(used.has(c.ci))continue;const s=fn(c);if(s>bs){bs=s;b=c.ci}}if(b>=0)used.add(b);return b};
  const sym=pick(symS,3),qty=pick(qtyS,4),price=pick(prS,4),cost=price<0?pick(coS,3):-1,date=pick(dS,6);
  return{sym,qty,price,cost,date};
}
function buildRows(grid,hdr,map){
  const out=[];if(map.sym<0||map.qty<0)return out;
  for(let i=hdr+1;i<grid.length;i++){const r=grid[i];
    const sym=String(r[map.sym]??'').trim().toUpperCase();if(!sym||/^(TOTAL|SUM|GRAND)/.test(sym))continue;
    const q=toNum(r[map.qty]);if(!(q>0))continue;
    let p=map.price>=0?toNum(r[map.price]):null;
    if(!(p>0)&&map.cost>=0){const c=toNum(r[map.cost]);if(c>0)p=c/q}
    if(!(p>0))continue;
    out.push({symbol:sym.slice(0,80),shares:q,buy_price:+p.toFixed(6),buy_date:map.date>=0?toDate(r[map.date]):null});
  }
  return out;
}
/*PURE-END*/
const IMP={sheets:{},sheet:'',grid:[],hdr:0,map:{sym:-1,qty:-1,price:-1,cost:-1,date:-1},rows:[],items:[],seq:0,t:null};
const colName=i=>{let s='',n=i+1;while(n>0){s=String.fromCharCode(65+(n-1)%26)+s;n=Math.floor((n-1)/26)}return s};
function textToGrid(t){const lines=t.replace(/\r/g,'').split('\n').filter(l=>l.trim());if(!lines.length)return[];
  const d=lines.some(l=>l.includes('\t'))?'\t':lines.some(l=>l.includes(';'))?';':',';
  const sp=l=>(d===','?l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/):l.split(d)).map(x=>cellNorm(x.trim().replace(/^"|"$/g,'')));return lines.map(sp)}
function fillSelects(){
  const g=IMP.grid,head=g[IMP.hdr]||[],w=Math.max(head.length,...g.slice(IMP.hdr,IMP.hdr+60).map(r=>r.length),0);
  const opts=['<option value="-1">— none —</option>'];
  for(let i=0;i<w;i++)opts.push(`<option value="${i}">${colName(i)}: ${esc(String(head[i]||'').slice(0,26)||'(blank)')}</option>`);
  [['sym','#imp-c-sym'],['qty','#imp-c-qty'],['price','#imp-c-price'],['cost','#imp-c-cost'],['date','#imp-c-date']].forEach(([k,id])=>{const el=$(id);el.innerHTML=opts.join('');el.value=IMP.map[k]})
}
function applySheet(name){
  IMP.sheet=name;IMP.grid=IMP.sheets[name]||[];IMP.hdr=findHeader(IMP.grid);IMP.map=autoMap(IMP.grid,IMP.hdr);
  $('#imp-hdr').value=IMP.hdr+1;fillSelects();$('#imp-map').hidden=false;refreshPreview();
}
function loadSheets(sheets){
  IMP.sheets=sheets;const names=Object.keys(sheets);
  let best=names[0],bs=-1;
  for(const n of names){const g=sheets[n],h=findHeader(g),m=autoMap(g,h),sc=(m.sym>=0)+(m.qty>=0)+((m.price>=0||m.cost>=0)?1:0);const rows=buildRows(g,h,m).length;const tot=sc*1000+rows;if(tot>bs){bs=tot;best=n}}
  $('#imp-sheetl').hidden=names.length<2;$('#imp-sheet').innerHTML=names.map(n=>`<option>${esc(n)}</option>`).join('');$('#imp-sheet').value=best;
  applySheet(best);
}
function refreshPreviewNow(){refreshPreview(true)}
function refreshPreview(keep){
  clearTimeout(IMP.t);
  IMP.t=setTimeout(async()=>{
    const seq=++IMP.seq;$('#imp-err').textContent='';
    if(keep!==true)IMP.rows=buildRows(IMP.grid,IMP.hdr,IMP.map).slice(0,200);
    if(!IMP.rows.length){$('#imp-out').innerHTML='<div class="empty">No usable rows with these columns. Choose the right Symbol, Quantity and Buy price columns above (or change the header row).</div>';return}
    $('#imp-out').innerHTML='<div class="mut sm" style="padding:12px">Checking symbols against live market data…</div>';
    try{
      const d=await api('/api/holdings/import',{method:'POST',body:{rows:IMP.rows,default_date:$('#imp-date').value,replace:$('#imp-rep').checked,mode:$('#imp-mode').value,dry_run:true}});
      if(seq!==IMP.seq)return;IMP.items=d.items;renderPreview();
    }catch(e){if(seq===IMP.seq){$('#imp-out').innerHTML='';$('#imp-err').textContent=e.message}}
  },keep===true?0:300);
}
function renderPreview(){
  const ok=IMP.items.filter(i=>!i.error).length,bad=IMP.items.length-ok;
  $('#imp-out').innerHTML=`<table><tr><th>In your file</th><th>Matched</th><th>Shares</th><th>Buy price</th><th>Date</th><th>Price now</th></tr>${IMP.rows.map((r,k)=>{const it=IMP.items[k]||{};
   return `<tr><td>${esc(r.symbol)}</td><td>${it.error?`<span class="down">${esc(it.error)}</span>`:`<b>${esc(it.symbol)}</b>${it.name?`<div class="mut xs">${esc(it.name)}</div>`:''}${it.via==='name'?'<div class="xs up">matched by name</div>':''}`}${it.error?`<div style="margin-top:6px"><input class="pill" data-fix="${k}" placeholder="Type the ticker" style="min-width:0;width:150px;padding:6px 10px;font-size:13px"></div>`:''}</td><td>${r.shares}</td><td>${r.buy_price}</td><td>${r.buy_date||'<span class="mut">default</span>'}</td><td>${it.price!=null?money(it.price,it.symbol):'—'}</td></tr>`}).join('')}</table>
   <div style="margin-top:14px;display:flex;gap:14px;align-items:center;flex-wrap:wrap"><button class="btn" id="imp-go" ${ok?'':'disabled'}>Import ${ok} holding${ok===1?'':'s'}</button>${bad?`<span class="down sm">${bad} row${bad>1?'s':''} can't be matched and will be skipped</span>`:''}</div>`;
  $('#imp-go').onclick=runImport;
  $$('#imp-out [data-fix]').forEach(el=>el.onchange=()=>{const v=el.value.trim();if(v){IMP.rows[+el.dataset.fix].symbol=v.toUpperCase();refreshPreviewNow()}});
}
async function runImport(){
  const b=$('#imp-go');b.disabled=true;b.textContent='Importing…';$('#imp-err').textContent='';
  try{
    const d=await api('/api/holdings/import',{method:'POST',body:{rows:IMP.rows,default_date:$('#imp-date').value,replace:$('#imp-rep').checked,mode:$('#imp-mode').value,dry_run:false}});
    $('#imp-out').innerHTML=`<div class="up">Imported ${d.added} holding${d.added===1?'':'s'}.</div>`+(d.failed.length?`<div class="down" style="margin-top:8px">Skipped: ${d.failed.map(x=>esc(x.symbol)).join(', ')}</div>`:'');
    $('#imp-text').value='';$('#imp-map').hidden=true;await refresh();
  }catch(e){$('#imp-err').textContent=e.message;b.disabled=false;b.textContent='Retry import'}
}
async function runPortfolioForecast(){
  const b=$('#pf-go');b.disabled=true;b.textContent='Running…';$('#pf-err').textContent='';
  try{
    const d=await api('/api/forecast/portfolio?days='+$('#pf-days').value);
    if(!d.items.length){$('#pf-out').innerHTML='<div class="empty">Add holdings first.</div>';return}
    const sg=s=>`<span class="sigpill ${s>0?'b':s<0?'s':'h'}">${s>0?'BUY':s<0?'SELL':'HOLD'}</span>`;
    const row=x=>x.error?`<tr><td><b>${esc(x.symbol)}</b><div class="mut xs">${esc(x.name)}</div></td><td colspan="5" class="mut">${esc(x.error)}</td></tr>`
     :`<tr data-an="${esc(x.symbol)}" style="cursor:pointer"><td><b>${esc(x.symbol)}</b><div class="mut xs">${esc(x.name)}</div></td><td>${money(x.last,x.symbol)}</td><td>${money(x.expected,x.symbol)}</td><td class="${cls(x.expected_pct)}">${pct(x.expected_pct)}</td><td>${num(x.low)} – ${num(x.high)}</td><td>${sg(x.signal)}</td></tr>`;
    const tot=Object.entries(d.totals).map(([c,t])=>{const p=(t.expected/t.value-1)*100,s=c==='LKR'?'LKR ':'$';
      return `<div class="outlook" style="margin:14px 0 0"><div><span class="mut xs">${c} holdings now</span><b>${s}${num(t.value)}</b></div><div><span class="mut xs">Predicted in ${d.days} trading days</span><b class="${cls(p)}">${s}${num(t.expected)} (${pct(p)})</b></div><div><span class="mut xs">95% range</span><b>${s}${num(t.low)} – ${s}${num(t.high)}</b></div></div>`}).join('');
    $('#pf-out').innerHTML=`<table><tr><th>Asset</th><th>Price</th><th>Predicted</th><th>Change</th><th>95% range</th><th>Signal</th></tr>${d.items.map(row).join('')}</table>${tot}<p class="mut xs" style="margin-top:12px">Click a row for the full chart. Currencies are totalled separately. Predictions are statistical estimates, not financial advice.</p>`;
  }catch(e){$('#pf-err').textContent=e.message}
  b.disabled=false;b.textContent='Run predictions';
}

function stackify(root){if(!root)return;root.querySelectorAll('table').forEach(t=>{t.classList.add('stack');const hs=[...t.querySelectorAll('th')].map(x=>x.textContent);
  t.querySelectorAll('tr').forEach(r=>[...r.children].forEach((c,i)=>{if(c.tagName==='TD')c.dataset.label=hs[i]||''}))})}
/* ---------- events ---------- */
async function post(url,body,errEl,done){
  errEl.textContent='';
  try{await api(url,{method:'POST',body});await done()}catch(e){errEl.textContent=e.message}
}
function bind(){
  $$('[data-v]').forEach(b=>b.onclick=()=>go(b.dataset.v));
  document.addEventListener('click',e=>{
    const t=e.target.closest('[data-go],[data-an],[data-del],[data-wdel]');
    if(t){
      if(t.dataset.go)go(t.dataset.go);
      if(t.dataset.an){$('#notifs').hidden=true;analyze(t.dataset.an,isCse(t.dataset.an))}
      if(t.dataset.del&&confirm('Remove this asset?'))api('/api/holdings/'+t.dataset.del,{method:'DELETE'}).then(refresh);
      if(t.dataset.wdel)api('/api/watchlist/'+t.dataset.wdel,{method:'DELETE'}).then(()=>{loadWatch().then(notifs)});
    }
    if(!e.target.closest('.searchbox'))$('#sugg').hidden=true;
    if(!e.target.closest('.pop'))$('#notifs').hidden=true;
    if(!e.target.closest('.user'))$('#umenu').hidden=true;
  });
  $$('.theme button').forEach(b=>b.onclick=()=>setTheme(b.dataset.t));
  $('#range').onchange=loadChart;
  $('#cur').onchange=e=>{S.pick=e.target.value;refresh()};
  $('#bell').onclick=()=>$('#notifs').hidden=!$('#notifs').hidden;
  const out=async()=>{await api('/api/logout',{method:'POST'}).catch(()=>{});location.href='/login'};
  $('#logout').onclick=out;$('#logout2').onclick=out;
  $('#userbtn').onclick=e=>{if(!e.target.closest('#umenu'))$('#umenu').hidden=!$('#umenu').hidden};
  ['#assetsTable','#pf-out','#m-sig','#imp-out'].forEach(s=>new MutationObserver(()=>stackify($(s))).observe($(s),{childList:true}));
  $('#tryai').onclick=()=>analyze(S.h[0]?.symbol||'AAPL',isCse(S.h[0]?.symbol));
  $('#a-dt').max=new Date().toISOString().slice(0,10);$('#a-dt').value=$('#a-dt').max;
  $('#a-go').onclick=()=>post('/api/holdings',{symbol:$('#a-sym').value,shares:+$('#a-sh').value,buy_price:+$('#a-px').value,buy_date:$('#a-dt').value||null,cse:$('#a-cse').checked},$('#a-err'),async()=>{['#a-sym','#a-sh','#a-px'].forEach(s=>$(s).value='');await refresh()});
  $('#w-go').onclick=()=>post('/api/watchlist',{symbol:$('#w-sym').value,cse:$('#w-cse').checked},$('#w-err'),async()=>{$('#w-sym').value='';await loadWatch();notifs()});
  $('#m-h').oninput=e=>$('#m-hv').textContent=e.target.value;
  $('#m-go').onclick=()=>analyze();
  $('#m-sym').onkeydown=e=>{if(e.key==='Enter')analyze()};
  $('#m-watch').onclick=()=>post('/api/watchlist',{symbol:S.fc.symbol.replace(/\.CSE$/,''),cse:isCse(S.fc.symbol)},$('#m-err'),async()=>{await loadWatch();notifs()});
  $('#m-asset').onclick=()=>{go('assets');$('#a-sym').value=S.fc.symbol.replace(/\.CSE$/,'');$('#a-cse').checked=isCse(S.fc.symbol);$('#a-px').value=S.fc.outlook.last;$('#a-sh').focus()};
  $('#pf-go').onclick=runPortfolioForecast;
  $('#imp-date').max=new Date().toISOString().slice(0,10);$('#imp-date').value=new Date(Date.now()-365*864e5).toISOString().slice(0,10);
  $('#imp-prev').onclick=()=>{const g=textToGrid($('#imp-text').value);if(g.length<2){$('#imp-err').textContent='Paste a table with a header row and at least one holding.';return}loadSheets({'Pasted table':g})};
  $('#imp-file').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();$('#imp-err').textContent='';
    if(/\.xlsx?$/i.test(f.name)){
      r.onload=()=>{try{const wb=XLSX.read(r.result,{type:'array',cellDates:true}),sh={};
        wb.SheetNames.forEach(n=>{sh[n]=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:true,defval:''}).map(row=>row.map(cellNorm))});loadSheets(sh)}catch{$('#imp-err').textContent='Could not read that Excel file.'}};
      r.readAsArrayBuffer(f);
    }else{r.onload=()=>{$('#imp-text').value=r.result;loadSheets({[f.name]:textToGrid(r.result)})};r.readAsText(f)}};
  $('#imp-sheet').onchange=e=>applySheet(e.target.value);
  $('#imp-hdr').onchange=e=>{IMP.hdr=Math.max(0,(+e.target.value||1)-1);IMP.map=autoMap(IMP.grid,IMP.hdr);fillSelects();refreshPreview()};
  $('#imp-mode').onchange=refreshPreview;
  [['sym','#imp-c-sym'],['qty','#imp-c-qty'],['price','#imp-c-price'],['cost','#imp-c-cost'],['date','#imp-c-date']].forEach(([k,id])=>$(id).onchange=e=>{IMP.map[k]=+e.target.value;refreshPreview()});
  $('#dl-f').onclick=()=>csv('forecast.csv',S.fc.forecast);
  $('#dl-h').onclick=()=>csv('historical.csv',S.fc.history);
  const si=$('#search');
  si.oninput=()=>{clearTimeout(searchT);const q=si.value.trim();if(q.length<2){$('#sugg').hidden=true;return}
    searchT=setTimeout(async()=>{try{const r=await api('/api/search?q='+encodeURIComponent(q));
      $('#sugg').innerHTML=r.map(x=>`<button data-an="${esc(x.symbol)}"><span><b>${esc(x.symbol)}</b> <span class="mut sm">${esc(x.name)}</span></span><span class="mut xs">${esc(x.exchange)}</span></button>`).join('');$('#sugg').hidden=!r.length}catch{}},300)};
  si.onkeydown=e=>{if(e.key==='Enter'&&si.value.trim()){$('#sugg').hidden=true;analyze(si.value.trim().toUpperCase(),false);si.blur()}};
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();si.focus()}});
}
(async function init(){
  setTheme(localStorage.getItem('theme')||'dark');
  try{S.user=await api('/api/me')}catch{return}
  $('#uname').textContent=S.user.name;$('#uemail').textContent=S.user.email;
  $('#av').innerHTML=S.user.avatar?`<img src="${esc(S.user.avatar)}" referrerpolicy="no-referrer" alt="">`:esc(S.user.name.slice(0,1).toUpperCase());
  bind();
  const v=location.hash.slice(1);if(['assets','market','watchlist'].includes(v))go(v);
  await refresh();
})();
