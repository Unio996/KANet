// READ-ONLY: backward getBlock walk in an independent process; measure wasm linear memory per call.
import * as kaspa from 'file:///D:/kanet-tn12/shared/vendor/kaspa-wasm/kaspa.js';
const { RpcClient, Encoding } = kaspa;
const mb = () => kaspa.__wasm.memory.buffer.byteLength/1048576;
const heap = () => process.memoryUsage().heapUsed/1048576;
const N = Number(process.argv[2]||20000), TXS = process.argv[3]==='tx';
const hard = setTimeout(()=>{console.log('HARD-TIMEOUT'); process.exit(0)}, 280000); hard.unref();
const rpc = new RpcClient({ url:'ws://127.0.0.1:17210', encoding:Encoding.Borsh, networkId:'testnet-12' });
await rpc.connect({});
const info = await rpc.getBlockDagInfo();
let hash = info.tipHashes[0]; let w0 = mb(), h0 = heap(), t0 = Date.now(), lastW = w0;
console.log(`start wasm=${w0.toFixed(1)} heap=${h0.toFixed(0)} tip=${hash.slice(0,12)} includeTransactions=${TXS}`);
let i = 0, errs = 0;
for (; i < N; i++) {
  let r; try { r = await rpc.getBlock({ hash, includeTransactions: TXS }); } catch (e) { errs++; if (errs > 20) break; continue; }
  const b = r.block ?? r; const next = b?.verboseData?.selectedParentHash || (b?.header?.parentsByLevel?.[0]?.[0]) || (b?.header?.parents?.[0]?.parentHashes?.[0]);
  if (!next) { console.log('no parent at i=',i, JSON.stringify(Object.keys(b||{}))); break; }
  hash = next;
  if ((i+1) % 5000 === 0) { const w = mb(); console.log(`  i=${i+1} wasm=${w.toFixed(1)} (+${(w-lastW).toFixed(1)}) heap=${heap().toFixed(0)} ${((Date.now()-t0)/(i+1)).toFixed(2)} ms/call`); lastW = w; }
}
const w1 = mb(); console.log(`done calls=${i} errs=${errs} dWasm=${(w1-w0).toFixed(1)}MB = ${((w1-w0)*1048576/Math.max(i,1)).toFixed(0)} B/call ; heap ${h0.toFixed(0)}->${heap().toFixed(0)} ; ${((Date.now()-t0)/1000).toFixed(0)}s`);
if (global.gc) { global.gc(); await new Promise(r=>setTimeout(r,500)); console.log(`after gc wasm=${mb().toFixed(1)} heap=${heap().toFixed(0)}`); 
  // second pass: does memory get REUSED after gc (i.e. was it garbage) or grow again (true leak)?
  let w2 = mb(); let j=0; for (; j<Math.min(N,10000); j++){ try { const r = await rpc.getBlock({ hash, includeTransactions: TXS }); const b=r.block??r; hash = b?.verboseData?.selectedParentHash || b?.header?.parentsByLevel?.[0]?.[0]; } catch { } }
  console.log(`second pass ${j} calls after gc: dWasm=${(mb()-w2).toFixed(1)}MB = ${((mb()-w2)*1048576/Math.max(j,1)).toFixed(0)} B/call`); }
await rpc.disconnect(); process.exit(0);
