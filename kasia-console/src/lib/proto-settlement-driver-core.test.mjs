// proto-settlement-driver-core.test.mjs — 批9 9-2b(ii): 结算驱动核心(编排层)。全部依赖是内存假端口: 零 DB / 零链 / 零 IPC / 零私钥, 无 DB_PATH 可跑。
// 假 driveIntent 忠实模仿真实 driveSettlementIntent 的一个关键性质: buildAndBroadcast 抛错会被包成新的 "exhausted N attempts" 错误(丢 code / 类型)——
//   核心必须自己在闭包里留原始错误做分类(否则 C1 传输错会被误报成编程错误)。
// Run: cd kasia-console && node src/lib/proto-settlement-driver-core.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const C = await import('./proto-settlement-driver-core.mjs');
const { createSettlementDriver, checkPmtGate, makeAlerter, SETTLEMENT_ALERTS, SETTLEMENT_DRIVER_STEPS, STEP_INTENT, STEP_OF_INTENT, DriverDepsError, PREPARED_STALE_MS, RELAY_FEE_REJECT_CODES, EXIT_GATE_REFUSAL_CODES } = C;
const { FactsResponseError, FeeWindowError, classifyC1Error } = await import('./proto-settlement-c1.mjs');
const { SettlementChainCheckError } = await import('./proto-settlement-chain-checks.mjs');
const { stripComments } = await import('../../../shared/test-fixtures/source-scan/scan-non-test-sources.mjs');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const hex64 = () => crypto.randomBytes(32).toString('hex');
const NOW = Date.parse('2026-09-20T12:00:00.000Z');
const RF_GRACE = 7_200_000;   // REFUND_FLIP_GRACE_MS(合约常量 deadline+2h)

// ── 假端口 ────────────────────────────────────────────────────────────────────────────────────────────────────────
function mkWorld(o = {}) {
  const log = [];                                   // 全部调用的有序轨迹
  const rows = new Map();                           // intent_key → row
  const alerts = [];
  const keyOf = (st, id, step) => `settle:${st}:${id}:${step}`;
  const intents = {
    active: (st, id, step) => { log.push('intents.active'); const r = rows.get(keyOf(st, id, step)); return r && r.status !== 'ambiguous_dead' ? r : null; },
    ensure: ({ subjectType, subjectId, step }) => { log.push('intents.ensure'); const k = keyOf(subjectType, subjectId, step); const r = { intent_key: k, subject_type: subjectType, subject_id: subjectId, step, status: 'pending', updated_at: new Date(NOW).toISOString() }; rows.set(k, r); return r; },
    get: (k) => rows.get(k) || null,
    mark: (k, patch) => { log.push('intents.mark:' + JSON.stringify(patch)); Object.assign(rows.get(k), patch); return rows.get(k); },
  };
  const driveIntent = async (a) => {
    log.push('driveIntent');
    let row = intents.active(a.subjectType, a.subjectId, a.step) || intents.ensure({ subjectType: a.subjectType, subjectId: a.subjectId, step: a.step });
    let lastError = null;
    for (let attempt = 1; attempt <= a.maxAttempts; attempt++) {
      row = intents.get(row.intent_key);
      if (row.status === 'submitted' || row.status === 'landed') return { txId: row.submitted_txid, intent: row, reused: true };
      if (row.status === 'ambiguous') throw Object.assign(new Error('ambiguous — HOLD'), { hold: true, code: 'ambiguous_inputs_spent' });
      if (row.status === 'prepared') { log.push('replay'); return { txId: row.prepared_txid, intent: row, replayed: true }; }
      try { const res = await a.buildAndBroadcast({ attempt, intentKey: row.intent_key }); if (res && res.txId) { intents.mark(row.intent_key, { status: 'submitted', submitted_txid: res.txId }); return { txId: res.txId, intent: rows.get(row.intent_key) }; } lastError = 'no txId'; }
      catch (e) { lastError = e.message; }
      intents.mark(row.intent_key, { last_error: lastError });
    }
    throw new Error(`settlement intent ${row.intent_key} exhausted ${a.maxAttempts} attempts: ${lastError}`);   // ⚠ 原始错误类型 / code 在此丢失(与真实实现一致)
  };
  const cfg = { pmt: { ok: true, pastMedianTimeMs: NOW, observedAtMs: NOW - 1000 }, broadcast: { ok: true, txId: 'ab'.repeat(32) }, ...o };
  const deps = {
    sendCmd: async (relayId, cmd) => {
      log.push('sendCmd:' + cmd.type);
      if (cmd.type === 'get_past_median_time') { if (cfg.pmt instanceof Error) throw cfg.pmt; return cfg.pmt; }
      if (cmd.type === 'covenant_broadcast') { world.lastBroadcast = cmd; return typeof cfg.broadcast === 'function' ? cfg.broadcast(cmd) : cfg.broadcast; }
      return { ok: true };
    },
    relayId: 'relay-1', minDepth: 20, now: () => 0,     // now 恒为 0: 若核心偷用本地时钟判断, 下面的 pmt 用例会露馅
    alert: (eventType, summary, payload, level) => { alerts.push({ eventType, level, payload }); },
    intents, driveIntent,
    pointers: (step, marketId) => { log.push('pointers:' + step); if (cfg.pointersThrow) throw cfg.pointersThrow; return { roles: { rootClose: { outpoint: { transactionId: 'aa'.repeat(32), index: 0 }, expectedCovenantId: 'cc'.repeat(32) } } }; },
    prepare: async (step, ctx) => { log.push(`prepare:${ctx.phase}`); if (cfg.prepareThrow && ctx.phase === 'inputs') throw cfg.prepareThrow; return { targetAddress: 'kaspatest:qtarget', expectedSpks: { rootClose: '00' }, feeMinAmount: 1n, deadlineMs: cfg.deadlineMs ?? NOW - 40_000 }; },
    verifyOnChain: async (o2) => { log.push('verifyOnChain'); if (cfg.verifyThrow) throw (typeof cfg.verifyThrow === 'function' ? cfg.verifyThrow() : cfg.verifyThrow); return { chainParents: { rootClose: { value: 1n, spkLen: 35, hasCovenant: true, outpoint: { txid: 'aa'.repeat(32), index: 0 } } }, fee: { candidates: [{ txid: 'ee'.repeat(32), vout: 0, value: 5n, spkLen: 34, covenantId: null }] }, events: cfg.verifyEvents || [] }; },
    build: async (step, ctx) => { log.push('build:' + step); world.lastBuildCtx = ctx; if (cfg.buildThrow) throw cfg.buildThrow; return { txJson: '{"tx":1}', expectedTxid: 'ab'.repeat(32), signInputIndices: [2], genesisOutputIndices: cfg.genesis, continuationOutputIndices: cfg.cont }; },
    dependenciesLanded: async (step, ctx) => { log.push('dependenciesLanded'); return cfg.depOk === false ? { ok: false, reason: 'resolve_not_landed' } : { ok: true }; },
    checkLanded: async (a) => { log.push('checkLanded'); world.lastCheckLanded = a; if (cfg.checkThrow) throw cfg.checkThrow; return cfg.landed || { landed: false, depth: 3 }; },
    markLanded: async (info, row) => { log.push('markLanded:' + info); world.markLandedCalls.push([info, row && row.intent_key]); },
    listWork: async () => { log.push('listWork'); return cfg.work || {}; },
    // 批 D D1 入口③的端口: 默认未冻结(false); cfg.frozen 可设任意值(测严格 fail-closed), cfg.frozenThrow 抛错
    isSettlementFrozen: async (marketId) => { log.push('isSettlementFrozen'); if (cfg.frozenThrow) throw cfg.frozenThrow; return Object.prototype.hasOwnProperty.call(cfg, 'frozen') ? cfg.frozen : false; },
    probeRefundFlip: cfg.probeRefundFlip,
    recordObservedRefundFlip: cfg.recordObservedRefundFlip,
    log: { log: () => {} },
  };
  const world = { log, rows, alerts, deps, cfg, markLandedCalls: [], lastBroadcast: null, lastBuildCtx: null, lastCheckLanded: null };
  return world;
}
const ids = () => ({ marketId: hex64(), subjectId: hex64() });
const adv = (w, step, { tickId } = {}) => { const d = createSettlementDriver(w.deps); const i = ids(); return d.advanceStep({ step, subjectId: i.subjectId, marketId: i.marketId, tickId }); };
const idx = (log, prefix) => log.findIndex((l) => l.startsWith(prefix));

