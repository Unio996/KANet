// NWT probe: which fields of a v1 tx does finalize()'s id cover? (deserializeFromSafeJSON keeps the JSON's own id; finalize() recomputes)
const kaspa = require('kaspa-wasm');
const spk = new kaspa.ScriptPublicKey(0, 'aa20' + 'ee'.repeat(32) + '87');
const outpoint = { transactionId: 'ab'.repeat(32), index: 0 };
const mk = () => new kaspa.Transaction({
  version: 1, lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
  inputs: [{ previousOutpoint: outpoint, signatureScript: '', sequence: 0n, sigOpCount: 1, computeBudget: 5, utxo: { outpoint, amount: 30000000n, scriptPublicKey: spk, blockDaaScore: 1n } }],
  outputs: [new kaspa.TransactionOutput(20000000n, spk, new kaspa.CovenantBinding(0, new kaspa.Hash('11'.repeat(32))))],
});
const tx = mk(); const id0 = tx.finalize(); const idStr = String(tx.id);
const json = tx.serializeToSafeJSON(); const obj = JSON.parse(json);
console.log('serialized keys: tx', Object.keys(obj).join(','), '| input', Object.keys(obj.inputs[0]).join(','), '| output', Object.keys(obj.outputs[0]).join(','));
console.log('output[0]:', JSON.stringify(obj.outputs[0]).slice(0, 220));
const re = (o) => { const t = kaspa.Transaction.deserializeFromSafeJSON(JSON.stringify(o)); const idNoFin = String(t.id); const idFin = String(t.finalize ? (t.finalize(), t.id) : t.id); return { idNoFin, idFin }; };
const base = re(obj);
console.log('roundtrip unchanged: keptId==orig?', base.idNoFin === idStr, ' finalizedId==orig?', base.idFin === idStr);
const clone = () => JSON.parse(json);
const muts = {
  'output value +1': (o) => { o.outputs[0].value = String(BigInt(o.outputs[0].value) + 1n); },
  'covenant id flipped': (o) => { const c = o.outputs[0].covenant; const k = c && (c.covenantId ?? c.covenant_id ?? c.id); if (c) { for (const key of Object.keys(c)) if (typeof c[key] === 'string' && c[key].length === 64) c[key] = '22'.repeat(32); } },
  'covenant authorizing input changed': (o) => { const c = o.outputs[0].covenant; if (c) for (const key of Object.keys(c)) if (typeof c[key] === 'number') c[key] = 1; },
  'input computeBudget changed': (o) => { o.inputs[0].computeBudget = 6; },
  'input sigOpCount changed': (o) => { o.inputs[0].sigOpCount = 2; },
  'input signatureScript set': (o) => { o.inputs[0].signatureScript = '4101' + 'aa'.repeat(64); },
  'input sequence changed': (o) => { o.inputs[0].sequence = '7'; },
  'tx payload set': (o) => { o.payload = 'deadbeef'; },
  'lockTime changed': (o) => { o.lockTime = '9'; },
};
for (const [name, fn] of Object.entries(muts)) {
  const o = clone(); try { fn(o); } catch (e) { console.log(name, 'PATCH-ERR', e.message); continue; }
  let r; try { r = re(o); } catch (e) { console.log(name.padEnd(36), 'ERR', e.message.slice(0, 60)); continue; }
  console.log(name.padEnd(36), 'id-without-finalize==orig:', r.idNoFin === idStr, '| id-after-finalize==orig:', r.idFin === idStr, r.idFin === idStr ? '  <== NOT COVERED by txid' : '  (covered)');
}
