// READ-ONLY, offline (no RPC, no keys): per-object wasm linear-memory cost, 3 arms: no-free / after gc reuse / explicit free.
import * as kaspa from 'file:///D:/kanet-tn12/shared/vendor/kaspa-wasm/kaspa.js';
import { readFileSync } from 'fs';
const { Address, ScriptBuilder, addressFromScriptPublicKey, XOnlyPublicKey, Transaction, TransactionOutput, payToAddressScript, CovenantBinding, Hash } = kaspa;
const mb = () => kaspa.__wasm.memory.buffer.byteLength/1048576;
const redeemHex = readFileSync(process.argv[2],'utf8').trim(); const redeem = new Uint8Array(Buffer.from(redeemHex,'hex'));
const ADDR = 'kaspatest:qr7cqq2eq5xyzq63yljgsfspmfce8nltrp9vhq5y0tjayzvhswtcvjc4pvxcx';
const PK = 'a'.repeat(64).replace(/a/g,(c,i)=>'0123456789abcdef'[(i*7)%16]);
const hold = [];
function arm(name, n, make, doFree) {
  const w0 = mb(); const t0=Date.now();
  for (let i=0;i<n;i++){ const o = make(); if (doFree) { try { o.free?.(); } catch{} } else hold.push(o); }
  const d = mb()-w0; console.log(`  ${name.padEnd(46)} n=${n} dWasm=${d.toFixed(1)}MB (${(d*1024/n).toFixed(1)} KB/obj) ${Date.now()-t0}ms`);
  return d;
}
async function gcDrain(){ hold.length=0; for(let i=0;i<3;i++){ global.gc(); await new Promise(r=>setTimeout(r,300)); } }
const makers = {
  'Address(str)': () => new Address(ADDR),
  'ScriptBuilder.fromScript(redeem 2119B).p2sh+addr': () => { const b=ScriptBuilder.fromScript(redeem); const spk=b.createPayToScriptHashScript(); const a=addressFromScriptPublicKey(spk,'testnet-12'); return b; },
  'XOnlyPublicKey(hex).toAddress': () => { const k=new XOnlyPublicKey(PK); k.toAddress('testnet-12'); return k; },
  'Transaction(1in sigScript 2.2KB, 2out covenant)': () => new Transaction({ version:0, inputs:[{ previousOutpoint:{ transactionId:'11'.repeat(32), index:0 }, signatureScript: Buffer.concat([Buffer.from([0x4d, redeem.length&0xff, redeem.length>>8]), Buffer.from(redeem)]).toString('hex'), sequence:0n, sigOpCount:1 }], outputs:[ new TransactionOutput(100000000n, payToAddressScript(new Address(ADDR)), new CovenantBinding(0, new Hash('22'.repeat(32)))), new TransactionOutput(50000000n, payToAddressScript(new Address(ADDR))) ], lockTime:0n, subnetworkId:'00'.repeat(20), gas:0n, payload:'' }),
};
console.log(`start wasm=${mb().toFixed(1)}MB`);
for (const [name, make] of Object.entries(makers)) {
  console.log(`\n== ${name}`);
  let ok=true; try { make(); } catch(e){ console.log('  CONSTRUCT ERROR:', e.message); ok=false; }
  if(!ok) continue;
  const n = name.startsWith('Transaction')? 300 : 2000;
  arm('A no-free (hold refs)', n, make, false);
  await gcDrain(); console.log(`  after gc: wasm=${mb().toFixed(1)}MB (cannot shrink; watch reuse next)`);
  arm('B no-free again after gc (reuse?)', n, make, false);
  await gcDrain();
  arm('C explicit .free()', n, make, true);
}
console.log('\n== serializeToSafeJSON x300 on one covenant tx (no free of result)');
{ const tx = makers['Transaction(1in sigScript 2.2KB, 2out covenant)'](); const w0=mb(); for(let i=0;i<300;i++){ const j=tx.serializeToSafeJSON(); hold.push(j); } console.log(`  dWasm=${(mb()-w0).toFixed(1)}MB`); hold.length=0; }
console.log('\n== calculateTransactionMass on covenant tx x20 (try/catch each)');
{ const tx = makers['Transaction(1in sigScript 2.2KB, 2out covenant)'](); let errs={}; const w0=mb(); for(let i=0;i<20;i++){ try{ const m=kaspa.calculateTransactionMass('testnet-12', tx); if(i==0) console.log('  mass=',String(m)); }catch(e){ const k=(e && (e.message||String(e))).slice(0,80); errs[k]=(errs[k]||0)+1; } } console.log(`  dWasm=${(mb()-w0).toFixed(1)}MB errors=`, errs); }
console.log(`\nfinal wasm=${mb().toFixed(1)}MB`);