// ── 常量与闭集 ────────────────────────────────────────────────────────────────────────────────────────────────────
await t('步骤计划: 恰五步(seal / close_commit / refund_flip / convert_to_claim / claim_draw; R-a 加 refund_flip); close_commit 的意图 step 名是 resolve; 无 withdraw / reclaim / ticket / convert_to_refundclaim / refund_payout(R-b/R-c 才接线); STEP_OF_INTENT 是它的逆', () => {
  assert.deepEqual([...SETTLEMENT_DRIVER_STEPS], ['seal', 'close_commit', 'refund_flip', 'convert_to_claim', 'claim_draw']);
  assert.deepEqual(STEP_INTENT.refund_flip, { subjectType: 'market', intentStep: 'refund_flip' });
  assert.deepEqual(STEP_INTENT.close_commit, { subjectType: 'market', intentStep: 'resolve' });
  assert.deepEqual(Object.values(STEP_INTENT).map((p) => p.subjectType).sort(), ['claim', 'claim', 'market', 'market', 'market']);
  for (const [step, p] of Object.entries(STEP_INTENT)) assert.equal(STEP_OF_INTENT[`${p.subjectType}:${p.intentStep}`], step);
  for (const bad of ['claim:withdraw', 'ticket:reclaim', 'market:withdraw', 'market:convert_to_refundclaim', 'claim:refund_payout']) assert.equal(STEP_OF_INTENT[bad], undefined);
  assert.ok(Object.isFrozen(STEP_INTENT) && Object.isFrozen(SETTLEMENT_ALERTS));
});
await t('报警闭集: 未登记的名字直接抛错; c1 分类器可能产出的每个 eventType 与 c1 事件名都已登记(drift 守卫); 含 fee_candidate_out_of_range_skipped(9-2b 清单 #8)', () => {
  const alerter = makeAlerter(() => {});
  assert.throws(() => alerter('settlement_typo_name', 's'), /未登记/);
  const errs = [new SettlementChainCheckError('rootClose_value_drift', 'x'), new SettlementChainCheckError('chain_check_params_missing', 'x'), new FactsResponseError('facts_transport_error', 'x'), new FactsResponseError('facts_echo_missing', 'x'),
    new FeeWindowError('fee_window_saturated', 'x'), new FeeWindowError('no_suitable_fee_utxo', 'x'), new TypeError('x')];
  for (const e of errs) assert.ok(Object.hasOwn(SETTLEMENT_ALERTS, classifyC1Error(e).eventType), 'classify 产出未登记: ' + classifyC1Error(e).eventType);
  for (const n of ['fee_candidate_poisoned_skipped', 'fee_candidate_out_of_range_skipped', 'settlement_fee_window_saturated', 'settlement_prepared_stale', 'settlement_relay_fee_rejected', 'settlement_pmt_read_failed', 'settlement_refund_flip_observed']) assert.ok(Object.hasOwn(SETTLEMENT_ALERTS, n), n);
  for (const [n, lv] of Object.entries(SETTLEMENT_ALERTS)) assert.ok(lv === 'warn' || lv === 'error', n);
});
await t('deps 校验: 缺任何端口 / minDepth 非正整数 / intents 缺函数 ⇒ DriverDepsError(没有默认值); 构造驱动本身零副作用(不调 listWork / sendCmd)', () => {
  const w = mkWorld();
  for (const k of ['sendCmd', 'relayId', 'alert', 'intents', 'driveIntent', 'pointers', 'prepare', 'verifyOnChain', 'build', 'dependenciesLanded', 'checkLanded', 'markLanded', 'listWork', 'isSettlementFrozen', 'minDepth', 'now']) {
    const d = { ...w.deps }; delete d[k];
    assert.throws(() => createSettlementDriver(d), (e) => e instanceof DriverDepsError && e.message.includes(k), '缺 ' + k);
  }
  for (const bad of [0, -1, 1.5, '20']) assert.throws(() => createSettlementDriver({ ...w.deps, minDepth: bad }), DriverDepsError);
  assert.throws(() => createSettlementDriver({ ...w.deps, intents: { ensure() {}, active() {} } }), DriverDepsError);
  const w2 = mkWorld(); createSettlementDriver(w2.deps);
  assert.deepEqual(w2.log, [], '构造驱动不得有任何副作用');
});

// ── 通用顺序 §5 ──────────────────────────────────────────────────────────────────────────────────────────────────
await t('通用顺序: 建 pending 意图 → 依赖已 landed → 指针 → C1 取证 → (步骤专属闸) → builder → covenant_broadcast; 意图建立先于任何 IPC', async () => {
  const w = mkWorld(); const r = await adv(w, 'seal');
  assert.equal(r.outcome, 'submitted');
  const order = ['intents.ensure', 'dependenciesLanded', 'driveIntent', 'pointers:seal', 'prepare:inputs', 'verifyOnChain', 'build:seal', 'sendCmd:covenant_broadcast'].map((p) => idx(w.log, p));
  assert.ok(order.every((i) => i >= 0), '缺环节: ' + w.log.join(' > '));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], '顺序不对: ' + w.log.join(' > '));
  assert.equal(w.log.filter((l) => l === 'sendCmd:get_past_median_time').length, 0, 'seal 不读 pmt');
});
await t('四步各自的 covenant_broadcast 载荷: intent_key = settle:<主体>:<64 位 hex id>:<step>(close_commit 用 resolve); 载荷含 tx_json / sign_input_indices / expected_txid; 可选下标只在 builder 给了才带; 键过出口 S9 正则(取自出口源码)', async () => {
  const src = fs.readFileSync(new URL('./proto-relay-ipc.mjs', import.meta.url), 'utf8');
  const m = src.match(/const SETTLE_KEY_RE = (\/.*\/);/); assert.ok(m, '取不到出口 S9 正则');
  const EXIT_RE = new RegExp(m[1].slice(1, -1));
  for (const step of SETTLEMENT_DRIVER_STEPS) {
    const w = mkWorld({ genesis: step === 'seal' ? [0, 1] : undefined, cont: (step === 'close_commit' || step === 'refund_flip') ? [0] : undefined, ...(step === 'refund_flip' ? { frozen: true, deadlineMs: NOW - RF_GRACE - 60_000 } : {}) });
    const i = ids(); const d = createSettlementDriver(w.deps);
    const r = await d.advanceStep({ step, subjectId: i.subjectId, marketId: i.marketId });
    assert.equal(r.outcome, 'submitted'); const cmd = w.lastBroadcast;
    const want = `settle:${STEP_INTENT[step].subjectType}:${i.subjectId}:${STEP_INTENT[step].intentStep}`;
    assert.equal(cmd.intent_key, want); assert.ok(EXIT_RE.test(cmd.intent_key), '过不了出口 S9: ' + cmd.intent_key);
    assert.deepEqual(cmd.sign_input_indices, [2]); assert.equal(cmd.type, 'covenant_broadcast'); assert.equal(typeof cmd.tx_json, 'string'); assert.equal(cmd.expected_txid, 'ab'.repeat(32));
    assert.equal('genesis_output_indices' in cmd, step === 'seal'); assert.equal('continuation_output_indices' in cmd, step === 'close_commit' || step === 'refund_flip');
  }
});
await t('依赖未 landed ⇒ waiting: 意图仍建(pending)、零 IPC、不指针 / 不取证 / 不构造 / 不广播', async () => {
  const w = mkWorld({ depOk: false }); const r = await adv(w, 'convert_to_claim');
  assert.equal(r.outcome, 'waiting'); assert.equal(r.reason, 'resolve_not_landed');
  assert.ok(w.log.includes('intents.ensure'));
  assert.deepEqual(w.log.filter((l) => /^(sendCmd|pointers|verifyOnChain|build|driveIntent)/.test(l)), []);
  assert.equal([...w.rows.values()][0].status, 'pending');
});
await t('意图状态: submitted / landed ⇒ in_flight(不重复构造); ambiguous ⇒ held(不重试不重建); prepared ⇒ 同字节重播(build / 指针 / 取证一次都不调, NO 重建)', async () => {
  for (const status of ['submitted', 'landed']) {
    const w = mkWorld(); const i = ids(); const d = createSettlementDriver(w.deps);
    const k = `settle:market:${i.subjectId}:seal`; w.rows.set(k, { intent_key: k, subject_type: 'market', subject_id: i.subjectId, step: 'seal', status, submitted_txid: 'cd'.repeat(32) });
    const r = await d.advanceStep({ step: 'seal', subjectId: i.subjectId, marketId: i.marketId });
    assert.equal(r.outcome, 'in_flight'); assert.deepEqual(w.log.filter((l) => /^(sendCmd|build|driveIntent)/.test(l)), []);
  }
  { const w = mkWorld(); const i = ids(); const d = createSettlementDriver(w.deps);
    const k = `settle:market:${i.subjectId}:seal`; w.rows.set(k, { intent_key: k, subject_type: 'market', subject_id: i.subjectId, step: 'seal', status: 'ambiguous' });
    const r = await d.advanceStep({ step: 'seal', subjectId: i.subjectId, marketId: i.marketId });
    assert.equal(r.outcome, 'held'); assert.deepEqual(w.log.filter((l) => /^(sendCmd|build)/.test(l)), []); assert.deepEqual(w.alerts, []); }
  { const w = mkWorld(); const i = ids(); const d = createSettlementDriver(w.deps);
    const k = `settle:market:${i.subjectId}:seal`; w.rows.set(k, { intent_key: k, subject_type: 'market', subject_id: i.subjectId, step: 'seal', status: 'prepared', prepared_txid: 'ef'.repeat(32) });
    const r = await d.advanceStep({ step: 'seal', subjectId: i.subjectId, marketId: i.marketId });
    assert.equal(r.outcome, 'submitted'); assert.equal(r.replayed, true); assert.equal(r.txId, 'ef'.repeat(32));
    assert.deepEqual(w.log.filter((l) => /^(build|pointers|verifyOnChain|dependenciesLanded)/.test(l)), [], 'prepared 行不得重建 / 重新取证'); }
});

