// bundle-serve.mjs — 镜像 J2 的 /bundle 服务, 让 J2 从本机拉 bundle
//
// 运行: node scripts/bundle-serve.mjs [--port=9202]
// 用途: git bundle rebuild 后挂到局域网, 对面机器 curl 下载

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';

const portArg = process.argv.find(a => a.startsWith('--port='));
const PORT = portArg ? parseInt(portArg.slice(7), 10) : 9202;
const BUNDLE_PATH = 'D:/kanet-sync.bundle';

const server = http.createServer((req, res) => {
  if (req.url === '/bundle') {
    try {
      const stat = fs.statSync(BUNDLE_PATH);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
      });
      fs.createReadStream(BUNDLE_PATH).pipe(res);
      console.log(`[${new Date().toISOString().slice(11,19)}] served /bundle ${stat.size}B → ${req.socket.remoteAddress}`);
    } catch (e) {
      res.writeHead(500);
      res.end('bundle read error: ' + e.message);
    }
  } else {
    res.writeHead(404);
    res.end('GET /bundle');
  }
});

server.listen(PORT, () => {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const list of Object.values(ifaces)) {
    for (const i of list) {
      if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    }
  }
  console.log(`bundle-serve listening :${PORT}`);
  console.log(`LAN IPs: ${ips.join(', ')}`);
  console.log(`Bundle: ${BUNDLE_PATH}`);
});
