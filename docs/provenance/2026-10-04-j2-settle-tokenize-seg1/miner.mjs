// miner.mjs — 持续挖矿循环(simnet), 复用 fund-relay.mjs 的 getBlockTemplate+submitBlock 手法。
// 用法: node miner.mjs <intervalMs> <durationSec>
import { createRequire } from 'node:module';
const require = createRequire('D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-relay/');
const kaspa = require('kaspa-wasm');
const { RpcClient, Encoding, PrivateKey } = kaspa;

const RPC_URL = process.env.KASPA_RPC_URL || 'ws://127.0.0.1:29717';   // rpclisten-borsh port (Encoding.Borsh pairs with this, not --rpclisten)
const intervalMs = Number(process.argv[2] || 300);
const durationSec = Number(process.argv[3] || 3600);

const rpc = new RpcClient({ url: RPC_URL, encoding: Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
const info = await rpc.getServerInfo();
if (info.networkId !== 'simnet') { console.error('REFUSE: networkId != simnet, got', info.networkId); process.exit(3); }
console.log(`[miner] connected ${RPC_URL} networkId=${info.networkId}`);

import { readFileSync } from 'node:fs';
const priv = new PrivateKey(readFileSync('D:/kanet-tn12/scratch/_j2_tok_sim/bank.key','utf8').trim());
const payAddr = priv.toPublicKey().toAddress('simnet').toString();
console.log(`[miner] throwaway coinbase addr=${payAddr.slice(0, 20)}...`);

let blocks = 0;
const t0 = Date.now();
while (Date.now() - t0 < durationSec * 1000) {
  try {
    const tpl = await rpc.getBlockTemplate({ payAddress: payAddr, extraData: [] });
    const r = await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: false });
    blocks++;
    if (blocks % 20 === 0) console.log(`[miner] blocks=${blocks} daa=${tpl.block.header.daaScore} report=${JSON.stringify(r.report?.type ?? r)}`);
  } catch (e) {
    console.error('[miner] error:', String(e?.message ?? e).slice(0, 200));
  }
  await new Promise((s) => setTimeout(s, intervalMs));
}
console.log(`[miner] done, blocks=${blocks}`);
await rpc.disconnect().catch(() => {});
process.exit(0);