// ── 批 D D1 入口③: 冻结 ──────────────────────────────────────────────────────────────────────────────────────
await t('批 D D1 入口③: close_commit 广播前闸重读冻结列(在 pmt 门之前): 冻结 ⇒ gated(close_commit_settlement_frozen), 不读 pmt / 不建 / 不广播; 严格 fail-closed——只有端口明确返回 false 才放行(true / undefined / null / 0 / "false" / 1 / {} / 抛错 一律拦)', async () => {
  for (const frozen of [true, undefined, null, 0, 'false', 1, {}]) {
    const w = mkWorld({ frozen }); const r = await adv(w, 'close_commit');
    assert.equal(r.outcome, 'gated', JSON.stringify(frozen)); assert.equal(r.reason, 'close_commit_settlement_frozen', JSON.stringify(frozen));
    assert.ok(idx(w.log, 'isSettlementFrozen') >= 0);
    assert.deepEqual(w.log.filter((l) => l === 'sendCmd:get_past_median_time' || /^build/.test(l) || l === 'sendCmd:covenant_broadcast'), [], 'frozen=' + JSON.stringify(frozen) + ': 不得读 pmt / 建 / 广播: ' + w.log.join(' > '));
  }
  const w = mkWorld({ frozenThrow: new Error('db locked') }); const r = await adv(w, 'close_commit');
  assert.equal(r.outcome, 'gated'); assert.equal(r.reason, 'close_commit_settlement_frozen'); assert.deepEqual(w.log.filter((l) => l === 'sendCmd:covenant_broadcast'), []);
});
await t('批 D D1 入口③: 未冻结(端口返回 false)⇒ 冻结读发生在 pmt 门之前并放行; 冻结只管 close_commit(seal 即使端口返回 true 也照发, 且根本不读冻结列)', async () => {
  const w = mkWorld({ frozen: false }); const r = await adv(w, 'close_commit');
  assert.equal(r.outcome, 'submitted');
  assert.ok(idx(w.log, 'isSettlementFrozen') >= 0 && idx(w.log, 'isSettlementFrozen') < idx(w.log, 'sendCmd:get_past_median_time'), '冻结读应在 pmt 门之前: ' + w.log.join(' > '));
  const w2 = mkWorld({ frozen: true }); const r2 = await adv(w2, 'seal');
  assert.equal(r2.outcome, 'submitted'); assert.equal(idx(w2.log, 'isSettlementFrozen'), -1, 'seal 不读冻结列');
});
await t('批 D D1: 已 prepared 的 close_commit 意图(字节已落库)不受冻结影响——同字节重播, 不读冻结列(冻结必须早于该市场第一个进 close_commit 的 tick)', async () => {
  const w = mkWorld({ frozen: true }); const i = ids(); const d = createSettlementDriver(w.deps);
  const k = `settle:market:${i.subjectId}:resolve`; w.rows.set(k, { intent_key: k, subject_type: 'market', subject_id: i.subjectId, step: 'resolve', status: 'prepared', prepared_txid: 'ef'.repeat(32) });
  const r = await d.advanceStep({ step: 'close_commit', subjectId: i.subjectId, marketId: i.marketId });
  assert.equal(r.outcome, 'submitted'); assert.equal(r.replayed, true); assert.equal(idx(w.log, 'isSettlementFrozen'), -1);
});

await t('批 D ⑤(c): 冻结只属于 close_commit——即使冻结端口恒返回 true, convert_to_claim / claim_draw / seal 照常 submitted 且【根本不读冻结端口】; 已 landed 的 close_commit 走 landed 检查 + markLanded 也不看冻结', async () => {
  for (const step of ['seal', 'convert_to_claim', 'claim_draw']) { const w = mkWorld({ frozen: true }); const r = await adv(w, step); assert.equal(r.outcome, 'submitted', step); assert.equal(idx(w.log, 'isSettlementFrozen'), -1, step + ' 不读冻结端口'); }
  const i = ids(); const k = `settle:market:${i.subjectId}:resolve`;
  const w2 = mkWorld({ frozen: true, landed: { landed: true, depth: 25 }, work: { landedChecks: [{ intent_key: k, subject_type: 'market', subject_id: i.subjectId, step: 'resolve', status: 'submitted', submitted_txid: 'ab'.repeat(32) }], advances: [], preparedRows: [], effectsPending: [] } });
  w2.rows.set(k, { intent_key: k, subject_type: 'market', subject_id: i.subjectId, step: 'resolve', status: 'submitted', submitted_txid: 'ab'.repeat(32) });
  const t2 = await createSettlementDriver(w2.deps).runTick({ cap: 5 });
  assert.equal(w2.markLandedCalls.length, 1, '冻结市场的已提交 close_commit landed ⇒ markLanded 照常调用'); assert.equal(idx(w2.log, 'isSettlementFrozen'), -1, 'landed 检查 / 后效不读冻结端口'); assert.ok(t2 && t2.landed === 1, JSON.stringify(t2));
});

