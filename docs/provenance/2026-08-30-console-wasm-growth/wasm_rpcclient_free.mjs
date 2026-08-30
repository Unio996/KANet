import * as kaspa from 'file:///D:/kanet-tn12/shared/vendor/kaspa-wasm/kaspa.js';
const { RpcClient, Encoding } = kaspa; const mb=()=>kaspa.__wasm.memory.buffer.byteLength/1048576;
const cyc = async (n, doFree, doConnect=true) => { const w=mb(); for (let i=0;i<n;i++){ const r=new RpcClient({url:'ws://127.0.0.1:17210',encoding:Encoding.Borsh,networkId:'testnet-12'}); if(doConnect){ try{ await r.connect({}); }catch{} try{ await r.disconnect(); }catch{} } if(doFree){ try{ r.free(); }catch(e){ console.log('free err', e.message); } } } global.gc(); await new Promise(x=>setTimeout(x,300)); return (mb()-w); };
console.log('A no-free, connect+disconnect: pass1 +'+(await cyc(100,false)).toFixed(2)+' pass2 +'+(await cyc(100,false)).toFixed(2)+' pass3 +'+(await cyc(100,false)).toFixed(2)+' MB');
console.log('B free(), connect+disconnect:  pass1 +'+(await cyc(100,true)).toFixed(2)+' pass2 +'+(await cyc(100,true)).toFixed(2)+' pass3 +'+(await cyc(100,true)).toFixed(2)+' MB');
console.log('C no-free, NO connect (construct only): pass1 +'+(await cyc(100,false,false)).toFixed(2)+' pass2 +'+(await cyc(100,false,false)).toFixed(2)+' MB');
console.log('D free(), NO connect: pass1 +'+(await cyc(100,true,false)).toFixed(2)+' pass2 +'+(await cyc(100,true,false)).toFixed(2)+' MB');
process.exit(0);
