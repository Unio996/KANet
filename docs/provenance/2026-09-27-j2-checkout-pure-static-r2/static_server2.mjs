import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
const ROOT = 'D:/kanet-tn12/scratch/_j2_wt_checkout_static/kasia-console/src/lib/checkout-static';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.ts': 'text/plain', '.md': 'text/plain' };
createServer(async (req, res) => {
  try {
    const path = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    const data = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) { res.writeHead(404); res.end('not found: ' + e.message); }
}).listen(8899, '127.0.0.1', () => console.log('static server on 8899, root=', ROOT));
