// NWT: 独立验证 market_seal out[0] 的 P2SH = blake2b256(rc_prefix ‖ state7 ‖ rc_suffix), state 编码自写(int→08+8B LE; bytes32→20+32B)。
import { readFileSync } from 'node:fs';
import { blake2b } from '@noble/hashes/blake2b';
import { parsePushes } from './decode_pushes.mjs';
const T = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/onchain_txs_with_parents.json', 'utf8'));
const tx = T['e2c45b328b9a47bf315f09dc3d7873e4278beb4fe5f46ce3bd9d839baa6924c8'];
const ps = parsePushes(tx.inputs[0].signatureScript);
const [prefix, suffix] = [ps[1].data, ps[2].data];
const i8 = (n) => { const b = Buffer.alloc(9); b[0] = 0x08; b.writeBigInt64LE(BigInt(n), 1); return b; };
const state = Buffer.concat([i8(1), i8(999), i8(2), i8(1000), i8(0), i8(0), Buffer.concat([Buffer.from([0x20]), Buffer.alloc(32)])]);
const redeem = Buffer.concat([prefix, state, suffix]);
const h = Buffer.from(blake2b(redeem, { dkLen: 32 })).toString('hex');
const spk = tx.outputs[0].scriptPublicKey; // 0000 aa20 <hash> 87
console.log('recomputed RootClose P2SH hash', h); console.log('on-chain out[0] spk           ', spk);
console.log('MATCH =', spk === '0000aa20' + h + '87');
