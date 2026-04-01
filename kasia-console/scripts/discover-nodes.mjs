// Discover Kaspa wRPC nodes via Resolver
// Usage: node discover-nodes.mjs [count]
// Output: JSON array of { url, latency } sorted by latency

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const kaspa = require('../../kasia-relay/node_modules/kaspa-wasm');
const { Resolver, Encoding } = kaspa;
const net = await import('net');
const { URL } = await import('url');

const COUNT = parseInt(process.argv[2] || '15');
const RESOLVE_TIMEOUT = 5000;
const nodes = new Map();

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function testLatency(url) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = parseInt(parsed.port) || (parsed.protocol === 'wss:' ? 443 : 80);
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = net.default.createConnection({ host, port, timeout: 3000 }, () => {
      socket.destroy();
      resolve(Date.now() - start);
    });
    socket.on('error', () => { socket.destroy(); resolve(-1); });
    socket.on('timeout', () => { socket.destroy(); resolve(-1); });
  });
}

// Run discovery calls concurrently in batches
const promises = [];
for (let i = 0; i < COUNT; i++) {
  promises.push(
    withTimeout(new Resolver().getUrl(Encoding.Borsh, 'mainnet'), RESOLVE_TIMEOUT).catch(() => null)
  );
}

const urls = await Promise.all(promises);
const unique = [...new Set(urls.filter(Boolean))];

// Test latency for all unique nodes concurrently
const latencyResults = await Promise.all(
  unique.map(async url => ({ url, latency: await testLatency(url) }))
);

const result = latencyResults
  .filter(n => n.latency >= 0)
  .sort((a, b) => a.latency - b.latency);

process.stdout.write(JSON.stringify(result));
process.exit(0);
