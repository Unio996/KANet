// proto-settlement-store.mjs — 批9 9-2b(iii-1): 结算驱动的 DB 端口(工作发现 / 依赖 / landed 记账 / claim 行创建)。设计 §4 / §5 / P3 / P4。
// 核心(proto-settlement-driver-core.mjs)只认端口; 这里是真实端口里"只碰 DB"的那一半(四步 builder 入参装配在 proto-settlement-ops.mjs)。
// 🔴 NO TX NO STATE: 状态只在 landed 之后推进(markLanded); 每个写都带前态谓词(WHERE status=<前态>), 重复调用幂等; 一个 landed 的全部后效放在同一个同步事务里(better-sqlite3, 无 await)。
// 🔴 claim 行 id = randomBytes(32).toString('hex')(64 位小写 hex, 与市场 id 同式; Bettor 裁定)——它要进意图键 settle:claim:<id>:…, 必须过出口的 S9 校验(9-2a)。
import { randomBytes } from 'node:crypto';
import { sqlite } from '../db/client.js';
import { deriveCloseCommitInputs } from './proto-settlement-inputs.mjs';
import { deriveWinnerBet } from './proto-winner-bet.mjs';
import { ensureSettlementIntent } from './proto-settlement-intent.mjs';
import { isMarketFrozen } from './proto-settlement-freeze.mjs';

const BATCH9_INTENT_PREDICATE = `((subject_type = 'market' AND step IN ('seal', 'resolve')) OR (subject_type = 'claim' AND step IN ('convert_to_claim', 'claim_draw')))`;
const nowIso = () => new Date().toISOString();
const DRIVER_STEP_OF_INTENT = Object.freeze({ 'market:seal': 'seal', 'market:resolve': 'close_commit', 'claim:convert_to_claim': 'convert_to_claim', 'claim:claim_draw': 'claim_draw' });

export function newClaimId() { return randomBytes(32).toString('hex'); }

