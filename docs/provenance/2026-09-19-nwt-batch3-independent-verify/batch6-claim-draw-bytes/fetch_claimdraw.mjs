// NWT 只读: 取回 J2 全链新一轮的六笔 + 其父交易 (simnet, 不提交任何交易)。
import { writeFileSync } from 'node:fs';
const kaspa = await import('kaspa-wasm');
const D = 'D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/';
const six = ['0c1d966659fbb7cbc388a42a15ac05429f2ffdf4ae8088b39eeb324295c8c06f'];
const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:18510', networkId: 'simnet' });
await rpc.connect();
const all = new Map(); let low; let pages = 0;
while (pages < 800) {
  const res = await rpc.getBlocks({ lowHash: low, includeBlocks: true, includeTransactions: true });
  const blocks = res.blocks || []; if (!blocks.length) break;
  for (const b of blocks) for (const tx of b.transactions || []) { const id = tx.verboseData?.transactionId; if (id && !all.has(id)) all.set(id, { blockHash: b.header.hash, tx: JSON.parse(JSON.stringify(tx, (k, v) => typeof v === 'bigint' ? v.toString() : v)) }); }
  const last = blocks[blocks.length - 1].header.hash; if (last === low || blocks.length < 2) break; low = last; pages++;
}
const need = new Set(six); for (const id of six) { const e = all.get(id); if (!e) { console.log('MISSING', id); continue; } for (const i of e.tx.inputs) need.add(i.previousOutpoint.transactionId); }
const out = {}; for (const id of need) if (all.has(id)) out[id] = all.get(id).tx; else console.log('parent missing', id);
console.log('indexed', all.size, 'saved', Object.keys(out).length);
writeFileSync(D + 'claimdraw_txs.json', JSON.stringify(out));
await rpc.disconnect();
