// storage_mass_scan.mjs — 读 S3 run4 的交易 id, 从 simnet 链上取全部块, 用 rusty-kaspa v2.0.x calc_storage_mass 公式(KIP-9, C=1e12, 密度单位 100B, covenant UTXO +32B)
// 对每笔重算 storage mass, 输出输入/输出面值与 plurality。只读。
import { readFileSync, writeFileSync } from 'node:fs';
import { rpcConnect } from './szlib.mjs';
const C = 1_000_000_000_000n;
const rr = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_j2_s3/s3_e2e_result.json', 'utf8'));
const want = new Set(rr.txs.map((t) => t.txid));
const rpc = await rpcConnect();
const all = new Map();
{ const info = await rpc.getBlockDagInfo(); let low = info.pruningPointHash;
  for (let pages = 0; pages < 800; pages++) { const r = await rpc.getBlocks({ lowHash: low, includeBlocks: true, includeTransactions: true }); const blocks = r.blocks || []; if (blocks.length < 2) break;
    for (const b of blocks) { for (const tx of b.transactions || []) { const id = tx.verboseData?.transactionId; if (id && !all.has(id)) all.set(id, tx); } low = b.header.hash; } } }
console.log('scanned txs', all.size);
const plur = (spkHex, cov) => BigInt(Math.ceil((63 + spkHex.length / 2 + (cov ? 32 : 0)) / 100));
const spkHexOf = (o) => (typeof o.scriptPublicKey === 'string' ? o.scriptPublicKey.slice(4) : (o.scriptPublicKey?.script ?? ''));
function mass(ins, outs) {
  let outsPlur = 0n, harm = 0n;
  for (const o of outs) { outsPlur += o.p; harm += C * o.p * o.p / o.v; }
  let relaxed;
  if (outsPlur === 1n) relaxed = true; else if (ins.length > 2) relaxed = false; else { const ip = ins.reduce((a, i) => a + i.p, 0n); relaxed = ip === 1n || (outsPlur === 2n && ip === 2n); }
  if (relaxed) { const hi = ins.reduce((a, i) => a + C * i.p * i.p / i.v, 0n); return harm > hi ? harm - hi : 0n; }
  const ip = ins.reduce((a, i) => a + i.p, 0n), sum = ins.reduce((a, i) => a + i.v, 0n); const mean = sum / ip; const arith = ip * (C / mean);
  return harm > arith ? harm - arith : 0n;
}
const rows = [];
for (const t of rr.txs) {
  const tx = all.get(t.txid); if (!tx) { rows.push({ txid: t.txid, missing: true }); continue; }
  const ins = [];
  for (const i of tx.inputs) { const prev = all.get(i.previousOutpoint.transactionId); const po = prev?.outputs?.[Number(i.previousOutpoint.index)]; if (!po) { ins.push(null); continue; } ins.push({ v: BigInt(po.value), p: plur(spkHexOf(po), !!po.covenant?.covenantId) }); }
  const outs = tx.outputs.map((o) => ({ v: BigInt(o.value), p: plur(spkHexOf(o), !!o.covenant?.covenantId) }));
  if (ins.some((x) => !x)) { rows.push({ txid: t.txid, unknownInputs: true }); continue; }
  rows.push({ txid: t.txid, ins: ins.map((x) => `${x.v}/p${x.p}`), outs: outs.map((x) => `${x.v}/p${x.p}`), storageMass: String(mass(ins, outs)) });
}
for (const r of rows) console.log(JSON.stringify(r));
writeFileSync('D:/kanet-tn12/scratch/_j2_sz/storage_mass_scan_result.json', JSON.stringify(rows, null, 1));
process.exit(0);
