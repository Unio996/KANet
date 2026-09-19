import { readFileSync } from 'node:fs';
import { parsePushes } from './decode_pushes.mjs';
const T = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/claimdraw_txs.json', 'utf8'));
const ID = '0c1d966659fbb7cbc388a42a15ac05429f2ffdf4ae8088b39eeb324295c8c06f';
const tx = T[ID]; console.log('version', tx.version, 'lockTime', tx.lockTime, 'ins', tx.inputs.length, 'outs', tx.outputs.length, 'storage', tx.storageMass, 'compute', tx.verboseData?.computeMass);
tx.inputs.forEach((inp, n) => { const par = T[inp.previousOutpoint.transactionId]?.outputs[inp.previousOutpoint.index]; console.log(`in[${n}] prev=${inp.previousOutpoint.transactionId.slice(0, 10)}:${inp.previousOutpoint.index} parentVal=${par?.value} parentCov=${!!par?.covenant} sigLen=${inp.signatureScript.length / 2}`); if (n < 3) { const ps = parsePushes(inp.signatureScript); ps.forEach((p, k) => console.log(`   push[${k}] ${p.kind} len=${p.data.length} ${p.data.length <= 34 ? p.data.toString('hex') : p.data.subarray(0, 6).toString('hex') + '…'}`)); } });
tx.outputs.forEach((o, n) => console.log(`out[${n}] value=${o.value} cov=${o.covenant ? o.covenant.authorizingInput : 'none'} spk=${o.scriptPublicKey.slice(0, 14)}…`));
