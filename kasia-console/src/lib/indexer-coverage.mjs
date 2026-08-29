// indexer-coverage.mjs — L2 期 1 coverage 原语 (候选转正 2026-08-29; NWT GREEN)（J2 2026-08-29; 稿 70208425 §2.2; NWT 审注 (b): 期 1 coverage 须保守偏洞）
// 表: kaspa_tx_log_coverage (migrate v199)
//
// 保守规则 (soundness 方向 = 宁可少标 covered):
//   R1 只有 indexer 对某块【全部命中 tx 的 POST 都收到 2xx】后, 才对该块的 watched 集合推进 end_daa (advanceCoverage)。
//      任何一条 POST 失败/被 backoff 跳过/超时 ⇒ 该块不推进 ⇒ 账上自然留洞 (不需要"punch"动作也成立: 推进是唯一写法)。
//   R2 推进本身也是 POST; 推进丢了 = 账上少一段 = 洞 (方向安全)。
//   R3 相邻延伸阈 ADJ: daa − end_daa ≤ ADJ 才延伸同一行, 否则开新行 (= 真洞可见)。ADJ 由 spc_daa_index 单块 DAA 跨度 P99 定 (调用方传入; 本原语不拍数)。
//   R4 查询 indexerCoverage(): 区间并集必须【完全】盖住 [from,to] 才 covered=true; 任何缝 ⇒ holes[] 非空。
//   R5 时间→DAA 换算走 spc_daa_index (timestamp_ms 无索引 ⇒ 调用方保证 idx_spc_daa_ts 已建, 或传 daa 直接查)。
//   R6 期 3 原子 batch (coverage + tx 同一 transaction()) 之前, 本账只对"relay 声称已成功"的块成立 —— 写进 evidence.mode='phase1-relay-attested'。
export const COVERAGE_DDL = `
CREATE TABLE IF NOT EXISTS kaspa_tx_log_coverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  start_daa INTEGER NOT NULL,
  end_daa INTEGER NOT NULL,
  indexer TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_daa >= start_daa)
);
CREATE INDEX IF NOT EXISTS idx_txlog_cov_addr_end ON kaspa_tx_log_coverage(network, address, end_daa);
`;

/** 推进: 对 addresses 每个地址, 若最新行 end_daa ≤ daa ≤ end_daa+adj ⇒ 延伸; 否则(首行/跳块/回退) 开新行。返回 {extended, opened, skipped} */
export function advanceCoverage(db, { network, addresses, daa, indexer, adj, nowIso = new Date().toISOString() }) {
  if (!network || !Array.isArray(addresses) || !Number.isInteger(daa) || daa < 0 || !indexer || !Number.isInteger(adj) || adj < 0) throw new Error('advanceCoverage: bad args');
  const sel = db.prepare(`SELECT id, end_daa FROM kaspa_tx_log_coverage WHERE network = ? AND address = ? AND indexer = ? ORDER BY end_daa DESC LIMIT 1`);
  const upd = db.prepare(`UPDATE kaspa_tx_log_coverage SET end_daa = ?, updated_at = ? WHERE id = ?`);
  const ins = db.prepare(`INSERT INTO kaspa_tx_log_coverage (network, address, start_daa, end_daa, indexer, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
  const out = { extended: 0, opened: 0, skipped: 0 };
  const tx = db.transaction(() => {
    for (const address of addresses) {
      const last = sel.get(network, address, indexer);
      if (last && daa <= last.end_daa) { out.skipped++; continue; }            // 乱序/重复到达: 不回退
      if (last && daa - last.end_daa <= adj) { upd.run(daa, nowIso, last.id); out.extended++; }
      else { ins.run(network, address, daa, daa, indexer, nowIso); out.opened++; }   // 跳块 > adj ⇒ 新行 = 洞可见
    }
  });
  tx();
  return out;
}

/** 查询: [fromDaa, toDaa] 是否被该地址的区间并集完全覆盖 (跨 indexer 取并集); holes = 未覆盖子区间 */
export function indexerCoverageDaa(db, { network, address, fromDaa, toDaa }) {
  if (!Number.isInteger(fromDaa) || !Number.isInteger(toDaa) || fromDaa > toDaa) return { covered: false, holes: [{ start_daa: fromDaa, end_daa: toDaa, reason: 'bad_range' }], intervals: [] };
  const rows = db.prepare(`SELECT start_daa, end_daa, indexer FROM kaspa_tx_log_coverage WHERE network = ? AND address = ? AND end_daa >= ? AND start_daa <= ? ORDER BY start_daa ASC`).all(network, address, fromDaa, toDaa);
  const holes = [];
  let cursor = fromDaa;
  for (const r of rows) {
    if (r.start_daa > cursor) holes.push({ start_daa: cursor, end_daa: r.start_daa - 1 });
    if (r.end_daa + 1 > cursor) cursor = r.end_daa + 1;
    if (cursor > toDaa) break;
  }
  if (cursor <= toDaa) holes.push({ start_daa: cursor, end_daa: toDaa, reason: rows.length ? 'tail_uncovered' : 'no_rows' });
  return { covered: holes.length === 0, holes, intervals: rows };
}

/** 时间→DAA: spc_daa_index 里 timestamp_ms ≥ t 的最小 daa (上界方向: 把"从 t 起"换成"从不晚于 t 的块起", 保守); 找不到 ⇒ null */
export function daaAtOrAfterMs(db, ms) {
  const r = db.prepare(`SELECT daa_score FROM spc_daa_index WHERE timestamp_ms >= ? ORDER BY timestamp_ms ASC LIMIT 1`).get(ms);
  return r ? Number(r.daa_score) : null;
}
export function daaAtOrBeforeMs(db, ms) {
  const r = db.prepare(`SELECT daa_score FROM spc_daa_index WHERE timestamp_ms <= ? ORDER BY timestamp_ms DESC LIMIT 1`).get(ms);
  return r ? Number(r.daa_score) : null;
}

/** 消费方入口 (escrow/refund 候选注入的形): ISO 窗 → DAA 窗 → 覆盖判定. 换算失败 ⇒ covered=false (保守) */
export function indexerCoverage(db, { network, address, fromIso, toIso }) {
  const fromMs = Date.parse(fromIso), toMs = Date.parse(toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) return { covered: false, holes: [{ reason: 'bad_time_window' }], mode: 'phase1-relay-attested' };
  const fromDaa = daaAtOrBeforeMs(db, fromMs);   // 窗起点向前取 (多覆盖一点才算数, 保守)
  const toDaa = daaAtOrAfterMs(db, toMs) ?? daaAtOrBeforeMs(db, toMs);   // 窗终点向后取; 没有更晚块则取最近
  if (fromDaa == null || toDaa == null) return { covered: false, holes: [{ reason: 'daa_conversion_unavailable', fromDaa, toDaa }], mode: 'phase1-relay-attested' };
  const r = indexerCoverageDaa(db, { network, address, fromDaa, toDaa });
  return { ...r, fromDaa, toDaa, mode: 'phase1-relay-attested' };
}
