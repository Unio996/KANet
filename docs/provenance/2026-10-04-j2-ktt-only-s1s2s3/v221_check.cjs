const D=require('D:/kanet-tn12/scratch/_j2_wt_s0/kasia-console/node_modules/better-sqlite3');
const db=new D(process.argv[2]);
const sql=db.prepare("select sql from sqlite_master where name='pool_markets'").get().sql;
console.log('spine_p2sh line:', JSON.stringify(sql.split('\n').find(l=>/spine_p2sh/.test(l))));
console.log('integrity:', JSON.stringify(db.prepare('pragma integrity_check').all()));
console.log('fk_check rows:', db.prepare('pragma foreign_key_check').all().length);
console.log('schema objs on pool_markets:', db.prepare("select type,name from sqlite_master where tbl_name='pool_markets' order by 1,2").all().map(r=>r.type+':'+r.name).join(' | '));
console.log('table_info spine_p2sh notnull =', db.prepare("pragma table_info(pool_markets)").all().find(c=>c.name==='spine_p2sh').notnull);
console.log('rows', db.prepare('select count(*) c from pool_markets').get().c, 'market_shards', db.prepare('select count(*) c from market_shards').get().c);
// insert test row with NULL spine in a transaction then roll back
db.exec('BEGIN');
const cols=db.prepare("pragma table_info(pool_markets)").all();
const need=cols.filter(c=>c.notnull&&c.dflt_value===null&&!c.pk||c.name==='id');
const vals={}; for(const c of need){ vals[c.name]= /INT/i.test(c.type)?1:'x'; } vals.id='v221-test'; vals.spine_p2sh=null;
try{ db.prepare(`insert into pool_markets (${Object.keys(vals).join(',')}) values (${Object.keys(vals).map(()=>'?').join(',')})`).run(...Object.values(vals)); console.log('NULL spine insert: OK'); }catch(e){ console.log('NULL spine insert FAILED:', e.message); }
db.exec('ROLLBACK');
console.log('user_version/schema_version', db.prepare('pragma schema_version').get());
