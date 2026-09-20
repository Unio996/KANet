// proto-judged.mjs — "这个 proto 市场有判定题"的【唯一】定义(oracle 整合批 A 落地 / 批 D N3 复用, 不另写第二份)。
// 纯函数, 无 DB / 无 IO。被三处共用: ① migrate.js 的 operator 禁写触发器(SQL 谓词) ② 批 D 受理点 outcome_end 门 ③ 批 D promote 门 / 晚 seal 守卫(JS 判据)。
// 定义(设计 v0.2 §3.1 / 批 A 判断 ②): 四个判定题列任一非 NULL(含空串)即算——fail-safe 取宽, "清空字段假装无判定题"走不通。outcome_end_ms 单独不算判定题。
export const JUDGED_COLUMNS = Object.freeze(['resolution_rule_spec', 'outcome_market_source', 'outcome_condition_id', 'outcome_oracle_relay_ids']);

/** SQL 谓词文本: r = 行别名(触发器里是 NEW / OLD)。 */
export function judgedSqlPredicate(r) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(r))) throw new TypeError('judgedSqlPredicate: 别名必须是标识符');
  return `(${JUDGED_COLUMNS.map((c) => `${r}.${c} IS NOT NULL`).join(' OR ')})`;
}

/** JS 判据: row 是 proto_markets 行(至少含四个判定题列); 列缺失(undefined)按 NULL 算 ⇒ 调用方必须 SELECT 出这四列, 否则会漏判——所以对缺列直接抛错。 */
export function isJudgedMarket(row) {
  if (!row || typeof row !== 'object') throw new TypeError('isJudgedMarket: row 必填');
  for (const c of JUDGED_COLUMNS) if (!(c in row)) throw new TypeError(`isJudgedMarket: row 缺列 ${c}(SELECT 漏了判定题列会把判定题市场误当无判定题)`);
  return JUDGED_COLUMNS.some((c) => row[c] !== null && row[c] !== undefined);
}
