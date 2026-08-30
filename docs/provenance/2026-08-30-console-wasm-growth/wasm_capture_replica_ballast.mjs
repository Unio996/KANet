// Same replica as wasm_capture_replica.mjs but with a retained JS-heap ballast (mimic console heap 60-350MB → rarer major GC).
import * as kaspa from 'file:///D:/kanet-tn12/shared/vendor/kaspa-wasm/kaspa.js';
const { RpcClient, Encoding } = kaspa; const mb=()=>kaspa.__wasm.memory.buffer.byteLength/1048576; const heap=()=>process.memoryUsage().heapUsed/1048576;
const ITER=Number(process.argv[2]||8), STEPS=Number(process.argv[3]||10000), SIDE='ff'.repeat(32);
const K=Number(process.env.BALLAST_K||0); const BALLAST=[]; for(let i=0;i<K*1000;i++) BALLAST.push({ i, s:'x'.repeat(64), a:[i,i+1,i+2] });
const hard=setTimeout(()=>{console.log('HARD-TIMEOUT');process.exit(0)},280000); hard.unref();
console.log(`ballast=${BALLAST.length} objs heap=${heap().toFixed(0)}MB start wasm=${mb().toFixed(1)} iter=${ITER} steps=${STEPS}`);
let churn=[]; // also add transient JS garbage per call like console's block objects
for (let it=0; it<ITER; it++) {
  const t0=Date.now(); const w0=mb();
  const rpc = new RpcClient({ url:'ws://127.0.0.1:17210', encoding:Encoding.Borsh, networkId:'testnet-12' });
  await rpc.connect({}); const info = await rpc.getBlockDagInfo(); let cursor = info?.sink; let n=0;
  for (let i=0;i<STEPS;i++){ const blkResp = await rpc.getBlock({ hash: cursor, includeTransactions: true }); const blk = blkResp?.block || blkResp; const txs = blk?.transactions || []; if (txs.find(t => (t?.verboseData?.transactionId || t?.id) === SIDE)) break; n++; churn.push(blk); if (churn.length>2000) churn=[]; const sp = blk?.verboseData?.selectedParentHash; if (!sp || sp === '0'.repeat(64)) break; cursor = sp; }
  try { await rpc.disconnect(); } catch {}
  console.log(`  iter ${it+1}: calls=${n} wasm=${mb().toFixed(1)} (+${(mb()-w0).toFixed(1)} MB) heap=${heap().toFixed(0)} ${((Date.now()-t0)/1000).toFixed(1)}s`);
}
if (global.gc) { global.gc(); await new Promise(r=>setTimeout(r,500)); console.log(`after manual gc: wasm=${mb().toFixed(1)} heap=${heap().toFixed(0)}`); }
process.exit(0);
