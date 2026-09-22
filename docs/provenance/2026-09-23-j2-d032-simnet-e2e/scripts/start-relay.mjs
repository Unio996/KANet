// start-relay.mjs — 用生产 startRelay() 起 relay 子进程(D-031 复用 relay-manager.js, 不手拼 env/fork)。
// 用法: DB_PATH=... CONSOLE_ENCRYPTION_KEY=... KASPA_NETWORK=simnet KASPA_RPC_URL=... RELAY_DIR=... KANET_ROOT=... node start-relay.mjs <relayId>
import { pathToFileURL } from 'node:url';
const KC_SRC = 'D:/kanet-tn12/scratch/_j2_wt_e2e/kasia-console/src';
const relayId = process.argv[2];
if (!relayId) { console.error('usage: node start-relay.mjs <relayId>'); process.exit(1); }
const { startRelay } = await import(pathToFileURL(`${KC_SRC}/services/relay-manager.js`).href);
const r = await startRelay(relayId);
console.log('[start-relay] result:', JSON.stringify(r));
if (!r.ok) process.exit(2);
// 保持本进程存活(child 是独立进程, 但我们借这个壳留 stdout/stderr 管道日志; 供 harness poll)
setInterval(() => {}, 60_000);
