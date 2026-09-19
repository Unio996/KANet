// NWT: kaspa-wasm calculateTransactionMass 是否计入 v1 每输入 computeBudget (compute 维度 = size + 10*Σ(2+spkLen) + 100*Σbudget)?
// 同一笔 tx 只改 computeBudget: 0 / 70 / 5000。若 wasm 返回值不随 budget 变化 => wasm 漏计 budget 项。
// 对照: 我的移植公式 computeMass(tx)。只在本地算, 不碰节点。
import { computeMass, calcStorageMass, utxoPlurality, spkLenOf } from './port_mass.mjs';
const kaspa = await import('kaspa-wasm');
const spk = new kaspa.ScriptPublicKey(0, 'aa20' + 'ab'.repeat(32) + '87');
const mk = (budget, sigLen) => {
  const op = { transactionId: '11'.repeat(32), index: 0 };
  const inputs = [{ previousOutpoint: op, signatureScript: new Uint8Array(sigLen), sequence: 0n, sigOpCount: 0, computeBudget: budget, utxo: { outpoint: op, amount: 1_000_000_000n, scriptPublicKey: spk, blockDaaScore: 0n } }];
  const outputs = [new kaspa.TransactionOutput(900_000_000n, spk)];
  return new kaspa.Transaction({ version: 1, inputs, outputs, lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '' });
};
const rows = [];
for (const [budget, sigLen] of [[0, 190], [70, 190], [5000, 190], [70, 2000]]) {
  const t = mk(budget, sigLen);
  const w = BigInt(kaspa.calculateTransactionMass('simnet', t));
  const jsTx = { version: 1, inputs: [{ signatureScript: '00'.repeat(sigLen), computeBudget: budget }], outputs: [{ scriptPublicKey: spk.script.length ? '0000' + spk.script : '', value: '900000000' }], payload: '' };
  const cm = computeMass(jsTx);
  rows.push({ budget, sigLen, wasmMass: String(w), myCompute: String(cm.compute), myStorageP1: String(calcStorageMass([{ p: 1n, a: 1_000_000_000n }], [{ p: 1n, a: 900_000_000n }]).mass) });
}
console.table(rows);
