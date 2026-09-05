// phase2-shadow.mjs — Phase-2 C 包共用: 影子比对的集合差分 + LOUD 记账(events 行含双方差集样本)。
//   (2026-09-05 · 设计 docs/2026-09-05-j2-phase2-slow-sql-design-v0.1.md §4 影子比对 · Bettor 派工 ledger 905 · Owner "C GO")
//   规矩(Bettor): 主路仍走【旧查询】; 新查询只在影子里跑, 两边去 LIMIT 按集合比; 差异 LOUD 到 events(含双方差集样本);
//   一周零差异后 Bettor 批切换主路。开关与 A 包同一个: PHASE2_SHADOW_EVERY(默认 0=关; resolveShadowEvery/shadowDue 在 phase2-indexes-v200.mjs)。
//   本文件不 import DB, 不 import 业务; 纯函数 + 一个接 db 的写入器, 便于离线测。
import { randomUUID } from 'node:crypto';

export const SHADOW_SAMPLE_CAP = 20;

/** 两个 id 列表按集合比: 返回 {equal, onlyNew, onlyLegacy}(各自去重排序; 样本不截断, 截断在写入器) */
export function diffIdSets(newIds, legacyIds) {
  const a = new Set(newIds.map(String)), b = new Set(legacyIds.map(String));
  const onlyNew = [...a].filter((x) => !b.has(x)).sort();
  const onlyLegacy = [...b].filter((x) => !a.has(x)).sort();
  return { equal: onlyNew.length === 0 && onlyLegacy.length === 0, onlyNew, onlyLegacy, newCount: a.size, legacyCount: b.size };
}

/**
 * 差异记账: console LOUD + events 行(event_type=phase2_shadow_mismatch, payload 含 site/计数/双方差集样本 ≤ SHADOW_SAMPLE_CAP)。
 * 写失败只 warn, 永不抛(影子不能影响主路)。返回写入的 event id 或 null。
 */
export function writePhase2ShadowMismatch(db, { site, source, diff, log = console.log, warn = console.warn } = {}) {
  const sampleNew = diff.onlyNew.slice(0, SHADOW_SAMPLE_CAP), sampleLegacy = diff.onlyLegacy.slice(0, SHADOW_SAMPLE_CAP);
  const summary = `phase2_shadow_mismatch ${site}: new=${diff.newCount} legacy=${diff.legacyCount} onlyNew=${diff.onlyNew.length} onlyLegacy=${diff.onlyLegacy.length}`;
  log(`🔴 ${summary} onlyNew=[${sampleNew.join(',')}] onlyLegacy=[${sampleLegacy.join(',')}]`);
  try {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'phase2_shadow_mismatch', ?, 'warn', ?, ?, datetime('now'))
    `).run(id, source, summary, JSON.stringify({ site, newCount: diff.newCount, legacyCount: diff.legacyCount, onlyNewCount: diff.onlyNew.length, onlyLegacyCount: diff.onlyLegacy.length, onlyNewSample: sampleNew, onlyLegacySample: sampleLegacy, sampleCap: SHADOW_SAMPLE_CAP }));
    return id;
  } catch (e) { warn(`phase2 shadow events insert fail (non-fatal, ${site}): ${e.message}`); return null; }
}

/**
 * 跑一次影子: 用 runLegacy()/runNew() 取 id 列表(各自去 LIMIT), 差分, 不等则记账。任何异常只 warn。
 * 返回 {ran, equal, diff} 供日志/测试; 永不抛。
 */
export function runShadowCompare(db, { site, source, runNew, runLegacy, log = console.log, warn = console.warn } = {}) {
  try {
    const t0 = Date.now();
    const legacyIds = runLegacy(); const newIds = runNew();
    const diff = diffIdSets(newIds, legacyIds);
    if (!diff.equal) writePhase2ShadowMismatch(db, { site, source, diff, log, warn });
    else log(`[phase2-shadow] ${site} equal n=${diff.newCount} ${Date.now() - t0} ms`);
    return { ran: true, equal: diff.equal, diff };
  } catch (e) { warn(`phase2 shadow compare fail (non-fatal, ${site}): ${e.message}`); return { ran: false, error: e.message }; }
}
