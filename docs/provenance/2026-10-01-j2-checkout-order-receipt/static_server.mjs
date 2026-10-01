import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT_CHECKOUT = 'D:/kanet-tn12/scratch/_j2_wt_order_receipt/kasia-console/src/lib/checkout-static';
const PORT = Number(process.env.PORT || 18777);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.sil': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.ts': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/checkout.html';
    const full = join(ROOT_CHECKOUT, p);
    const st = await stat(full);
    if (!st.isFile()) throw new Error('not a file');
    const body = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (e) {
    res.writeHead(404); res.end('not found: ' + e.message);
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`[receipt-test server] listening http://127.0.0.1:${PORT}`));
