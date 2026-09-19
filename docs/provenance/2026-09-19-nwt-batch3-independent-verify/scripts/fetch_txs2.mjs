// NWT 只读: 取 4 笔 + 其全部父交易(用于按 consensus 源码独立复算 mass)。不提交任何交易。
import { writeFileSync, readFileSync } from 'node:fs';
const kaspa = await import('kaspa-wasm');
const D = 'D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/';
const four = Object.keys(JSON.parse(readFileSync(D + 'onchain_txs.json', 'utf8')));
const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:18510', networkId: 'simnet' });
await rpc.connect();
const all = new Map();
let low; let pages = 0;
while (pages < 500) {
  const res = await rpc.getBlocks({ lowHash: low, includeBlocks: true, includeTransactions: true });
  const blocks = res.blocks || []; if (!blocks.length) break;
  for (const b of blocks) for (const tx of b.transactions || []) { const id = tx.verboseData?.transactionId; if (id && !all.has(id)) all.set(id, JSON.parse(JSON.stringify(tx, (k, v) => typeof v === "bigint" ? v.toString() : v))); }
  const last = blocks[blocks.length - 1].header.hash; if (last === low || blocks.length < 2) break; low = last; pages++;
}
const need = new Set(four);
for (const id of four) for (const inp of all.get(id).inputs) need.add(inp.previousOutpoint.transactionId);
const out = {}; for (const id of need) if (all.has(id)) out[id] = all.get(id); else console.log('missing', id);
console.log('indexed', all.size, 'saved', Object.keys(out).length);
writeFileSync(D + 'onchain_txs_with_parents.json', JSON.stringify(out, (k, v) => typeof v === 'bigint' ? v.toString() : v));
await rpc.disconnect();
