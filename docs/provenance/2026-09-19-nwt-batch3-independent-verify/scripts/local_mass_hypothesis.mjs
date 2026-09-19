// NWT: 假设 —— kaspa-wasm calculateTransactionMass 的输入 UtxoEntry 没有 covenant 标志, 输入 plurality 恒按 1 算。
// 检验: 我的移植公式, 输入 plurality 强制=1, 输出 plurality 照真, 能否复现 J2 记录的本地 wasm 值(500,980 / 293116*1.404 / 231312*1.512)。
import { readFileSync } from 'node:fs';
import { utxoPlurality, spkLenOf, calcStorageMass, computeMass } from './port_mass.mjs';
const T = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/onchain_txs_with_parents.json', 'utf8'));
const ids = { 'register_append#1': 'aed39af62d9524e06a07569a11399b4395e0666d00187ddb5509fea2ee4a6f68', 'register_append#2': 'a5d664e46a8e2c617bf2b5d4e66601f1b7534284d4f94c550faa215dde34dbb6', market_seal: 'e2c45b328b9a47bf315f09dc3d7873e4278beb4fe5f46ce3bd9d839baa6924c8' };
for (const [n, id] of Object.entries(ids)) {
  const tx = T[id];
  const ins = tx.inputs.map((i) => { const p = T[i.previousOutpoint.transactionId].outputs[i.previousOutpoint.index]; return { p: 1n, a: BigInt(p.value) }; });
  const outs = tx.outputs.map((o) => ({ p: utxoPlurality(spkLenOf(o.scriptPublicKey), !!o.covenant), a: BigInt(o.value) }));
  const s = calcStorageMass(ins, outs).mass;
  console.log(n, 'storage with input-p forced 1 =', String(s), ' actual fee/100 =', String(BigInt(tx.inputs.length) && (() => { let si = 0n; for (const i of tx.inputs) si += BigInt(T[i.previousOutpoint.transactionId].outputs[i.previousOutpoint.index].value); let so = 0n; for (const o of tx.outputs) so += BigInt(o.value); return (si - so) / 100n; })()));
}
