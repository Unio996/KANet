import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('q/console.simnet.db', { readOnly: false });
const F='d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a';
console.log(db.prepare('pragma table_info(proto_settlement_intents)').all().map(r=>r.name).join(','));
for (const r of db.prepare('select * from proto_settlement_intents where subject_id=?').all(F)) { const d={...r}; if(d.prepared_tx_json) d.prepared_tx_json=d.prepared_tx_json.slice(0,60)+'…len='+d.prepared_tx_json.length; console.log(JSON.stringify(d)); }
const m=db.prepare('select * from proto_markets where id=?').get(F); console.log(JSON.stringify(m,(k,v)=>typeof v==='bigint'?String(v):v).slice(0,2500));
