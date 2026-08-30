import * as kaspa from 'file:///D:/kanet-tn12/shared/vendor/kaspa-wasm/kaspa.js';
const mb=()=>kaspa.__wasm.memory.buffer.byteLength/1048576;
const p2sh=(bytes)=>kaspa.addressFromScriptPublicKey(kaspa.ScriptBuilder.fromScript(bytes).createPayToScriptHashScript(),'testnet-12').toString();
console.log('start wasm', mb().toFixed(1));
for (const KB of [2, 50, 200, 500, 1000]) {
  const bytes=new Uint8Array(KB*1024).fill(0x51);
  const w0=mb(); for (let i=0;i<5;i++) p2sh(bytes); const w1=mb();
  global.gc(); await new Promise(r=>setTimeout(r,200));
  const w2=mb(); for (let i=0;i<5;i++) p2sh(bytes); const w3=mb();
  global.gc(); await new Promise(r=>setTimeout(r,200));
  const w4=mb(); for (let i=0;i<5;i++) p2sh(bytes); const w5=mb();
  console.log(`redeem ${String(KB).padStart(4)} KB: 5x -> +${(w1-w0).toFixed(1)} MB | after gc 5x -> +${(w3-w2).toFixed(1)} | again -> +${(w5-w4).toFixed(1)}  (wasm now ${w5.toFixed(1)})`);
}
console.log('--- interleave: big(500KB) x5, small(2KB) x2000 held, big x5, gc, big x5 (fragmentation probe)');
const big=new Uint8Array(500*1024).fill(0x51), small=new Uint8Array(2*1024).fill(0x51); const hold=[];
let a=mb(); for(let i=0;i<5;i++) p2sh(big); let b=mb(); for(let i=0;i<2000;i++) hold.push(kaspa.ScriptBuilder.fromScript(small)); let c=mb(); for(let i=0;i<5;i++) p2sh(big); let d=mb(); global.gc(); await new Promise(r=>setTimeout(r,200)); let e=mb(); for(let i=0;i<5;i++) p2sh(big); let f=mb();
console.log(`big +${(b-a).toFixed(1)} | small-held +${(c-b).toFixed(1)} | big again +${(d-c).toFixed(1)} | gc | big again +${(f-e).toFixed(1)} (wasm ${f.toFixed(1)})`);
process.exit(0);
