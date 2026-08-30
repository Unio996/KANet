import * as kaspa from 'file:///D:/kanet-tn12/shared/vendor/kaspa-wasm/kaspa.js';
const { RpcClient, Encoding, Address } = kaspa; const mb=()=>kaspa.__wasm.memory.buffer.byteLength/1048576;
const FAUCET='kaspatest:qr7cqq2eq5xyzq63yljgsfspmfce8nltrp9vhq5y0tjayzvhswtcvjc4pvxcx';
const rpc=new RpcClient({url:'ws://127.0.0.1:17210',encoding:Encoding.Borsh,networkId:'testnet-12'}); await rpc.connect({});
const info=await rpc.getBlockDagInfo(); const tip=info.tipHashes[0];
// A: 50 concurrent mixed calls on ONE client
let t0=Date.now(); const rs=await Promise.allSettled(Array.from({length:50},(_,i)=> i%3===0? rpc.getBlockDagInfo() : i%3===1? rpc.getUtxosByAddresses([new Address(FAUCET)]) : rpc.getBlock({hash:tip,includeTransactions:false})));
console.log(`A concurrent x50 on one client: ok=${rs.filter(r=>r.status==='fulfilled').length} fail=${rs.filter(r=>r.status==='rejected').length} ${Date.now()-t0}ms wasm=${mb().toFixed(1)}`);
// B: ordering — do responses come back in request order? (tag by sequence)
t0=Date.now(); const order=[]; await Promise.all(Array.from({length:20},(_,i)=> rpc.getBlockDagInfo().then(()=>order.push(i)))); console.log(`B response order for 20 parallel getBlockDagInfo: ${order.join(',')} (${Date.now()-t0}ms)`);
// C: call while disconnected → error shape; then reconnect and call again
await rpc.disconnect(); let e1='ok'; try{ await Promise.race([rpc.getBlockDagInfo(), new Promise((_,r)=>setTimeout(()=>r(new Error('TIMEOUT 3s')),3000))]); }catch(e){ e1=String(e.message||e).slice(0,80); } console.log(`C call after disconnect: ${e1}`);
await rpc.connect({}); let e2='ok'; try{ await rpc.getBlockDagInfo(); }catch(e){ e2=String(e.message||e).slice(0,80);} console.log(`C reconnect same instance then call: ${e2}; isConnected=${rpc.isConnected}`);
// D: is there an isConnected/url property to health-check without a new client?
console.log(`D props: isConnected=${rpc.isConnected} url=${rpc.url} nodeId? ${typeof rpc.nodeId}`);
// E: 5 concurrent getUtxos on big addresses (relay addrs) to see mass concurrency ok
await rpc.disconnect(); process.exit(0);