// ── 失败分类与报警 ─────────────────────────────────────────────────────────────────────────────────────────────────
await t('C1 事实漂移 ⇒ failed + settlement_chain_fact_drift(error); 不构造、不广播; 意图仍 pending(NO TX NO STATE)', async () => {
  const w = mkWorld({ verifyThrow: new SettlementChainCheckError('rootClose_value_drift', '面值漂移', { step: 'close_commit', role: 'rootClose' }) });
  const r = await adv(w, 'close_commit');
  assert.equal(r.outcome, 'failed'); assert.equal(r.class, 'settlement_chain_fact_drift'); assert.equal(r.transient, false);
  assert.deepEqual(w.alerts.map((a) => [a.eventType, a.level]), [['settlement_chain_fact_drift', 'error']]);
  assert.deepEqual(w.log.filter((l) => /^(build|sendCmd:covenant_broadcast)/.test(l)), []);
  assert.equal([...w.rows.values()][0].status, 'pending');
});
await t('传输类 C1 错(原始错误在 driveIntent 包装后仍被正确分类): 同一 key 连续【不同 tick】warn, warn, error; 成功一次清零; 另一个 key 互不影响', async () => {
  const w = mkWorld({ verifyThrow: () => new FactsResponseError('facts_transport_error', 'ECONNRESET') });
  const d = createSettlementDriver(w.deps); const i = ids();
  const levels = [];
  for (const tickId of [1, 2, 3]) { w.alerts.length = 0; const r = await d.advanceStep({ step: 'seal', subjectId: i.subjectId, marketId: i.marketId, tickId }); assert.equal(r.class, 'settlement_facts_transport_error'); assert.equal(r.transient, true); levels.push(w.alerts[0].level); }
  assert.deepEqual(levels, ['warn', 'warn', 'error']);
  w.cfg.verifyThrow = null; assert.equal((await d.advanceStep({ step: 'seal', subjectId: i.subjectId, marketId: i.marketId, tickId: 4 })).outcome, 'submitted');   // 成功清零
  // 成功清零是【对同一 key】: 清零后同 key 再失败, 从头计数(warn, warn), 不是接着 4、5 直接 error
  w.cfg.verifyThrow = () => new FactsResponseError('facts_transport_error', 'x'); w.alerts.length = 0;
  w.rows.get(d._keyOf('seal', i.subjectId)).status = 'pending';   // 上面成功已把行推到 submitted, 复位后才会再走取证
  for (const tickId of [10, 11]) { await d.advanceStep({ step: 'seal', subjectId: i.subjectId, marketId: i.marketId, tickId }); }
  assert.deepEqual(w.alerts.map((a) => a.level), ['warn', 'warn'], '成功后同 key 重新计数');
  const j = ids(); w.cfg.verifyThrow = () => new FactsResponseError('facts_transport_error', 'x'); w.alerts.length = 0;
  await d.advanceStep({ step: 'seal', subjectId: j.subjectId, marketId: j.marketId, tickId: 5 }); assert.equal(w.alerts[0].level, 'warn', '另一个 key 从头计数');
});
await t('fee 窗口错自带的事件先发(fee_candidate_* 已登记), 再发主报警 settlement_fee_window_saturated; 未识别错误(TypeError)⇒ settlement_c1_programming_error(不是"照常重试")', async () => {
  const w = mkWorld({ verifyThrow: new FeeWindowError('fee_window_saturated', '饱和', { events: [{ eventType: 'fee_candidate_poisoned_skipped', level: 'warn', payload: { count: 3 } }, { eventType: 'settlement_fee_window_saturated', level: 'error', payload: { truncated: true } }] }) });
  const r = await adv(w, 'seal'); assert.equal(r.class, 'settlement_fee_window_saturated');
  assert.ok(w.alerts.some((a) => a.eventType === 'fee_candidate_poisoned_skipped'));
  const w2 = mkWorld({ verifyThrow: new TypeError('boom') }); const r2 = await adv(w2, 'seal');
  assert.equal(r2.class, 'settlement_c1_programming_error'); assert.equal(w2.alerts[0].level, 'error');
});
await t('c1 返回的 events(fee_candidate_* 等)被逐条报警; 未登记的事件名抛错而不是静默吞掉', async () => {
  const w = mkWorld({ verifyEvents: [{ eventType: 'fee_candidate_out_of_range_skipped', level: 'warn', payload: { count: 2 } }] });
  assert.equal((await adv(w, 'seal')).outcome, 'submitted'); assert.deepEqual(w.alerts.map((a) => a.eventType), ['fee_candidate_out_of_range_skipped']);
  const w2 = mkWorld({ verifyEvents: [{ eventType: 'not_registered_event', level: 'warn', payload: {} }] });
  const r2 = await adv(w2, 'seal'); assert.equal(r2.outcome, 'failed');   // 未登记事件名 ⇒ makeAlerter 抛错 ⇒ 该步失败(loud), 不静默继续广播
  assert.equal(w2.log.filter((l) => l === 'sendCmd:covenant_broadcast').length, 0);
});
await t('builder 阶段的专名报警: signing_key_mismatch ⇒ settlement_signing_key_mismatch; close_commit 的 db_payout_root_drift ⇒ settlement_close_commit_args_not_from_db; 其它 builder 错 ⇒ 编程错误; 都不广播', async () => {
  let w = mkWorld({ buildThrow: new Error('signing_key_mismatch: fail-closed — claim_draw ticket: 公钥不符') }); let r = await adv(w, 'claim_draw');
  assert.equal(r.class, 'settlement_signing_key_mismatch'); assert.equal(w.alerts[0].level, 'error');
  w = mkWorld({ buildThrow: new Error('assertCloseCommitArgsFromDb: fail-closed — payout_root(db_payout_root_drift): 库 != 现算') }); r = await adv(w, 'close_commit');
  assert.equal(r.class, 'settlement_close_commit_args_not_from_db');
  w = mkWorld({ buildThrow: new Error('assertCloseCommitArgsFromDb: db_payout_root_drift') }); r = await adv(w, 'seal');   // 非 close_commit 步骤不套这个专名
  assert.equal(r.class, 'settlement_c1_programming_error');
  assert.deepEqual(w.log.filter((l) => l === 'sendCmd:covenant_broadcast'), []);
});
await t('广播失败: 只记 last_error(意图不推进, NO TX NO STATE)、不报"编程错误"; relay 的 fee 天花板拒绝 ⇒ settlement_relay_fee_rejected; 成功回执无 txId 也算失败', async () => {
  let w = mkWorld({ broadcast: { ok: false, error: 'relay busy' } }); let r = await adv(w, 'seal');
  assert.equal(r.outcome, 'failed'); assert.equal(r.class, 'broadcast_failed'); assert.deepEqual(w.alerts, []); assert.equal([...w.rows.values()][0].status, 'pending'); assert.match([...w.rows.values()][0].last_error, /relay busy/);
  for (const code of RELAY_FEE_REJECT_CODES) { w = mkWorld({ broadcast: { ok: false, error: 'fee', code } }); r = await adv(w, 'claim_draw'); assert.deepEqual(w.alerts.map((a) => [a.eventType, a.level]), [['settlement_relay_fee_rejected', 'error']]); }
  w = mkWorld({ broadcast: { ok: true } }); r = await adv(w, 'seal'); assert.equal(r.outcome, 'failed');
});

