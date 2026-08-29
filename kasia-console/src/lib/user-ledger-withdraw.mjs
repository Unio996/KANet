// user-ledger-withdraw.mjs — 用户提币的 write-ahead 借记 (J2 2026-08-29, race 盘点 P11)
// 病: broker-v2/router.js withdraw 先读余额 → 链转账 → 【转账后】INSERT 负项 ⇒ 转账在飞时余额未变 ⇒ 第二条 DM 同样过余额检查 ⇒ 双提。
// 修: 同一事务里 CAS 式扣: 重算 SUM(balance_change) ≥ amount 才 INSERT 负项 (reason withdraw_pending:<id>), 事务提交后余额已减 ⇒ 任何后续读都看到;
//     转账成功 finalize (reason 改 withdraw_user_initiated:…, 记 ref_tx_hash); 转账【确定】失败 revert (INSERT 反向正项冲正, 不 DELETE——账本只追加);
//     转账结果不明 (抛/超时) ⇒ 不 revert (fail-closed: 余额先扣着, 人工核链后按 SOP 冲正或补 tx)。
import { randomUUID } from 'node:crypto';

export function reserveWithdraw(db, { peer, asset, chain, amount, now = () => new Date().toISOString() }) {
  if (!db) throw new Error('reserveWithdraw: db 缺失');
  const amt = Number(amount);
  if (!(amt > 0) || !Number.isFinite(amt)) return { ok: false, reason: 'bad_amount' };
  if (!peer || !asset) return { ok: false, reason: 'bad_args' };
  const ledgerId = `ledger_withdraw_${String(peer).slice(-8)}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const tx = db.transaction(() => {
    const cur = db.prepare(`SELECT COALESCE(SUM(balance_change), 0) AS balance FROM user_ledger WHERE user_kasia_address = ? AND asset = ?`).get(peer, asset);
    const balance = parseFloat(cur?.balance || 0);
    if (balance < amt) return { ok: false, reason: 'insufficient', balance };
    const balanceAfter = parseFloat((balance - amt).toFixed(4));
    db.prepare(`INSERT INTO user_ledger (id, user_kasia_address, asset, chain, balance_change, balance_after, reason, ref_order_id, ref_tx_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`)
      .run(ledgerId, peer, asset, chain || null, -amt, balanceAfter, `withdraw_pending:${ledgerId}`, now());
    return { ok: true, ledgerId, balance, balanceAfter };
  });
  return tx.immediate();   // BEGIN IMMEDIATE: 事务起点即拿写锁, WAL 下两并发 reserve 不会各自读到同一旧 SUM 再各自 INSERT (NWT 审点 8/29)
}

export function finalizeWithdraw(db, { ledgerId, txHash }) {
  if (!ledgerId || !txHash) throw new Error('finalizeWithdraw: ledgerId/txHash 缺失');
  const r = db.prepare(`UPDATE user_ledger SET reason = ?, ref_tx_hash = ? WHERE id = ? AND reason LIKE 'withdraw_pending:%'`)
    .run(`withdraw_user_initiated:broker_direct:${String(txHash).slice(0, 12)}`, txHash, ledgerId);
  return { ok: r.changes === 1, changes: r.changes };
}

export function revertWithdraw(db, { ledgerId, error, now = () => new Date().toISOString() }) {
  if (!ledgerId) throw new Error('revertWithdraw: ledgerId 缺失');
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT user_kasia_address, asset, chain, balance_change, reason FROM user_ledger WHERE id = ?`).get(ledgerId);
    if (!row) return { ok: false, reason: 'no_such_pending' };
    const already = db.prepare(`SELECT 1 FROM user_ledger WHERE reason = ? LIMIT 1`).get(`withdraw_reverted:${ledgerId}`);
    if (already) return { ok: false, reason: 'already_reverted' };   // 先查冲正痕迹 (pending 行 revert 后 reason 已改成 withdraw_failed:, 不能再靠它判)
    if (!String(row.reason).startsWith('withdraw_pending:')) return { ok: false, reason: 'not_pending' };
    const cur = db.prepare(`SELECT COALESCE(SUM(balance_change), 0) AS balance FROM user_ledger WHERE user_kasia_address = ? AND asset = ?`).get(row.user_kasia_address, row.asset);
    const amt = -Number(row.balance_change);
    const balanceAfter = parseFloat((parseFloat(cur?.balance || 0) + amt).toFixed(4));
    db.prepare(`INSERT INTO user_ledger (id, user_kasia_address, asset, chain, balance_change, balance_after, reason, ref_order_id, ref_tx_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`)
      .run(`${ledgerId}_revert`, row.user_kasia_address, row.asset, row.chain, amt, balanceAfter, `withdraw_reverted:${ledgerId}`, now());
    db.prepare(`UPDATE user_ledger SET reason = ? WHERE id = ?`).run(`withdraw_failed:${ledgerId}:${String(error || '').slice(0, 60)}`, ledgerId);
    return { ok: true, balanceAfter };
  });
  return tx.immediate();   // BEGIN IMMEDIATE: 事务起点即拿写锁, WAL 下两并发 reserve 不会各自读到同一旧 SUM 再各自 INSERT (NWT 审点 8/29)
}
