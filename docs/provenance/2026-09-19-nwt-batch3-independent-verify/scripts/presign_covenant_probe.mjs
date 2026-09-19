// NWT: buildCloseCommitTxJson 的 presignTx 与最终 tx t 共用同一个 outputs 数组, 之后只给 t.outputs[0] 加 covenant。
// sighash 承诺 output.covenant(sighash.rs:233-235)。探针: presignTx 的 output 0 到底有没有 covenant?
const kaspa = await import('kaspa-wasm');
const spk = new kaspa.ScriptPublicKey(0, 'aa20' + '11'.repeat(32) + '87');
const op = { transactionId: '22'.repeat(32), index: 0 };
const mkIn = () => ({ previousOutpoint: op, signatureScript: new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: 1, utxo: { outpoint: op, amount: 20000000n, scriptPublicKey: spk, blockDaaScore: 0n } });
const outputs = [new kaspa.TransactionOutput(20000000n, spk)];
const presign = new kaspa.Transaction({ version: 1, inputs: [mkIn()], outputs, lockTime: 5n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '' });
const t = new kaspa.Transaction({ version: 1, inputs: [mkIn()], outputs, lockTime: 5n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '' });
console.log('before: presign.outputs[0].covenant =', presign.outputs[0].covenant, '| t.outputs[0].covenant =', t.outputs[0].covenant);
t.outputs[0].covenant = new kaspa.CovenantBinding(0, new kaspa.Hash('ab'.repeat(32)));
console.log('after setting on t: t cov =', t.outputs[0].covenant && String(t.outputs[0].covenant.covenantId).slice(0, 8), '| presign cov =', presign.outputs[0].covenant && String(presign.outputs[0].covenant.covenantId).slice(0, 8), '| shared outputs[0] cov =', outputs[0].covenant && 'set');
console.log('presign.outputs===t.outputs objects identical?', presign.outputs[0] === t.outputs[0]);
