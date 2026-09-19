// NWT 批7: withdraw 链上交易解码 (只读)。
import { readFileSync } from 'node:fs';
import { parsePushes } from './decode_pushes.mjs';
const T = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/withdraw_txs.json', 'utf8'));
const ID = '39f4f2c6a0070b183fa7e5ffb241974b19db3b4346790ff4dfc1ab901c1ae508';
const tx = T[ID];
console.log('version', tx.version, 'lockTime', tx.lockTime, 'ins', tx.inputs.length, 'outs', tx.outputs.length, 'storage', tx.storageMass, 'compute', tx.verboseData?.computeMass);
tx.inputs.forEach((inp, n) => {
  const par = T[inp.previousOutpoint.transactionId]?.outputs[inp.previousOutpoint.index];
  console.log(`in[${n}] prev=${inp.previousOutpoint.transactionId.slice(0, 10)}:${inp.previousOutpoint.index} parentVal=${par?.value} parentCov=${par?.covenant ? par.covenant.covenantId.slice(0, 8) : 'none'} sigLen=${inp.signatureScript.length / 2}`);
  if (n < 2) { const ps = parsePushes(inp.signatureScript); ps.forEach((p, k) => console.log(`   push[${k}] ${p.kind} len=${p.data.length} ${p.data.length <= 34 ? p.data.toString('hex') : p.data.subarray(0, 6).toString('hex') + '…'}`)); }
});
tx.outputs.forEach((o, n) => console.log(`out[${n}] value=${o.value} cov=${o.covenant ? o.covenant.authorizingInput + ':' + o.covenant.covenantId.slice(0, 8) : 'none'} spk=${o.scriptPublicKey}`.slice(0, 200)));
