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
const axes=()=>({x:{grid:{display:false},ticks:{color:css('--mut'),maxTicksLimit:10,callback(v){return fmtD(this.getLabelForValue(v))}}},
  y:{grid:{color:css('--line'),borderDash:[4,4]},ticks:{color:css('--mut'),callback:v=>(S.cur==='LKR'?'':'$')+Intl.NumberFormat('en',{notation:'compact'}).format(v)}}});

/* ---------- navigation & theme ---------- */
function go(v){
  $$('.view').forEach(e=>e.classList.toggle('on',e.id==='v-'+v));
  $$('.nav[data-v]').forEach(e=>e.classList.toggle('on',e.dataset.v===v));
  $('#title').textContent=v;location.hash=v;
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
async function loadChart(){
  const d=await api('/api/portfolio/history?days='+$('#range').value+'&currency='+S.cur);
  $('#chartEmpty').hidden=d.length>0;
  if(pChart){pChart.destroy();pChart=null}
  if(!d.length){$('#cval').innerHTML=big(0);return}
  const f=d[0].value,l=d[d.length-1].value;
  $('#cval').innerHTML=big(l)+(f?badge((l/f-1)*100):'');
  pChart=new Chart($('#pChart'),{type:'line',data:{labels:d.map(x=>x.date),datasets:[
    {label:'Value',data:d.map(x=>x.value),borderColor:'#8b5cf6',borderWidth:2.5,tension:.4,pointRadius:0,pointHoverRadius:6,pointHoverBackgroundColor:'#e9d5ff',fill:true,backgroundColor:c=>grad(c,'rgba(139,92,246,.4)')},
    {label:'Invested',data:d.map(x=>x.cost),borderColor:'#f472b6',borderWidth:1.8,tension:.4,pointRadius:0,pointHoverRadius:4}]},
   options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
    plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>fmtD(i[0].label,1),label:c=>{const p=c.dataIndex?c.dataset.data[c.dataIndex-1]:0;return ` ${c.dataset.label}: ${csym()}${num(c.parsed.y)}${p?' ('+pct((c.parsed.y/p-1)*100)+')':''}`}}}},scales:axes()},plugins:[cross]});
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


