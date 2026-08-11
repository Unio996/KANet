// v196 `u1_identity_registration` 的**结构约束**用例 —— 判据 = A-2 设计 §4 的 V10/V11(+轮换摩擦 V12 的前半)。
//
// 🔴 **本用例跑的是【真的那份 migration】, 不是抄一份 DDL 过来。**
//    抄一份会假绿: 它测的是我这份副本, 而线上跑的是 migrate.js 那份 —— 两份漂了没有任何东西会报。
//    (同 @J1 `b61e66d5` 的理由: 走实际调用的那个函数, 不走抄本。)
//    做法: 把 `DB_PATH` 指到临时文件后再 import migrate.js ⇒ client.js 在 import 时按 env 解析路径。
//
// ⚠ 只碰临时库, **不碰 live console.db**。
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'u1-reg-schema-'));
process.env.DB_PATH = join(dir, 'probe.db');

const { runMigrations } = await import('../db/migrate.js');
const { sqlite, dbPath } = await import('../db/client.js');
assert.ok(dbPath.startsWith(dir), `安全闸: 必须指向临时库, 实际 ${dbPath}`);   // 防手滑打到 live
runMigrations();

let pass = 0; let fail = 0;
const t = (name, fn) => {
  try { fn(); pass += 1; console.log(`[PASS] ${name}`); }
  catch (e) { fail += 1; console.log(`[FAIL] ${name} — ${e.message}`); }
};
const ins = (row) => sqlite.prepare(`INSERT INTO u1_identity_registration
  (relay_id, root_fingerprint, root_xpub, identity_index, identity_pubkey_xonly, custody)
  VALUES (@relay_id, @root_fingerprint, @root_xpub, @identity_index, @identity_pubkey_xonly, @custody)`).run(row);
const base = (over = {}) => ({
  relay_id: 'relay-1', root_fingerprint: 'blake2b256:aa', root_xpub: 'kpubXXX',
  identity_index: 0, identity_pubkey_xonly: 'ab'.repeat(32), custody: 'mnemonic', ...over,
});
const rejects = (row, what) => {
  try { ins(row); throw new Error(`__NOT_REJECTED__`); }
  catch (e) {
    if (e.message === '__NOT_REJECTED__') throw new Error(`${what}: DB 竟然收下了 —— 约束没生效`);
    return e.message;
  }
};

// 前置: 合法行必须能进, 否则下面每一格"被拒"都可能是恒拒
t('前置 · 合法行可写入(否则后面的"被拒"都不算数)', () => {
  ins(base());
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration').get().n, 1);
});

t('V10 · 同一 root_fingerprint 的第二条 ⇒ 被【DB】拒(N3 锁1 落成写入时约束)', () => {
  const msg = rejects(base({ relay_id: 'relay-2' }), 'V10');
  assert.match(msg, /UNIQUE/i, `期望 UNIQUE 冲突, 实际: ${msg}`);
});

t('V11-a · identity_index != 0 ⇒ 被 DB 拒', () => {
  const msg = rejects(base({ relay_id: 'relay-3', root_fingerprint: 'blake2b256:bb', identity_index: 1 }), 'V11-a');
  assert.match(msg, /CHECK/i, `期望 CHECK 约束, 实际: ${msg}`);
});

t('V11-b · custody != mnemonic ⇒ 被 DB 拒(privkey-only 不入委员)', () => {
  const msg = rejects(base({ relay_id: 'relay-4', root_fingerprint: 'blake2b256:cc', custody: 'privkey' }), 'V11-b');
  assert.match(msg, /CHECK/i, `期望 CHECK 约束, 实际: ${msg}`);
});

t('同一 relay_id 第二条 ⇒ 被 DB 拒(一个 relay 只能有一条登记)', () => {
  const msg = rejects(base({ root_fingerprint: 'blake2b256:dd' }), 'relay_id PK');
  assert.match(msg, /UNIQUE|PRIMARY/i, `实际: ${msg}`);
});

// 🔴 约束【挡不住】什么 —— 与条款同页写死, 免得被读成"数据库保证了不同源"
t('作用域 · 另一个【不同的根】可以正常写入(同 seed 异硬化账户就长这样 ⇒ DB 挡不到)', () => {
  ins(base({ relay_id: 'relay-9', root_fingerprint: 'blake2b256:ee' }));
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration').get().n, 2,
    '两条不同根必须都在 —— 这正是 spec §1 C 边界: 数据库分不出它们是不是同一份 seed');
});

// V12 的前半: 轮换会撞 UNIQUE, 归档旧行后才能写新行
t('V12 · 轮换: 旧行不删 ⇒ 新根写不进? 不, 新根能进; 撞的是【同根重登记】', () => {
  // 换钥(R5)= 新 mnemonic ⇒ 新根 ⇒ 不撞 UNIQUE(root), 但撞 relay_id 主键
  const msg = rejects(base({ relay_id: 'relay-1', root_fingerprint: 'blake2b256:ff' }), 'V12');
  assert.match(msg, /UNIQUE|PRIMARY/i, `轮换写新根到同一 relay ⇒ 必须撞主键, 实际: ${msg}`);
  // ⇒ 结论: 轮换流程必须【先归档/删旧行】再写新行, 这条摩擦是真的, 设计稿 §3 已预告
});

sqlite.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✅' : '🔴'} u1_identity_registration schema: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
