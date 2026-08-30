import * as kaspa from 'file:///D:/kanet-tn12/shared/vendor/kaspa-wasm/kaspa.js';
const { RpcClient, Encoding } = kaspa; const mb=()=>kaspa.__wasm.memory.buffer.byteLength/1048576;
const N=Number(process.argv[2]||100); const w0=mb(); const t0=Date.now(); let ok=0, fail=0; const errs={};
for (let i=0;i<N;i++){ const rpc=new RpcClient({url:'ws://127.0.0.1:17210',encoding:Encoding.Borsh,networkId:'testnet-12'}); const t=Date.now();
  try { await Promise.race([rpc.connect({}), new Promise((_,r)=>setTimeout(()=>r(new Error('RPC connect timeout')),4000))]); ok++; } catch(e){ fail++; const k=String(e.message||e).slice(0,60); errs[k]=(errs[k]||0)+1; }
  try { await rpc.disconnect(); } catch {} }
console.log(`N=${N} ok=${ok} fail=${fail} errs=${JSON.stringify(errs)} elapsed=${Date.now()-t0}ms wasm ${w0.toFixed(1)}->${mb().toFixed(1)} MB (+${(mb()-w0).toFixed(2)}, ${((mb()-w0)*1024/N).toFixed(1)} KB/client)`);
global.gc?.(); await new Promise(r=>setTimeout(r,300)); const w2=mb(); for (let i=0;i<N;i++){ const rpc=new RpcClient({url:'ws://127.0.0.1:17210',encoding:Encoding.Borsh,networkId:'testnet-12'}); try{ await Promise.race([rpc.connect({}), new Promise((_,r)=>setTimeout(()=>r(new Error('t')),4000))]); }catch{} try{ await rpc.disconnect(); }catch{} }
console.log(`second pass after gc: +${(mb()-w2).toFixed(2)} MB`); process.exit(0);
