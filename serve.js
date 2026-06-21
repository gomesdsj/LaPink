const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname);
const MIME = { html:'text/html', css:'text/css', js:'application/javascript', json:'application/json', png:'image/png', jpg:'image/jpeg', svg:'image/svg+xml', webp:'image/webp', ico:'image/x-icon', woff2:'font/woff2' };
const s = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/V1.html';
  const f = path.join(ROOT, url);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const data = fs.readFileSync(f);
    const ext = path.extname(f).slice(1);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  } catch(e) { res.writeHead(404); res.end('not found'); }
});
s.listen(8787, () => console.log('LaPink server ready on :8787'));
