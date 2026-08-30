// READ-ONLY wasm linear-memory growth probe in an INDEPENDENT process (J2 diag 2026-08-30).
// Only read RPCs against local kaspad (same as scratch/_step0_gate.mjs). No console/relay touched.
import * as kaspa from 'file:///D:/kanet-tn12/shared/vendor/kaspa-wasm/kaspa.js';
const { RpcClient, Encoding, Address } = kaspa;
const URL = 'ws://127.0.0.1:17210', NET = 'testnet-12';
const ADDR = process.argv[2];
const mb = () => (kaspa.__wasm.memory.buffer.byteLength/1048576).toFixed(1);
const heap = () => (process.memoryUsage().heapUsed/1048576).toFixed(0);
const t = () => new Date().toISOString().slice(11,19);
const to = (p, ms, tag) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(tag+' timeout')), ms))]);
const hard = setTimeout(() => { console.log('HARD-TIMEOUT'); process.exit(0); }, 420000); hard.unref();
async function expA(n, doFree) {
  console.log(`\n== A: ${n}x new RpcClient->connect->getBlockDagInfo->disconnect${doFree?'->free()':''} | wasm0=${mb()}`);
  for (let i=0;i<n;i++){ const r=new RpcClient({url:URL,encoding:Encoding.Borsh,networkId:NET}); try{ await to(r.connect({}),5000,'connect'); await to(r.getBlockDagInfo(),5000,'gbdi'); await r.disconnect(); if(doFree) r.free(); }catch(e){ console.log('  err',e.message);} if(i%3==2) console.log(`  ${t()} i=${i+1} wasm=${mb()} heap=${heap()}`); }
  if (global.gc) global.gc();
  console.log(`  end wasm=${mb()}`);
}
async function expB(n) {
  console.log(`\n== B: one client, ${n}x getUtxosByAddresses([${ADDR.slice(0,20)}...]) | wasm0=${mb()}`);
  const r=new RpcClient({url:URL,encoding:Encoding.Borsh,networkId:NET}); await to(r.connect({}),5000,'connect');
  for (let i=0;i<n;i++){ const {entries}=await to(r.getUtxosByAddresses([new Address(ADDR)]),8000,'utxo'); if(i%5==4) console.log(`  ${t()} i=${i+1} entries=${entries.length} wasm=${mb()}`); }
  await r.disconnect(); console.log(`  end wasm=${mb()}`);
}
async function expD(n) {
  console.log(`\n== D: one client, ${n}x getBlockDagInfo+getServerInfo | wasm0=${mb()}`);
  const r=new RpcClient({url:URL,encoding:Encoding.Borsh,networkId:NET}); await to(r.connect({}),5000,'connect');
  for (let i=0;i<n;i++){ await to(r.getBlockDagInfo(),5000,'gbdi'); await to(r.getServerInfo(),5000,'gsi'); if(i%5==4) console.log(`  ${t()} i=${i+1} wasm=${mb()}`); }
  await r.disconnect(); console.log(`  end wasm=${mb()}`);
}
async function expC(sec) {
  console.log(`\n== C: idle persistent connection ${sec}s, sample /15s | wasm0=${mb()}`);
  const r=new RpcClient({url:URL,encoding:Encoding.Borsh,networkId:NET}); await to(r.connect({}),5000,'connect');
  for (let s=0;s<sec;s+=15){ await new Promise(x=>setTimeout(x,15000)); console.log(`  ${t()} +${s+15}s wasm=${mb()} heap=${heap()}`); }
  await r.disconnect(); console.log(`  end wasm=${mb()}`);
}
console.log(`start ${t()} wasm=${mb()} heap=${heap()} addr=${ADDR}`);
await expA(15,false); await expA(15,true); await expB(15); await expD(15); await expC(150);
console.log(`\nfinal ${t()} wasm=${mb()}`); process.exit(0);
