// B 组补验: 上一轮 relay 的 unlockP2SH_SingleEntry 固定 fee=100000 sompi, 被 v2.0.1 最低中继费(1755 克×100=175500)拒("not standard")——那是手续费门, 还没到脚本。
// 这里用与 unlockP2SH_SingleEntry 逐行同构的构造, 只把 fee 提到 300000, 验旧编译器产出的 OracleStake_v1 脚本本身能否通过真共识。
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const WT='D:/kanet-tn12/scratch/_j2_wt_pm_a'; const require=createRequire(`${WT}/kasia-relay/`); const kaspa=require('kaspa-wasm');
const { RpcClient, Encoding, PrivateKey, Address, Transaction, TransactionOutput, payToAddressScript, createInputSignature, SighashType, ScriptBuilder } = kaspa;
const fs=require('node:fs');
// 上一轮的 staker 私钥没落盘 → 本脚本重新来一遍: 新 staker、注资、解锁(fee 300000)
import { randomBytes } from 'node:crypto';
process.env.DB_PATH='D:/kanet-tn12/scratch/_j2_pm_a_simnet/stake.db'; process.env.CONSOLE_ENCRYPTION_KEY='1'.repeat(64); process.env.KASPA_RPC_URL='ws://127.0.0.1:29617'; process.env.KASPA_NETWORK='simnet';
const S=await import(pathToFileURL(`${WT}/kasia-console/src/lib/oracle-stake-v1.mjs`).href);
const { Generator, PaymentOutput } = kaspa;
const rpc=new RpcClient({url:process.env.KASPA_RPC_URL,encoding:Encoding.Borsh,networkId:'simnet'}); await rpc.connect({});
const staker=new PrivateKey(randomBytes(32).toString('hex')); const stakerAddr=staker.toPublicKey().toAddress('simnet').toString();
const lockUntilDaa=2000; const stake=await S.computeStakeP2SH_v1({stakerPkX:staker.toPublicKey().toXOnlyPublicKey().toString(),lockUntilDaa,network:'simnet'});
const funder=new PrivateKey(randomBytes(32).toString('hex')); const funderAddr=funder.toPublicKey().toAddress('simnet').toString();
const tpl=await rpc.getBlockTemplate({payAddress:funderAddr,extraData:[]}); await rpc.submitBlock({block:tpl.block,allowNonDAABlocks:false});
console.log('[stake2] stake p2sh =',stake.p2shAddr);
let fundTx='',t0=Date.now();
while(!fundTx&&Date.now()-t0<1500000){ try{ const {entries}=await rpc.getUtxosByAddresses([new Address(funderAddr)]); if(!entries?.length) throw 0;
  const g=new Generator({entries,outputs:[new PaymentOutput(new Address(stake.p2shAddr),200_000_000n)],priorityFee:500_000n,changeAddress:new Address(funderAddr),networkId:'simnet'});
  let p; while((p=await g.next())){ await p.sign([funder]); fundTx=await p.submit(rpc);} }catch(e){ fundTx=''; await new Promise(r=>setTimeout(r,3000)); } }
console.log('[stake2] fund tx =',fundTx);
let utxo=null; for(let i=0;i<60&&!utxo;i++){ const {entries}=await rpc.getUtxosByAddresses([stake.p2shAddr]); utxo=entries?.find(e=>e.outpoint.transactionId===fundTx)||null; if(!utxo) await new Promise(r=>setTimeout(r,500)); }
const fee=300000n; const outValue=utxo.entry.amount-fee; const toSpk=payToAddressScript(new Address(stakerAddr));
const redeem=new Uint8Array(Buffer.from(stake.redeemScript,'hex'));
const mk=(sig)=>new Transaction({version:0,inputs:[{previousOutpoint:{transactionId:utxo.outpoint.transactionId,index:utxo.outpoint.index},signatureScript:sig,sequence:0n,sigOpCount:1,utxo}],outputs:[new TransactionOutput(outValue,toSpk)],lockTime:BigInt(lockUntilDaa),gas:0n,subnetworkId:'0000000000000000000000000000000000000000',payload:''});
const unsigned=mk(''); const sigHex=createInputSignature(unsigned,0,staker,SighashType.All);
const signed=mk(ScriptBuilder.fromScript(redeem).encodePayToScriptHashSignatureScript(sigHex));
const r=await rpc.submitTransaction({transaction:signed,allowOrphan:false});
console.log('[stake2] POS timeout_unlock (fee 300000) ACCEPTED txId =',r.transactionId);
let got=false; for(let i=0;i<60&&!got;i++){ const {entries}=await rpc.getUtxosByAddresses([stakerAddr]); got=!!entries?.some(e=>e.outpoint.transactionId===r.transactionId); if(!got) await new Promise(r2=>setTimeout(r2,500)); }
console.log('[stake2] unlock output landed at staker =',got);
await rpc.disconnect(); process.exit(0);
