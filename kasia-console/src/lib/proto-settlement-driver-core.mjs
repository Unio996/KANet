// proto-settlement-driver-core.mjs — 批9 9-2b(ii): 结算驱动核心(四步: seal / close_commit / convert_to_claim / claim_draw)的【编排层】。
// 设计: docs/2026-09-19-j2-proto-v0-batch9-wiring-design-and-checklist-v0.2.md §3–§12 / §19。
//
// 🔴 本文件是纯编排: 一切外部依赖(意图表、指针、C1 取证、DB 派生入参 + builder、pmt 读取、relay IPC、报警)都经 deps 端口注入——
//   ① 不 import 任何 DB 客户端 / relay-manager / kaspa-wasm(无 DB_PATH 可 import, 测试里有守卫); ② 不接触私钥(builder 端口自己取信封, §11.4); ③ 没有任何调用方 ⇒ 无运行时效果。
//   真实端口(DB 查询 + 四步 builder 入参装配)与启动接线在 9-2b(iii)。
// 🔴 通用顺序(§5, 每步一致, 全部在签名之前): 建 pending 意图(先于任何 IPC)→ 依赖已 landed → 指针 → C1 取证 → DB 派生 / 步骤专属闸(close_commit 的 pmt 门)→ builder → covenant_broadcast → landed 检查 → landed 记账。
// 🔴 NO TX NO STATE: 广播失败 / 超时 / 进程死 ≠ 已发生——只有 landed 才推进 market 状态与后续意图; prepared 行只允许同字节重播(driveIntent 内部), 永不重建 / 重签。
// 🔴 报警名收进闭集 SETTLEMENT_ALERTS(含 c1 的 fee_candidate_* 事件); 发未登记的名字直接抛错(否则拼错的名字会静默不报警)。
import { classifyC1Error, createTransportAlertGrader, withFeeParent } from './proto-settlement-c1.mjs';
import { evaluateCloseCommitTiming } from './proto-close-commit-gate.mjs';

export const SETTLEMENT_DRIVER_STEPS = Object.freeze(['seal', 'close_commit', 'convert_to_claim', 'claim_draw']);
/** 驱动步骤名 → 意图表里的 (subject_type, step)。close_commit 的意图 step 名是 'resolve'(§4)。 */
export const STEP_INTENT = Object.freeze({
  seal: Object.freeze({ subjectType: 'market', intentStep: 'seal' }),
  close_commit: Object.freeze({ subjectType: 'market', intentStep: 'resolve' }),
  convert_to_claim: Object.freeze({ subjectType: 'claim', intentStep: 'convert_to_claim' }),
  claim_draw: Object.freeze({ subjectType: 'claim', intentStep: 'claim_draw' }),
});
export const PREPARED_STALE_MS = 10 * 60_000;      // §9 S6: prepared 超过 10 分钟仍未 landed ⇒ 报警
export const PMT_READ_FAIL_ALERT_AFTER = 3;        // §10: 连续 3 次读 pmt 失败 ⇒ 报警
export const RELAY_FEE_REJECT_CODES = Object.freeze(['net_loss_exceeded', 'implied_fee_exceeded']);
/** 出口分闸(9-2a)的四种确定性拒绝: 重试永远不会成功, 当 tick 立即报警(NWT e4039235 MUST——否则意图永远 pending、每 tick 静默重试、永不结算也永不报警)。 */
export const EXIT_GATE_REFUSAL_CODES = Object.freeze(['proto_settlement_intent_key_invalid', 'proto_intent_key_not_string', 'proto_driver_disabled', 'proto_settlement_driver_disabled']);
/** 其余广播失败(relay ok:false / IPC 超时 …)按 (intent_key, code) 连续这么多个【不同 tick】仍失败 ⇒ 同一报警(幂等, 成功清零)。 */
export const BROADCAST_FAIL_ALERT_AFTER = 3;

