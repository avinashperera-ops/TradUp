/* TradUp AI Lab - every method in one place. Loaded after app.js (uses its helpers: $, $$, api, esc, num, pct, fmtD, css, csv, stackify, go). */
(() => {
const MODELS = [
  ['rules', 'Technical rules', 'RSI, MACD, MA cross, Bollinger, Stochastic, ADX, OBV', 1],
  ['arima', 'ARIMA / SARIMAX', 'Classic statistical time-series model', 1],
  ['ets', 'Holt-Winters', 'Exponential smoothing with damped trend', 0],
  ['rf', 'Random Forest', 'Machine learning on indicator features', 1],
  ['gb', 'Gradient Boosting', 'XGBoost-style boosted trees + up/down probability', 1],
  ['dl', 'LSTM / GRU', 'Deep learning, trains on your device', 1],
  ['mc', 'Monte Carlo', 'Simulates thousands of price paths for risk', 1]];
const NAME = Object.fromEntries(MODELS.map(m => [m[0], m[1]]));
const COL = { rules: '#f59e0b', arima: '#38bdf8', ets: '#2dd4bf', rf: '#34d399', gb: '#a3e635', dl: '#f472b6', mc: '#94a3b8', ens: '#c084fc' };
// [key, label, default, min, max, step] | [key, label, bool] | [key, label, [options], default]
const GROUPS = [
  ['Signals & consensus', [['sig_days', 'Signal horizon (days)', 5, 1, 30, 1], ['th', 'Buy/Sell threshold (%)', 1.5, .1, 25, .1], ['ens_th', 'Consensus threshold', .25, .05, .9, .05], ['autoW', 'Weight models by their backtest skill', true]]],
  ['Technical rules', [['ma_type', 'Moving average type', ['sma', 'ema'], 'sma'], ['fast', 'Fast MA window', 50, 2, 120, 1], ['slow', 'Slow MA window', 200, 5, 400, 1], ['rsi_n', 'RSI period', 14, 2, 50, 1], ['rsi_ob', 'RSI overbought', 70, 55, 95, 1], ['rsi_os', 'RSI oversold', 30, 5, 45, 1],
    ['macd_f', 'MACD fast', 12, 2, 50, 1], ['macd_s', 'MACD slow', 26, 5, 100, 1], ['macd_g', 'MACD signal', 9, 2, 30, 1], ['bb_n', 'Bollinger window', 20, 5, 100, 1], ['bb_k', 'Bollinger width (std)', 2, .5, 4, .1],
    ['st_ob', 'Stochastic overbought', 80, 60, 95, 1], ['st_os', 'Stochastic oversold', 20, 5, 40, 1], ['adx_min', 'Min ADX for trend', 20, 5, 50, 1], ['vote_th', 'Votes needed (0-1)', .25, .05, .9, .05], ['bt_days', 'Backtest length (days)', 750, 120, 2500, 10]]],
  ['ARIMA / SARIMAX / Holt-Winters', [['ar_auto', 'Auto-select (p,q) by AIC', true], ['ar_p', 'p (lags)', 1, 0, 5, 1], ['ar_d', 'd (differencing)', 1, 0, 2, 1], ['ar_q', 'q (moving avg)', 1, 0, 5, 1], ['ar_seas', 'Seasonal period (0 = off)', 0, 0, 30, 1], ['ar_lookback', 'Training window (days)', 500, 100, 1500, 10], ['ar_drift', 'Add historical drift', false], ['ar_vol', 'Use volume as exogenous (SARIMAX)', false]]],
  ['Random Forest / Gradient Boosting', [['tr_n', 'Trees / boosting rounds', 80, 20, 300, 10], ['tr_depth', 'Tree depth', 5, 2, 12, 1], ['tr_lr', 'Learning rate (boosting)', .05, .01, .3, .01], ['tr_train', 'Lookback window (days)', 500, 120, 2500, 10], ['bt_n', 'Backtest tests', 12, 4, 40, 1]]],
  ['Deep learning (LSTM / GRU)', [['dl_type', 'Network type', ['gru', 'lstm'], 'gru'], ['dl_seq', 'Sequence length (days)', 30, 10, 120, 5], ['dl_units', 'Units', 32, 8, 128, 8], ['dl_drop', 'Dropout', .2, 0, .6, .05], ['dl_epochs', 'Max epochs', 40, 5, 150, 5], ['dl_members', 'Ensemble members', 2, 1, 5, 1], ['dl_lr', 'Learning rate', .004, .0005, .02, .0005]]],
  ['Monte Carlo', [['mc_n', 'Simulated paths', 2000, 200, 5000, 100], ['mc_lookback', 'Return history (days)', 252, 60, 1500, 10], ['mc_drift', 'Drift', ['shrink', 'zero', 'hist'], 'shrink'], ['mc_target', 'Profit target (%)', 10, 1, 100, 1], ['mc_stop', 'Stop loss (%)', 8, 1, 60, 1]]]];
const PRESETS = {
  balanced: {},
  conservative: { th: 3, ens_th: .4, ma_type: 'sma', fast: 50, slow: 200, rsi_ob: 80, rsi_os: 20, vote_th: .4, adx_min: 25 },
  aggressive: { th: .8, ens_th: .15, ma_type: 'ema', fast: 20, slow: 50, rsi_ob: 65, rsi_os: 35, macd_f: 8, macd_s: 17, macd_g: 9, vote_th: .15, adx_min: 15 }};
const AI = { res: {}, hist: null, d: null, ch: {}, tok: 0, ready: false };
const LAB = { 1: 'BUY', '-1': 'SELL', 0: 'HOLD' }, PC = s => s > 0 ? 'b' : s < 0 ? 's' : 'h';
const pill = (s, t) => `<span class="sigpill ${PC(s)}">${t || LAB[s]}</span>`;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const px = () => (AI.d && isCse(AI.d.symbol) ? 'LKR ' : '$');
const fp = v => px() + num(v);

/* ---------------- UI shell ---------------- */
function shell() {
  const el = $('#v-ailab');
  const inp = e => e.length >= 3 && typeof e[2] === 'boolean' && e.length === 3
    ? `<label class="chk"><input type="checkbox" data-p="${e[0]}" ${e[2] ? 'checked' : ''}> ${e[1]}</label>`
    : Array.isArray(e[2]) ? `<label>${e[1]}<select class="pill" data-p="${e[0]}">${e[2].map(o => `<option ${o === e[3] ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`
    : `<label>${e[1]}<input class="pill" type="number" data-p="${e[0]}" value="${e[2]}" min="${e[3]}" max="${e[4]}" step="${e[5]}"></label>`;
  el.innerHTML = `<div class="card"><h3 style="font-weight:500;font-size:22px">AI Lab</h3>
   <p class="mut sm" style="margin-top:6px">Seven independent prediction methods plus a consensus. Pick a ticker, choose models, tune any parameter, and compare the results side by side.</p>
   <div class="form" style="margin-top:16px"><label>Ticker<input class="pill" id="ai-sym" value="AAPL"></label>
    <label class="chk"><input type="checkbox" id="ai-cse"> Sri Lankan CSE</label>
    <label><span>Forecast horizon: <b id="ai-hv">30</b> trading days</span><input type="range" id="ai-h" min="7" max="90" value="30"></label>
    <label>Preset<select class="pill" id="ai-preset"><option value="balanced">Balanced</option><option value="conservative">Conservative</option><option value="aggressive">Aggressive</option></select></label>
    <button class="btn" id="ai-go">Run AI analysis</button></div>
   <div class="chips" id="ai-models">${MODELS.map(m => `<label class="chip" id="ai-chip-${m[0]}" title="${m[2]}"><input type="checkbox" id="ai-m-${m[0]}" ${m[3] ? 'checked' : ''}><span class="cn">${m[1]}</span><span class="cs xs"></span></label>`).join('')}</div>
   <details class="ps"><summary>Advanced parameters</summary>${GROUPS.map(g => `<h4>${g[0]}</h4><div class="form">${g[1].map(inp).join('')}</div>`).join('')}</details>
   <div class="err" id="ai-err"></div></div>
  <div id="ai-out" hidden><div id="ai-cons"></div>
   <div class="card chartcard" style="margin-top:24px"><div class="head"><h3>Forecast comparison</h3><button class="btn ghost" id="ai-csv">Download CSV</button></div><div class="chartbox"><canvas id="ai-fc"></canvas></div><p class="mut xs" style="margin-top:8px">Tap a model in the legend to show or hide it. The shaded band is the consensus 90% range.</p></div>
   <div class="card" style="margin-top:24px"><h3 style="font-weight:500;font-size:22px">Model signals</h3><div class="tw" id="ai-table" style="margin-top:12px"></div></div>
   <div class="card" style="margin-top:24px"><h3 style="font-weight:500;font-size:22px">Technical signals</h3><div class="chartbox"><canvas id="ai-sig"></canvas></div><div class="chartbox" style="height:200px"><canvas id="ai-rsi"></canvas></div><p class="mut xs" style="margin-top:8px">Green and red triangles mark moving-average crossovers that passed the RSI filter.</p></div>
   <div id="ai-extra"></div>
   <p class="mut xs" style="margin-top:16px">All outputs are statistical estimates produced from past prices. They are not financial advice, and models often fail to beat a naive "tomorrow = today" guess, which is why each one is tested on unseen days above.</p></div>`;
  $('#ai-h').oninput = e => $('#ai-hv').textContent = e.target.value;
  $('#ai-go').onclick = run; $('#ai-sym').onkeydown = e => { if (e.key === 'Enter') run() };
  $('#ai-preset').onchange = e => setP({ ...PRESETS.balanced, ...defaults(), ...PRESETS[e.target.value] });
  $('#ai-csv').onclick = download;
  AI.ready = true;
}
const defaults = () => Object.fromEntries(GROUPS.flatMap(g => g[1]).map(e => [e[0], Array.isArray(e[2]) ? e[3] : e[2]]));
function setP(o) { $$('#v-ailab [data-p]').forEach(el => { const v = o[el.dataset.p]; if (v === undefined) return; if (el.type === 'checkbox') el.checked = !!v; else el.value = v }) }
function readP() { const o = {}; $$('#v-ailab [data-p]').forEach(el => o[el.dataset.p] = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : +el.value); return o }
const chip = (m, st, txt) => { const c = $('#ai-chip-' + m); if (!c) return; c.dataset.st = st; c.querySelector('.cs').textContent = txt || { q: 'queued', r: 'running…', ok: 'done' }[st] || '' };
const P0 = x => Math.max(1, x | 0);
const fail = t => { $('#ai-err').textContent = t };

/* ---------------- run ---------------- */
async function run() {
  const sym = $('#ai-sym').value.trim(); if (!sym) return fail('Enter a ticker.');
  const sel = MODELS.map(m => m[0]).filter(m => $('#ai-m-' + m).checked); if (!sel.length) return fail('Select at least one model.');
  const P = readP(), H = Math.max(+$('#ai-h').value, P0(readP().sig_days)), tok = ++AI.tok, btn = $('#ai-go');
  fail(''); btn.disabled = true; btn.textContent = 'Running…'; AI.res = {}; MODELS.forEach(m => chip(m[0], '', ''));
  sel.forEach(m => chip(m, 'q'));
  try {
    const d = await api(`/api/forecast?symbol=${encodeURIComponent(sym)}&days=7&cse=${$('#ai-cse').checked}`);
    AI.d = d; AI.hist = d.history || []; AI.P = P; AI.H = H;
    if (AI.hist.length < 120) throw new Error(`Only ${AI.hist.length} daily prices are available for ${d.symbol}; at least 120 are needed.`);
  } catch (e) { fail(e.message); btn.disabled = false; btn.textContent = 'Run AI analysis'; sel.forEach(m => chip(m, '', '')); return }
  $('#ai-out').hidden = false;
  const server = (async () => {
    for (const m of sel.filter(x => x !== 'dl')) {
      if (tok !== AI.tok) return; chip(m, 'r'); const t0 = performance.now();
      try { AI.res[m] = await api('/api/ai/' + m, { method: 'POST', body: { history: AI.hist, horizon: H, params: P } }); chip(m, 'ok', 'done ' + ((performance.now() - t0) / 1000).toFixed(1) + 's') }
      catch (e) { chip(m, 'err', 'failed'); $('#ai-chip-' + m).title = e.message; AI.res[m] = { error: e.message } }
      if (tok === AI.tok) render();
    }
  })();
  const dl = sel.includes('dl') ? (async () => {
    chip('dl', 'r');
    try { AI.res.dl = await runDL(AI.hist, P, H, (f, t) => chip('dl', 'r', t)); chip('dl', 'ok') }
    catch (e) { chip('dl', 'err', 'failed'); $('#ai-chip-dl').title = e.message; AI.res.dl = { error: e.message } }
    if (tok === AI.tok) render();
  })() : null;
  await Promise.all([server, dl]);
  if (tok === AI.tok) { btn.disabled = false; btn.textContent = 'Run AI analysis'; const errs = Object.entries(AI.res).filter(([, v]) => v.error); if (errs.length) fail(errs.map(([k, v]) => `${NAME[k]}: ${v.error}`).join(' · ')) }
}

/* ---------------- deep learning in the browser (TensorFlow.js) ---------------- */
const loadTF = () => window.tf ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js'; s.onload = ok; s.onerror = () => no(new Error('Could not load TensorFlow.js')); document.head.appendChild(s) });
const NF = 8, nextBiz = s => { let d = new Date(s + 'T00:00:00Z'); do { d = new Date(+d + 864e5) } while ([0, 6].includes(d.getUTCDay())); return d.toISOString().slice(0, 10) };
function feats(c, v) {
  const n = c.length, R = [0]; for (let i = 1; i < n; i++) R[i] = Math.log(c[i] / c[i - 1]);
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length, sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))) || 1e-9 };
  let e12 = c[0], e26 = c[0], sg = 0; const H = []; for (let i = 0; i < n; i++) { e12 += (c[i] - e12) * 2 / 13; e26 += (c[i] - e26) * 2 / 27; const m = e12 - e26; sg += (m - sg) * 2 / 10; H[i] = (m - sg) / c[i] * 100 }
  const F = []; for (let i = 50; i < n; i++) {
    let g = 0, l = 0; for (let j = i - 13; j <= i; j++) { const d = c[j] - c[j - 1]; d > 0 ? g += d : l -= d }
    const rsi = g + l === 0 ? .5 : g / (g + l), w = v ? v.slice(i - 19, i + 1) : null, vz = w && sd(w) > 1e-6 ? (v[i] - mean(w)) / sd(w) : 0;
    F.push([R[i], Math.log(c[i] / c[i - 5]), Math.log(c[i] / c[i - 20]), sd(R.slice(i - 9, i + 1)), rsi - .5, H[i], Math.log(c[i] / mean(c.slice(i - 49, i + 1))), vz]);
  }
  return { F, R };
}
async function runDL(hist, P, H, prog) {
  await loadTF(); const h = hist.slice(-1500), c = h.map(x => +x.close), v = h.every(x => +x.volume > 0) ? h.map(x => +x.volume) : null;
  const L = P.dl_seq | 0, E = P.dl_members | 0, k = Math.min(P.sig_days | 0, H), last = c[c.length - 1];
  if (c.length < Math.max(250, L * 5)) throw new Error(`Only ${c.length} prices; deep learning needs at least ${Math.max(250, L * 5)}.`);
  const { F, R } = feats(c, v), ns = F.length - 1 - (L - 1), ntr = Math.floor(ns * .8), mu = [], sg = [];
  const trRows = F.slice(0, ntr + L - 1);
  for (let j = 0; j < NF; j++) { const col = trRows.map(r => r[j]), m = col.reduce((s, x) => s + x, 0) / col.length; mu[j] = m; sg[j] = Math.sqrt(col.reduce((s, x) => s + (x - m) ** 2, 0) / col.length) || 1 }
  const nz = r => r.map((x, j) => clamp((x - mu[j]) / sg[j], -5, 5)), Fn = F.map(nz), ys = [], Xa = [];
  for (let i = L - 1; i < F.length - 1; i++) { ys.push(R[i + 51]); Xa.push(Fn.slice(i - L + 1, i + 1)) }
  const sdY = Math.sqrt(ys.slice(0, ntr).reduce((s, x) => s + x * x, 0) / ntr) || 1e-6;
  const Xtr = tf.tensor3d(Xa.slice(0, ntr)), ytr = tf.tensor2d(ys.slice(0, ntr).map(y => [y / sdY])), Xte = tf.tensor3d(Xa.slice(ntr)), models = [];
  const mk = () => { const m = tf.sequential(); m.add(tf.layers[P.dl_type === 'lstm' ? 'lstm' : 'gru']({ units: P.dl_units | 0, inputShape: [L, NF], dropout: P.dl_drop })); m.add(tf.layers.dense({ units: 12, activation: 'tanh' })); m.add(tf.layers.dense({ units: 1 })); m.compile({ optimizer: tf.train.adam(P.dl_lr), loss: 'meanSquaredError' }); return m };
  for (let e = 0; e < E; e++) {
    const m = mk(); await m.fit(Xtr, ytr, { epochs: P.dl_epochs | 0, batchSize: 32, validationSplit: .15, shuffle: false, callbacks: [tf.callbacks.earlyStopping({ monitor: 'val_loss', patience: 6 }), { onEpochEnd: async ep => { prog((e + (ep + 1) / P.dl_epochs) / E, `training ${Math.round((e + (ep + 1) / P.dl_epochs) / E * 100)}%`); await tf.nextFrame() } }] }); models.push(m);
  }
  const pred = X => tf.tidy(() => { const o = models.map(m => m.predict(X).dataSync()); return Array.from(o[0]).map((_, i) => o.reduce((s, a) => s + a[i], 0) / E * sdY) });
  const pr = pred(Xte), yt = ys.slice(ntr), n = yt.length; let hit = 0, cnt = 0, sm = 0, sn = 0;
  for (let i = 0; i < n; i++) { if (yt[i] !== 0) { cnt++; if (Math.sign(pr[i]) === Math.sign(yt[i])) hit++ } sm += (yt[i] - pr[i]) ** 2; sn += yt[i] ** 2 }
  const res = yt.map((y, i) => y - pr[i]); let C = c.slice(), V = v ? v.slice() : null; const path = [];
  for (let s = 0; s < H; s++) { const tl = Math.max(150, L + 80), tail = C.slice(-tl), { F: f } = feats(tail, V ? V.slice(-tl) : null), X = tf.tensor3d([f.slice(-L).map(nz)]), r = pred(X)[0]; X.dispose(); C.push(C[C.length - 1] * Math.exp(r)); if (V) V.push(V.slice(-20).reduce((a, b) => a + b, 0) / 20); path.push(C[C.length - 1]) }
  const sums = new Array(600).fill(0), q = (a, p) => a[Math.floor(p * (a.length - 1))], lo = [], hi = []; let d = hist[hist.length - 1].date; const dates = [];
  for (let s = 0; s < H; s++) { for (let i = 0; i < 600; i++) sums[i] += res[Math.floor(Math.random() * res.length)]; const so = [...sums].sort((a, b) => a - b); lo.push(path[s] * Math.exp(q(so, .05))); hi.push(path[s] * Math.exp(q(so, .95))); d = nextBiz(d); dates.push(d) }
  [Xtr, ytr, Xte].forEach(x => x.dispose()); models.forEach(m => m.dispose());
  const e_k = (path[k - 1] / last - 1) * 100, e_h = (path[H - 1] / last - 1) * 100, sig = e_k > P.th ? 1 : e_k < -P.th ? -1 : 0;
  return { ok: true, signal: sig, label: LAB[sig], score: clamp(e_k / (2 * P.th), -1, 1), expected_pct: e_k, horizon_pct: e_h, sig_days: k, last, forecast: path.map((y, i) => ({ date: dates[i], yhat: y, lower: lo[i], upper: hi[i] })),
    holdout: { n, k: 1, hit_rate: hit / cnt, skill: 1 - Math.sqrt(sm / n) / Math.sqrt(sn / n), strategy_pct: null, buy_hold_pct: null, win_rate: null, trades: null, basis: 'next-day' },
    notes: [`${P.dl_type.toUpperCase()}: ${P.dl_units} units, sequence ${L} days, dropout ${P.dl_drop}, ${E}-model ensemble trained in your browser (${ntr} training windows).`] };
}

/* ---------------- consensus ---------------- */
function ensemble() {
  const P = AI.P, rs = Object.entries(AI.res).filter(([k, v]) => v && !v.error && typeof v.score === 'number' && k !== 'mc'); if (!rs.length) return null;
  const w = v => { const h = v.holdout; return P.autoW && h && h.n >= 6 && h.hit_rate != null ? clamp(1 + 4 * (h.hit_rate - .5), .3, 2) : 1 };
  let sw = 0, sc = 0; rs.forEach(([, v]) => { sw += w(v); sc += w(v) * v.score }); sc /= sw;
  const sig = sc >= P.ens_th ? 1 : sc <= -P.ens_th ? -1 : 0, agree = rs.filter(([, v]) => v.signal === sig).length / rs.length, fcs = rs.filter(([, v]) => v.forecast && v.forecast.length);
  let fc = null, tw = 0;
  if (fcs.length) { fc = fcs[0][1].forecast.map((r, i) => ({ date: r.date, yhat: 0, lower: 0, upper: 0 })); fcs.forEach(([, v]) => { const ww = w(v); tw += ww; v.forecast.forEach((r, i) => { if (!fc[i]) return; fc[i].yhat += ww * r.yhat; fc[i].lower += ww * r.lower; fc[i].upper += ww * r.upper }) }); fc.forEach(r => { r.yhat /= tw; r.lower /= tw; r.upper /= tw }) }
  const last = rs[0][1].last, k = Math.min(P.sig_days, AI.H), e_k = fc ? (fc[k - 1].yhat / last - 1) * 100 : null;
  return { sc, sig, agree, n: rs.length, fc, last, e_k, k, w };
}

/* ---------------- rendering ---------------- */
const AX = () => ({ x: { grid: { display: false }, ticks: { color: css('--mut'), maxTicksLimit: window.innerWidth < 600 ? 5 : 10, callback(v) { return fmtD(this.getLabelForValue(v)) } } }, y: { grid: { color: css('--line'), borderDash: [4, 4] }, ticks: { color: css('--mut'), callback: v => px().replace('LKR ', '') + Intl.NumberFormat('en', { notation: 'compact' }).format(v) } } });
function chart(id, cfg) { if (AI.ch[id]) AI.ch[id].destroy(); const cv = $('#' + id); if (!cv) return; AI.ch[id] = new Chart(cv, cfg) }
const common = (ex = {}) => ({ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, spanGaps: false, ...ex });
function render() {
  const E = ensemble(), P = AI.P, hist = AI.hist, d = AI.d;
  if (!E) { $('#ai-cons').innerHTML = '<div class="card empty">Waiting for the first model to finish…</div>'; return }
  const lab = { 1: 'BUY', '-1': 'SELL', 0: 'HOLD' }[E.sig], conf = E.agree >= .7 && E.n >= 3 ? 'High' : E.agree >= .5 ? 'Medium' : 'Low';
  const hs = Object.values(AI.res).filter(v => v.holdout && v.holdout.n >= 4), beat = hs.filter(v => v.holdout.skill > 0).length;
  $('#ai-cons').innerHTML = `<div class="card" style="margin-top:24px"><div class="head"><div><span class="mut xs">Consensus signal for ${esc(d.symbol)} · ${E.n} models</span><div class="big">${pill(E.sig, lab)}<span class="sm mut">score ${(E.sc * 100).toFixed(0)}</span></div></div><div class="mut sm">${P.sig_days}-day horizon</div></div>
   <div class="gauge"><i style="left:${50 + E.sc * 50}%"></i></div><div class="gl"><span>SELL</span><span>HOLD</span><span>BUY</span></div>
   <div class="outlook"><div><span class="mut xs">Latest close</span><b>${fp(E.last)}</b></div><div><span class="mut xs">Model agreement</span><b>${(E.agree * 100).toFixed(0)}%</b></div><div><span class="mut xs">Confidence</span><b>${conf}</b></div>
   ${E.e_k != null ? `<div><span class="mut xs">Expected ${E.k}-day move</span><b class="${cls(E.e_k)}">${pct(E.e_k)}</b></div><div><span class="mut xs">Consensus price at horizon</span><b>${fp(E.fc[E.fc.length - 1].yhat)}</b></div>` : ''}</div>
   ${hs.length ? `<p class="mut xs">${beat} of ${hs.length} models beat a naive "no change" guess on days they had never seen. ${beat < hs.length / 2 ? 'Treat this consensus as low-confidence.' : ''}</p>` : ''}</div>`;
  // table
  const rows = Object.entries(AI.res).filter(([, v]) => v && !v.error).map(([k, v]) => { const h = v.holdout, hr = h && h.hit_rate != null ? `<span class="${h.hit_rate >= .55 ? 'up' : h.hit_rate <= .48 ? 'down' : ''}">${(h.hit_rate * 100).toFixed(0)}%</span> <span class="mut xs">(${h.n} tests)</span>` : '<span class="mut">n/a</span>';
    return `<tr><td><span class="dot" style="background:${COL[k]}"></span>${NAME[k]}</td><td>${pill(v.signal)}</td><td class="${v.expected_pct == null ? '' : cls(v.expected_pct)}">${v.expected_pct == null ? '-' : pct(v.expected_pct)}</td><td>${v.forecast && v.forecast.length ? fp(v.forecast[v.forecast.length - 1].yhat) : '-'}</td><td>${hr}</td><td>${h ? `<span class="${h.skill > 0 ? 'up' : 'down'}">${(h.skill * 100).toFixed(0)}%</span>` : '-'}</td><td class="mut xs">${esc((v.notes || [])[0] || '')}</td></tr>` }).join('');
  $('#ai-table').innerHTML = `<table><tr><th>Model</th><th>Signal</th><th>Expected ${P.sig_days}-day</th><th>Price at horizon</th><th>Hit-rate on unseen days</th><th>Edge vs naive</th><th>Details</th></tr>${rows}</table>`; stackify($('#ai-table'));
  // forecast chart
  const n0 = Math.max(0, hist.length - 150), H = hist.slice(n0), n = H.length, dates = E.fc ? E.fc.map(r => r.date) : [], labels = [...H.map(x => x.date), ...dates], padL = a => [...Array(n - 1).fill(null), H[n - 1].close, ...a];
  const ds = [{ label: 'Historical', data: [...H.map(x => x.close), ...Array(dates.length).fill(null)], borderColor: '#8b5cf6', borderWidth: 2.5, tension: .3, pointRadius: 0 }];
  Object.entries(AI.res).forEach(([k, v]) => { if (v && v.forecast && v.forecast.length) ds.push({ label: NAME[k], data: padL(v.forecast.map(r => r.yhat)), borderColor: COL[k], borderWidth: 1.8, borderDash: [5, 4], tension: .3, pointRadius: 0 }) });
  if (E.fc) ds.push({ label: 'Consensus', data: padL(E.fc.map(r => r.yhat)), borderColor: COL.ens, borderWidth: 3.2, tension: .3, pointRadius: 0 }, { label: 'Upper', data: [...Array(n).fill(null), ...E.fc.map(r => r.upper)], borderColor: 'transparent', pointRadius: 0 }, { label: 'Lower', data: [...Array(n).fill(null), ...E.fc.map(r => r.lower)], borderColor: 'transparent', pointRadius: 0, fill: '-1', backgroundColor: 'rgba(192,132,252,.14)' });
  chart('ai-fc', { type: 'line', data: { labels, datasets: ds }, options: common({ plugins: { legend: { labels: { color: css('--mut'), filter: i => !['Upper', 'Lower'].includes(i.text) } }, tooltip: { filter: i => !['Upper', 'Lower'].includes(i.dataset.label), callbacks: { title: i => fmtD(i[0].label, 1), label: i => `${i.dataset.label}: ${fp(i.parsed.y)}` } } }, scales: AX() }), plugins: [cross] });
  const R = AI.res.rules; if (R && !R.error) rulesCharts(R); else { ['ai-sig', 'ai-rsi'].forEach(i => AI.ch[i] && AI.ch[i].destroy()) }
  extras(E);
}
function rulesCharts(R) {
  const S0 = R.series, mk = (idx, up) => S0.close.map((c, i) => idx.includes(i) ? c : null);
  chart('ai-sig', { type: 'line', data: { labels: S0.date, datasets: [
    { label: 'Price', data: S0.close, borderColor: '#8b5cf6', borderWidth: 2.2, tension: .2, pointRadius: 0 }, { label: 'Fast MA', data: S0.fast, borderColor: '#38bdf8', borderWidth: 1.4, pointRadius: 0 }, { label: 'Slow MA', data: S0.slow, borderColor: '#f59e0b', borderWidth: 1.4, pointRadius: 0 },
    { label: 'Upper', data: S0.bb_up, borderColor: 'rgba(148,163,184,.4)', borderWidth: 1, pointRadius: 0 }, { label: 'Lower', data: S0.bb_lo, borderColor: 'rgba(148,163,184,.4)', borderWidth: 1, pointRadius: 0, fill: '-1', backgroundColor: 'rgba(148,163,184,.08)' },
    { label: 'Buy', data: mk(R.markers.buy), showLine: false, pointStyle: 'triangle', pointRadius: 8, backgroundColor: '#34d399', borderColor: '#34d399' }, { label: 'Sell', data: mk(R.markers.sell), showLine: false, pointStyle: 'triangle', rotation: 180, pointRadius: 8, backgroundColor: '#f87171', borderColor: '#f87171' }] },
    options: common({ plugins: { legend: { labels: { color: css('--mut'), filter: i => !['Upper', 'Lower'].includes(i.text) } }, tooltip: { filter: i => !['Upper', 'Lower'].includes(i.dataset.label), callbacks: { title: i => fmtD(i[0].label, 1) } } }, scales: AX() }), plugins: [cross] });
  const ax = AX(), P = AI.P;
  chart('ai-rsi', { type: 'line', data: { labels: S0.date, datasets: [
    { type: 'bar', label: 'MACD histogram', data: S0.macd_hist, yAxisID: 'y2', backgroundColor: S0.macd_hist.map(v => v >= 0 ? 'rgba(52,211,153,.45)' : 'rgba(248,113,113,.45)') },
    { label: 'RSI', data: S0.rsi, borderColor: '#c084fc', borderWidth: 2, pointRadius: 0, tension: .2 },
    { label: 'Overbought', data: S0.rsi.map(() => P.rsi_ob), borderColor: 'rgba(248,113,113,.6)', borderDash: [4, 4], pointRadius: 0, borderWidth: 1 }, { label: 'Oversold', data: S0.rsi.map(() => P.rsi_os), borderColor: 'rgba(52,211,153,.6)', borderDash: [4, 4], pointRadius: 0, borderWidth: 1 }] },
    options: common({ plugins: { legend: { labels: { color: css('--mut') } }, tooltip: { callbacks: { title: i => fmtD(i[0].label, 1) } } }, scales: { x: ax.x, y: { min: 0, max: 100, grid: { color: css('--line'), borderDash: [4, 4] }, ticks: { color: css('--mut') } }, y2: { position: 'right', display: false } } }), plugins: [cross] });
}
function extras(E) {
  const R = AI.res.rules, h = [], P = AI.P, tag = v => v > 0 ? 'b' : v < 0 ? 's' : 'h', tx = { 1: 'Bullish', '-1': 'Bearish', 0: 'Neutral' };
  if (R && !R.error) {
    h.push(`<div class="card" style="margin-top:24px"><div class="head"><h3 style="font-weight:500;font-size:22px">Indicator readings</h3>${pill(R.signal)}</div>
     <p class="mut sm" style="margin-top:6px">MA-cross rule: last event <b>${R.primary.event}</b>${R.primary.bars_ago != null ? ` ${R.primary.bars_ago} bars ago` : ''}; market is in a <b>${R.primary.state}</b>. ${esc(R.notes[0])}</p>
     <div class="tw" style="margin-top:10px"><table><tr><th>Indicator</th><th>Reading</th><th>Vote</th><th>Rule</th></tr>${R.indicators.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.value)}</td><td><span class="sigpill ${tag(i.vote)}">${tx[i.vote]}</span></td><td class="mut xs">${esc(i.note)}</td></tr>`).join('')}</table></div></div>`);
    const b = R.backtest, row = (n, x) => `<tr><td>${n}</td><td class="${cls(x.total_pct)}">${pct(x.total_pct)}</td><td class="${cls(x.buy_hold_pct)}">${pct(x.buy_hold_pct)}</td><td>${x.sharpe.toFixed(2)}</td><td class="down">${x.max_dd_pct.toFixed(1)}%</td><td>${x.trades}</td><td>${x.win_rate == null ? '-' : (x.win_rate * 100).toFixed(0) + '%'}</td></tr>`;
    h.push(`<div class="card" style="margin-top:24px"><h3 style="font-weight:500;font-size:22px">Rule backtest (last ${b.days} days)</h3><div class="chartbox" style="height:260px"><canvas id="ai-bt"></canvas></div>
     <div class="tw" style="margin-top:12px"><table><tr><th>Strategy</th><th>Return</th><th>Buy &amp; hold</th><th>Sharpe</th><th>Max drawdown</th><th>Trades</th><th>Win rate</th></tr>${row('Composite vote (long / flat)', b.vote)}${row('MA-cross + RSI filter', b.primary)}</table></div>
     <p class="mut xs" style="margin-top:8px">Trades are placed on the next day's price. No fees or slippage are included.</p></div>`);
  }
  const vr = Object.entries(AI.res).filter(([, v]) => v && v.holdout);
  if (vr.length) h.push(`<div class="card" style="margin-top:24px"><h3 style="font-weight:500;font-size:22px">Walk-forward validation</h3><p class="mut sm" style="margin-top:6px">Each model re-predicts past dates using only the data available then, so these numbers come from days it never saw.</p>
   <div class="tw" style="margin-top:10px"><table><tr><th>Model</th><th>Tests</th><th>Direction hit-rate</th><th>Edge vs naive</th><th>Following signals</th><th>Just holding</th><th>Win rate</th><th>Basis</th></tr>${vr.map(([k, v]) => { const o = v.holdout; return `<tr><td>${NAME[k]}</td><td>${o.n}</td><td>${(o.hit_rate * 100).toFixed(0)}%</td><td class="${o.skill > 0 ? 'up' : 'down'}">${(o.skill * 100).toFixed(0)}%</td><td>${o.strategy_pct == null ? '-' : pct(o.strategy_pct)}</td><td>${o.buy_hold_pct == null ? '-' : pct(o.buy_hold_pct)}</td><td>${o.win_rate == null ? '-' : (o.win_rate * 100).toFixed(0) + '%'}</td><td class="mut xs">${o.basis || o.k + '-day moves'}</td></tr>` }).join('')}</table></div></div>`);
  const mc = AI.res.mc; if (mc && !mc.error) h.push(`<div class="card" style="margin-top:24px"><h3 style="font-weight:500;font-size:22px">Monte Carlo risk (${mc.paths} simulated paths)</h3><div class="outlook">
   <div><span class="mut xs">Chance of finishing higher</span><b>${(mc.prob_up * 100).toFixed(0)}%</b></div><div><span class="mut xs">Chance of touching +${mc.target_pct}%</span><b class="up">${(mc.prob_target * 100).toFixed(0)}%</b></div><div><span class="mut xs">Chance of touching -${mc.stop_pct}%</span><b class="down">${(mc.prob_stop * 100).toFixed(0)}%</b></div>
   <div><span class="mut xs">${mc.sig_days}-day Value at Risk (95%)</span><b class="down">${pct(mc.var95_pct)}</b></div><div><span class="mut xs">Expected shortfall (95%)</span><b class="down">${pct(mc.es95_pct)}</b></div></div></div>`);
  const gb = AI.res.gb, rf = AI.res.rf;
  if ((gb && gb.prob_up != null) || (rf && rf.importance)) h.push(`<div class="card" style="margin-top:24px"><h3 style="font-weight:500;font-size:22px">Machine-learning insight</h3>
   ${gb && gb.prob_up != null ? `<p class="sm" style="margin-top:8px">Boosted-tree classifier: <b>${(gb.prob_up * 100).toFixed(0)}%</b> probability the price is higher in ${P.sig_days} days.</p>` : ''}
   ${rf && rf.importance ? `<p class="mut xs" style="margin-top:10px">What the Random Forest relies on most</p>${rf.importance.map(i => `<div class="imp"><span>${esc(i.name)}</span><i style="width:${Math.max(4, i.value * 300)}px"></i><span class="mut xs">${(i.value * 100).toFixed(0)}%</span></div>`).join('')}` : ''}</div>`);
  if (R && !R.error) { const k = R.risk; h.push(`<div class="card" style="margin-top:24px"><h3 style="font-weight:500;font-size:22px">Risk &amp; regime</h3><div class="outlook">
   <div><span class="mut xs">Market regime</span><b style="font-size:16px">${esc(k.regime)}</b></div><div><span class="mut xs">Volatility (annualised, EWMA)</span><b>${k.vol_ann_pct.toFixed(1)}%</b></div><div><span class="mut xs">Volatility percentile (1y)</span><b>${k.vol_percentile.toFixed(0)}</b></div>
   <div><span class="mut xs">Suggested stop (2 x ATR)</span><b class="down">${fp(k.stop)}</b></div><div><span class="mut xs">Suggested target (3 x ATR)</span><b class="up">${fp(k.target)}</b></div><div><span class="mut xs">Worst drop in last year</span><b class="down">${k.max_dd_1y_pct.toFixed(1)}%</b></div></div></div>`) }
  $('#ai-extra').innerHTML = h.join(''); $$('#ai-extra .tw').forEach(stackify2);
  if (R && !R.error && $('#ai-bt')) { const q = R.equity, pc = a => a.map(v => (v - 1) * 100); const ax = AX();
    chart('ai-bt', { type: 'line', data: { labels: q.date, datasets: [{ label: 'Composite vote', data: pc(q.vote), borderColor: COL.ens, borderWidth: 2.4, pointRadius: 0 }, { label: 'MA-cross + RSI', data: pc(q.primary), borderColor: COL.rules, borderWidth: 1.8, pointRadius: 0 }, { label: 'Buy & hold', data: pc(q.buy_hold), borderColor: '#94a3b8', borderDash: [5, 4], borderWidth: 1.8, pointRadius: 0 }] },
      options: common({ plugins: { legend: { labels: { color: css('--mut') } }, tooltip: { callbacks: { title: i => fmtD(i[0].label, 1), label: i => `${i.dataset.label}: ${pct(i.parsed.y)}` } } }, scales: { x: ax.x, y: { grid: { color: css('--line'), borderDash: [4, 4] }, ticks: { color: css('--mut'), callback: v => v + '%' } } } }), plugins: [cross] }) }
}
const stackify2 = el => { if (typeof stackify === 'function') stackify(el.parentElement) };
function download() {
  const rows = [], by = {}; Object.entries(AI.res).forEach(([k, v]) => (v.forecast || []).forEach(r => { (by[r.date] = by[r.date] || { date: r.date })[NAME[k].replace(/[ \/]/g, '_')] = r.yhat }));
  const E = ensemble(); if (E && E.fc) E.fc.forEach(r => { (by[r.date] = by[r.date] || { date: r.date }).Consensus = r.yhat });
  Object.values(by).sort((a, b) => a.date < b.date ? -1 : 1).forEach(r => rows.push(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? v.toFixed(4) : v]))));
  csv(`ai-forecasts-${(AI.d && AI.d.symbol) || 'ticker'}.csv`, rows);
}

/* ---------------- public API ---------------- */
window.AILab = {
  show() { if (!AI.ready) { shell(); setP(defaults()) } const m = $('#m-sym'); if (m && m.value && !AI.shown) { $('#ai-sym').value = m.value; $('#ai-cse').checked = $('#m-cse').checked } AI.shown = true },
  open(sym, cse) { go('ailab'); if (sym) { $('#ai-sym').value = sym.replace(/\.CSE$/, ''); $('#ai-cse').checked = !!cse; run() } }
};
const mAi = $('#m-ai'); if (mAi) mAi.onclick = () => AILab.open(S.fc.symbol, isCse(S.fc.symbol));
})();
