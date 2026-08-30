// READ-ONLY: 1000 mixed calls — per-call new RpcClient (old pattern) vs one shared instance (batch-1 pattern). wasm delta compared.
import * as kaspa from 'file:///D:/kanet-tn12/shared/vendor/kaspa-wasm/kaspa.js';
const { RpcClient, Encoding, Address } = kaspa; const mb=()=>kaspa.__wasm.memory.buffer.byteLength/1048576;
const URL='ws://127.0.0.1:17210', NET='testnet-12', FAUCET='kaspatest:qr7cqq2eq5xyzq63yljgsfspmfce8nltrp9vhq5y0tjayzvhswtcvjc4pvxcx';
const N=Number(process.argv[2]||1000);
const op = async (rpc, i) => { if (i%3===0) return rpc.getBlockDagInfo(); if (i%3===1) return rpc.getUtxosByAddresses([new Address(FAUCET)]); return rpc.getServerInfo(); };
// arm A: per-call (old)
let w0=mb(), t0=Date.now();
for (let i=0;i<N;i++){ const r=new RpcClient({url:URL,encoding:Encoding.Borsh,networkId:NET}); try{ await r.connect({}); await op(r,i); }catch{} try{ await r.disconnect(); }catch{} }
global.gc(); await new Promise(x=>setTimeout(x,500)); const dA=mb()-w0; const tA=Date.now()-t0;
// arm B: shared (new)
w0=mb(); t0=Date.now(); const s=new RpcClient({url:URL,encoding:Encoding.Borsh,networkId:NET}); await s.connect({});
for (let i=0;i<N;i++){ try{ await op(s,i); }catch{} }
global.gc(); await new Promise(x=>setTimeout(x,500)); const dB=mb()-w0; const tB=Date.now()-t0; await s.disconnect();
console.log(`N=${N} mixed calls | per-call new RpcClient: wasm +${dA.toFixed(2)} MB (${(dA*1024/N).toFixed(1)} KB/call) ${tA} ms | shared one instance: wasm +${dB.toFixed(2)} MB (${(dB*1024/N).toFixed(2)} KB/call) ${tB} ms`);
process.exit(0);
