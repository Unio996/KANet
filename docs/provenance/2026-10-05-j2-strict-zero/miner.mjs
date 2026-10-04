// simnet-only throwaway miner (refuses non-simnet). usage: node miner.mjs [intervalMs]
import { createRequire } from 'node:module';
const require = createRequire('D:/kanet-tn12/scratch/_j2_wt_sz/kasia-relay/');
const kaspa = require('kaspa-wasm');
const iv = Number(process.argv[2] || 300);
const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:29717', encoding: kaspa.Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
if ((await rpc.getServerInfo()).networkId !== 'simnet') throw new Error('REFUSE: not simnet');
const addr = new kaspa.PrivateKey('11'.repeat(32)).toPublicKey().toAddress('simnet').toString();
console.log('[miner] simnet ok pay=', addr.slice(0, 20));
let n = 0;
for (;;) {
  try { const t = await rpc.getBlockTemplate({ payAddress: addr, extraData: [] }); await rpc.submitBlock({ block: t.block, allowNonDAABlocks: true }); n++; if (n % 50 === 0) console.log('[miner] blocks', n); } catch (e) { console.log('[miner] err', String(e.message || e).slice(0, 100)); }
  await new Promise((r) => setTimeout(r, iv));
}
