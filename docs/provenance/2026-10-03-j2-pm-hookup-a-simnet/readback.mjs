import { createRequire } from 'node:module';
const require=createRequire('D:/kanet-tn12/scratch/_j2_wt_pm_a/kasia-relay/'); const kaspa=require('kaspa-wasm');
const rpc=new kaspa.RpcClient({url:'ws://127.0.0.1:29617',encoding:kaspa.Encoding.Borsh,networkId:'simnet'}); await rpc.connect({});
const D=require('D:/kanet-tn12/scratch/_j2_wt_pm_a/kasia-console/node_modules/better-sqlite3');
const db=new D('D:/kanet-tn12/scratch/_j2_pm_a_simnet/console.simnet.db',{readonly:true});
const rows=db.prepare("SELECT logical_market_id, shard_p2sh, current_leaf_outpoint, current_token_outpoint FROM market_shards").all();
for (const r of rows){
  const [tx,idx]=r.current_leaf_outpoint.split(':');
  const m=await rpc.getMempoolEntry({transactionId:tx,includeOrphanPool:false,filterTransactionPool:false}).then(()=>'IN-MEMPOOL').catch(e=>'not in mempool: '+String(e?.message??e).slice(0,70));
  console.log(r.logical_market_id,'| final leaf outpoint',r.current_leaf_outpoint,'|',m);
}
const ps=db.prepare("SELECT logical_market_id,covenant_family,payout_ps_outpoint,token_tmpl_hash,claim_tmpl_hash,market_suffix_hash FROM payout_shards").all();
console.log(JSON.stringify(ps,null,1));
// 用 UTXO 集证明: 终态 leaf 输出仍未花(在 UTXO 集)——getUtxosByAddresses 需地址; 用 getBlockDagInfo 附带 DAA
console.log('daa',(await rpc.getBlockDagInfo()).virtualDaaScore.toString());
const sides=db.prepare("SELECT market_id, direction, stake_amount, side_lock_tx FROM pool_bettor_sides").all(); console.log(JSON.stringify(sides));
await rpc.disconnect(); process.exit(0);
