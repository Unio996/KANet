// NWT: (1) convert_to_claim out[0] 的 P2SH = blake2b256(claim_prefix ‖ 8字段 RootClaim state ‖ claim_suffix)(自写 state 编码) (2) close_commit 的 5 个委员签名对链上 tx 的 sighash 验签(自移植)。
import { readFileSync } from 'node:fs';
import { blake2b } from '@noble/hashes/blake2b';
import { parsePushes } from './decode_pushes.mjs';
import { sighashAll, verify } from './sighash_port.mjs';
const T = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/fullchain_txs.json', 'utf8'));
const CC = '9e3398a6b9d61c81b255f8a8ecbdd85d07e736fa42f684529acb15ab41f68570', CL = '1b1133ebb096379cbcbdc29c48716f21516383397c8dae747ebcf2c2172ef983';
{ const tx = T[CL]; const ps = parsePushes(tx.inputs[0].signatureScript);
  const i8 = (n) => { const b = Buffer.alloc(9); b[0] = 8; b.writeBigInt64LE(BigInt(n), 1); return b; };
  const root = Buffer.alloc(32, 0xcd);
  const state = Buffer.concat([i8(1), i8(999), i8(2), i8(1000), i8(1), i8(1), Buffer.concat([Buffer.from([0x20]), root]), i8(0)]);
  const redeem = Buffer.concat([ps[1].data, state, ps[2].data]); const h = Buffer.from(blake2b(redeem, { dkLen: 32 })).toString('hex');
  console.log('convert_to_claim out[0] P2SH recomputed =', h.slice(0, 16) + '…', ' on-chain =', tx.outputs[0].scriptPublicKey.slice(8, 24) + '…', ' MATCH =', tx.outputs[0].scriptPublicKey === '0000aa20' + h + '87'); }
{ const tx = T[CC]; const ps = parsePushes(tx.inputs[0].signatureScript);
  const d = { version: tx.version, lockTime: BigInt(tx.lockTime), inputs: tx.inputs.map((i) => { const par = T[i.previousOutpoint.transactionId].outputs[i.previousOutpoint.index]; return { txid: i.previousOutpoint.transactionId, index: i.previousOutpoint.index, sequence: BigInt(i.sequence), spkHex: par.scriptPublicKey.slice(4), amount: BigInt(par.value) }; }),
    outputs: tx.outputs.map((o) => ({ value: BigInt(o.value), spkHex: o.scriptPublicKey.slice(4), covenant: o.covenant ? { auth: o.covenant.authorizingInput, id: o.covenant.covenantId } : null })) };
  const h = sighashAll(d, 0); const pk = ps[0].data.toString('hex');
  console.log('close_commit on-chain committee sigs vs my sighash port:', JSON.stringify(ps.slice(5, 10).map((p) => verify(p.data.subarray(0, 64).toString('hex'), h, pk))), ' sig hashtype bytes =', ps.slice(5, 10).map((p) => p.data[64]).join(','));
  console.log('close_commit fee input(in[1]) sequence/lockTime: seq', tx.inputs[1].sequence, ' tx.lockTime', tx.lockTime, ' (deadline baked = lockTime by builder)'); }
