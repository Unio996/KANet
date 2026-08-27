// L8 · 只读 · DB-identity positive control: 证明看的是【意图中的 live 库】, 不是 cwd 建出的杂库(ANTI-PATTERNS 规则 74)。
// 用法: node scripts/u1-live-arms/L8.mjs [--db <abs>]。openDb 三道断言本身就是本臂; 这里再把可核对的读数打出来。
import { setArm, openDb, cnt, hasTable, emit, DB } from './common.mjs';
import { statSync } from 'node:fs';
setArm('L8');
const sqlite = await openDb();
const st = statSync(DB);
const ev = {
  db_abs_path: DB, db_size_bytes: st.size, db_mtime: st.mtime.toISOString(),
  relay_nodes: cnt(sqlite, 'SELECT COUNT(*) c FROM relay_nodes'),
  tables_total: cnt(sqlite, "SELECT COUNT(*) c FROM sqlite_master WHERE type='table'"),
  u1_identity_challenge: hasTable(sqlite, 'u1_identity_challenge') ? cnt(sqlite, 'SELECT COUNT(*) c FROM u1_identity_challenge') : null,
  u1_identity_registration: hasTable(sqlite, 'u1_identity_registration') ? cnt(sqlite, 'SELECT COUNT(*) c FROM u1_identity_registration') : null,
  u1_relay_identity: hasTable(sqlite, 'u1_relay_identity') ? cnt(sqlite, 'SELECT COUNT(*) c FROM u1_relay_identity') : null,
  path_is_kasia_console_data: /kasia-console[\\/]data[\\/]console\.db$/i.test(DB),
};
emit('L8', ev.relay_nodes > 0 ? 'PASS' : 'FAIL', ev);
