// bshard-auto-settler-clear-deadshape.test.mjs — clearLegacyRefundDeadShape 离线回归(J2 2026-07-13,
// docs/2026-07-13-cohort-b-container2-disposition-design.md, NWT MUST-FIX: isBshard 纵深防御)。
// Run: cd kasia-console && node src/services/bshard-auto-settler-clear-deadshape.test.mjs
import { clearLegacyRefundDeadShape } from './bshard-auto-settler.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

function mockDb({ marketRow, isBshard, inserted = [] }) {
  return {
    prepare(sql) {
      if (sql.includes('FROM pool_markets WHERE id')) return { get: () => marketRow };
      if (sql.includes('FROM market_shards WHERE logical_market_id')) return { get: () => (isBshard ? { 1: 1 } : undefined) };
      if (sql.startsWith('UPDATE pool_markets')) return { run: (metaJson) => { marketRow.metadata = metaJson; } };
      if (sql.startsWith('INSERT INTO events')) return { run: (...args) => { inserted.push(args); } };
      throw new Error(`mockDb: 未覆盖 SQL: ${sql.slice(0, 50)}`);
    },
  };
}

console.log('[test] ① 市场不存在 → 拒:');
{
  const db = mockDb({ marketRow: undefined, isBshard: true });
  const r = clearLegacyRefundDeadShape('nope', db);
  ok(r.ok === false && r.reason === 'market 不存在', 'reason 精确匹配');
}

console.log('[test] ② 非 bshard 市场(MUST-FIX 纵深防御) → 拒:');
{
  const db = mockDb({ marketRow: { metadata: JSON.stringify({ refund_tx_obj: {} }) }, isBshard: false });
  const r = clearLegacyRefundDeadShape('m1', db);
  ok(r.ok === false && /非 bshard 市场/.test(r.reason), '拒绝，不清理 legacy in-flight 状态');
}

console.log('[test] ③ 无 refund_tx_obj(幂等) → 拒:');
{
  const db = mockDb({ marketRow: { metadata: JSON.stringify({ foo: 'bar' }) }, isBshard: true });
  const r = clearLegacyRefundDeadShape('m1', db);
  ok(r.ok === false && r.already === true, 'already=true');
}

console.log('[test] ④ metadata 坏 JSON → fail-closed 拒:');
{
  const db = mockDb({ marketRow: { metadata: 'not-json' }, isBshard: true });
  const r = clearLegacyRefundDeadShape('m1', db);
  ok(r.ok === false && /坏 JSON/.test(r.reason), 'fail-closed，不崩');
}

console.log('[test] ⑤ 正例: bshard 市场 + 有 refund_tx_obj → 清四字段 + 保留其它字段 + 写 events:');
{
  const marketRow = { metadata: JSON.stringify({
    spine_redeem_script_hex: 'abcd', refund_tx_obj: { x: 1 }, refund_reason: 'legacy', refund_dispatched_at: '2026-07-01T00:00:00Z', refund_amount: 9999,
  }) };
  const inserted = [];
  const db = mockDb({ marketRow, isBshard: true, inserted });
  const r = clearLegacyRefundDeadShape('m1', db);
  ok(r.ok === true, 'ok=true');
  ok(r.cleared.refund_tx_obj && r.cleared.refund_amount === 9999, 'cleared 回显四字段原值');
  const after = JSON.parse(marketRow.metadata);
  ok(after.spine_redeem_script_hex === 'abcd', '非死形状字段(spine_redeem_script_hex)原样保留');
  ok(!('refund_tx_obj' in after) && !('refund_reason' in after) && !('refund_dispatched_at' in after) && !('refund_amount' in after), '四字段全部清除');
  ok(inserted.length === 1, 'events 表写入一条审计行');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — clearLegacyRefundDeadShape: 5 类(不存在/非bshard纵深防御/幂等/坏JSON/正例清理+审计) 全绿'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
