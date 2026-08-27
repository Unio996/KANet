// L1 · 只读 · migration/schema acceptance against the actual live DB(v198 存在 + 约束)。用法: node scripts/u1-live-arms/L1.mjs [--db <abs>]
// 🔴 不在 live 库跑 ④ 探针(它会 INSERT); 这里只读 sqlite_master。
import { setArm, openDb, tableSql, emit, fail } from './common.mjs';
setArm('L1');
const sqlite = await openDb();
const ddl = tableSql(sqlite, 'u1_relay_identity');
if (!ddl) fail('V198_ABSENT', 'u1_relay_identity 不存在 ⇒ v198 未迁移(D-005 未执行)');
const checks = {
  pk_pubkey_check: /relay_pubkey_xonly\s+TEXT\s+PRIMARY KEY\s*CHECK\s*\(\s*length\(relay_pubkey_xonly\)\s*=\s*64\s+AND\s+NOT\s*\(relay_pubkey_xonly GLOB '\*\[\^0-9a-f\]\*'\)\s*\)/i.test(ddl),
  network_enum: /network\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*network\s+IN\s*\(\s*'testnet-12'\s*,\s*'mainnet'\s*\)\s*\)/i.test(ddl),
  operation_register: /operation\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*operation\s*=\s*'register'\s*\)/i.test(ddl),
  epoch_unique: /epoch\s+TEXT\s+NOT NULL\s+UNIQUE/i.test(ddl),
  no_local_relay_id: !/local_relay_id/i.test(ddl) && !/\brelay_id\b|ecdsa/i.test(ddl),
};
const idx = sqlite.prepare('PRAGMA index_list(u1_relay_identity)').all();
checks.only_auto_indexes = idx.every((i) => i.origin === 'pk' || i.origin === 'u');
const v197 = !!tableSql(sqlite, 'u1_identity_challenge'); const v196 = !!tableSql(sqlite, 'u1_identity_registration');
const ok = Object.values(checks).every(Boolean) && v197 && v196;
emit('L1', ok ? 'PASS' : 'FAIL', { checks, v196, v197, indexes: idx.map((i) => [i.name, i.origin]), ddl });
