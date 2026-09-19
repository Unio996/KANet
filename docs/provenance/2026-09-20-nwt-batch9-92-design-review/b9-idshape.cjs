// 只读: 活库 proto_markets 的 id 形状(长度 / 字符类 / 分隔符), 不打印值; 以及 market_id 如何在设计里被当作 subject_id
const { createRequire } = require('module');
const Database = createRequire('D:/kanet-nwt-cand/kasia-console/package.json')('better-sqlite3');
const db = new Database('D:/kanet-tn12/kasia-console/data/console.mainnet.db', { readonly: true, fileMustExist: true });
const cols = db.prepare("PRAGMA table_info(proto_markets)").all().map((c) => c.name);
console.log('proto_markets columns:', cols.join(','));
for (const r of db.prepare('SELECT id, status FROM proto_markets').all()) {
  const id = String(r.id);
  const cls = id.replace(/[0-9]/g, '9').replace(/[a-f]/g, 'h').replace(/[g-z]/g, 'l').replace(/[A-F]/g, 'H').replace(/[G-Z]/g, 'L');
  console.log(`status=${r.status} len=${id.length} shape=${cls.replace(/(.)\1{3,}/g, (m, c) => c + '{' + m.length + '}')} hasHyphen=${id.includes('-')} hasUpper=${/[A-Z]/.test(id)} isHex=${/^[0-9a-f]+$/.test(id)}`);
}
