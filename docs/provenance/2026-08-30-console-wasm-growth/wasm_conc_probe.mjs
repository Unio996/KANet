import * as kaspa from 'file:///D:/kanet-tn12/shared/vendor/kaspa-wasm/kaspa.js';
const { RpcClient, Encoding, Address } = kaspa; const mb=()=>kaspa.__wasm.memory.buffer.byteLength/1048576;
const ADDRS = process.argv.slice(2);
const hard=setTimeout(()=>{console.log('HARD-TIMEOUT');process.exit(0)},120000); hard.unref();
const rpc=new RpcClient({url:'ws://127.0.0.1:17210',encoding:Encoding.Borsh,networkId:'testnet-12'}); await rpc.connect({});
let w0=mb(); console.log(`start wasm=${w0.toFixed(1)} addrs=${ADDRS.length}`);
for (let round=0; round<30; round++) { await Promise.all(ADDRS.map(a => rpc.getUtxosByAddresses([new Address(a)]))); if (round%10==9) console.log(`  round ${round+1}: wasm=${mb().toFixed(1)} (+${(mb()-w0).toFixed(1)})`); }
console.log(`concurrent utxo: ${30*ADDRS.length} calls dWasm=${(mb()-w0).toFixed(1)}MB`);
w0=mb(); for (let round=0; round<30; round++) { await Promise.all([rpc.getBlockDagInfo(), rpc.getServerInfo(), rpc.getSinkBlueScore?.(), rpc.getInfo()].filter(Boolean)); }
console.log(`concurrent info x120: dWasm=${(mb()-w0).toFixed(1)}MB`);
await rpc.disconnect(); process.exit(0);
