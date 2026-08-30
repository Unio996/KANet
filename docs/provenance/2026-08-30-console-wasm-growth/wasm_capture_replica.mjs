// READ-ONLY replica of trade-protocol-filter.js captureSideLockDaa()'s IBD-period path:
//   per market: new RpcClient -> connect -> getBlockDagInfo (sink) -> up to MAX_STEPS getBlock({includeTransactions:true}) along selectedParentHash -> disconnect
// N iterations back-to-back (console does 177 per tick). Measures wasm linear memory after each iteration, no manual gc.
import * as kaspa from 'file:///D:/kanet-tn12/shared/vendor/kaspa-wasm/kaspa.js';
const { RpcClient, Encoding } = kaspa; const mb=()=>kaspa.__wasm.memory.buffer.byteLength/1048576; const heap=()=>process.memoryUsage().heapUsed/1048576;
const ITER=Number(process.argv[2]||8), STEPS=Number(process.argv[3]||10000), TXS=(process.argv[4]||'tx')==='tx', SIDE='ff'.repeat(32);
const hard=setTimeout(()=>{console.log('HARD-TIMEOUT');process.exit(0)},280000); hard.unref();
console.log(`start wasm=${mb().toFixed(1)} heap=${heap().toFixed(0)} iter=${ITER} steps=${STEPS} tx=${TXS}`);
for (let it=0; it<ITER; it++) {
  const t0=Date.now(); const w0=mb();
  const rpc = new RpcClient({ url:'ws://127.0.0.1:17210', encoding:Encoding.Borsh, networkId:'testnet-12' });
  await Promise.race([rpc.connect({}), new Promise((_,rej)=>setTimeout(()=>rej(new Error('RPC connect timeout')),4000))]);
  const info = await rpc.getBlockDagInfo(); let cursor = info?.sink; let n=0;
  for (let i=0;i<STEPS;i++){ const blkResp = await rpc.getBlock({ hash: cursor, includeTransactions: TXS }); const blk = blkResp?.block || blkResp; const txs = blk?.transactions || []; const hit = txs.find(t => (t?.verboseData?.transactionId || t?.id) === SIDE); n++; if (hit) break; const sp = blk?.verboseData?.selectedParentHash; if (!sp || sp === '0'.repeat(64)) break; cursor = sp; }
  try { await rpc.disconnect(); } catch {}
  console.log(`  iter ${it+1}: calls=${n} wasm=${mb().toFixed(1)} (+${(mb()-w0).toFixed(1)} MB) heap=${heap().toFixed(0)} ${((Date.now()-t0)/1000).toFixed(1)}s`);
}
if (global.gc) { global.gc(); await new Promise(r=>setTimeout(r,500)); console.log(`after manual gc: wasm=${mb().toFixed(1)} heap=${heap().toFixed(0)}`); }
process.exit(0);