await t('NWT e4039235 MUST ①: 出口分闸的四种确定性拒绝(broadcast 阶段, sendCmd 抛错) ⇒ 当 tick 立即报 settlement_step_unexpected_error(error), transient:false; 意图仍 pending', async () => {
  for (const code of EXIT_GATE_REFUSAL_CODES) {
    const w = mkWorld({ broadcast: () => { throw new Error(`sendProtoCommand: ${code} — 'covenant_broadcast' refused (...)`); } });
    const r = await adv(w, 'seal');
    assert.equal(r.outcome, 'failed', code); assert.equal(r.transient, false, code); assert.equal(r.code, code);
    assert.deepEqual(w.alerts.map((a) => [a.eventType, a.level, a.payload.code]), [['settlement_step_unexpected_error', 'error', code]], code);
    assert.equal([...w.rows.values()][0].status, 'pending');
  }
  assert.deepEqual([...EXIT_GATE_REFUSAL_CODES], ['proto_settlement_intent_key_invalid', 'proto_intent_key_not_string', 'proto_driver_disabled', 'proto_settlement_driver_disabled']);
});
await t('出口闸拒绝按 (intent_key, code) 去重(每 tick 重试会每 tick 撞同一个拒绝, 不能每 tick 刷 events): 同 key 同 code 连续 5 个 tick 只报 1 次; 换 code 再报; 换 key 再报; 成功清零后可再报', async () => {
  const gateErr = (code) => () => { throw new Error(`sendProtoCommand: ${code} — 'covenant_broadcast' refused`); };
  const w = mkWorld({ broadcast: gateErr('proto_settlement_driver_disabled') }); const d = createSettlementDriver(w.deps); const i = ids();
  const go = (tickId) => d.advanceStep({ step: 'seal', subjectId: i.subjectId, marketId: i.marketId, tickId });
  for (const tickId of [1, 2, 3, 4, 5]) { const r = await go(tickId); assert.equal(r.outcome, 'failed'); assert.equal(r.transient, false); }
  assert.equal(w.alerts.length, 1, '5 个 tick 只报 1 次');
  w.cfg.broadcast = gateErr('proto_driver_disabled'); await go(6); await go(7); assert.equal(w.alerts.length, 2, '换 code 再报一次'); assert.equal(w.alerts[1].payload.code, 'proto_driver_disabled');
  const j = ids(); await d.advanceStep({ step: 'seal', subjectId: j.subjectId, marketId: j.marketId, tickId: 8 }); assert.equal(w.alerts.length, 3, '换 key 再报一次');
  w.cfg.broadcast = { ok: true, txId: 'ab'.repeat(32) }; assert.equal((await go(9)).outcome, 'submitted');
  w.rows.get(d._keyOf('seal', i.subjectId)).status = 'pending'; w.cfg.broadcast = gateErr('proto_driver_disabled'); await go(10);
  assert.equal(w.alerts.length, 4, '成功清零后可再报');
});
await t('NWT e4039235 MUST ②: 其余广播失败(relay ok:false invalid_tx)按 (intent_key, code) 连续 3 个【不同 tick】后报警一次, 第 4 次不重复; 同一 tick 内重复不累计; code 变了重计; 成功清零后可再报; 两个 key 互不影响; 无 code 的 IPC 超时同样计数', async () => {
  const w = mkWorld({ broadcast: { ok: false, error: 'invalid tx', code: 'invalid_tx' } }); const d = createSettlementDriver(w.deps); const i = ids();
  const go = (tickId) => d.advanceStep({ step: 'seal', subjectId: i.subjectId, marketId: i.marketId, tickId });
  await go(1); await go(1); await go(2); assert.deepEqual(w.alerts, [], '前 2 个不同 tick 不报(同 tick 重复不累计)');
  await go(3); assert.deepEqual(w.alerts.map((a) => [a.eventType, a.level, a.payload.code, a.payload.consecutiveTicks]), [['settlement_step_unexpected_error', 'error', 'invalid_tx', 3]]);
  await go(4); await go(5); assert.equal(w.alerts.length, 1, '第 4 次起不重复(幂等)');
  // code 变了 ⇒ 重计
  w.cfg.broadcast = { ok: false, error: 'busy', code: 'relay_busy' }; w.alerts.length = 0;
  await go(6); await go(7); assert.deepEqual(w.alerts, []); await go(8); assert.equal(w.alerts.length, 1); assert.equal(w.alerts[0].payload.code, 'relay_busy');
  // 成功清零: 之后再失败 3 个 tick 可再报
  w.cfg.broadcast = { ok: true, txId: 'ab'.repeat(32) }; assert.equal((await go(9)).outcome, 'submitted');
  w.rows.get(d._keyOf('seal', i.subjectId)).status = 'pending'; w.cfg.broadcast = { ok: false, error: 'x', code: 'relay_busy' }; w.alerts.length = 0;   // 同 code(relay_busy)——否则 code 变化本身就会重计, 掩盖"成功不清零"
  await go(10); await go(11); assert.deepEqual(w.alerts, []); await go(12); assert.equal(w.alerts.length, 1, '成功清零后重新累计');
  // 两个 key 互不影响
  const j = ids(); w.alerts.length = 0;
  await d.advanceStep({ step: 'seal', subjectId: j.subjectId, marketId: j.marketId, tickId: 13 }); assert.deepEqual(w.alerts, [], '另一个 key 从 1 开始');
  // 无 code 的 IPC 超时(sendCmd 抛错、不含出口闸码)同样计数
  const w2 = mkWorld({ broadcast: () => { throw new Error('IPC timeout after 30000ms'); } }); const d2 = createSettlementDriver(w2.deps); const k = ids();
  for (const tickId of [1, 2, 3]) await d2.advanceStep({ step: 'claim_draw', subjectId: k.subjectId, marketId: k.marketId, tickId });
  assert.deepEqual(w2.alerts.map((a) => a.payload.code), ['unknown']);
});

