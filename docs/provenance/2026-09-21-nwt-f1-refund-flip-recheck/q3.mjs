import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('q/console.simnet.db');
const cols=db.prepare('pragma table_info(proto_market_verdicts)').all().map(c=>c.name); console.log(cols.join(','));
const arms=JSON.parse((await import('node:fs')).readFileSync('arms.json','utf8'));
for (const [arm,id] of Object.entries(arms)) for (const r of db.prepare('select * from proto_market_verdicts where market_id=?').all(id)) { const d={arm,...r}; for(const k of Object.keys(d)) if(typeof d[k]==='bigint') d[k]=String(d[k]); if(d.evidence_ref) d.evidence_ref=String(d.evidence_ref).slice(0,90); console.log(JSON.stringify(d)); }
for (const [arm,id] of Object.entries(arms)) console.log(arm, JSON.stringify(db.prepare('select status,winning_side ws,winning_side_source src,settlement_frozen_at fz,frozen_reason fr from proto_markets where id=?').get(id)));
