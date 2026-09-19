const fs=require('fs'),cp=require('child_process');const F='scripts/proto-v0-template-anchors.json';const orig=fs.readFileSync(F,'utf8');const j0=JSON.parse(orig);
const out=[];const run=(name,mut)=>{const j=JSON.parse(orig);mut(j);fs.writeFileSync(F,JSON.stringify(j,null,2));const r=cp.spawnSync('node',['src/lib/proto-fee-profile-caps.test.mjs'],{encoding:'utf8'});out.push((r.status===0?'SURVIVED ':'killed   ')+name);};
for(const k of ['market_seal','close_commit','convert_to_claim','claim_draw','withdraw','ticket_reclaim']){
  run(k+' cap +1',j=>{j.feeProfile[k].cap=String(BigInt(j.feeProfile[k].cap)+1n);});
  run(k+' cap -1',j=>{j.feeProfile[k].cap=String(BigInt(j.feeProfile[k].cap)-1n);});
  run(k+' entry deleted',j=>{delete j.feeProfile[k];});
  run(k+' _source emptied',j=>{j.feeProfile[k]._source='';});
}
run('cap as number type (not string)',j=>{j.feeProfile.withdraw.cap=55000000;});
run('cap hex string 0x',j=>{j.feeProfile.withdraw.cap='0x3473bc0';});
run('market_seal moved to over global cap',j=>{j.feeProfile.market_seal.cap='100000001';});
fs.writeFileSync(F,orig);console.log(out.join('\n'));
