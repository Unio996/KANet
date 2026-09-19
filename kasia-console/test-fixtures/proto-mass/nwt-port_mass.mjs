// NWT 独立移植: rusty-kaspa v2.0.1 (tag=cfafeb4c093fa37a303f1b9f19c58f986b870ce3)
//   consensus/core/src/mass/mod.rs 的 calc_storage_mass(含 relaxed 分支) / calc_non_contextual_masses / transaction_estimated_serialized_size / utxo_plurality。
//   刻意不参照 J2 的 proto-mass-ceiling.mjs, 直接按 Rust 源码逐行移植, 再拿链上 4 笔真实交易的节点值对账。
import { readFileSync } from 'node:fs';
const D = 'D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/';
const C = 100_000_000n * 10_000n; // STORAGE_MASS_PARAMETER = SOMPI_PER_KASPA * 10_000 (constants.rs)
const HASH = 32n;
export const spkLenOf = (spk) => { const h = (typeof spk === 'string' ? spk : (spk.script ?? spk.scriptPublicKey ?? '')).replace(/^0x/, ''); return BigInt(typeof spk === 'string' ? (h.length - 4) / 2 : h.length / 2); }; // string form = 2B version + script
export function utxoPlurality(spkLen, hasCov) { const b = 32n + 4n + 8n + 8n + 1n + 2n + 8n + spkLen + (hasCov ? HASH : 0n); return (b + 99n) / 100n; }
// cells: [{p:BigInt, a:BigInt}]
export function calcStorageMass(ins, outs) {
  let outsP = 0n, harmOuts = 0n;
  for (const o of outs) { outsP += o.p; harmOuts += (C * o.p * o.p) / o.a; }
  let relaxed;
  if (outsP === 1n) relaxed = true;
  else if (ins.length > 2) relaxed = false;
  else { const insP = ins.reduce((s, c) => s + c.p, 0n); relaxed = insP === 1n || (outsP === 2n && insP === 2n); }
  const sat = (x, y) => (x > y ? x - y : 0n);
  if (relaxed) return { mass: sat(harmOuts, ins.reduce((s, c) => s + (C * c.p * c.p) / c.a, 0n)), path: 'relaxed(harmonic ins)', outsP };
  let insP = 0n, sumIns = 0n; for (const c of ins) { insP += c.p; sumIns += c.a; }
  let mean = sumIns / insP; if (mean < 1n) mean = 1n;
  return { mass: sat(harmOuts, insP * (C / mean)), path: 'arithmetic(mean ins)', outsP };
}
// tx: node JSON (blocks getBlocks form), version>=1 => compute_budget 2B per input
export function estSize(tx) {
  let s = 2n + 8n;
  for (const i of tx.inputs) { s += 32n + 4n + 8n + BigInt(i.signatureScript.length / 2) + 8n + (tx.version >= 1 ? 2n : 0n); }
  s += 8n;
  for (const o of tx.outputs) { const spk = o.scriptPublicKey; const l = spkLenOf(spk); s += 8n + 2n + 8n + l + (o.covenant ? 2n + HASH : 0n); }
  s += 8n + 20n + 8n + 32n + 8n + BigInt((tx.payload || '').replace(/^0x/, '').length / 2);
  return s;
}
export function computeMass(tx) {
  const size = estSize(tx);
  let spk = 0n; for (const o of tx.outputs) spk += 2n + spkLenOf(o.scriptPublicKey);
  let budget = 0n; for (const i of tx.inputs) budget += BigInt(i.computeBudget ?? 0);
  return { compute: size * 1n + spk * 10n + 100n * budget, size, transient: size * 4n /* TRANSIENT_BYTE_TO_MASS_FACTOR checked below */ };
}
if ((process.argv[1] ?? '').endsWith('port_mass.mjs')) {
  const T = JSON.parse(readFileSync(D + 'onchain_txs_with_parents.json', 'utf8'));
  const names = { '8c119539e065d713558132cf4e518cb950af28313c2a071ef55611b35f3fb0f8': 'market_genesis', 'aed39af62d9524e06a07569a11399b4395e0666d00187ddb5509fea2ee4a6f68': 'register_append#1', 'a5d664e46a8e2c617bf2b5d4e66601f1b7534284d4f94c550faa215dde34dbb6': 'register_append#2', 'e2c45b328b9a47bf315f09dc3d7873e4278beb4fe5f46ce3bd9d839baa6924c8': 'market_seal' };
  for (const [id, name] of Object.entries(names)) {
    const tx = T[id];
    const ins = tx.inputs.map((i) => { const par = T[i.previousOutpoint.transactionId].outputs[i.previousOutpoint.index]; return { p: utxoPlurality(spkLenOf(par.scriptPublicKey), !!par.covenant), a: BigInt(par.value), cov: !!par.covenant }; });
    const outs = tx.outputs.map((o) => ({ p: utxoPlurality(spkLenOf(o.scriptPublicKey), !!o.covenant), a: BigInt(o.value), cov: !!o.covenant }));
    const sm = calcStorageMass(ins, outs); const cm = computeMass(tx);
    const sumIn = ins.reduce((s, c) => s + c.a, 0n), sumOut = outs.reduce((s, c) => s + c.a, 0n);
    console.log(`\n${name} ${id.slice(0, 12)}…  ins=${ins.length}(p=${ins.map(c => c.p)}) outs=${outs.length}(p=${outs.map(c => c.p)})  fee=${sumIn - sumOut} sompi`);
    console.log(`  MINE storage=${sm.mass} via ${sm.path}  | NODE storageMass=${tx.storageMass} mass=${tx.mass}`);
    console.log(`  MINE compute=${cm.compute} (size ${cm.size})  | NODE computeMass=${tx.verboseData?.computeMass}  transientMass(node)=${tx.verboseData?.transientMass ?? 'n/a'}`);
    console.log('  node verboseData keys:', Object.keys(tx.verboseData || {}).join(','));
  }
}
