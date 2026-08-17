// Dev-only static server so the renderer can be tested in a browser.
// The real app runs in Electron (npm start) — this is just for UI testing.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.csv': 'text/csv' };

http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/src/dev.html';
  if (req.method === 'POST' && url === '/save-icon') {
    // dev-only helper: the browser renders the emoji to canvas PNGs and posts them here
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const { name, b64 } = JSON.parse(body);
      const dir = path.join(__dirname, 'icons');
      fs.mkdirSync(dir, { recursive: true });
      const safe = String(name).replace(/[^a-z0-9._-]/gi, '');
      fs.writeFileSync(path.join(dir, safe), Buffer.from(b64, 'base64'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }
  if (url === '/sample.csv' || url === '/sample2.csv') {
    // serve the real bank exports for import-flow testing
    const p = url === '/sample.csv'
      ? 'C:/Users/redacted/Desktop/2026-07-26_transaction_download.csv'
      : 'C:/Users/redacted/Desktop/2026-08-08_redacted.csv';
    res.writeHead(200, { 'Content-Type': 'text/csv' });
    res.end(fs.readFileSync(p));
    return;
  }
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(5173, () => console.log('dev server on http://localhost:5173'));
