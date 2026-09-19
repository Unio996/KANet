import { readFileSync } from 'node:fs';
import { parsePushes } from './decode_pushes.mjs';
const dir = 'D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/';
const err = readFileSync(dir + 'dbg_stderr.txt', 'utf8');
const m = err.match(/J2_DEBUG active_sigscript_hex=([0-9a-f]+)/);
const upstream = Buffer.from(m[1], 'hex');
const j = JSON.parse(readFileSync(dir + 'onchain_txs.json', 'utf8'));
const tx = j['e2c45b328b9a47bf315f09dc3d7873e4278beb4fe5f46ce3bd9d839baa6924c8'].tx;
const sig = Buffer.from(tx.inputs[0].signatureScript, 'hex');
const redeemLen = 14746, redeemPushHdr = 3; // 4d + u16 len
const action = sig.subarray(0, sig.length - redeemLen - redeemPushHdr);
console.log('upstream action len', upstream.length, 'on-chain action len', action.length, 'BYTE-EQUAL =', upstream.equals(action));
// and the redeem push tail
const tail = sig.subarray(sig.length - redeemLen - redeemPushHdr, sig.length - redeemLen);
console.log('redeem push header on-chain', tail.toString('hex'), '(expect 4d 9a 39 = PUSHDATA2 len 14746)');