function parseTable(text){
  let lines=text.trim().split(/\r?\n/).filter(l=>l.trim());
  const hi=lines.findIndex(l=>/symbol|security|code|counter|stock/i.test(l)&&/qty|quantity|shares|units|holding|balance/i.test(l));
  if(hi>0)lines=lines.slice(hi);   // skip title rows above the header (ATrad exports have one)
  if(lines.length<2)return{rows:[],err:'Include the header row and at least one share.'};
  const d=lines[0].includes('\t')?'\t':lines[0].includes(';')?';':',';
  const split=l=>(d===','?l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/):l.split(d)).map(x=>x.trim().replace(/^"|"$/g,''));
  const head=split(lines[0]).map(x=>x.toLowerCase());
  const f=re=>head.findIndex(x=>re.test(x));
  const iS=f(/symbol|security|code|counter|stock|company/),iQ=f(/qty|quantity|shares|holding|balance|units/);
  let iP=f(/avg|average/);if(iP<0)iP=f(/buy.*price|purchase|cost.*(price|share)|price/);
  const iD=f(/date/);
  if(iS<0||iQ<0||iP<0)return{rows:[],err:`Couldn't find these columns: ${[iS<0&&'symbol',iQ<0&&'quantity',iP<0&&'average price'].filter(Boolean).join(', ')}. Found: ${head.join(', ')}`};
  const num=v=>parseFloat(String(v??'').replace(/[^0-9.\-]/g,''));
  const dt=v=>{v=(v||'').trim();if(/^\d{4}-\d{2}-\d{2}/.test(v))return v.slice(0,10);const m=v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:null};
  const rows=[];
  for(const l of lines.slice(1)){const c=split(l);const symbol=(c[iS]||'').toUpperCase().replace(/\s+/g,'');const shares=num(c[iQ]),buy_price=num(c[iP]);
    if(symbol&&!/^total/i.test(symbol)&&shares>0&&buy_price>0)rows.push({symbol,shares,buy_price,buy_date:iD>=0?dt(c[iD]):null})}
  return{rows,err:rows.length?'':'No valid rows found (need symbol, quantity > 0 and price > 0).'};
}
let impRows=[];
function previewImport(){
  $('#imp-err').textContent='';$('#imp-out').innerHTML='';
  const r=parseTable($('#imp-text').value);
  if(r.err){$('#imp-err').textContent=r.err;return}
  impRows=r.rows;
  $('#imp-out').innerHTML=`<table><tr><th>Symbol</th><th>Shares</th><th>Avg price</th><th>Date</th></tr>${impRows.map(x=>`<tr><td>${esc(x.symbol)}</td><td>${x.shares}</td><td>${x.buy_price}</td><td>${x.buy_date||'<span class="mut">default</span>'}</td></tr>`).join('')}</table>
   <button class="btn" id="imp-go" style="margin-top:14px">Import ${impRows.length} holding${impRows.length>1?'s':''}</button>`;
  $('#imp-go').onclick=runImport;
}
async function runImport(){
  const b=$('#imp-go');b.disabled=true;b.textContent='Importing…';$('#imp-err').textContent='';
  try{
    const d=await api('/api/holdings/import',{method:'POST',body:{rows:impRows,default_date:$('#imp-date').value,replace:$('#imp-rep').checked,cse:$('#imp-cse').checked}});
    $('#imp-out').innerHTML=`<div class="up">Imported ${d.added} holding${d.added===1?'':'s'}.</div>`+(d.failed.length?`<div class="down" style="margin-top:8px">Skipped: ${d.failed.map(x=>esc(x.symbol)+' ('+esc(x.error)+')').join('; ')}</div>`:'');
    $('#imp-text').value='';await refresh();
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
  });
  $$('.theme button').forEach(b=>b.onclick=()=>setTheme(b.dataset.t));
  $('#range').onchange=loadChart;
  $('#cur').onchange=e=>{S.pick=e.target.value;refresh()};
  $('#bell').onclick=()=>$('#notifs').hidden=!$('#notifs').hidden;
  $('#logout').onclick=async()=>{await api('/api/logout',{method:'POST'}).catch(()=>{});location.href='/login'};
  $('#tryai').onclick=()=>analyze(S.h[0]?.symbol||'AAPL',isCse(S.h[0]?.symbol));
  $('#a-dt').max=new Date().toISOString().slice(0,10);$('#a-dt').value=$('#a-dt').max;
  $('#a-go').onclick=()=>post('/api/holdings',{symbol:$('#a-sym').value,shares:+$('#a-sh').value,buy_price:+$('#a-px').value,buy_date:$('#a-dt').value||null,cse:$('#a-cse').checked},$('#a-err'),async()=>{['#a-sym','#a-sh','#a-px'].forEach(s=>$(s).value='');await refresh()});
  $('#w-go').onclick=()=>post('/api/watchlist',{symbol:$('#w-sym').value,cse:$('#w-cse').checked},$('#w-err'),async()=>{$('#w-sym').value='';await loadWatch();notifs()});
  $('#m-h').oninput=e=>$('#m-hv').textContent=e.target.value;
  $('#m-go').onclick=()=>analyze();
  $('#m-sym').onkeydown=e=>{if(e.key==='Enter')analyze()};
  $('#m-watch').onclick=()=>post('/api/watchlist',{symbol:S.fc.symbol.replace(/\.CSE$/,''),cse:isCse(S.fc.symbol)},$('#m-err'),async()=>{await loadWatch();notifs()});
  $('#m-asset').onclick=()=>{go('assets');$('#a-sym').value=S.fc.symbol.replace(/\.CSE$/,'');$('#a-cse').checked=isCse(S.fc.symbol);$('#a-px').value=S.fc.outlook.last;$('#a-sh').focus()};
  $('#imp-prev').onclick=previewImport;
  $('#pf-go').onclick=runPortfolioForecast;
  $('#imp-date').max=new Date().toISOString().slice(0,10);$('#imp-date').value=new Date(Date.now()-365*864e5).toISOString().slice(0,10);
  $('#imp-file').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();
    if(/\.xlsx?$/i.test(f.name)){
      r.onload=()=>{try{const wb=XLSX.read(r.result,{type:'array'});$('#imp-text').value=XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]],{FS:'\t'});previewImport()}catch{$('#imp-err').textContent='Could not read that Excel file.'}};
      r.readAsArrayBuffer(f);
    }else{r.onload=()=>{$('#imp-text').value=r.result;previewImport()};r.readAsText(f)}};
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