/** §10 报警闭集(名字 → 默认级别)。 */
export const SETTLEMENT_ALERTS = Object.freeze({
  settlement_close_commit_sla_warn: 'warn',
  settlement_close_commit_refund_flip_open: 'error',
  settlement_refund_flip_observed: 'error',
  settlement_intent_ambiguous_inputs_spent: 'error',
  settlement_intent_ambiguous_replay_txid_mismatch: 'error',
  settlement_intent_prepared_without_bytes: 'error',
  settlement_signing_key_mismatch: 'error',
  settlement_close_commit_args_not_from_db: 'error',
  settlement_chain_fact_drift: 'error',
  settlement_pmt_read_failed: 'warn',
  settlement_relay_fee_rejected: 'error',
  settlement_prepared_stale: 'warn',
  settlement_c1_programming_error: 'error',
  settlement_facts_transport_error: 'warn',
  settlement_fee_window_saturated: 'error',
  settlement_no_suitable_fee_utxo: 'warn',
  fee_candidate_poisoned_skipped: 'warn',
  fee_candidate_out_of_range_skipped: 'warn',          // 9-2b 清单 #8: F1 起 c1 会发, 这里登记
  settlement_step_unexpected_error: 'error',
});

const REQUIRED_DEPS = ['sendCmd', 'relayId', 'alert', 'intents', 'driveIntent', 'pointers', 'prepare', 'verifyOnChain', 'build', 'dependenciesLanded', 'checkLanded', 'markLanded', 'listWork', 'minDepth', 'now'];

export class DriverDepsError extends TypeError {}
function assertDeps(deps) {
  if (!deps || typeof deps !== 'object') throw new DriverDepsError('driver core: deps 必填');
  const missing = REQUIRED_DEPS.filter((k) => deps[k] === undefined || deps[k] === null);
  if (missing.length) throw new DriverDepsError(`driver core: deps 缺 ${missing.join(', ')}`);
  for (const k of ['sendCmd', 'alert', 'driveIntent', 'pointers', 'prepare', 'verifyOnChain', 'build', 'dependenciesLanded', 'checkLanded', 'markLanded', 'listWork', 'now']) if (typeof deps[k] !== 'function') throw new DriverDepsError(`driver core: deps.${k} 必须是函数`);
  for (const k of ['ensure', 'active', 'get']) if (!deps.intents || typeof deps.intents[k] !== 'function') throw new DriverDepsError(`driver core: deps.intents.${k} 必须是函数`);
  if (!Number.isInteger(deps.minDepth) || deps.minDepth <= 0) throw new DriverDepsError('driver core: deps.minDepth 必须是正整数(没有默认值: 与 REORG_SAFE_MIN_DEPTH 同源, 由接线传入)');
}

/** 报警包装: 名字必须在闭集内; 级别缺省取闭集默认。 */
export function makeAlerter(rawAlert) {
  if (typeof rawAlert !== 'function') throw new TypeError('makeAlerter: alert 必须是函数');
  return (eventType, summary, payload = {}, level) => {
    if (!Object.prototype.hasOwnProperty.call(SETTLEMENT_ALERTS, eventType)) throw new Error(`settlement alert: 事件名 ${eventType} 未登记进 SETTLEMENT_ALERTS`);
    return rawAlert(eventType, summary, payload, level || SETTLEMENT_ALERTS[eventType]);
  };
}

/**
 * close_commit 的同节点 pmt 门(§8): 读 relay 的 get_past_median_time(与提交交易的是同一个共享 RpcClient ⇒ 同节点), 读不到 / 非法一律 canSubmit=false(fail-closed);
 * 放行时产出 pmtEvidence = { pastMedianTimeMs, readAtMs(=relay 的 observedAtMs), source:'relay' }(S5: builder 只接受 source==='relay' 且 readAtMs 距今 ≤ 60 s 的证据)。
 * 不用本地墙钟判断能否提交(B4-2)。
 */
