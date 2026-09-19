// NWT: close_commit / convert_to_claim 的专属 fee cap 推导。requiredFee(v)=100×wasmLocalMass(draft: change=leftover), 直接调 wasm 对链上真实 tx 形状(真 sigScript/真 outputs/covenant), 只改 fee UTXO 面值 v。
import { readFileSync } from 'node:fs';
import { calcStorageMass } from './port_mass.mjs';
const kaspa = await import('kaspa-wasm');
const T = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/fullchain_txs.json', 'utf8'));
const spkOf = (h) => new kaspa.ScriptPublicKey(0, h.slice(4));
function draft(tx, feeIdx, changeIdx, v, leftover) {
  const inputs = tx.inputs.map((inp, k) => { const par = T[inp.previousOutpoint.transactionId].outputs[inp.previousOutpoint.index]; const op = { transactionId: inp.previousOutpoint.transactionId, index: inp.previousOutpoint.index }; return { previousOutpoint: op, signatureScript: k === feeIdx ? new Uint8Array(0) : Buffer.from(inp.signatureScript, 'hex'), sequence: 0n, sigOpCount: 0, computeBudget: Number(inp.computeBudget ?? 0), utxo: { outpoint: op, amount: k === feeIdx ? v : BigInt(par.value), scriptPublicKey: spkOf(par.scriptPublicKey), blockDaaScore: 0n } }; });
  const outputs = tx.outputs.map((o, k) => { const out = new kaspa.TransactionOutput(k === changeIdx ? leftover : BigInt(o.value), spkOf(o.scriptPublicKey)); if (o.covenant) out.covenant = new kaspa.CovenantBinding(o.covenant.authorizingInput, new kaspa.Hash(o.covenant.covenantId)); return out; });
  return new kaspa.Transaction({ version: 1, inputs, outputs, lockTime: BigInt(tx.lockTime), subnetworkId: '0'.repeat(40), gas: 0n, payload: '' });
}
const M = 20_000_000n;
const shapes = { close_commit: { id: '9e3398a6b9d61c81b255f8a8ecbdd85d07e736fa42f684529acb15ab41f68570', feeIdx: 1, changeIdx: 1, leftover: (v) => v, // leftover=fee UTXO 面值(RootClose 自续约抵消)
    formula: (v) => calcStorageMass([{ p: 1n, a: M }, { p: 1n, a: v }], [{ p: 2n, a: M }, { p: 1n, a: v }]).mass },
  convert_to_claim: { id: '1b1133ebb096379cbcbdc29c48716f21516383397c8dae747ebcf2c2172ef983', feeIdx: 2, changeIdx: 2, leftover: (v) => v,
    formula: (v) => calcStorageMass([{ p: 1n, a: M }, { p: 1n, a: M }, { p: 1n, a: v }], [{ p: 2n, a: M }, { p: 2n, a: M }, { p: 1n, a: v }]).mass } };
for (const [name, s] of Object.entries(shapes)) {
  console.log('==', name);
  const rows = [];
  for (const v of [30_000_000n, 40_000_000n, 50_000_000n, 70_000_000n, 95_000_000n, 100_000_000n]) {
    let wasm; try { wasm = BigInt(kaspa.calculateTransactionMass('mainnet', draft(T[s.id], s.feeIdx, s.changeIdx, v, s.leftover(v)))); } catch (e) { wasm = -1n; }
    rows.push({ v: String(v), wasmMass: String(wasm), formulaP1: String(s.formula(v)), equal: wasm === s.formula(v), requiredFee: String(wasm * 100n) });
  }
  console.table(rows);
}
