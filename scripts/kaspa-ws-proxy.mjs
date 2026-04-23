#!/usr/bin/env node
// Kaspa node WebSocket proxy — localhost TCP forwarder.
//
// Problem: HTTPS pages (kasia.fyi) cannot connect to ws://LAN-IP due to
// Mixed Content. But browsers exempt 127.0.0.1 / localhost from the block.
// Solution: forward 127.0.0.1:LISTEN → LAN-IP:TARGET so the page sees a
// loopback ws:// URL.
//
// Usage:
//   node scripts/kaspa-ws-proxy.mjs                # defaults below
//   KASPA_NODE=192.168.1.123 node scripts/kaspa-ws-proxy.mjs
//   LISTEN_PORT=17111 TARGET_PORT=17210 node scripts/kaspa-ws-proxy.mjs

import net from 'node:net';

const LISTEN_HOST = process.env.LISTEN_HOST || '127.0.0.1';
const LISTEN_PORT = Number(process.env.LISTEN_PORT || 17110);
const TARGET_HOST = process.env.KASPA_NODE || '192.168.1.123';
const TARGET_PORT = Number(process.env.TARGET_PORT || 17110);

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${ts()}]`, ...a);

let connId = 0;
const server = net.createServer((client) => {
  const id = ++connId;
  const from = `${client.remoteAddress}:${client.remotePort}`;
  log(`[${id}] open from ${from} → ${TARGET_HOST}:${TARGET_PORT}`);

  const upstream = net.connect(TARGET_PORT, TARGET_HOST);

  upstream.on('connect', () => log(`[${id}] upstream connected`));
  client.on('error', (e) => log(`[${id}] client err: ${e.code || e.message}`));
  upstream.on('error', (e) => {
    log(`[${id}] upstream err: ${e.code || e.message}`);
    client.destroy();
  });
  client.on('close', () => { log(`[${id}] client closed`); upstream.destroy(); });
  upstream.on('close', () => { log(`[${id}] upstream closed`); client.destroy(); });

  client.pipe(upstream);
  upstream.pipe(client);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`ERROR: ${LISTEN_HOST}:${LISTEN_PORT} already in use — another proxy running?`);
  } else {
    console.error('server error:', e);
  }
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  log(`Kaspa WS proxy listening ${LISTEN_HOST}:${LISTEN_PORT} → ${TARGET_HOST}:${TARGET_PORT}`);
  log(`In kasia.fyi, set node URL to: ws://${LISTEN_HOST}:${LISTEN_PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { log(`${sig} received, shutting down`); server.close(() => process.exit(0)); });
}
