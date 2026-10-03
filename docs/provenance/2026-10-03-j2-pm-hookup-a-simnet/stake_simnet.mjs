// B 组真共识验: 旧编译器(pool-p2sh.mjs)产出的 OracleStake_v1 押金脚本, 在主网同款 kaspad 2.0.1 simnet 上 注资→timeout_unlock 能否花出。
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const WT='D:/kanet-tn12/scratch/_j2_wt_pm_a';
process.env.DB_PATH='D:/kanet-tn12/scratch/_j2_pm_a_simnet/stake.db'; process.env.CONSOLE_ENCRYPTION_KEY='1'.repeat(64);
process.env.KASPA_RPC_URL='ws://127.0.0.1:29617'; process.env.KASPA_NETWORK='simnet';
const require=createRequire(`${WT}/kasia-relay/`); const kaspa=require('kaspa-wasm');
const { RpcClient, Encoding, PrivateKey, Address, Generator, PaymentOutput } = kaspa;
const imp=(p)=>import(pathToFileURL(p).href);
const S=await imp(`${WT}/kasia-console/src/lib/oracle-stake-v1.mjs`);
const R=await imp(`${WT}/kasia-relay/src/lib/p2sh.mjs`);
const rpc=new RpcClient({url:process.env.KASPA_RPC_URL,encoding:Encoding.Borsh,networkId:'simnet'}); await rpc.connect({});
const stakerPriv=new PrivateKey(randomBytes(32).toString('hex'));
const stakerPkX=stakerPriv.toPublicKey().toXOnlyPublicKey().toString();
const stakerAddr=stakerPriv.toPublicKey().toAddress('simnet').toString();
const lockUntilDaa=2000;   // 低于当前 daa 即可解锁(tx.time >= lockUntilDaa, DAA 模式)
const stake=await S.computeStakeP2SH_v1({stakerPkX,lockUntilDaa,network:'simnet'});
console.log('[stake] legacy-compiled OracleStake_v1 p2sh =',stake.p2shAddr,' redeemLen=',stake.redeemScript.length/2);
// 资金: 挖一块给 funder, 等成熟, 转 2 KAS 进押金地址(≥ ORACLE_STAKE_MIN_SOMPI)
const funder=new PrivateKey(randomBytes(32).toString('hex')); const funderAddr=funder.toPublicKey().toAddress('simnet').toString();
const tpl=await rpc.getBlockTemplate({payAddress:funderAddr,extraData:[]}); await rpc.submitBlock({block:tpl.block,allowNonDAABlocks:false});
let fundTx=''; const t0=Date.now();
while(!fundTx && Date.now()-t0<1200000){
  try{ const {entries}=await rpc.getUtxosByAddresses([new Address(funderAddr)]); if(!entries?.length) throw new Error('no utxo');
    const g=new Generator({entries,outputs:[new PaymentOutput(new Address(stake.p2shAddr),200_000_000n)],priorityFee:500_000n,changeAddress:new Address(funderAddr),networkId:'simnet'});
    let p; while((p=await g.next())){ await p.sign([funder]); fundTx=await p.submit(rpc);} }
  catch(e){ fundTx=''; await new Promise(r=>setTimeout(r,2000)); }
}
if(!fundTx) throw new Error('fund timeout');
console.log('[stake] fund tx (2 KAS -> stake p2sh) =',fundTx);
let landed=false; for(let i=0;i<60&&!landed;i++){ const {entries}=await rpc.getUtxosByAddresses([new Address(stake.p2shAddr)]); landed=!!entries?.some(e=>e.outpoint.transactionId===fundTx); if(!landed) await new Promise(r=>setTimeout(r,500)); }
console.log('[stake] stake UTXO landed =',landed);
const dag=await rpc.getBlockDagInfo(); console.log('[stake] daa now =',dag.virtualDaaScore,' lockUntilDaa =',lockUntilDaa);
const wallet={getPrivateKey:()=>stakerPriv,getNetworkId:()=>'simnet'};
// 反例①: lockTime=0 (< lockUntilDaa) 应被共识拒
try{ await R.unlockP2SH_SingleEntry(wallet,stake.p2shAddr,new Uint8Array(Buffer.from(stake.redeemScript,'hex')),stakerAddr,0n); console.log('[stake] NEG lockTime=0: UNEXPECTED ACCEPT'); }
catch(e){ console.log('[stake] NEG lockTime=0 rejected as expected:',String(e?.message??e).slice(0,160)); }
// 正例: lockTime = lockUntilDaa (≤ 当前 daa)
const r=await R.unlockP2SH_SingleEntry(wallet,stake.p2shAddr,new Uint8Array(Buffer.from(stake.redeemScript,'hex')),stakerAddr,BigInt(lockUntilDaa));
console.log('[stake] POS timeout_unlock txId =',r.txId,' out=',r.amount.toString());
let got=false; for(let i=0;i<60&&!got;i++){ const {entries}=await rpc.getUtxosByAddresses([new Address(stakerAddr)]); got=!!entries?.some(e=>e.outpoint.transactionId===r.txId); if(!got) await new Promise(r2=>setTimeout(r2,500)); }
console.log('[stake] unlock output landed at staker addr =',got);
await rpc.disconnect().catch(()=>{}); process.exit(0);
