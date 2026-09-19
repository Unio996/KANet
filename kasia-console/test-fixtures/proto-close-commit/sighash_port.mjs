// NWT 独立移植: rusty-kaspa v2.0.1 consensus/core/src/hashing/sighash.rs calc_schnorr_signature_hash (SIG_HASH_ALL, tx.version>=1) + schnorr 验签。
import { blake2b } from '@noble/hashes/blake2b';
import { schnorr } from '@noble/curves/secp256k1';
const KEY = Buffer.from('TransactionSigningHash');
const H = (parts) => Buffer.from(blake2b(Buffer.concat(parts), { dkLen: 32, key: KEY }));
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const varBytes = (b) => Buffer.concat([u64(b.length), b]);
const spkHash = (scriptHex) => Buffer.concat([u16(0), varBytes(Buffer.from(scriptHex, 'hex'))]);
export function sighashAll(tx, i) {
  const prevOutputs = H(tx.inputs.map((x) => Buffer.concat([Buffer.from(x.txid, 'hex'), u32(x.index)])));
  const sequences = H(tx.inputs.map((x) => u64(x.sequence)));
  const outputs = H(tx.outputs.map((o) => Buffer.concat([u64(o.value), spkHash(o.spkHex), Buffer.from([o.covenant ? 1 : 0]), ...(o.covenant ? [u16(o.covenant.auth), Buffer.from(o.covenant.id, 'hex')] : [])])));
  const inp = tx.inputs[i];
  const payload = Buffer.alloc(32); // native + empty payload => ZERO_HASH
  return H([u16(tx.version), prevOutputs, sequences, Buffer.from(inp.txid, 'hex'), u32(inp.index), spkHash(inp.spkHex), u64(inp.amount), u64(inp.sequence), outputs, u64(tx.lockTime), Buffer.alloc(20), u64(0), payload, Buffer.from([0x01])]);
}
export const verify = (sig64hex, hash, pkHex) => { try { return schnorr.verify(Buffer.from(sig64hex, 'hex'), hash, Buffer.from(pkHex, 'hex')); } catch { return false; } };

if ((process.argv[1] ?? '').endsWith('sighash_port.mjs')) {
  // 自检: 用 wasm createInputSignature 签, 我的移植验; 正向必真, 改 covenant 必假(证明移植对 covenant 敏感且对得上)
  const kaspa = await import('kaspa-wasm'); const { randomBytes } = await import('node:crypto');
  const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex')); const pk = priv.toPublicKey().toXOnlyPublicKey().toString();
  const spkIn = new kaspa.ScriptPublicKey(0, 'aa20' + '11'.repeat(32) + '87');
  const mkIn = (id, amt) => { const op = { transactionId: id, index: 0 }; return { previousOutpoint: op, signatureScript: new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: 1, utxo: { outpoint: op, amount: amt, scriptPublicKey: spkIn, blockDaaScore: 0n } }; };
  const out = new kaspa.TransactionOutput(20000000n, new kaspa.ScriptPublicKey(0, 'aa20' + '33'.repeat(32) + '87'));
  out.covenant = new kaspa.CovenantBinding(0, new kaspa.Hash('ab'.repeat(32)));
  const tx = new kaspa.Transaction({ version: 1, inputs: [mkIn('00'.repeat(32), 20000000n), mkIn('01'.repeat(32), 95000000n)], outputs: [out], lockTime: 1789809900050n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '' });
  const r = kaspa.createInputSignature(tx, 0, priv, kaspa.SighashType.All); const sig64 = (r.startsWith('0x') ? r.slice(2) : r).slice(2, 2 + 128);
  const d = { version: 1, lockTime: 1789809900050n, inputs: [{ txid: '00'.repeat(32), index: 0, sequence: 0, spkHex: 'aa20' + '11'.repeat(32) + '87', amount: 20000000n }, { txid: '01'.repeat(32), index: 0, sequence: 0, spkHex: 'aa20' + '11'.repeat(32) + '87', amount: 95000000n }], outputs: [{ value: 20000000n, spkHex: 'aa20' + '33'.repeat(32) + '87', covenant: { auth: 0, id: 'ab'.repeat(32) } }] };
  console.log('self-check same tx (covenant present)      => verify =', verify(sig64, sighashAll(d, 0), pk), '(expect true)');
  const d2 = JSON.parse(JSON.stringify(d, (k, v) => typeof v === 'bigint' ? v.toString() : v)); d2.lockTime = BigInt(d2.lockTime); d2.inputs.forEach((x) => { x.amount = BigInt(x.amount); }); d2.outputs[0].value = 20000000n; delete d2.outputs[0].covenant;
  console.log('self-check covenant stripped from tx        => verify =', verify(sig64, sighashAll(d2, 0), pk), '(expect false)');
}
