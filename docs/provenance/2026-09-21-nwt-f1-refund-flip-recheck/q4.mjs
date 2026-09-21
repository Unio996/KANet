import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('q/console.simnet.db');
const F='d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a';
const conv=(d)=>{for(const k of Object.keys(d)) if(typeof d[k]==='bigint') d[k]=String(d[k]); return d;};
console.log(db.prepare('pragma table_info(proto_claims)').all().map(c=>c.name).join(','));
const claims=db.prepare('select * from proto_claims where market_id=?').all(F);
for (const c of claims){ const d=conv({...c}); for(const k of Object.keys(d)) if(typeof d[k]==='string'&&d[k].length>90) d[k]=d[k].slice(0,90)+'…'; console.log('CLAIM',JSON.stringify(d));
  for (const r of db.prepare("select intent_key,step,status,prepared_txid,submitted_txid,landed_depth,landed_at,last_error,created_at,updated_at from proto_settlement_intents where subject_type='claim' and subject_id=?").all(c.id)) console.log('  INTENT',JSON.stringify(conv({...r}))); }
console.log('all intents by status:', JSON.stringify(db.prepare('select subject_type,step,status,count(*) n from proto_settlement_intents group by 1,2,3').all().map(conv)));
