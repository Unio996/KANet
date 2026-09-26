// 跑: cd kasia-console && node src/lib/user-ledger-withdraw.test.mjs  (真 schema: db/client + migrate)
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'ulw-'));
process.env.DB_PATH = join(dir, 't.db');
const { sqlite: db } = await import('../db/client.js');
const { runMigrations } = await import('../db/migrate.js');
await runMigrations();
const { reserveWithdraw, finalizeWithdraw, revertWithdraw } = await import('./user-ledger-withdraw.mjs');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const bal = (p, a = 'USDT') => db.prepare(`SELECT COALESCE(SUM(balance_change),0) AS b FROM user_ledger WHERE user_kasia_address=? AND asset=?`).get(p, a).b;
const credit = (p, n) => db.prepare(`INSERT INTO user_ledger (id,user_kasia_address,asset,chain,balance_change,balance_after,reason,created_at) VALUES (?,?,'USDT',NULL,?,?,'test_credit',datetime('now'))`).run(`c_${p}_${Math.random()}`, p, n, n);
credit('u1', 10);
t('W1 (P11 双提向量) 余额 10: 第一次 reserve 8 ⇒ ok, 余额立刻 2; 第二次 reserve 8 ⇒ insufficient(balance=2) — 借记先于转账, 第二条 DM 过不了', () => {
  const r1 = reserveWithdraw(db, { peer: 'u1', asset: 'USDT', chain: 'BSC', amount: 8 }); assert.strictEqual(r1.ok, true); assert.strictEqual(r1.balanceAfter, 2); assert.strictEqual(bal('u1'), 2);
  const r2 = reserveWithdraw(db, { peer: 'u1', asset: 'USDT', chain: 'BSC', amount: 8 }); assert.strictEqual(r2.ok, false); assert.strictEqual(r2.reason, 'insufficient'); assert.strictEqual(r2.balance, 2);
  const row = db.prepare(`SELECT reason, ref_tx_hash FROM user_ledger WHERE id=?`).get(r1.ledgerId); assert.ok(row.reason.startsWith('withdraw_pending:')); assert.strictEqual(row.ref_tx_hash, null);
  globalThis._r1 = r1;
});
t('W2 finalize: reason 改 withdraw_user_initiated + 记 tx; 二次 finalize changes=0; 余额不变(2)', () => {
  const f = finalizeWithdraw(db, { ledgerId: globalThis._r1.ledgerId, txHash: '0xabc123456789' }); assert.strictEqual(f.ok, true);
  const row = db.prepare(`SELECT reason, ref_tx_hash FROM user_ledger WHERE id=?`).get(globalThis._r1.ledgerId); assert.ok(row.reason.startsWith('withdraw_user_initiated:broker_direct:0xabc1234567')); assert.strictEqual(row.ref_tx_hash, '0xabc123456789');
  assert.strictEqual(finalizeWithdraw(db, { ledgerId: globalThis._r1.ledgerId, txHash: '0xabc123456789' }).ok, false); assert.strictEqual(bal('u1'), 2);
});
credit('u2', 5);
t('W3 revert: 转账确定失败 ⇒ 反向正项冲正(不 DELETE), 余额回 5; 二次 revert 拒 already_reverted; 对已 finalize 的拒 not_pending', () => {
  const r = reserveWithdraw(db, { peer: 'u2', asset: 'USDT', chain: 'BSC', amount: 3 }); assert.strictEqual(bal('u2'), 2);
  const v = revertWithdraw(db, { ledgerId: r.ledgerId, error: 'insufficient funds for gas' }); assert.strictEqual(v.ok, true); assert.strictEqual(bal('u2'), 5);
  assert.strictEqual(db.prepare(`SELECT count(*) AS n FROM user_ledger WHERE user_kasia_address='u2'`).get().n, 3, '账本只追加: credit + pending(改 reason) + revert');
  assert.strictEqual(revertWithdraw(db, { ledgerId: r.ledgerId }).reason, 'already_reverted');
  assert.strictEqual(revertWithdraw(db, { ledgerId: globalThis._r1.ledgerId }).reason, 'not_pending');
  assert.strictEqual(revertWithdraw(db, { ledgerId: 'nope' }).reason, 'no_such_pending');
});
t('W4 边界: amount 0/负/NaN ⇒ bad_amount; 缺 peer ⇒ bad_args; 恰好等于余额 ⇒ ok 余额 0', () => {
  for (const a of [0, -1, NaN, 'x']) assert.strictEqual(reserveWithdraw(db, { peer: 'u2', asset: 'USDT', amount: a }).reason, 'bad_amount');
  assert.strictEqual(reserveWithdraw(db, { asset: 'USDT', amount: 1 }).reason, 'bad_args');
  assert.strictEqual(reserveWithdraw(db, { peer: 'u2', asset: 'USDT', amount: 5 }).ok, true); assert.strictEqual(bal('u2'), 0);
});
db.close(); rmSync(dir, { recursive: true, force: true });
console.log(`user-ledger-withdraw: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