// ── close_commit 的 pmt 门(§8) ────────────────────────────────────────────────────────────────────────────────────
await t('pmt 门(纯函数): 读的是 relay 的 get_past_median_time; 回执不合法 / 抛错 ⇒ canSubmit=false 且 readFailed; pmt 未领先 deadline+30s ⇒ 不放行; 放行 ⇒ pmtEvidence={pastMedianTimeMs, readAtMs=observedAtMs, source:relay}', async () => {
  const mk = (r) => async () => r;
  const dl = NOW - 40_000;
  let g = await checkPmtGate({ sendCmd: mk({ ok: true, pastMedianTimeMs: NOW, observedAtMs: NOW - 500 }), relayId: 'r', deadlineMs: dl });
  assert.equal(g.canSubmit, true); assert.deepEqual(g.pmtEvidence, { pastMedianTimeMs: NOW, readAtMs: NOW - 500, source: 'relay' });
  for (const bad of [null, {}, { ok: false }, { ok: true, pastMedianTimeMs: 'x', observedAtMs: 1 }, { ok: true, pastMedianTimeMs: NOW }, { ok: true, pastMedianTimeMs: 0, observedAtMs: 5 }]) { g = await checkPmtGate({ sendCmd: mk(bad), relayId: 'r', deadlineMs: dl }); assert.equal(g.canSubmit, false); assert.equal(g.readFailed, true); assert.equal(g.pmtEvidence, null); }
  g = await checkPmtGate({ sendCmd: async () => { throw new Error('ipc down'); }, relayId: 'r', deadlineMs: dl }); assert.equal(g.canSubmit, false); assert.equal(g.readFailed, true);
  g = await checkPmtGate({ sendCmd: mk({ ok: true, pastMedianTimeMs: dl + 10_000, observedAtMs: NOW }), relayId: 'r', deadlineMs: dl }); assert.equal(g.canSubmit, false); assert.equal(g.readFailed, false); assert.equal(g.pmtEvidence, null);
  let sent = null; await checkPmtGate({ sendCmd: async (rid, cmd, to, origin) => { sent = { rid, cmd, to, origin }; return { ok: true, pastMedianTimeMs: NOW, observedAtMs: NOW }; }, relayId: 'r1', deadlineMs: dl });
  assert.deepEqual(sent.cmd, { type: 'get_past_median_time' }); assert.equal(sent.origin, 'internal'); assert.ok(sent.to >= 15000);
});
await t('close_commit 走 pmt 门: pmt 未到 ⇒ gated(不构造不广播, 无报警); 放行 ⇒ builder 拿到 pmtEvidence(source=relay); 门判据不依赖 deps.now(恒为 0)', async () => {
  let w = mkWorld({ pmt: { ok: true, pastMedianTimeMs: NOW - 100_000, observedAtMs: NOW } }); let r = await adv(w, 'close_commit');
  assert.equal(r.outcome, 'gated'); assert.deepEqual(w.log.filter((l) => /^(build|sendCmd:covenant_broadcast)/.test(l)), []); assert.deepEqual(w.alerts, []);
  w = mkWorld(); r = await adv(w, 'close_commit'); assert.equal(r.outcome, 'submitted');
  assert.deepEqual(w.lastBuildCtx.pmtEvidence, { pastMedianTimeMs: NOW, readAtMs: NOW - 1000, source: 'relay' });
  assert.ok(idx(w.log, 'sendCmd:get_past_median_time') < idx(w.log, 'build:close_commit'), 'pmt 门先于 builder');
  for (const step of ['seal', 'convert_to_claim', 'claim_draw']) { const w2 = mkWorld(); await adv(w2, step); assert.equal(w2.lastBuildCtx.pmtEvidence, undefined, step + ' 不带 pmtEvidence'); assert.equal(w2.log.includes('sendCmd:get_past_median_time'), false); }
});
await t('pmt 读失败连续 3 次 ⇒ settlement_pmt_read_failed 恰一次(第 3 次); 中途读成功清零重计', async () => {
  const w = mkWorld({ pmt: new Error('ipc down') }); const d = createSettlementDriver(w.deps); const i = ids();
  for (let n = 1; n <= 4; n++) { await d.advanceStep({ step: 'close_commit', subjectId: i.subjectId, marketId: i.marketId, tickId: n }); }
  assert.deepEqual(w.alerts.map((a) => a.eventType), ['settlement_pmt_read_failed']);
  w.cfg.pmt = { ok: true, pastMedianTimeMs: NOW - 100_000, observedAtMs: NOW }; await d.advanceStep({ step: 'close_commit', subjectId: i.subjectId, marketId: i.marketId, tickId: 5 });
  w.cfg.pmt = new Error('down'); w.alerts.length = 0;
  for (let n = 6; n <= 7; n++) await d.advanceStep({ step: 'close_commit', subjectId: i.subjectId, marketId: i.marketId, tickId: n });
  assert.deepEqual(w.alerts, [], '清零后 2 次不报');
});
await t('SLA(以 pmt 计): ≥ deadline+1h ⇒ settlement_close_commit_sla_warn; ≥ +2h ⇒ 再加 refund_flip_open; 同 (key, 级别) 幂等; 仍尽力提交(放行时照常构造广播)', async () => {
  const dl = NOW - 3_700_000;                                            // pmt=NOW ⇒ 领先 1h+
  let w = mkWorld({ deadlineMs: dl }); const d = createSettlementDriver(w.deps); const i = ids();
  const r1 = await d.advanceStep({ step: 'close_commit', subjectId: i.subjectId, marketId: i.marketId, tickId: 1 });
  assert.equal(r1.outcome, 'submitted'); assert.deepEqual(w.alerts.map((a) => a.eventType), ['settlement_close_commit_sla_warn']);
  w = mkWorld({ deadlineMs: NOW - 7_300_000 }); const d2 = createSettlementDriver(w.deps); const j = ids();
  await d2.advanceStep({ step: 'close_commit', subjectId: j.subjectId, marketId: j.marketId, tickId: 1 });
  assert.deepEqual(w.alerts.map((a) => [a.eventType, a.level]), [['settlement_close_commit_sla_warn', 'warn'], ['settlement_close_commit_refund_flip_open', 'error']]);
  // 幂等: 同 key 再来一轮(先把行恢复成 pending)
  w.rows.get(d2._keyOf('close_commit', j.subjectId)).status = 'pending'; w.alerts.length = 0;
  await d2.advanceStep({ step: 'close_commit', subjectId: j.subjectId, marketId: j.marketId, tickId: 2 }); assert.deepEqual(w.alerts, []);
});
await t('refund_flip(§8): RootClose 输入 drift 且探测到 closed=2 ⇒ 意图置 ambiguous(last_error=refund_flip_observed)+ settlement_refund_flip_observed 一次; 再来一轮 ⇒ held 不重复报警; 探测为假 ⇒ 仍是普通 chain_fact_drift; 探测抛错 ⇒ 按未翻处理不崩', async () => {
  const drift = () => new SettlementChainCheckError('rootClose_outpoint_drift', 'outpoint 漂移', { step: 'close_commit', role: 'rootClose' });
  let w = mkWorld({ verifyThrow: drift, probeRefundFlip: async () => true }); const d = createSettlementDriver(w.deps); const i = ids();
  let r = await d.advanceStep({ step: 'close_commit', subjectId: i.subjectId, marketId: i.marketId, tickId: 1 });
  assert.equal(r.outcome, 'held'); assert.equal(r.reason, 'refund_flip_observed');
  const row = w.rows.get(d._keyOf('close_commit', i.subjectId)); assert.equal(row.status, 'ambiguous'); assert.equal(row.last_error, 'refund_flip_observed');
  assert.deepEqual(w.alerts.map((a) => [a.eventType, a.level]), [['settlement_refund_flip_observed', 'error']]);
  r = await d.advanceStep({ step: 'close_commit', subjectId: i.subjectId, marketId: i.marketId, tickId: 2 }); assert.equal(r.outcome, 'held'); assert.equal(w.alerts.length, 1, '不重复报警');
  w = mkWorld({ verifyThrow: drift, probeRefundFlip: async () => false }); r = await adv(w, 'close_commit'); assert.equal(r.class, 'settlement_chain_fact_drift');
  w = mkWorld({ verifyThrow: drift, probeRefundFlip: async () => { throw new Error('rpc'); } }); r = await adv(w, 'close_commit'); assert.equal(r.class, 'settlement_chain_fact_drift');
  w = mkWorld({ verifyThrow: new SettlementChainCheckError('leaf_outpoint_drift', 'x'), probeRefundFlip: async () => true }); r = await adv(w, 'seal'); assert.equal(r.class, 'settlement_chain_fact_drift', '非 close_commit 步骤不探测');
  // 只有 RootClose 输入的 value / outpoint / spk 漂移才可能是被翻: 其它错误(编程错、covenant 分类、别的角色)即使探测会说"翻了"也不触发探测
  for (const err of [new TypeError('boom'), new SettlementChainCheckError('rootClose_covenant_class_mismatch', 'x'), new SettlementChainCheckError('fee_value_drift', 'x')]) {
    let called = 0; w = mkWorld({ verifyThrow: err, probeRefundFlip: async () => { called++; return true; } }); r = await adv(w, 'close_commit');
    assert.equal(called, 0, '不该探测: ' + (err.code || err.name)); assert.notEqual([...w.rows.values()][0].status, 'ambiguous'); assert.equal(r.outcome, 'failed');
  }
});

