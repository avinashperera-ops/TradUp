// Today's top gainers on the Colombo Stock Exchange (live from cse.lk)
const { cse } = require('./_lib');
module.exports = async (req, res) => {
  try {
    const j = await cse('topGainers'); const a = Array.isArray(j) ? j : Object.values(j).find(Array.isArray) || [];
    res.setHeader('Cache-Control', 's-maxage=60');
    res.json(a.slice(0, 4).map(x => ({ symbol: x.symbol, price: x.price, pct: x.changePercentage })));
  } catch (e) { res.status(500).json([]); }
};
