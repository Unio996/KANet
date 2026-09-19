import { readFileSync } from 'node:fs';
import { calcStorageMass } from './port_mass.mjs';
const kaspa = await import('kaspa-wasm');
const T = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/claimdraw_txs.json', 'utf8'));
const tx = T['0c1d966659fbb7cbc388a42a15ac05429f2ffdf4ae8088b39eeb324295c8c06f'];
const spkOf = (h) => new kaspa.ScriptPublicKey(0, h.slice(4));
function draft(v, leftover) {
  const inputs = tx.inputs.map((inp, k) => { const par = T[inp.previousOutpoint.transactionId].outputs[inp.previousOutpoint.index]; const op = { transactionId: inp.previousOutpoint.transactionId, index: inp.previousOutpoint.index }; return { previousOutpoint: op, signatureScript: k === 3 ? new Uint8Array(0) : Buffer.from(inp.signatureScript, 'hex'), sequence: 0n, sigOpCount: 0, computeBudget: Number(inp.computeBudget ?? 0), utxo: { outpoint: op, amount: k === 3 ? v : BigInt(par.value), scriptPublicKey: spkOf(par.scriptPublicKey), blockDaaScore: 0n } }; });
  const outputs = tx.outputs.map((o, k) => { const out = new kaspa.TransactionOutput(k === 2 ? leftover : BigInt(o.value), spkOf(o.scriptPublicKey)); if (o.covenant) out.covenant = new kaspa.CovenantBinding(o.covenant.authorizingInput, new kaspa.Hash(o.covenant.covenantId)); return out; });
  return new kaspa.Transaction({ version: 1, inputs, outputs, lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '' });
}
const M = 20_000_000n; const P = (p, a) => ({ p: BigInt(p), a: BigInt(a) });
const rows = [];
for (const v of [50_000_000n, 60_000_000n, 70_000_000n, 95_000_000n, 100_000_000n]) {
  const left = v + M; // leftover = v + ticket 20M (rc/held 各自抵扣 claim/token 输出)
  const w = BigInt(kaspa.calculateTransactionMass('simnet', draft(v, left)));
  const f = calcStorageMass([P(1, M), P(1, M), P(1, M), P(1, v)], [P(2, M), P(2, M), P(1, left)]).mass;
  rows.push({ v: String(v), wasmMass: String(w), formulaP1: String(f), equal: w === f, requiredFee: String(w * 100n) });
}
console.table(rows);
console.log('J2 实付 fee (fee input 95M) = 30,547,100 => draft wasm mass 305,471 ; 表内 v=95M 行应为 requiredFee 30,547,100');