export async function checkPmtGate({ sendCmd, relayId, deadlineMs, timeoutMs = 15000 }) {
  let r;
  try { r = await sendCmd(relayId, { type: 'get_past_median_time' }, timeoutMs, 'internal'); }
  catch (e) { return { canSubmit: false, readFailed: true, reason: `get_past_median_time 抛错: ${e && e.message ? e.message : e}`, pmtEvidence: null, sla: 'ok' }; }
  const pmt = r && r.pastMedianTimeMs, obs = r && r.observedAtMs;
  if (!(r && r.ok === true && Number.isFinite(pmt) && pmt > 0 && Number.isFinite(obs) && obs > 0)) {
    return { canSubmit: false, readFailed: true, reason: `get_past_median_time 回执不合法(ok=${r && r.ok})`, pmtEvidence: null, sla: 'ok' };
  }
  const tm = evaluateCloseCommitTiming({ pastMedianTimeMs: pmt, deadlineMs });
  return { ...tm, readFailed: false, pastMedianTimeMs: pmt, pmtEvidence: tm.canSubmit ? { pastMedianTimeMs: pmt, readAtMs: obs, source: 'relay' } : null };
}

/** 单个驱动实例(有状态: 传输报警分级 / pmt 读失败连续计数 / SLA 与 stale 去重); 状态只在内存里, 不碰外部存储。 */
export function createSettlementDriver(deps, { ticksToError = 3 } = {}) {
  assertDeps(deps);
  const alert = makeAlerter(deps.alert);
  const grader = createTransportAlertGrader({ ticksToError });
  const log = deps.log || console;
  const pmtFail = new Map();            // intentKey → 连续失败次数
  const slaAlerted = new Set();         // `${intentKey}:${sla}` 已报警(幂等)
  const staleAlerted = new Set();       // `${intentKey}:${updated_at}` 已报警
  const flipAlerted = new Set();        // refund_flip_observed 已报警(幂等)
  const gateAlerted = new Set();        // `${intentKey}:${code}` 出口分闸确定性拒绝已报警(每 tick 重试会每 tick 撞同一个拒绝——去重, 否则每 tick 刷 events; 成功清零)
  const bcastFail = new Map();          // intentKey → { code, count, lastTick, alerted }: 广播失败的连续计数(按 key 分开, 同 code 才累计)
  let tickSeq = 0;

  const keyOf = (step, subjectId) => `settle:${STEP_INTENT[step].subjectType}:${subjectId}:${STEP_INTENT[step].intentStep}`;

  /** 报 C1 / 构造类失败(纯分类交给 classifyC1Error; 传输类走分级)。 */
  function reportFailure(err, tickId, key, extra = {}) {
    const g = grader.onFailure(err, tickId, key);
    alert(g.eventType, `${key}: ${err && err.message ? String(err.message).slice(0, 300) : err}`, { intent_key: key, code: g.code, transient: g.transient, consecutiveTicks: g.consecutiveTicks, ...extra }, g.level);
    return g;
  }

  /** 步骤失败的报警分类: 指针 / C1 类交给 classifyC1Error(传输类走分级); builder 类按错误文本 / code 归到 §10 的专名; 广播类只记 last_error(driveIntent 已写), 不报"编程错误"。 */
  function classifyStepFailure(err, stage, step) {
    const msg = err && err.message ? String(err.message) : String(err);
    if (stage === 'broadcast') {
      const gate = EXIT_GATE_REFUSAL_CODES.find((c) => msg.includes(c));
      if (gate) return { report: true, gate: true, eventType: 'settlement_step_unexpected_error', level: 'error', code: gate, transient: false };   // 确定性拒绝: 立即报警
      return { report: false, eventType: 'broadcast_failed', code: err && err.code ? String(err.code) : 'unknown', transient: true, track: true };
    }
    if (stage === 'build') {
      if (/^signing_key_mismatch\b/.test(msg)) return { report: true, eventType: 'settlement_signing_key_mismatch', level: 'error', code: 'signing_key_mismatch', transient: false };
      if (step === 'close_commit' && (/db_payout_root_drift/.test(msg) || (err && err.code === 'close_commit_args_not_from_db'))) return { report: true, eventType: 'settlement_close_commit_args_not_from_db', level: 'error', code: 'close_commit_args_not_from_db', transient: false };
    }
    return { report: true, viaGrader: true };
  }

  /** 广播失败的连续计数: 同 (key, code) 连续 BROADCAST_FAIL_ALERT_AFTER 个不同 tick ⇒ settlement_step_unexpected_error 一次(其后不重复, 直到成功清零); code 变了从 1 重计。 */
  function trackBroadcastFailure(key, code, tickId) {
    const st = bcastFail.get(key);
    if (!st || st.code !== code) { bcastFail.set(key, { code, count: 1, lastTick: tickId, alerted: false }); return; }
    if (tickId !== st.lastTick) { st.count += 1; st.lastTick = tickId; }
    if (st.count >= BROADCAST_FAIL_ALERT_AFTER && !st.alerted) {
      st.alerted = true;
      alert('settlement_step_unexpected_error', `${key}: 广播连续 ${st.count} 个 tick 失败(code=${code}), 意图一直 pending`, { intent_key: key, code, stage: 'broadcast', consecutiveTicks: st.count }, 'error');
    }
  }

  /** 一步推进(通用顺序 §5)。返回 { outcome: 'submitted'|'in_flight'|'waiting'|'held'|'failed'|'gated', ... }; 永不抛(除 DriverDepsError)。 */
  async function advanceStep({ step, subjectId, marketId, tickId = ++tickSeq }) {
    const plan = STEP_INTENT[step];
    if (!plan) throw new RangeError(`advanceStep: 未知步骤 ${step}`);
    if (typeof subjectId !== 'string' || !subjectId || typeof marketId !== 'string' || !marketId) throw new TypeError('advanceStep: subjectId / marketId 必填');
    const key = keyOf(step, subjectId);
    let stage = 'inputs', buildFail = null;   // driveIntent 会把 buildAndBroadcast 的错误包成 "exhausted" 新错误(丢 code / 类型), 所以在闭包里留一份原始错误 + 阶段
    try {
      // 1) 意图行: 先建 pending(先于任何 IPC); 已在途 / 已 landed / ambiguous 不再走构造
      let row = deps.intents.active(plan.subjectType, subjectId, plan.intentStep) || deps.intents.ensure({ subjectType: plan.subjectType, subjectId, step: plan.intentStep });
      if (row.status === 'landed' || row.status === 'submitted') return { outcome: 'in_flight', key, status: row.status };
      if (row.status === 'ambiguous') return { outcome: 'held', key, reason: 'ambiguous' };
      // 2) 依赖已 landed(含跨 subject_type 的额外检查, §4)——prepared 行不需要(它只会同字节重播)
      if (row.status === 'pending') {
        const dep = await deps.dependenciesLanded(step, { subjectId, marketId });
        if (!dep || dep.ok !== true) return { outcome: 'waiting', key, reason: (dep && dep.reason) || 'dependency_not_landed' };
      }
      const targetAddress = (await deps.prepare(step, { marketId, subjectId, phase: 'target' })).targetAddress;
      // 3) 交给意图状态机: prepared ⇒ 同字节重播(永不重建); pending ⇒ 走下面的 buildAndBroadcast(单次尝试, 重试交给下一 tick)
      const res = await deps.driveIntent({
        sendCmd: deps.sendCmd, relayId: deps.relayId, subjectType: plan.subjectType, subjectId, step: plan.intentStep, targetAddress, origin: 'internal', maxAttempts: 1, sleepMs: () => 0, log,
        buildAndBroadcast: async () => {
          try {
            // ── 以下全部在签名之前(builder 内的签名除外) ──
            stage = 'inputs';
            const pointers = deps.pointers(step, marketId);
            const prep = await deps.prepare(step, { marketId, subjectId, phase: 'inputs', pointers });   // DB 派生的 expectedSpks / feeMinAmount / 步骤入参(纯读)
            const v = await deps.verifyOnChain({ step, pointers, expectedSpks: prep.expectedSpks, feeMinAmount: prep.feeMinAmount, inflightOutpoints: (prep.inflightOutpoints || []) });
            grader.onSuccess(key);
            for (const ev of (v.events || [])) alert(ev.eventType, `${key}: ${ev.eventType}`, { intent_key: key, ...(ev.payload || {}) }, ev.level);
            let pmtEvidence;
            if (step === 'close_commit') {
              stage = 'gate';
              const gate = await checkPmtGate({ sendCmd: deps.sendCmd, relayId: deps.relayId, deadlineMs: prep.deadlineMs });
              pmtSla(key, gate);
              if (!gate.canSubmit) { const e = new Error(`close_commit_pmt_not_ready: ${gate.reason}`); e.code = 'close_commit_pmt_not_ready'; throw e; }
              pmtEvidence = gate.pmtEvidence;
            }
            stage = 'build';
            const built = await deps.build(step, { marketId, subjectId, prep, chainParents: v.chainParents, feeCandidates: v.fee && v.fee.candidates, withFeeParent, pmtEvidence });
            if (!built || typeof built.txJson !== 'string' || typeof built.expectedTxid !== 'string' || !Array.isArray(built.signInputIndices) || built.signInputIndices.length === 0) {
              throw new Error(`${key}: build 端口返回不完整(txJson / expectedTxid / 非空 signInputIndices)`);
            }
            stage = 'broadcast';
            const cmd = { type: 'covenant_broadcast', intent_key: key, tx_json: built.txJson, sign_input_indices: built.signInputIndices, expected_txid: built.expectedTxid };
            if (built.genesisOutputIndices) cmd.genesis_output_indices = built.genesisOutputIndices;
            if (built.continuationOutputIndices) cmd.continuation_output_indices = built.continuationOutputIndices;
            const rep = await deps.sendCmd(deps.relayId, cmd, 30000, 'internal');
            if (rep && rep.ok && rep.txId) return { txId: rep.txId, txJson: built.txJson };
            const code = rep && rep.code;
            if (RELAY_FEE_REJECT_CODES.includes(code)) alert('settlement_relay_fee_rejected', `${key}: relay 拒绝 fee(${code})`, { intent_key: key, code }, 'error');
            const e = new Error((rep && rep.error) || `covenant_broadcast failed (code=${code || 'unknown'})`); e.code = code; throw e;
          } catch (e) { buildFail = { err: e, stage }; throw e; }
        },
      });
      pmtFail.delete(key); bcastFail.delete(key);
      for (const gk of [...gateAlerted]) if (gk.startsWith(`${key}:`)) gateAlerted.delete(gk);
      return { outcome: 'submitted', key, txId: res.txId, reused: !!res.reused, replayed: !!res.replayed };
    } catch (e) {
      if (e instanceof DriverDepsError) throw e;
      if (e && e.hold) return { outcome: 'held', key, reason: e.code || 'hold', message: e.message };
      const orig = buildFail ? buildFail.err : e;
      const at = buildFail ? buildFail.stage : 'driver';
      const message = orig && orig.message ? orig.message : String(orig);
      if (at === 'gate') return { outcome: 'gated', key, reason: orig.code, message };
      // fee 窗口类错误自带该发的事件(fee_candidate_* / fee_window_saturated 的明细)——先发它们, 再按分类发主报警
      if (Array.isArray(orig && orig.events)) for (const ev of orig.events) alert(ev.eventType, `${key}: ${ev.eventType}`, { intent_key: key, ...(ev.payload || {}) }, ev.level);
      // §8: close_commit 的 RootClose 输入已不在预期 outpoint ⇒ 探测是否已被 refund_flip(closed 0→2); 有 ⇒ 意图置 ambiguous(不重试不重建), 报警一次
      if (step === 'close_commit' && at === 'inputs' && typeof deps.probeRefundFlip === 'function' && /^rootClose_(value|outpoint|spk)_drift$/.test(String(orig && orig.code))) {
        let flipped = false;
        try { flipped = (await deps.probeRefundFlip({ marketId })) === true; } catch (pe) { log.log && log.log(`[settlement-driver] refund_flip 探测失败(按未翻处理, 下一 tick 再探): ${pe && pe.message}`); }
        if (flipped) {
          deps.intents.mark(key, { status: 'ambiguous', last_error: 'refund_flip_observed' });
          if (!flipAlerted.has(key)) { flipAlerted.add(key); alert('settlement_refund_flip_observed', `${key}: RootClose 已被 refund_flip(closed=2)——close_commit 永不可入, 转人工`, { intent_key: key }, 'error'); }
          return { outcome: 'held', key, reason: 'refund_flip_observed', message };
        }
      }
      const c = classifyStepFailure(orig, at, step);
      if (!c.report) {
        if (c.track) trackBroadcastFailure(key, c.code, tickId);
        return { outcome: 'failed', key, class: c.eventType, code: c.code, transient: true, message };
      }
      if (c.viaGrader) { const g = reportFailure(orig, tickId, key, { stage: at }); return { outcome: 'failed', key, class: g.eventType, code: g.code, transient: g.transient, message }; }
      if (c.gate) {                                                   // 出口分闸确定性拒绝: 同 (key, code) 只报一次
        const gk = `${key}:${c.code}`;
        if (gateAlerted.has(gk)) return { outcome: 'failed', key, class: c.eventType, code: c.code, transient: false, message, deduped: true };
        gateAlerted.add(gk);
      }
      alert(c.eventType, `${key}: ${message.slice(0, 300)}`, { intent_key: key, code: c.code, stage: at }, c.level);
      return { outcome: 'failed', key, class: c.eventType, code: c.code, transient: false, message };
    }
  }

  /** pmt 门的读失败计数 + SLA 报警(以 pmt 计; 同 (key, 级别) 幂等)。 */
  function pmtSla(key, gate) {
    if (gate.readFailed) {
      const n = (pmtFail.get(key) || 0) + 1; pmtFail.set(key, n);
      if (n === PMT_READ_FAIL_ALERT_AFTER) alert('settlement_pmt_read_failed', `${key}: 连续 ${n} 次读 pmt 失败`, { intent_key: key, consecutive: n }, 'warn');
      return;
    }
    pmtFail.delete(key);
    const emit = (name) => { const k = `${key}:${name}`; if (slaAlerted.has(k)) return; slaAlerted.add(k); alert(name, `${key}: pmt 领先 deadline ${gate.pmtLeadMs}ms`, { intent_key: key, pmtLeadMs: gate.pmtLeadMs }); };
    if (gate.sla === 'warn') emit('settlement_close_commit_sla_warn');
    else if (gate.sla === 'refund_flip_open') { emit('settlement_close_commit_sla_warn'); emit('settlement_close_commit_refund_flip_open'); }
  }

  /** landed 检查: submitted 行 → check_utxo_landed; landed ⇒ 行转 landed + 后续记账(markLanded 端口, 幂等)。 */
  async function checkLandedAndApply(intent) {
    const info = STEP_OF_INTENT[`${intent.subject_type}:${intent.step}`];
    if (!info) return { outcome: 'ignored', key: intent.intent_key, reason: 'not_a_batch9_step' };
    try {
      const targetAddress = (await deps.prepare(info, { marketId: undefined, subjectId: intent.subject_id, phase: 'target', intent })).targetAddress;
      const r = await deps.checkLanded({ sendCmd: deps.sendCmd, relayId: deps.relayId, intent, targetAddress, minDepth: deps.minDepth, origin: 'internal' });
      if (!r.landed) return { outcome: 'not_landed', key: intent.intent_key, depth: r.depth ?? null };
      await deps.markLanded(info, deps.intents.get(intent.intent_key));
      return { outcome: 'landed', key: intent.intent_key, depth: r.depth ?? null };
    } catch (e) {
      if (e instanceof DriverDepsError) throw e;
      alert('settlement_step_unexpected_error', `${intent.intent_key}: landed 检查 / 记账失败: ${e && e.message ? e.message : e}`, { intent_key: intent.intent_key }, 'error');
      return { outcome: 'failed', key: intent.intent_key, message: e && e.message ? e.message : String(e) };
    }
  }

  /** 后效待应用(NWT 38b983e4): landed 意图的 markLanded 没成功(失败 / 进程死在两步之间)⇒ 每 tick 重跑(markLanded 幂等); 失败逐 tick 报警(不去重——这是"已上链但状态没推进"的持续故障)。 */
  async function applyEffects(intent) {
    const info = STEP_OF_INTENT[`${intent.subject_type}:${intent.step}`];
    if (!info) return { outcome: 'ignored', key: intent.intent_key, reason: 'not_a_batch9_step' };
    try { await deps.markLanded(info, deps.intents.get(intent.intent_key) || intent); return { outcome: 'effects_applied', key: intent.intent_key }; }
    catch (e) {
      if (e instanceof DriverDepsError) throw e;
      const message = e && e.message ? e.message : String(e);
      alert('settlement_step_unexpected_error', `${intent.intent_key}: 已 landed 但后效应用失败(将逐 tick 重试): ${message.slice(0, 300)}`, { intent_key: intent.intent_key, stage: 'effects' }, 'error');
      return { outcome: 'failed', key: intent.intent_key, message };
    }
  }

  /** prepared 停留过久 ⇒ settlement_prepared_stale(四步都有, 不只 close_commit 的 SLA); 同 (key, updated_at) 幂等。 */
  function scanPreparedStale(rows, { olderThanMs = PREPARED_STALE_MS } = {}) {
    const nowMs = deps.now(); let n = 0;
    for (const r of rows) {
      if (r.status !== 'prepared') continue;
      const age = nowMs - Date.parse(r.updated_at);
      if (!(age >= olderThanMs)) continue;
      const k = `${r.intent_key}:${r.updated_at}`;
      if (staleAlerted.has(k)) continue;
      staleAlerted.add(k); n++;
      alert('settlement_prepared_stale', `${r.intent_key}: prepared 已停留 ${Math.round(age / 60000)} 分钟仍未 landed`, { intent_key: r.intent_key, prepared_txid: String(r.prepared_txid || '').slice(0, 16), ageMs: age }, 'warn');
    }
    return n;
  }

  /** 一个 tick: 单飞由调用方(接线层)保证; 这里只做 cap 与"一个条目失败不拖垮整个 tick"。 */
  async function runTick({ cap = 5 } = {}) {
    if (!Number.isInteger(cap) || cap <= 0) throw new RangeError('runTick: cap 必须是正整数');
    const tickId = ++tickSeq;
    const work = await deps.listWork();                       // { landedChecks:[intent], advances:[{step,subjectId,marketId}], resumes:[intent], preparedRows:[intent] }
    const out = { tickId, actioned: 0, landed: 0, submitted: 0, waiting: 0, gated: 0, held: 0, failed: 0, staleAlerts: 0, results: [] };
    out.staleAlerts = scanPreparedStale(work.preparedRows || []);
    const budget = () => out.actioned < cap;
    out.effectsApplied = 0;
    for (const it of (work.effectsPending || [])) {           // 最先: 已上链但状态没推进的不能排在新触发后面饿死
      if (!budget()) break; out.actioned++;
      const r = await applyEffects(it); out.results.push(r); if (r.outcome === 'effects_applied') out.effectsApplied++; else if (r.outcome === 'failed') out.failed++;
    }
    for (const it of (work.landedChecks || [])) {                // 先对账(便宜、且推进后续意图)
      if (!budget()) break; out.actioned++;
      const r = await checkLandedAndApply(it); out.results.push(r); if (r.outcome === 'landed') out.landed++; else if (r.outcome === 'failed') out.failed++;
    }
    for (const a of (work.advances || [])) {
      if (!budget()) break; out.actioned++;
      const r = await advanceStep({ ...a, tickId }); out.results.push(r);
      if (r.outcome === 'submitted') out.submitted++; else if (r.outcome === 'waiting') out.waiting++; else if (r.outcome === 'gated') out.gated++; else if (r.outcome === 'held') out.held++; else if (r.outcome === 'failed') out.failed++;
    }
    return out;
  }

  return { advanceStep, checkLandedAndApply, applyEffects, scanPreparedStale, runTick, _keyOf: keyOf };
}

/** (subject_type:step) → 驱动步骤名(landed 检查用)。 */
export const STEP_OF_INTENT = Object.freeze(Object.fromEntries(Object.entries(STEP_INTENT).map(([step, p]) => [`${p.subjectType}:${p.intentStep}`, step])));