// ── landed / stale / tick ───────────────────────────────────────────────────────────────────────────────────────
await t('landed 检查: landed ⇒ markLanded 恰一次(带驱动步骤名); 未 landed ⇒ 不记账; minDepth = deps.minDepth; checkLanded 抛错 ⇒ settlement_step_unexpected_error 且不记账; 批9 排除的意图(withdraw / reclaim)忽略、零 IPC', async () => {
  const mkRow = (st, step, id = hex64()) => ({ intent_key: `settle:${st}:${id}:${step}`, subject_type: st, subject_id: id, step, status: 'submitted', submitted_txid: 'ab'.repeat(32) });
  let w = mkWorld({ landed: { landed: true, depth: 22 } }); let d = createSettlementDriver(w.deps); let row = mkRow('market', 'resolve'); w.rows.set(row.intent_key, row);
  let r = await d.checkLandedAndApply(row); assert.equal(r.outcome, 'landed'); assert.deepEqual(w.markLandedCalls, [['close_commit', row.intent_key]]); assert.equal(w.lastCheckLanded.minDepth, 20);
  w = mkWorld({ landed: { landed: false, depth: 5 } }); d = createSettlementDriver(w.deps); row = mkRow('claim', 'claim_draw'); w.rows.set(row.intent_key, row);
  r = await d.checkLandedAndApply(row); assert.equal(r.outcome, 'not_landed'); assert.deepEqual(w.markLandedCalls, []);
  w = mkWorld({ checkThrow: new Error('ipc') }); d = createSettlementDriver(w.deps); row = mkRow('market', 'seal'); w.rows.set(row.intent_key, row);
  r = await d.checkLandedAndApply(row); assert.equal(r.outcome, 'failed'); assert.deepEqual(w.alerts.map((a) => a.eventType), ['settlement_step_unexpected_error']); assert.deepEqual(w.markLandedCalls, []);
  w = mkWorld(); d = createSettlementDriver(w.deps);
  for (const [st, step] of [['claim', 'withdraw'], ['ticket', 'reclaim']]) { r = await d.checkLandedAndApply(mkRow(st, step)); assert.equal(r.outcome, 'ignored'); }
  assert.deepEqual(w.log, []);
});
await t('prepared_stale(四步都扫): prepared 停留 ≥10 分钟 ⇒ 报警一次(同 updated_at 幂等; updated_at 变了再报); 不足 10 分钟 / 非 prepared 不报', () => {
  const w = mkWorld({}); const d = createSettlementDriver({ ...w.deps, now: () => NOW });
  const mk = (step, ageMin, status = 'prepared') => ({ intent_key: `settle:market:${hex64()}:${step}`, status, prepared_txid: 'ab'.repeat(32), updated_at: new Date(NOW - ageMin * 60_000).toISOString() });
  const rows = [mk('seal', 11), mk('resolve', 10), mk('seal', 9), mk('resolve', 60, 'submitted')];
  assert.equal(d.scanPreparedStale(rows), 2); assert.equal(d.scanPreparedStale(rows), 0, '幂等');
  assert.deepEqual(w.alerts.map((a) => [a.eventType, a.level]), [['settlement_prepared_stale', 'warn'], ['settlement_prepared_stale', 'warn']]);
  rows[0].updated_at = new Date(NOW - 20 * 60_000).toISOString(); assert.equal(d.scanPreparedStale(rows), 1);
  assert.equal(PREPARED_STALE_MS, 600000);
});
await t('后效待应用: runTick 最先处理 effectsPending(占 cap, 排在 landed 检查与推进之前); markLanded 失败 ⇒ settlement_step_unexpected_error(error)逐 tick 报警不去重, 成功后停; 批 9 之外的意图忽略', async () => {
  const row = { intent_key: `settle:market:${hex64()}:seal`, subject_type: 'market', subject_id: hex64(), step: 'seal', status: 'landed' };
  const w = mkWorld({ work: { effectsPending: [row], advances: [{ step: 'seal', ...ids() }], preparedRows: [] } });
  w.rows.set(row.intent_key, row);
  let fails = 2; const realMarkLanded = w.deps.markLanded; w.deps.markLanded = async (info, r) => { if (fails-- > 0) throw new Error('deriveCloseCommitInputs: 派生失败(注入)'); return realMarkLanded(info, r); };
  const d = createSettlementDriver(w.deps);
  let out = await d.runTick({ cap: 1 });
  assert.equal(out.actioned, 1); assert.equal(out.failed, 1); assert.equal(w.log.filter((l) => l.startsWith('intents.ensure')).length, 0, 'cap=1 被后效占满, 新触发没机会先跑');
  assert.deepEqual(w.alerts.map((a) => [a.eventType, a.level, a.payload.stage]), [['settlement_step_unexpected_error', 'error', 'effects']]);
  out = await d.runTick({ cap: 1 }); assert.equal(w.alerts.length, 2, '第 2 tick 继续报警(不去重)');
  out = await d.runTick({ cap: 5 }); assert.equal(out.effectsApplied, 1); assert.equal(w.alerts.length, 2, '成功后不再报警'); assert.deepEqual(w.markLandedCalls.map((c) => c[0]), ['seal']);
  const r = await d.applyEffects({ intent_key: 'settle:claim:x:withdraw', subject_type: 'claim', step: 'withdraw' }); assert.equal(r.outcome, 'ignored');
  // 与 landedChecks 并存时也排在最前(cap=1 ⇒ 只做后效, 不做 landed 检查)
  const w2 = mkWorld({ landed: { landed: true, depth: 30 }, work: { effectsPending: [row], landedChecks: [{ intent_key: `settle:market:${hex64()}:seal`, subject_type: 'market', subject_id: hex64(), step: 'seal', status: 'submitted' }], advances: [], preparedRows: [] } });
  w2.rows.set(row.intent_key, row); const d2 = createSettlementDriver(w2.deps); const o2 = await d2.runTick({ cap: 1 });
  assert.equal(o2.effectsApplied, 1); assert.equal(w2.log.includes('checkLanded'), false, '后效排在 landed 检查之前, cap=1 时 landed 检查没机会');
});
await t('runTick: 先 landed 检查再推进; cap 限制总动作数; 一个条目失败不拖垮后面的条目; 汇总计数正确; cap 非法 ⇒ RangeError', async () => {
  const i1 = ids(), i2 = ids(), i3 = ids();
  const landedRow = { intent_key: `settle:market:${hex64()}:seal`, subject_type: 'market', subject_id: hex64(), step: 'seal', status: 'submitted' };
  const w = mkWorld({ landed: { landed: true, depth: 30 }, work: { landedChecks: [landedRow], advances: [{ step: 'seal', ...i1 }, { step: 'seal', ...i2 }, { step: 'seal', ...i3 }], preparedRows: [] } });
  let n = 0; const realBuild = w.deps.build; w.deps.build = async (...a) => { if (++n === 1) throw new Error('boom'); return realBuild(...a); };   // 第一个推进条目 build 失败
  const d = createSettlementDriver(w.deps);
  const out = await d.runTick({ cap: 3 });
  assert.equal(out.actioned, 3); assert.equal(out.landed, 1); assert.equal(out.failed, 1); assert.equal(out.submitted, 1);
  assert.ok(idx(w.log, 'markLanded') < idx(w.log, 'intents.ensure'), 'landed 对账先于推进');
  await assert.rejects(() => d.runTick({ cap: 0 }), RangeError);
  await assert.rejects(() => d.runTick({ cap: 1.5 }), RangeError);
});

