// proto-oracle-adapter-core.mjs — oracle 整合批 B: adapter 一个 tick 的编排(扫 sealed 判定题市场 → derive 两路 → 贴标 / 决策 → 写 verdicts → 批 D 门 → promote / 冻结)。
// 设计 docs/2026-09-20-bettor-oracle-batchB-adapter-verdict-promote-design-v0.1.md §1–§4 + §10 B1–B7 + §11。
// 🔴 复用 deriveKanetNativeVote / derivePolymarketVote(注入; 不改引擎内核); 写值只经批 D 的 promoteWinningSide(带 B7 NOT EXISTS 异议子查询的 guarded UPDATE)、
//    冻结只经批 D 的 freezeMarket; 全部 DB 写都在此(db 注入; 本文件不 import DB 客户端: M0a 门)。
// 🔴 N5b / B5: 每个候选市场在【扫描】与【promote 之前】各调一次 judgedMarketAllowedHere(三处强制谓词之③); 不允许 ⇒ 跳过, 不写任何东西。
// 🔴 v0 "单运营方裁决机": R2 的"多源"= 数据源机制独立(ESPN 确定性抽取器 vs UMA 人投预言机), 不是多个 relay 委员(设计 §6 M4)。
import { judgedSqlPredicate, JUDGED_COLUMNS } from '../db/proto-judged.mjs';
import { judgedMarketAllowedHere } from './proto-oracle-policy.mjs';
import { classifyDerivation, toSide, evidenceRefOf, planVerdictWrites, assertUmaWindowSafe } from './proto-oracle-verdict.mjs';
import { parseStoredSpec, CONDITION_ID_RE } from './proto-oracle-spec.mjs';
import { normalizeSideMap } from './proto-oracle-verdict.mjs';
import { evaluatePromoteGate } from './proto-settlement-budget.mjs';
import { freezeMarket, promoteWinningSide } from './proto-settlement-freeze.mjs';
import { findExtractor } from './oracle-evidence-extractors.mjs';

const CANDIDATE_SQL = `
  SELECT m.id, m.token_def_id, m.status, m.winning_side, m.settlement_frozen_at, m.deadline_ms, m.outcome_end_ms,
         ${JUDGED_COLUMNS.map((c) => `m.${c}`).join(', ')}
  FROM proto_markets m
  WHERE m.status = 'sealed' AND m.winning_side IS NULL AND m.settlement_frozen_at IS NULL
    AND ${judgedSqlPredicate('m')} AND m.outcome_end_ms IS NOT NULL
  ORDER BY m.created_at ASC LIMIT ?`;

/**
 * @param {object} o
 * @param {object} o.db                       注入的 better-sqlite3 库
 * @param {() => Promise<{valid:boolean,pmtMs?:number}>} o.readPmt   批 D readValidatedPmt 的封装(每 tick 至多读一次)
 * @param {(offer, spec) => Promise<object>} o.deriveExtractor   = deriveKanetNativeVote
 * @param {(offer) => Promise<object>} o.deriveUma               = derivePolymarketVote
 * @param {object} o.cfg                      批 D resolveBudgetConfig().config
 * @param {string} o.network                  configuredNetwork()
 * @param {number} o.umaWindowMs              voter 导出的 UMA_FINALIZATION_WINDOW_MS 生效值
 * @returns {Promise<object>} 本 tick 摘要(供日志 / 测试)
 */
