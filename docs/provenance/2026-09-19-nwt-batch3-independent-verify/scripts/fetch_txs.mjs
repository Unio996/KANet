// NWT 只读: 从 simnet 节点(15972, ws borsh 18510)按 txid 取回 4 笔链上原始交易, 落 JSON。不提交任何交易。
import { writeFileSync } from 'node:fs';
const kaspa = await import('kaspa-wasm');
const want = new Set([
  '8c119539e065d713558132cf4e518cb950af28313c2a071ef55611b35f3fb0f8',
  'aed39af62d9524e06a07569a11399b4395e0666d00187ddb5509fea2ee4a6f68',
  'a5d664e46a8e2c617bf2b5d4e66601f1b7534284d4f94c550faa215dde34dbb6',
  'e2c45b328b9a47bf315f09dc3d7873e4278beb4fe5f46ce3bd9d839baa6924c8',
]);
const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:18510', networkId: 'simnet' });
await rpc.connect();
const info = await rpc.getBlockDagInfo();
console.log('daa', info.virtualDaaScore, 'blocks', info.blockCount, 'pp', info.pruningPointHash);
const found = {};
let low = undefined, pages = 0, seen = 0;
while (pages < 500) {
  const res = await rpc.getBlocks({ lowHash: low, includeBlocks: true, includeTransactions: true });
  const blocks = res.blocks || [];
  if (!blocks.length) break;
  for (const b of blocks) {
    seen++;
    for (const tx of b.transactions || []) {
      const id = tx.verboseData?.transactionId;
      if (want.has(id)) found[id] = { blockHash: b.header.hash, tx: tx.serializeToSafeJSON ? tx.serializeToSafeJSON() : tx };
    }
  }
  const last = blocks[blocks.length - 1].header.hash;
  if (last === low || blocks.length < 2) break;
  low = last; pages++;
  if (Object.keys(found).length === want.size) break;
}
console.log('blocks seen', seen, 'found', Object.keys(found).length);
writeFileSync(new URL('./onchain_txs.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), JSON.stringify(found, (k, v) => typeof v === 'bigint' ? v.toString() : v, 1));
await rpc.disconnect();
