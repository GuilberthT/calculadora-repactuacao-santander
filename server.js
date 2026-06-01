const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 1515;
const ROOT = __dirname;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.pdf':  'application/pdf',
};

http.createServer((req, res) => {
  let filePath = path.join(ROOT, decodeURIComponent(req.url === '/' ? '/calculadora-repactuacao-santander.html' : req.url));
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
