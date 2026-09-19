// NWT 批7 withdraw 专属 fee cap (F3'): requiredFee(v) = 100 x wasm calculateTransactionMass(draft), draft = builder 的 mkTx(leftover) 形状 (只改 fee UTXO 面值 v, 找零 = leftover)。
// 同时: (a) 用我自己移植的 KIP-9 公式(输入 plurality 按真实 spk/covenant)复算真实 withdraw tx 的 storage/compute, 对节点区块记录 219,598/30,371;
//       (b) wasm mass == plurality 恒 1 的公式 (已知偏差根因), 以及 v=85M 行 requiredFee 对 J2 实付 33,976,400。
import { readFileSync } from 'node:fs';
import { calcStorageMass, computeMass, utxoPlurality, spkLenOf } from './port_mass.mjs';
const kaspa = await import('kaspa-wasm');
const T = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/withdraw_txs.json', 'utf8'));
const tx = T['39f4f2c6a0070b183fa7e5ffb241974b19db3b4346790ff4dfc1ab901c1ae508'];
const spkOf = (h) => new kaspa.ScriptPublicKey(0, h.slice(4));
const par = (inp) => T[inp.previousOutpoint.transactionId].outputs[inp.previousOutpoint.index];
function draft(v, changeVal) {
  const inputs = tx.inputs.map((inp, k) => { const p = par(inp); const op = { transactionId: inp.previousOutpoint.transactionId, index: inp.previousOutpoint.index }; return { previousOutpoint: op, signatureScript: k === 2 ? new Uint8Array(0) : Buffer.from(inp.signatureScript, 'hex'), sequence: 0n, sigOpCount: 0, computeBudget: Number(inp.computeBudget ?? 0), utxo: { outpoint: op, amount: k === 2 ? v : BigInt(p.value), scriptPublicKey: spkOf(p.scriptPublicKey), blockDaaScore: 0n } }; });
  const outputs = tx.outputs.map((o, k) => { const out = new kaspa.TransactionOutput(k === 2 ? changeVal : BigInt(o.value), spkOf(o.scriptPublicKey)); if (o.covenant) out.covenant = new kaspa.CovenantBinding(o.covenant.authorizingInput, new kaspa.Hash(o.covenant.covenantId)); return out; });
  return new kaspa.Transaction({ version: 1, inputs, outputs, lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '' });
}
const P = (p, a) => ({ p: BigInt(p), a: BigInt(a) });
// (a) 真实 tx, plurality 按真实 spk/covenant
{
  const ins = tx.inputs.map((inp) => { const p = par(inp); return P(utxoPlurality(spkLenOf(p.scriptPublicKey), !!p.covenant), p.value); });
  const outs = tx.outputs.map((o) => P(utxoPlurality(spkLenOf(o.scriptPublicKey), !!o.covenant), o.value));
  const st = calcStorageMass(ins, outs);
  console.log('真实 withdraw tx: 输入 plurality', ins.map((x) => String(x.p)).join(','), ' 输出 plurality', outs.map((x) => String(x.p)).join(','), '=> 我的公式 storage', String(st.mass ?? st), ' 节点区块记录 storage', tx.storageMass);
  const cm = computeMass(tx); console.log('  compute mass: MINE', String(cm.compute), '(size', String(cm.size) + ') | NODE computeMass', tx.verboseData?.computeMass);
}
// (b) fee 曲线
const M = 20_000_000n; const rows = [];
for (const v of [50_000_000n, 60_000_000n, 70_000_000n, 85_000_000n, 100_000_000n]) {
  const left = v; // = v + KTC(20M) + held(20M) - token(20M) - dest(20M)
  const w = BigInt(kaspa.calculateTransactionMass('simnet', draft(v, left)));
  const f = calcStorageMass([P(1, M), P(1, M), P(1, v)], [P(2, M), P(2, M), P(1, left)]).mass;
  rows.push({ v: String(v), wasmMass: String(w), formulaP1: String(f), equal: w === f, requiredFee: String(w * 100n) });
}
console.table(rows);
console.log('J2 实付 fee (fee input 85M) = 33,976,400 => wasm draft mass 339,764; 表内 v=85M 行 requiredFee 应为 33,976,400');
