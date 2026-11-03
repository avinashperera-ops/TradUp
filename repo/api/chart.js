// GET /api/chart?s=AAPL&range=5y&interval=1d   |   /api/chart?s=JKH.N0000
// Yahoo Finance for global tickers, cse.lk public API for Colombo Stock Exchange tickers. Add &diag=1 to see raw CSE history response.
const { UA, isCSE, cse } = require('./_lib');
async function yahoo(s, range, interval) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=${range}&interval=${interval}`, { headers: UA });
  if (!r.ok) throw Object.assign(new Error('upstream'), { code: r.status });
  const c = (await r.json()).chart?.result?.[0]; if (!c) throw Object.assign(new Error('nf'), { code: 404 });
  const q = c.indicators.quote[0], pts = [], vol = [];
  (c.timestamp || []).forEach((t, i) => { if (q.close[i] != null) { pts.push([t * 1000, q.close[i]]); vol.push(q.volume?.[i] ?? 0); } });
  const prev = pts.length > 1 ? pts[pts.length - 2][1] : c.meta.chartPreviousClose;
  return { symbol: c.meta.symbol, name: c.meta.longName || c.meta.shortName || c.meta.symbol, price: c.meta.regularMarketPrice, prev, cur: c.meta.currency, pts, vol };
}
async function colombo(s, diag) {
  const info = (await cse('companyInfoSummery?symbol=' + encodeURIComponent(s))).reqSymbolInfo;
  if (!info) throw Object.assign(new Error('nf'), { code: 404 });
  let pts = [], raw = null;
  try {
    raw = await cse('companyChartDataByStock', `stockId=${info.id}&period=5`);
    const arr = raw.chartData || raw.data || [];
    const byDay = {};
    arr.forEach(x => { const t = +(x.t ?? x.d), p = +(x.p ?? x.c ?? x.price); if (t && p) byDay[new Date(t).toISOString().slice(0, 10)] = [t, p]; });
    pts = Object.values(byDay).sort((a, b) => a[0] - b[0]);
  } catch (e) { raw = String(e); }
  if (diag) return { info, raw: JSON.stringify(raw).slice(0, 1500), n: pts.length };
  return { symbol: s, name: info.name, price: info.lastTradedPrice, prev: info.previousClose, cur: 'LKR', pts, vol: null };
}
module.exports = async (req, res) => {
  const { s = 'AAPL', range = '5y', interval = '1d', diag } = req.query;
  try {
    const d = isCSE(s) ? await colombo(s, diag) : await yahoo(s, range, interval);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.json(d);
  } catch (e) { res.status(e.code || 500).json({ error: e.message }); }
};