// ── 结构性守卫 ─────────────────────────────────────────────────────────────────────────────────────────────────────
await t('结构: 核心只 import c1 与 pmt 门两个无 DB 模块; 不含 relay-manager / process.env / 私钥 / kaspa-wasm / withdraw / reclaim / buildWithdraw / buildTicketReclaim / allowUnlistedTestDestination(§11)', () => {
  const raw = fs.readFileSync(new URL('./proto-settlement-driver-core.mjs', import.meta.url), 'utf8');
  const code = stripComments(raw);
  const imports = code.match(/^import\s.*$/gm) || [];
  assert.equal(imports.length, 2, imports.join(' | '));
  assert.ok(imports.every((l) => /'\.\/proto-settlement-c1\.mjs'|'\.\/proto-close-commit-gate\.mjs'/.test(l)));
  for (const bad of [/relay-manager/, /process\.env/, /PrivateKey/i, /privkey/i, /kaspa-wasm/, /\bwithdraw\b/i, /\breclaim\b/i, /buildWithdrawTxJson/, /buildTicketReclaimTxJson/, /allowUnlistedTestDestination/, /destinationAllowlist/, /\bsqlite\b/, /db\/client/]) assert.ok(!bad.test(code), '不应出现 ' + bad);
});
await t('结构: 无 DB_PATH 的子进程里核心可直接 import(证明它不拖 db/client; 将来谁拖进来这里立刻红)', () => {
  const env = { ...process.env }; delete env.DB_PATH;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('./proto-settlement-driver-core.mjs', import.meta.url).href)})`], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, (r.stderr || '').split('\n')[0]);
});

// ══ R-a: refund_flip step(设计 docs/2026-09-21-j2-driver-refund-path-design-v0.2.md §3.6 / M5) ══════════════════════════════════════════════════
await t('R-a refund_flip 广播前闸①: 只翻【已冻结】市场——未冻结(false / undefined / null / 0 / "true" / 抛错)一律 gated(refund_flip_market_not_frozen), 不读 pmt / 不建 / 不广播(与 close_commit 的冻结闸方向相反且同样严格 fail-closed)', async () => {
  for (const frozen of [false, undefined, null, 0, 'true', 1, {}]) {
    const w = mkWorld({ frozen, deadlineMs: NOW - RF_GRACE - 60_000 }); const r = await adv(w, 'refund_flip');
    assert.equal(r.outcome, 'gated', String(frozen)); assert.equal(r.reason, 'refund_flip_market_not_frozen');
    assert.deepEqual(w.log.filter((l) => /^(sendCmd|build)/.test(l)), [], `未冻结时不得读 pmt / 建 / 广播: ${String(frozen)}`);
  }
  const w2 = mkWorld({ frozenThrow: new Error('db down'), deadlineMs: NOW - RF_GRACE - 60_000 }); const r2 = await adv(w2, 'refund_flip');
  assert.equal(r2.outcome, 'gated'); assert.equal(r2.reason, 'refund_flip_market_not_frozen'); assert.deepEqual(w2.log.filter((l) => /^(sendCmd|build)/.test(l)), []);
});
await t('R-a refund_flip 广播前闸②: pmt 门用 evaluateRefundFlipTiming(deadline+2h+30s), 不是 close 的 30s 闸——deadline+60s 的读数(close 会放行)对 refund_flip 必须 gated; pmt 读不到 ⇒ gated; 都不建不广播', async () => {
  let w = mkWorld({ frozen: true, deadlineMs: NOW - 60_000 });                                  // pmt=NOW ⇒ 领先 deadline 60s: close 闸放行, refund_flip 必拒
  let r = await adv(w, 'refund_flip'); assert.equal(r.outcome, 'gated'); assert.equal(r.reason, 'refund_flip_pmt_not_ready');
  assert.ok(!w.log.includes('build:refund_flip') && !w.log.includes('sendCmd:covenant_broadcast'), '不建、不广播');
  w = mkWorld({ frozen: true, deadlineMs: NOW - RF_GRACE - 29_999 }); r = await adv(w, 'refund_flip'); assert.equal(r.reason, 'refund_flip_pmt_not_ready', '差 1ms 余量不放行');
  w = mkWorld({ frozen: true, deadlineMs: NOW - RF_GRACE - 30_000 }); r = await adv(w, 'refund_flip'); assert.equal(r.outcome, 'submitted', '恰好 deadline+2h+30s 放行(对照: 上面的 gated 来自时间)');
  w = mkWorld({ frozen: true, deadlineMs: NOW - RF_GRACE - 60_000, pmt: new Error('rpc timeout') }); r = await adv(w, 'refund_flip'); assert.equal(r.outcome, 'gated'); assert.ok(!w.log.includes('build:refund_flip'));
});
await t('R-a refund_flip 放行路径: builder 收到 relay 来源的 pmtEvidence(readAtMs=relay 的 observedAtMs); 广播载荷带 continuation_output_indices; 意图 key = settle:market:<id>:refund_flip', async () => {
  const w = mkWorld({ frozen: true, cont: [0], deadlineMs: NOW - RF_GRACE - 60_000 }); const i = ids(); const d = createSettlementDriver(w.deps);
  const r = await d.advanceStep({ step: 'refund_flip', subjectId: i.subjectId, marketId: i.marketId }); assert.equal(r.outcome, 'submitted');
  assert.equal(r.key, `settle:market:${i.subjectId}:refund_flip`);
  assert.equal(w.lastBuildCtx.pmtEvidence.source, 'relay'); assert.equal(w.lastBuildCtx.pmtEvidence.pastMedianTimeMs, NOW); assert.equal(w.lastBuildCtx.pmtEvidence.readAtMs, NOW - 1000);
  assert.deepEqual(w.lastBroadcast.continuation_output_indices, [0]);
});
await t('R-a / M5: refund_flip 的 inputs 阶段 RootClose drift + 探针返回 {flipped:true,…} ⇒ 调 recordObservedRefundFlip({marketId, probe}) ⇒ held(refund_flip_observed), 报警一次; 探针 false / 抛错 / 旧式 true 的行为', async () => {
  const drift = () => new SettlementChainCheckError('rootClose_outpoint_drift', 'outpoint 漂移', { step: 'refund_flip', role: 'rootClose' });
  const probe = { flipped: true, txid: 'cd'.repeat(32), depth: 9 }; const recorded = [];
  let w = mkWorld({ frozen: true, deadlineMs: NOW - RF_GRACE - 60_000, verifyThrow: drift, probeRefundFlip: async () => probe, recordObservedRefundFlip: (a) => recorded.push(a) });
  const d = createSettlementDriver(w.deps); const i = ids();
  let r = await d.advanceStep({ step: 'refund_flip', subjectId: i.subjectId, marketId: i.marketId, tickId: 1 });
  assert.equal(r.outcome, 'held'); assert.equal(r.reason, 'refund_flip_observed');
  assert.deepEqual(recorded, [{ marketId: i.marketId, probe }], '探针结果原样交给记账端口');
  assert.deepEqual(w.alerts.map((a) => a.eventType), ['settlement_refund_flip_observed']);
  r = await d.advanceStep({ step: 'refund_flip', subjectId: i.subjectId, marketId: i.marketId, tickId: 2 }); assert.equal(w.alerts.length, 1, '不重复报警');
  const rec2 = []; w = mkWorld({ frozen: true, deadlineMs: NOW - RF_GRACE - 60_000, verifyThrow: drift, probeRefundFlip: async () => ({ flipped: false, reason: 'no_matching_successor' }), recordObservedRefundFlip: (a) => rec2.push(a) });
  r = await adv(w, 'refund_flip'); assert.equal(r.outcome, 'failed'); assert.equal(rec2.length, 0, '探针说没翻 ⇒ 不记账');
  const rec3 = []; w = mkWorld({ frozen: true, deadlineMs: NOW - RF_GRACE - 60_000, verifyThrow: drift, probeRefundFlip: async () => { throw new Error('rpc'); }, recordObservedRefundFlip: (a) => rec3.push(a) });
  r = await adv(w, 'refund_flip'); assert.equal(r.outcome, 'failed'); assert.equal(rec3.length, 0, '探针抛错 ⇒ 按未翻, 不记账');
  const rec4 = []; w = mkWorld({ frozen: true, deadlineMs: NOW - RF_GRACE - 60_000, verifyThrow: drift, probeRefundFlip: async () => true, recordObservedRefundFlip: (a) => rec4.push(a) });
  r = await adv(w, 'refund_flip'); assert.equal(r.outcome, 'held'); assert.equal(rec4.length, 0, '旧式 true(无 txid)不足以记 landed: 只 held, 不记账');
  const rec5 = []; w = mkWorld({ frozen: true, deadlineMs: NOW - RF_GRACE - 60_000, verifyThrow: new SettlementChainCheckError('fee_value_drift', 'x'), probeRefundFlip: async () => probe, recordObservedRefundFlip: (a) => rec5.push(a) });
  r = await adv(w, 'refund_flip'); assert.equal(rec5.length, 0, '非 RootClose 输入漂移 ⇒ 不探测不记账');
});
await t('R-a / M5: close_commit 的 RootClose drift + 探针 {flipped:true} ⇒ 既有行为(resolve 意图 ambiguous + 报警)之外, 还记 refund_flip landed + 冻结(recordObservedRefundFlip 被调)', async () => {
  const drift = new SettlementChainCheckError('rootClose_spk_drift', 'spk 漂移', { step: 'close_commit', role: 'rootClose' }); const probe = { flipped: true, txid: 'ef'.repeat(32), depth: 6 }; const recorded = [];
  const w = mkWorld({ verifyThrow: drift, probeRefundFlip: async () => probe, recordObservedRefundFlip: (a) => recorded.push(a) }); const d = createSettlementDriver(w.deps); const i = ids();
  const r = await d.advanceStep({ step: 'close_commit', subjectId: i.subjectId, marketId: i.marketId, tickId: 1 });
  assert.equal(r.outcome, 'held'); assert.equal(w.rows.get(d._keyOf('close_commit', i.subjectId)).status, 'ambiguous');
  assert.deepEqual(recorded, [{ marketId: i.marketId, probe }]);
});

console.log(`\nproto-settlement-driver-core.test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