export async function runOracleAdapterTick({ db, readPmt, deriveExtractor, deriveUma, cfg, network, umaWindowMs, env = process.env, nowMs = Date.now, log = console, limit = 20, findExtractorFn = findExtractor }) {
  const summary = { scanned: 0, skipped: {}, verdictsWritten: 0, promoted: [], frozen: [], waited: 0, errors: 0, aborted: null };
  const skip = (why, id) => { summary.skipped[why] = (summary.skipped[why] || 0) + 1; log.log?.(`[proto-oracle-adapter] skip market=${String(id).slice(0, 12)} why=${why}`); };
  const uma = assertUmaWindowSafe(umaWindowMs);
  if (!uma.ok) { summary.aborted = 'uma_window_unsafe'; log.error?.(`[proto-oracle-adapter] REFUSED tick: ${uma.reason}`); return summary; }
  const candidates = db.prepare(CANDIDATE_SQL).all(limit);
  if (!candidates.length) return summary;
  let pmt = null;
  try { pmt = await readPmt(); } catch (e) { pmt = { valid: false, reason: `read_pmt_threw: ${e && e.message ? e.message : e}` }; }
  const pmtOk = !!(pmt && pmt.valid === true && Number.isSafeInteger(pmt.pmtMs));

  for (const m of candidates) {
    summary.scanned++;
    try {
      // 三处强制谓词之③(扫描)
      const allowed = judgedMarketAllowedHere({ network, tokenDefId: m.token_def_id, env });
      if (!allowed.allowed) { skip(`not_allowed_here:${allowed.reason.split('(')[0]}`, m.id); continue; }
      // 结果可知: max(墙钟, pmt) ≥ outcome_end(墙钟已过即可扫——pmt 无效时仍要能写实质异议, B4)
      const wall = nowMs();
      if (!(wall >= m.outcome_end_ms || (pmtOk && pmt.pmtMs >= m.outcome_end_ms))) { skip('outcome_not_known', m.id); continue; }
      const spec = parseStoredSpec(m.resolution_rule_spec);
      const sideMap = spec ? normalizeSideMap(spec.side_map) : null;
      if (!spec || !sideMap || (spec.polymarket_outcome_side !== 'YES' && spec.polymarket_outcome_side !== 'NO')) { skip('spec_invalid', m.id); summary.errors++; continue; }
      // B6(a): adapter 复核同一注册表(直接写库 / 旧数据的 data_source 也不 fetch); v0 只支持 ESPN 确定性源
      const ent = findExtractorFn(spec.data_source_canonical);
      if (!ent || ent.kind !== 'espn') { skip('source_not_registered', m.id); summary.errors++; continue; }

      const existing = db.prepare('SELECT id, source_kind, outcome, evidence_ref, pmt_at FROM proto_market_verdicts WHERE market_id = ?').all(m.id);
      const kinds = new Set(existing.map((v) => v.source_kind));
      // B2: 每路成功判出结果后不再重复 derive(LLM 每市场只问一次: kanet 路已有 extractor / llm 行即不再调)
      const doExtractor = !kinds.has('extractor') && !kinds.has('llm');
      const doUma = !kinds.has('uma') && m.outcome_market_source === 'polymarket' && typeof m.outcome_condition_id === 'string' && CONDITION_ID_RE.test(m.outcome_condition_id);
      const items = [];
      const run = async (branch, fn) => {
        let result = null;
        try { result = await fn(); } catch (e) { result = { ok: false, reason: `derive_threw: ${e && e.message ? e.message : e}` }; }
        const c = classifyDerivation({ branch, result });
        const item = { branch, cls: c.cls, kind: c.kind, reason: c.reason, evidenceRef: evidenceRefOf({ result, cls: c.cls }), confidence: null };
        if (c.cls === 'vote') {
          try { item.side = toSide(c.label, { sideMap, branch, polymarketOutcomeSide: spec.polymarket_outcome_side }); }
          catch (e) { item.cls = 'transient'; item.reason = `toSide_failed: ${e.message}`; }
        }
        items.push(item);
      };
      if (doExtractor) await run('extractor', () => deriveExtractor({ id: m.id, outcome_market_source: 'kanet_native', outcome_condition_id: null, outcome_token_id: null, outcome_side: null, resolution_rule_spec: m.resolution_rule_spec, outcome_oracle_relay_id: null }, spec));
      if (doUma) await run('uma', () => deriveUma({ id: m.id, outcome_market_source: 'polymarket', outcome_condition_id: m.outcome_condition_id, outcome_token_id: null, resolution_rule_spec: null }));

      const plan = planVerdictWrites({ items, existing, pmt });
      if (plan.writes.length) {
        const dup = db.prepare('SELECT 1 FROM proto_market_verdicts WHERE market_id = ? AND source_kind = ? AND evidence_ref = ? LIMIT 1');
        const ins = db.prepare('INSERT INTO proto_market_verdicts (market_id, source_kind, relay_id, outcome, confidence, evidence_ref, created_at, pmt_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)');
        db.transaction(() => {   // 事务内查重后插(同 (市场, source_kind, 证据哈希) 至多一条)
          for (const w of plan.writes) { if (dup.get(m.id, w.source_kind, w.evidence_ref)) continue; ins.run(m.id, w.source_kind, w.outcome, w.confidence, w.evidence_ref, new Date(nowMs()).toISOString(), w.pmt_at); summary.verdictsWritten++; }
        })();
      }
      // 批 D 门
      const fresh = db.prepare(`SELECT m.id, m.status, m.winning_side, m.settlement_frozen_at, m.deadline_ms, m.outcome_end_ms, ${JUDGED_COLUMNS.map((c) => `m.${c}`).join(', ')} FROM proto_markets m WHERE m.id = ?`).get(m.id);
      const verdicts = db.prepare('SELECT id, source_kind, outcome, pmt_at FROM proto_market_verdicts WHERE market_id = ?').all(m.id);
      const bets = db.prepare('SELECT side, status, stake FROM proto_bets WHERE market_id = ?').all(m.id);
      const decision = evaluatePromoteGate({ market: fresh, verdicts, bets, pmt, wallMs: nowMs(), cfg });
      if (decision.action === 'promote') {
        // 三处强制谓词之③(promote 前再判一次)
        const again = judgedMarketAllowedHere({ network, tokenDefId: m.token_def_id, env });
        if (!again.allowed) { skip('not_allowed_here_at_promote', m.id); continue; }
        const r = promoteWinningSide({ db, marketId: m.id, decision });
        if (r.changes === 1) { summary.promoted.push({ id: m.id, side: decision.winningSide, source: decision.source, verdictId: decision.verdictId }); log.log?.(`[proto-oracle-adapter] PROMOTED market=${m.id.slice(0, 12)} winning_side=${decision.winningSide} source=${decision.source} verdict=${decision.verdictId}`); }
        else { skip('promote_guard_changes_0', m.id); }   // 已判 / 已冻 / 非 sealed / B7: 检查后插入了异议行 ⇒ 下 tick 门会因异议冻结
      } else if (decision.action === 'freeze') {
        const f = freezeMarket({ db, marketId: m.id, reason: decision.reason, pmt, wallMs: nowMs(), log });
        summary.frozen.push({ id: m.id, reason: decision.reason, clock: f.clock, changes: f.changes });
      } else summary.waited++;
    } catch (e) {
      summary.errors++;
      log.error?.(`[proto-oracle-adapter] market=${String(m.id).slice(0, 12)} tick error: ${e && e.message ? e.message : e}`);
    }
  }
  return summary;
}
