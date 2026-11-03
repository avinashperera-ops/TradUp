const { UA, cse, allCodes } = require('./_lib');
module.exports = async (req, res) => {
  const q = (req.query.q || '').trim(), ql = q.toLowerCase(); if (!q) return res.json([]);
  const out = [];
  try { // Colombo Stock Exchange
    (await allCodes()).filter(x => x.active && /\.[NX]0000$/.test(x.symbol) && (x.name.toLowerCase().replace(/\s/g, '').includes(ql.replace(/\s/g, '')) || x.symbol.toLowerCase().startsWith(ql)))
      .slice(0, 5).forEach(x => out.push({ symbol: x.symbol, name: x.name, ex: 'CSE' }));
  } catch (e) {}
  try { // Global
    const j = await (await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0`, { headers: UA })).json();
    (j.quotes || []).filter(x => ['EQUITY', 'ETF'].includes(x.quoteType)).forEach(x => out.push({ symbol: x.symbol, name: x.shortname || x.longname || x.symbol, ex: x.exchDisp || '' }));
  } catch (e) {}
  res.setHeader('Cache-Control', 's-maxage=300'); res.json(out.slice(0, 9));
};
