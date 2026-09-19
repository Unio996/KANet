import { readFileSync } from 'node:fs';
import { parsePushes } from './decode_pushes.mjs';
const T = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/fullchain_txs.json', 'utf8'));
const CC = '9e3398a6b9d61c81b255f8a8ecbdd85d07e736fa42f684529acb15ab41f68570', CL = '1b1133ebb096379cbcbdc29c48716f21516383397c8dae747ebcf2c2172ef983';
for (const [name, id] of [['close_commit', CC], ['convert_to_claim', CL]]) {
  const tx = T[id]; console.log('\n==', name, id.slice(0, 12), 'version', tx.version, 'lockTime', tx.lockTime, 'ins', tx.inputs.length, 'outs', tx.outputs.length);
  tx.inputs.forEach((inp, n) => { console.log(`in[${n}] prev=${inp.previousOutpoint.transactionId.slice(0, 10)}:${inp.previousOutpoint.index} seq=${inp.sequence} sigLen=${inp.signatureScript.length / 2}`); if (n < 2) { const ps = parsePushes(inp.signatureScript); ps.forEach((p, k) => console.log(`   push[${k}] ${p.kind} len=${p.data.length} ${p.data.length <= 34 ? p.data.toString('hex') : p.data.subarray(0, 8).toString('hex') + '…'}`)); } });
  tx.outputs.forEach((o, n) => console.log(`out[${n}] value=${o.value} cov=${o.covenant ? o.covenant.authorizingInput + ':' + o.covenant.covenantId.slice(0, 8) : 'none'} spk=${o.scriptPublicKey.slice(0, 12)}…`));
}
