const UA = { 'User-Agent': 'Mozilla/5.0' };
const isCSE = s => /\.[NXPRD]\d{4}$/i.test(s);
async function cse(path, body = '') {
  const r = await fetch('https://www.cse.lk/api/' + path, { method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error('cse ' + r.status);
  return r.json();
}
let codes = null;
async function allCodes() { if (!codes) codes = await cse('allSecurityCode'); return codes; }
module.exports = { UA, isCSE, cse, allCodes };
