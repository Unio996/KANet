// 只读: 活库 proto_markets / proto_claims 的 id 是否满足 S9 的"小写 UUID"(只打印计数)
const { createRequire } = require('module');
const Database = createRequire('D:/kanet-nwt-cand/kasia-console/package.json')('better-sqlite3');
const db = new Database('D:/kanet-tn12/kasia-console/data/console.mainnet.db', { readonly: true, fileMustExist: true });
const RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
for (const t of ['proto_markets', 'proto_claims']) {
  let rows; try { rows = db.prepare(`SELECT id FROM ${t}`).all(); } catch (e) { console.log(t + ': table missing (' + e.message.slice(0, 40) + ')'); continue; }
  console.log(`${t}: rows=${rows.length} lowercaseUuid=${rows.filter((r) => RE.test(r.id)).length} nonConforming=${rows.filter((r) => !RE.test(r.id)).length}`);
}
try { const n = db.prepare("SELECT COUNT(*) c FROM proto_settlement_intents").get().c; console.log('proto_settlement_intents rows=' + n); } catch { console.log('proto_settlement_intents: table missing'); }