export function createSettlementStore({ db = sqlite, claimIdFn = newClaimId, ensureIntent = ensureSettlementIntent, claimDrawClaimOutIndex, now = nowIso } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('createSettlementStore: db 必填');
  if (!Number.isInteger(claimDrawClaimOutIndex) || claimDrawClaimOutIndex < 0) throw new TypeError('createSettlementStore: claimDrawClaimOutIndex 必填(builder 导出的 CLAIM_DRAW_CLAIM_OUT_INDEX; 没有默认值, 防止与 builder 的输出布局悄悄分叉)');

  const intentRow = (subjectType, subjectId, step) => db.prepare('SELECT * FROM proto_settlement_intents WHERE subject_type = ? AND subject_id = ? AND step = ? ORDER BY rowid DESC LIMIT 1').get(subjectType, subjectId, step) || null;
  const landed = (subjectType, subjectId, step) => { const r = db.prepare("SELECT 1 FROM proto_settlement_intents WHERE subject_type = ? AND subject_id = ? AND step = ? AND status = 'landed' LIMIT 1").get(subjectType, subjectId, step); return !!r; };
  const marketOf = (id) => db.prepare('SELECT * FROM proto_markets WHERE id = ?').get(id) || null;
  const claimOf = (id) => db.prepare('SELECT * FROM proto_claims WHERE id = ?').get(id) || null;

  /** seal 触发(P3): status='betting' ∧ 已确认下注 == seal_count ∧ 无未确认(pending)下注 ∧ 无 pending/prepared/submitted/ambiguous 的 append 意图 ∧ seal 意图未 landed / ambiguous。 */
  const sealSql = (byId) => `
    SELECT m.id FROM proto_markets m
    WHERE ${byId ? 'm.id = ? AND ' : ''}m.status = 'betting' AND m.seal_count > 0 AND m.shardleaf_txid IS NOT NULL
      AND (SELECT COUNT(*) FROM proto_bets b WHERE b.market_id = m.id AND b.status = 'confirmed') = m.seal_count
      AND NOT EXISTS (SELECT 1 FROM proto_bets b WHERE b.market_id = m.id AND b.status = 'pending')
      AND NOT EXISTS (SELECT 1 FROM proto_bet_intents i JOIN proto_bets b ON b.id = i.bet_id WHERE b.market_id = m.id AND i.step = 'append' AND i.status IN ('pending', 'prepared', 'submitted', 'ambiguous'))
      AND NOT EXISTS (SELECT 1 FROM proto_settlement_intents s WHERE s.subject_type = 'market' AND s.subject_id = m.id AND s.step = 'seal' AND s.status IN ('landed', 'ambiguous'))
    ${byId ? '' : 'ORDER BY m.created_at ASC LIMIT ?'}`;

  function sealReady(marketId) { return !!db.prepare(sealSql(true)).get(marketId); }

  /** 每个 tick 的工作清单(核心的 listWork 端口)。 */
  function listWork({ limit = 20 } = {}) {
    const landedChecks = db.prepare(`SELECT * FROM proto_settlement_intents WHERE status = 'submitted' AND ${BATCH9_INTENT_PREDICATE} ORDER BY updated_at ASC LIMIT ?`).all(limit);
    const preparedRows = db.prepare(`SELECT * FROM proto_settlement_intents WHERE status = 'prepared' AND ${BATCH9_INTENT_PREDICATE} ORDER BY updated_at ASC LIMIT ?`).all(limit);
    const advances = [];
    // 重启恢复(§9): prepared 行(字节已落库)不论触发条件是否仍满足都要推进——advanceStep 对它只做同字节重播, 永不重建; 排在最前(优先于新触发)
    for (const r of preparedRows) {
      const step = DRIVER_STEP_OF_INTENT[`${r.subject_type}:${r.step}`];
      const marketId = r.subject_type === 'market' ? r.subject_id : (claimOf(r.subject_id) || {}).market_id;
      if (step && marketId) advances.push({ step, subjectId: r.subject_id, marketId });
    }
    for (const r of db.prepare(sealSql(false)).all(limit)) advances.push({ step: 'seal', subjectId: r.id, marketId: r.id });
    for (const r of db.prepare(`
      SELECT m.id FROM proto_markets m
      WHERE m.status = 'sealed' AND m.winning_side IS NOT NULL
        AND m.settlement_frozen_at IS NULL   -- 批 D D1 入口①: 冻结市场不进 close_commit 选行(已 prepared 的意图走上面 preparedRows, 不受冻结影响)
        AND NOT EXISTS (SELECT 1 FROM proto_settlement_intents s WHERE s.subject_type = 'market' AND s.subject_id = m.id AND s.step = 'resolve' AND s.status IN ('landed', 'ambiguous'))
      ORDER BY m.created_at ASC LIMIT ?`).all(limit)) advances.push({ step: 'close_commit', subjectId: r.id, marketId: r.id });
    for (const r of db.prepare(`
      SELECT c.id AS claim_id, c.market_id FROM proto_claims c JOIN proto_markets m ON m.id = c.market_id
      WHERE c.side = 'win' AND m.status = 'resolved'
        AND EXISTS (SELECT 1 FROM proto_settlement_intents s WHERE s.subject_type = 'market' AND s.subject_id = m.id AND s.step = 'resolve' AND s.status = 'landed')
        AND NOT EXISTS (SELECT 1 FROM proto_settlement_intents s WHERE s.subject_type = 'claim' AND s.subject_id = c.id AND s.step = 'convert_to_claim' AND s.status IN ('landed', 'ambiguous'))
      ORDER BY c.created_at ASC LIMIT ?`).all(limit)) advances.push({ step: 'convert_to_claim', subjectId: r.claim_id, marketId: r.market_id });
    for (const r of db.prepare(`
      SELECT c.id AS claim_id, c.market_id FROM proto_claims c
      WHERE c.side = 'win' AND c.claim_txid IS NULL
        AND EXISTS (SELECT 1 FROM proto_settlement_intents s WHERE s.subject_type = 'claim' AND s.subject_id = c.id AND s.step = 'convert_to_claim' AND s.status = 'landed')
        AND NOT EXISTS (SELECT 1 FROM proto_settlement_intents s WHERE s.subject_type = 'claim' AND s.subject_id = c.id AND s.step = 'claim_draw' AND s.status IN ('landed', 'ambiguous'))
      ORDER BY c.created_at ASC LIMIT ?`).all(limit)) advances.push({ step: 'claim_draw', subjectId: r.claim_id, marketId: r.market_id });
    // 后效待应用(NWT 38b983e4 MUST): 意图已 landed 但 markLanded 的后效谓词未满足——checkSettlementIntentLanded 先把行置 landed、核心随后才 markLanded, 两步之间失败 / 进程死,
    // 该行就不会再出现在 landedChecks(只取 submitted)、市场也因 NOT EXISTS(landed) 不再出现在触发清单 ⇒ 永远无人再捞。这里把"landed 且后效缺失"单列一类, 核心每 tick 重跑(markLanded 幂等)。
    const effectsPending = db.prepare(`
      SELECT s.* FROM proto_settlement_intents s JOIN proto_markets m ON m.id = s.subject_id
      WHERE s.subject_type = 'market' AND s.step = 'seal' AND s.status = 'landed' AND m.status = 'betting'
      UNION ALL
      SELECT s.* FROM proto_settlement_intents s JOIN proto_markets m ON m.id = s.subject_id
      WHERE s.subject_type = 'market' AND s.step = 'resolve' AND s.status = 'landed'
        AND (m.status = 'sealed'
             OR NOT EXISTS (SELECT 1 FROM proto_claims c WHERE c.market_id = m.id AND c.side = 'win')
             OR NOT EXISTS (SELECT 1 FROM proto_claims c JOIN proto_settlement_intents i ON i.subject_type = 'claim' AND i.subject_id = c.id AND i.step = 'convert_to_claim' WHERE c.market_id = m.id AND c.side = 'win'))
      UNION ALL
      SELECT s.* FROM proto_settlement_intents s
      WHERE s.subject_type = 'claim' AND s.step = 'convert_to_claim' AND s.status = 'landed'
        AND NOT EXISTS (SELECT 1 FROM proto_settlement_intents i WHERE i.subject_type = 'claim' AND i.subject_id = s.subject_id AND i.step = 'claim_draw')
      UNION ALL
      SELECT s.* FROM proto_settlement_intents s JOIN proto_claims c ON c.id = s.subject_id
      WHERE s.subject_type = 'claim' AND s.step = 'claim_draw' AND s.status = 'landed' AND c.claim_txid IS NULL
      LIMIT ?`).all(limit);
    const seen = new Set();
    const deduped = advances.filter((a) => { const k = `${a.step}:${a.subjectId}`; if (seen.has(k)) return false; seen.add(k); return true; });
    return { landedChecks, preparedRows, advances: deduped, effectsPending };
  }

  /** 依赖已 landed(§4, 含跨 subject_type 的额外检查)。返回 {ok, reason}。 */
  function dependenciesLanded(step, { subjectId, marketId }) {
    if (step === 'seal') return sealReady(marketId) || landedOrActive('market', marketId, 'seal') ? { ok: true } : { ok: false, reason: 'seal_conditions_not_met' };
    if (step === 'close_commit') {
      const m = marketOf(marketId);
      if (!m || m.status !== 'sealed') return { ok: false, reason: 'market_not_sealed' };
      if (m.settlement_frozen_at !== null && m.settlement_frozen_at !== undefined) return { ok: false, reason: 'settlement_frozen' };   // 批 D D1 入口②: 重读冻结列(listWork 选行与这里之间可能已冻)
      if (m.winning_side !== 0 && m.winning_side !== 1) return { ok: false, reason: 'winning_side_not_set' };
      return landed('market', marketId, 'seal') ? { ok: true } : { ok: false, reason: 'seal_not_landed' };
    }
    if (step === 'convert_to_claim') {
      const c = claimOf(subjectId), m = c && marketOf(c.market_id);
      if (!c || !m || m.status !== 'resolved') return { ok: false, reason: 'market_not_resolved' };
      return landed('market', m.id, 'resolve') ? { ok: true } : { ok: false, reason: 'resolve_not_landed' };   // 跨 subject_type: STEP_DEPENDS_ON 里 convert_to_claim 为 null, 由这里额外检查(§4)
    }
    if (step === 'claim_draw') return landed('claim', subjectId, 'convert_to_claim') ? { ok: true } : { ok: false, reason: 'convert_to_claim_not_landed' };
    return { ok: false, reason: `unknown_step:${step}` };
  }
  // seal 的 prepared / submitted 行: 触发条件在提交后会变(下注表不变但 append 意图等), 已在途的不该被"条件不再满足"挡住(它只会同字节重播 / 等 landed)
  const landedOrActive = (st, id, step) => { const r = intentRow(st, id, step); return !!r && ['prepared', 'submitted', 'landed'].includes(r.status); };

  /** landed 后效(§4: 只有 landed 才推进状态与创建后续意图)。同步事务, 每个写带前态谓词, 重复调用幂等。 */
  function markLanded(step, intent) {
    const tx = db.transaction(() => {
      const t = now();
      if (step === 'seal') {
        return { sealed: db.prepare("UPDATE proto_markets SET status = 'sealed', updated_at = ? WHERE id = ? AND status = 'betting'").run(t, intent.subject_id).changes };
      }
      if (step === 'close_commit') {
        const marketId = intent.subject_id;
        const m = marketOf(marketId);
        const existing = db.prepare("SELECT id FROM proto_claims WHERE market_id = ? AND side = 'win' LIMIT 1").get(marketId);
        let claimId = existing ? existing.id : null, created = 0;
        if (!claimId && m) {
          // sealed: 走带全部 fail-closed 检查的 deriveCloseCommitInputs(必须在把 status 推到 resolved 之前); 已 resolved 却缺 claim 行(人工改库 / 旧版本遗留)⇒ 由同一份赢家判定补建, 不留"永远挂起"
          let bettorPk, amount;
          if (m.status === 'sealed') { const d = deriveCloseCommitInputs(marketId, { db }); bettorPk = d.payouts[0].bettorPk; amount = d.poolValue; }
          else { const w = deriveWinnerBet(marketId, { db, who: `markLanded(close_commit) 补建 claim(${marketId.slice(0, 12)}…)` }); bettorPk = String(w.winner.bettor_pk).toLowerCase(); amount = w.poolValue; }
          claimId = claimIdFn();
          created = db.prepare("INSERT OR IGNORE INTO proto_claims (id, market_id, bettor_pk, side, amount, created_at) VALUES (?, ?, ?, 'win', ?, ?)").run(claimId, marketId, bettorPk, amount, t).changes;
        }
        const resolved = db.prepare("UPDATE proto_markets SET status = 'resolved', updated_at = ? WHERE id = ? AND status = 'sealed'").run(t, marketId).changes;
        if (claimId) ensureIntent({ subjectType: 'claim', subjectId: claimId, step: 'convert_to_claim' });   // 幂等(活跃行复用)
        return { resolved, claimCreated: created, claimId };
      }
      if (step === 'convert_to_claim') {
        ensureIntent({ subjectType: 'claim', subjectId: intent.subject_id, step: 'claim_draw' });
        return { claimDrawIntent: true };
      }
      if (step === 'claim_draw') {
        if (!intent.submitted_txid) throw new Error('markLanded(claim_draw): landed 行缺 submitted_txid');
        return { claimed: db.prepare('UPDATE proto_claims SET claim_txid = ?, claim_vout = ?, claimed_at = ? WHERE id = ? AND claim_txid IS NULL').run(intent.submitted_txid, claimDrawClaimOutIndex, t, intent.subject_id).changes };
      }
      throw new Error(`markLanded: 未知步骤 ${step}`);
    });
    return tx();
  }

  /** 批 D D1 入口③的数据源(核心广播前闸调用): 读失败 / 市场不存在 ⇒ 抛(核心按冻结处理, fail-closed)。 */
  const isSettlementFrozen = async (marketId) => isMarketFrozen(db, marketId);

  return { listWork, dependenciesLanded, markLanded, sealReady, isSettlementFrozen, _claimOf: claimOf, _marketOf: marketOf };
}
