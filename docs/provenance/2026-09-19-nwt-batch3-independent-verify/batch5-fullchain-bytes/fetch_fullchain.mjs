// NWT 只读: 取回 J2 全链新一轮的六笔 + 其父交易 (simnet, 不提交任何交易)。
import { writeFileSync } from 'node:fs';
const kaspa = await import('kaspa-wasm');
const D = 'D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/';
const six = ['f3f871cab563d113338410c70e5addad7656c520ff649924b77fe1926bd0573a', 'd2f7384cbc0c04fdc6bf8ed99926e695731cfb4923d4f26ee227d139fe127e69', 'defb3fd90cf8e58e3f3a109d5159e2ae97b1b57cee1abcdcb3ded3c62c28345d', '78246e013e8b871511b98bdec11e640b252b63c44694eb107512bea9b6cb6bfb', '9e3398a6b9d61c81b255f8a8ecbdd85d07e736fa42f684529acb15ab41f68570', '1b1133ebb096379cbcbdc29c48716f21516383397c8dae747ebcf2c2172ef983'];
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
writeFileSync(D + 'fullchain_txs.json', JSON.stringify(out));
await rpc.disconnect();
