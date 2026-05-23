// bundle-serve.mjs — 镜像 J2 的 /bundle 服务, 让 J2 从本机拉 bundle
//
// 运行: node scripts/bundle-serve.mjs [--port=9202]
// 用途: git bundle rebuild 后挂到局域网, 对面机器 curl 下载

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';

const portArg = process.argv.find(a => a.startsWith('--port='));
const PORT = portArg ? parseInt(portArg.slice(7), 10) : 9202;
const BUNDLE_PATH = 'D:/kanet-sync.bundle';
const REPO_PATH = process.env.NWT_REPO_PATH || 'C:/kanet';

// R-NWT-2026-04-27: regenerate on each GET (跟 J2 :9203 同模式).
// J1 c92bedb24c 报: NWT :9202 stale a2c9460b, J1 拉旧 commit. 真因 = 静态 file, 没自动 refresh.
// 修: 每 GET 现 git bundle create master live, 真 fresh from current HEAD.
function regenerateBundle() {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['bundle', 'create', BUNDLE_PATH, 'master'], {
      cwd: REPO_PATH, stdio: 'pipe',
    });
    let stderr = '';
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`git bundle exit ${code}: ${stderr}`));
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/bundle') {
    try {
      await regenerateBundle();
      const stat = fs.statSync(BUNDLE_PATH);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
      });
      fs.createReadStream(BUNDLE_PATH).pipe(res);
      console.log(`[${new Date().toISOString().slice(11,19)}] served /bundle ${stat.size}B (fresh from master HEAD) → ${req.socket.remoteAddress}`);
    } catch (e) {
      res.writeHead(500);
      res.end('bundle err: ' + e.message);
    }
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, port: PORT, bundle: BUNDLE_PATH, repo: REPO_PATH }));
  } else {
    res.writeHead(404);
    res.end('GET /bundle | /health');
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
