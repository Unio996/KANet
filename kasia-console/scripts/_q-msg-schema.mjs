import Database from 'better-sqlite3';
const db = new Database('./data/console.db', { readonly: true });

const cols = db.prepare("PRAGMA table_info(messages)").all();
console.log('=== messages cols ===');
for (const c of cols) console.log(`  ${c.name}: ${c.type}${c.notnull?' NOT NULL':''}${c.dflt_value?` default ${c.dflt_value}`:''}`);

const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='messages'").all();
console.log('\n=== indexes ===');
for (const i of idx) console.log('  ', i.name);

const sample = db.prepare("SELECT * FROM messages WHERE message_type='text' ORDER BY rowid DESC LIMIT 3").all();
console.log('\n=== recent text msgs ===');
for (const m of sample) console.log(m);

// also identity / peer table
const tabs = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%identity%' OR name LIKE '%peer%' OR name='conversations')").all();
console.log('\n=== related tables ===', tabs);

db.close();
