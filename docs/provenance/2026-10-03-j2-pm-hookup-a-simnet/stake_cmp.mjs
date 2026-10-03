// B 组: OracleStake_v1 押金地址——旧编译器(pool-p2sh.mjs 经 SILVERC_LEGACY) vs D-019 新编译器(compileSilV100) 同 ctor 产出对比
import { pathToFileURL } from 'node:url';
const W='D:/kanet-tn12/scratch/_j2_wt_pm_a/kasia-console/src/lib/';
process.env.KASPA_NETWORK = process.argv[2] || 'mainnet';
const imp=(p)=>import(pathToFileURL(W+p).href);
const S=await imp('oracle-stake-v1.mjs'); const A=await imp('pool-bshard-artifacts.mjs');
const pk='22'.repeat(32), lock=600000000;
let legacy=null, v100=null;
try { legacy = await S.computeStakeP2SH_v1({ stakerPkX: pk, lockUntilDaa: lock, network: process.env.KASPA_NETWORK }); console.log('LEGACY ok  redeemLen=',legacy.redeemScript.length/2,' p2sh=',legacy.p2shAddr); } catch(e){ console.log('LEGACY FAIL:',String(e.message).slice(0,300)); }
try { const c=A.compileSilV100(W+'OracleStake_v1.sil',[A.ctorBytes32V100(pk),A.ctorIntV100(lock)],'OracleStake_v1'); v100=Buffer.from(c.script).toString('hex'); console.log('V100 ok  redeemLen=',v100.length/2); } catch(e){ console.log('V100 FAIL:',String(e.message).slice(0,600)); }
if (legacy && v100) console.log('BYTE-IDENTICAL =', legacy.redeemScript===v100);
