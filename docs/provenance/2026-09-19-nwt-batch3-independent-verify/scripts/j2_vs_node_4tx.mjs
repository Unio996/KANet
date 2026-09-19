import { readFileSync } from 'node:fs';
import { utxoPlurality, spkLenOf } from './port_mass.mjs';
const { handComputeStorageMass, handComputeComputeMass } = await import('../../src/lib/proto-mass-ceiling.mjs');
const T = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/onchain_txs_with_parents.json', 'utf8'));
const names = { '8c119539e065d713558132cf4e518cb950af28313c2a071ef55611b35f3fb0f8': 'market_genesis', 'aed39af62d9524e06a07569a11399b4395e0666d00187ddb5509fea2ee4a6f68': 'register_append#1', 'a5d664e46a8e2c617bf2b5d4e66601f1b7534284d4f94c550faa215dde34dbb6': 'register_append#2', 'e2c45b328b9a47bf315f09dc3d7873e4278beb4fe5f46ce3bd9d839baa6924c8': 'market_seal' };
for (const [id, nm] of Object.entries(names)) {
  const tx = T[id];
  const ins = tx.inputs.map((i) => { const p = T[i.previousOutpoint.transactionId].outputs[i.previousOutpoint.index]; return { plurality: utxoPlurality(spkLenOf(p.scriptPublicKey), !!p.covenant), amountSompi: BigInt(p.value) }; });
  const outs = tx.outputs.map((o) => ({ plurality: utxoPlurality(spkLenOf(o.scriptPublicKey), !!o.covenant), amountSompi: BigInt(o.value) }));
  const spkBytes = tx.outputs.reduce((s, o) => s + Number(spkLenOf(o.scriptPublicKey)) + 2, 0);
  const hc = handComputeComputeMass(0, spkBytes, tx.inputs.map((i) => Number(i.computeBudget ?? 0)));
  console.log(nm.padEnd(18), 'J2.handStorage=', String(handComputeStorageMass(outs, ins)).padStart(7), ' node.storage=', String(tx.storageMass).padStart(7), '| J2.handCompute(size=0)=', String(hc).padStart(6), ' node.compute=', tx.verboseData.computeMass);
}
