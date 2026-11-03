// Zero-dependency Node server for Render: serves /public, mounts /api/*, and exposes /health for the Android app's wake-up check.
const http = require('http'), fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const API = { chart: require('./api/chart'), search: require('./api/search'), movers: require('./api/movers') };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end('{"ok":true,"app":"tradup"}');
  }
  const m = u.pathname.match(/^\/api\/(chart|search|movers)$/);
  if (m) {
    req.query = Object.fromEntries(u.searchParams);
    res.status = c => { res.statusCode = c; return res; };
    res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    try { await API[m[1]](req, res); } catch (e) { res.statusCode = 500; res.end('{"error":"server"}'); }
    return;
  }
  const file = path.normalize(path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname));
  if (!file.startsWith(PUB)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}).listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('TradUp running'));
