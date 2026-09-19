// NWT: 直接调 kaspa-wasm calculateTransactionMass, 用链上 market_seal 的真实形状(真 sigScript/真 outputs/covenant), 只改 fee UTXO 面值 v 与 draft change=v。
// 与我的公式(输入 plurality 恒 1 的 storage mass)逐位对拍 → 证明 requiredFee(v)=100×公式 对整条 v 曲线成立。
import { readFileSync } from 'node:fs';
import { calcStorageMass } from './port_mass.mjs';
const kaspa = await import('kaspa-wasm');
const T = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/onchain_txs_with_parents.json', 'utf8'));
const seal = T['e2c45b328b9a47bf315f09dc3d7873e4278beb4fe5f46ce3bd9d839baa6924c8'];
const spkOf = (h) => new kaspa.ScriptPublicKey(0, h.slice(4));
function draft(v) {
  const inputs = seal.inputs.map((inp, k) => {
    const par = T[inp.previousOutpoint.transactionId].outputs[inp.previousOutpoint.index]; const op = { transactionId: inp.previousOutpoint.transactionId, index: inp.previousOutpoint.index };
    return { previousOutpoint: op, signatureScript: k === 2 ? new Uint8Array(0) : Buffer.from(inp.signatureScript, 'hex'), sequence: 0n, sigOpCount: 0, computeBudget: Number(inp.computeBudget ?? 0), utxo: { outpoint: op, amount: k === 2 ? v : BigInt(par.value), scriptPublicKey: spkOf(par.scriptPublicKey), blockDaaScore: 0n } };
  });
  const outputs = seal.outputs.map((o, k) => { const out = new kaspa.TransactionOutput(k === 2 ? v : BigInt(o.value), spkOf(o.scriptPublicKey)); if (o.covenant) out.covenant = new kaspa.CovenantBinding(o.covenant.authorizingInput, new kaspa.Hash(o.covenant.covenantId)); return out; });
  return new kaspa.Transaction({ version: 1, inputs, outputs, lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '' });
}
const P = (p, a) => ({ p: BigInt(p), a: BigInt(a) }); const M = 20_000_000n;
for (const v of [50_000_000n, 70_000_000n, 95_000_000n, 100_000_000n]) {
  const wasm = kaspa.calculateTransactionMass('mainnet', draft(v));
  const mine = calcStorageMass([P(1, M), P(1, M), P(1, v)], [P(2, M), P(2, M), P(1, v)]).mass;
  console.log(`v=${v}  wasm.calculateTransactionMass=${wasm}  mine(storage,input p=1)=${mine}  equal=${BigInt(wasm) === mine}  requiredFee=${BigInt(wasm) * 100n}`);
}
