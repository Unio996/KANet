import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const PORT = 9202;
const ROOT = 'C:/kanet';
const ALLOWED = new Set(['j2-to-j1.bundle', 'j2-latest.bundle']);
http.createServer((req, res) => {
  const name = req.url.replace(/^\/+/, '').split('?')[0];
  if (!ALLOWED.has(name)) { res.statusCode = 404; res.end('not allowed'); return; }
  const f = path.join(ROOT, name);
  if (!fs.existsSync(f)) { res.statusCode = 404; res.end('not found'); return; }
  const stat = fs.statSync(f);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Type', 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
  console.log(new Date().toISOString(), req.socket.remoteAddress, name, stat.size + ' B');
}).listen(PORT, '0.0.0.0', () => console.log('bundle server listening on 0.0.0.0:' + PORT));
