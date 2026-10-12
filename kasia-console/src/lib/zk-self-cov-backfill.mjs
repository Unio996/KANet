// zk-self-cov-backfill.mjs — 账本1893 票: 给"claim 发生在 stampSelfCovId 上线之前"的盘补写 metadata.zk_self_cov_id。
//
// 为什么单写一份而不直接用 stampSelfCovId: stampSelfCovId 是读-改-写整个 metadata JSON(UPDATE ... SET metadata = <整串>),
//   对【正在运行的 console】会有丢更新窗口(读到写回之间别处改了 metadata 就被覆盖)。补写要在线上库上做, 所以用【单条 SQL json_set】:
//   只碰 $.zk_self_cov_id 这一个键, 且 WHERE 里带"该键为空"——首写为准、已有值一律不覆盖, 判空与写入是同一条语句(原子)。
// 只读/只写本库一个字段; 不碰链、不碰钱路。DB 由调用方注入(本文件不 import DB 客户端)。
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * @param {{prepare:Function}} db
 * @param {string} marketId 完整盘 id
 * @param {string} covIdHex 64hex(从链上 claim 交易输入的 covenant_id 取得, 并已与重算的 claim redeem 对过)
 * @param {{apply?:boolean}} [o] apply=false(默认) ⇒ dry-run, 不写
 * @returns {{ok:boolean, action:'would_write'|'written'|'noop', reason?:string, current?:string|null}}
 */
export function backfillSelfCovId(db, marketId, covIdHex, { apply = false } = {}) {
  const id = String(covIdHex || '').toLowerCase();
  if (!HEX64.test(id)) return { ok: false, action: 'noop', reason: 'bad_cov_id' };
  const row = db.prepare('SELECT metadata, json_valid(metadata) AS valid FROM pool_markets WHERE id = ?').get(marketId);
  if (!row) return { ok: false, action: 'noop', reason: 'no_market' };
  if (!row.valid) return { ok: false, action: 'noop', reason: 'bad_metadata' };
  const meta = JSON.parse(row.metadata);
  if (meta.zk_self_cov_id) {
    return { ok: String(meta.zk_self_cov_id).toLowerCase() === id, action: 'noop', reason: String(meta.zk_self_cov_id).toLowerCase() === id ? 'already_set_same' : 'already_set_DIFFERENT(不覆盖)', current: meta.zk_self_cov_id };
  }
  if (meta.zk_continuation?.exhausted !== true) return { ok: false, action: 'noop', reason: 'not_exhausted(本工具只补"续约已耗尽"的盘; 未耗尽的盘 claim tick 会自己 stamp)', current: null };
  if (!apply) return { ok: true, action: 'would_write', current: null };
  const r = db.prepare(`UPDATE pool_markets SET metadata = json_set(metadata, '$.zk_self_cov_id', ?) WHERE id = ? AND json_valid(metadata) AND json_extract(metadata, '$.zk_self_cov_id') IS NULL`).run(id, marketId);
  return r.changes === 1 ? { ok: true, action: 'written', current: null } : { ok: false, action: 'noop', reason: 'lost_race(写入瞬间该键已被别处写入, 未覆盖)' };
}
