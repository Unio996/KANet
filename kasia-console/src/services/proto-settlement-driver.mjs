// proto-settlement-driver.mjs — 批9 9-2b(iii): 结算驱动的启动接线(开关 / 启动日志 / 单飞 / 健康与网络前缀检查 / 端口装配)。设计 §3 / §9 / §19。
//
// 🔴 默认关闭: 只有 PROTO_SETTLEMENT_DRIVER_ENABLED==='1' ∧ PROTO_RELAY_ID 已配置才启动(PROTO_DRIVER_ENABLED 与本开关互相独立, §3.1); 否则只打一行
//    `[proto-settlement-driver] disabled`, 零 interval、零 IPC(§3.3)。合入主线不带运行时效果——本文件只在 index.js 被调用一次, 而开关默认不写。
// 🔴 M0a 门: 不 bare-import relay-manager, 发命令一律经 lib/proto-relay-ipc.mjs 的 protoSendCmd(出口按 intent_key 分闸, 9-2a)。
// 🔴 network 只取自 KASPA_NETWORK 配置(shared configuredNetwork, 未设 ⇒ 拒绝), 绝不取自请求 / 意图行 / 调用方(§11.3); 且必须与 relay 收款地址的【整段前缀】一致(S7: 精确比较, 不用 startsWith)。
// 🔴 驱动层永不接触私钥(builder 端口自己取信封); 不接线 withdraw / ticket_reclaim(核心与端口都不含)。
import { wrapTick } from '../lib/diag-step.mjs';
import { PROTO_RELAY_ID, assertProtoRelayHealthy } from '../lib/proto-relay-guard.mjs';
import { createSettlementDriver } from '../lib/proto-settlement-driver-core.mjs';
import { createSettlementStore } from '../lib/proto-settlement-store.mjs';
import * as SI from '../lib/proto-settlement-intent.mjs';
import { verifyStepInputsOnChain, MIN_STEP_BUDGET_MS, MIN_FACTS_IPC_TIMEOUT_MS } from '../lib/proto-settlement-c1.mjs';
import { resolveStepPointers } from '../lib/proto-settlement-pointers.mjs';
import { CLAIM_DRAW_CLAIM_OUT_INDEX } from '../lib/proto-tx-assembly-settlement.mjs';
import { configuredNetwork, prefixForNetwork, addressPrefix } from '../../../shared/lib/kaspa-network.mjs';
import { sqlite } from '../db/client.js';
import { REORG_SAFE_MIN_DEPTH } from './proto-driver.mjs';
import { resolveBudgetConfig, sharedPmtValidator, readValidatedPmt } from '../lib/proto-settlement-budget.mjs';
import { applyLateSealGuard } from '../lib/proto-settlement-freeze.mjs';

const DEFAULT_INTERVAL_MS = 60_000;      // tick 间隔; 每步总预算 = 间隔的一半(§19.3a), 且 ≥ MIN_STEP_BUDGET_MS(15 s)、< 间隔
const DEFAULT_TICK_CAP = 3;

/** 开关判据(HTTP 与启动共用同一份, 同 F1 形状): 结算开关==='1' ∧ relay 已配置; 与 PROTO_DRIVER_ENABLED 无关。env / relayId 可注入(8 态测试)。 */
export function isProtoSettlementDriverEnabled({ env = process.env, relayId = PROTO_RELAY_ID } = {}) {
  return env.PROTO_SETTLEMENT_DRIVER_ENABLED === '1' && !!relayId;
}

const intFromEnv = (name, dflt, env) => { const v = Number(env[name]); return Number.isInteger(v) && v > 0 ? v : dflt; };
export const settlementIntervalMs = (env = process.env) => intFromEnv('PROTO_SETTLEMENT_DRIVER_INTERVAL_MS', DEFAULT_INTERVAL_MS, env);
export const settlementTickCap = (env = process.env) => intFromEnv('PROTO_SETTLEMENT_DRIVER_TICK_CAP', DEFAULT_TICK_CAP, env);
/** 每步总预算 = tick 间隔的一半(向下取整), 下限 MIN_STEP_BUDGET_MS; 间隔太短使预算 ≥ 间隔 ⇒ 抛错(配置错误, 不悄悄放宽)。 */
export function stepBudgetFor(intervalMs) {
  const budget = Math.max(MIN_STEP_BUDGET_MS, Math.floor(intervalMs / 2));
  if (!(budget < intervalMs)) throw new RangeError(`settlement driver: tick 间隔 ${intervalMs}ms 太短——每步预算(≥${MIN_STEP_BUDGET_MS}ms)必须小于间隔`);
  return budget;
}

/** S7: relay 地址的整段前缀必须精确等于配置网络的前缀(kaspa ↔ mainnet, kaspasim ↔ simnet …), 不用 startsWith。 */
export function assertRelayAddressOnNetwork({ network, relayAddress }) {
  const want = prefixForNetwork(network);
  const got = addressPrefix(relayAddress);
  if (got !== want) throw new Error(`settlement driver: network=${network} 期望 relay 地址前缀 ${JSON.stringify(want)}, 实际 ${JSON.stringify(got)}——拒绝(网络与 relay 不一致)`);
  return true;
}

/** 单飞状态(模块级, 同 proto-driver 的形状; 测试经 _settlementDriverTestState 读)。 */
let _started = false, _interval = null, _inFlight = false, _tickCount = 0, _skippedOverlap = 0;
export function _settlementDriverTestState() { return { started: _started, inFlight: _inFlight, tickCount: _tickCount, skippedOverlap: _skippedOverlap }; }
export function _resetSettlementDriverState() { if (_interval) clearInterval(_interval); _interval = null; _started = false; _inFlight = false; _tickCount = 0; _skippedOverlap = 0; }

/**
 * 单次 tick(单飞在这里): 健康检查(余额硬顶 / relay 存活)不过 ⇒ 跳过整 tick、零 IPC(§3.6); 网络前缀不符 ⇒ 跳过并 LOUD; 否则装配端口跑一次 runTick。
 * 全部外部依赖可注入(离线测试); 生产由 startProtoSettlementDriver 提供。
 */
export async function driveSettlementOnce({ assertHealthyFn = assertProtoRelayHealthy, network, buildDeps, cap = settlementTickCap(), log = console }) {
  if (_inFlight) { _skippedOverlap++; log.log?.(`[proto-settlement-driver] tick skipped (previous tick still in flight, skipped=${_skippedOverlap})`); return { skipped: true, reason: 'in_flight' }; }
  _inFlight = true; _tickCount++;
  const tickNo = _tickCount;
  try {
    let health;
    try { health = await assertHealthyFn(); }
    catch (e) { log.warn?.(`[proto-settlement-driver] tick ${tickNo} skipped: relay unhealthy: ${e.message}`); return { skipped: true, reason: 'relay_unhealthy' }; }
    try { assertRelayAddressOnNetwork({ network, relayAddress: health.address }); }
    catch (e) { log.error?.(`[proto-settlement-driver] tick ${tickNo} REFUSED: ${e.message}`); return { skipped: true, reason: 'network_mismatch' }; }
    const driver = await buildDeps({ health, network, tickNo });
    const out = await driver.runTick({ cap });
    if (out.actioned) log.log?.(`[proto-settlement-driver] tick ${tickNo}: ${JSON.stringify({ actioned: out.actioned, landed: out.landed, submitted: out.submitted, waiting: out.waiting, gated: out.gated, held: out.held, failed: out.failed })}`);
    return out;
  } finally { _inFlight = false; }
}

/**
 * landed 记账端口(批 D §4): store.markLanded 之后, 若是 seal 且配了预算 ⇒ 跑晚 seal 守卫(含 effectsPending 重跑, 守卫幂等)——只对有判定题的市场生效; 守卫永不抛、失败不阻塞 seal 记账(promote 门会再判)。
 */
export function makeMarkLanded({ store, budget, sendCmd, relayId, db = sqlite, log = console }) {
  return async (step, intent) => {
    const r = store.markLanded(step, intent);
    if (step === 'seal' && budget) await applyLateSealGuard({ db, marketId: intent.subject_id, readPmt: () => readValidatedPmt({ sendCmd, relayId, validator: sharedPmtValidator(budget.lagMaxMs) }), cfg: budget, log });
    return r;
  };
}

/**
 * 生产端口装配(每 tick 一次): 真实意图表 / 指针 / C1 / store + 步骤端口(ops: prepare / build / probeRefundFlip)。
 * ops 模块(lib/proto-settlement-ops.mjs)是四步 builder 的入参装配; 它不可用时【拒绝启动】(LOUD), 绝不带着半截端口跑钱路。
 */
export async function buildProductionDriver({ health, network, ops, kaspa, sendCmd, relayId, tickIntervalMs, budget }) {
  const store = createSettlementStore({ claimDrawClaimOutIndex: CLAIM_DRAW_CLAIM_OUT_INDEX });
  const { Address } = kaspa;
  const relaySpkHex = '0x' + kaspa.payToAddressScript(new Address(health.address)).script;
  const budgetMs = stepBudgetFor(tickIntervalMs);
  const requestFacts = (address, payload, { timeoutMs }) => sendCmd(relayId, { type: 'get_address_utxos', address, ...payload }, timeoutMs, 'internal');
  return createSettlementDriver({
    sendCmd, relayId, minDepth: REORG_SAFE_MIN_DEPTH, now: Date.now, log: console,
    alert: SI.alertSettlementIntent,
    intents: { ensure: SI.ensureSettlementIntent, active: SI.activeSettlementIntent, get: SI.getSettlementIntent, mark: SI.markSettlementIntent },
    driveIntent: SI.driveSettlementIntent, checkLanded: SI.checkSettlementIntentLanded,
    pointers: (step, marketId) => resolveStepPointers({ step, marketId, db: sqlite, kaspa }),
    verifyOnChain: (o) => verifyStepInputsOnChain({ ...o, network, requestFacts, kaspa, relaySpkHex, budgetMs, tickIntervalMs, ipcTimeoutMs: MIN_FACTS_IPC_TIMEOUT_MS }),
    dependenciesLanded: async (step, ctx) => store.dependenciesLanded(step, ctx),
    markLanded: makeMarkLanded({ store, budget, sendCmd, relayId }),
    isSettlementFrozen: (marketId) => store.isSettlementFrozen(marketId),
    listWork: async () => store.listWork(),
    prepare: (step, ctx) => ops.prepare(step, { ...ctx, kaspa, network, relayAddress: health.address, relaySpkHex }),
    build: (step, ctx) => ops.build(step, { ...ctx, kaspa, network, relayAddress: health.address, relaySpkHex }),
    // R-a / M5: 探针走 facts(covenantId ∧ spk ∧ 旧 outpoint 已花 ∧ 后继 landed 深度, 不得地址级), 与结算 C1 同一个 requestFacts 端口; 观察到别人翻牌 ⇒ store 一个事务记 landed + 冻结
    probeRefundFlip: ops.probeRefundFlip ? (a) => ops.probeRefundFlip({ ...a, kaspa, network, requestFacts, sendCmd, relayId, minDepth: REORG_SAFE_MIN_DEPTH }) : undefined,
    recordObservedRefundFlip: (a) => store.recordObservedRefundFlip({ ...a, log: console }),
  });
}

/** 默认的 ops 装载器: 四步 builder 入参装配模块(lib/proto-settlement-ops.mjs)。装载失败 ⇒ 拒绝启动并自停, 绝不带着半截端口跑钱路。 */
async function defaultLoadOps() { return import('../lib/proto-settlement-ops.mjs'); }

/** tick 体(setInterval 回调): ops 装载失败 ⇒ LOUD 拒绝并自停; 网络与 relay 前缀不符 ⇒ 自停(不是瞬时故障)。deps(kaspa / sendCmd / assertHealthyFn)可注入。 */
export async function settlementTickBody({ relayId, loadOps, log, network, cap, intervalMs, budget, kaspa, sendCmd, assertHealthyFn }) {
  let ops;
  try { ops = await loadOps(); }
  catch (e) { log.error(`[proto-settlement-driver] REFUSED: 步骤端口(ops)不可用: ${e.message} — 驱动自停`); stopProtoSettlementDriver(); return { skipped: true, reason: 'ops_unavailable' }; }
  const wasm = kaspa || await import('kaspa-wasm');
  const send = sendCmd || (await import('../lib/proto-relay-ipc.mjs')).protoSendCmd;
  const r = await driveSettlementOnce({
    network, cap, log, ...(assertHealthyFn ? { assertHealthyFn } : {}),
    buildDeps: ({ health }) => buildProductionDriver({ health, network, ops, kaspa: wasm, sendCmd: send, relayId, tickIntervalMs: intervalMs, budget }),
  });
  if (r && r.reason === 'network_mismatch') stopProtoSettlementDriver();
  return r;
}

export function startProtoSettlementDriver({ env = process.env, relayId = PROTO_RELAY_ID, loadOps = defaultLoadOps, log = console, deps } = {}) {
  if (_started) return;
  if (!isProtoSettlementDriverEnabled({ env, relayId })) { log.log('[proto-settlement-driver] disabled'); return; }
  let network;
  try { network = configuredNetwork(env); }
  catch (e) { log.error(`[proto-settlement-driver] REFUSED to start: ${e.message}`); return; }
  let intervalMs;
  try { intervalMs = settlementIntervalMs(env); stepBudgetFor(intervalMs); }
  catch (e) { log.error(`[proto-settlement-driver] REFUSED to start: ${e.message}`); return; }
  // 批 D N2: 预算常量校验——非法 env 回默认并 LOUD; 默认值自身与 tick 自相矛盾 ⇒ 拒启动
  let budget;
  try { const r = resolveBudgetConfig(env, { tickMs: intervalMs }); for (const w of r.warnings) log.error(`[proto-settlement-driver] BUDGET CONFIG (LOUD): ${w}`); budget = r.config; }
  catch (e) { log.error(`[proto-settlement-driver] REFUSED to start: ${e.message}`); return; }
  _started = true;
  const cap = settlementTickCap(env);
  _interval = setInterval(wrapTick('proto-settlement-driver.tick', () => settlementTickBody({ relayId, loadOps, log, network, cap, intervalMs, budget, ...(deps || {}) }).catch((e) => log.error('[proto-settlement-driver] tick error:', e.message))), intervalMs);
  log.log(`[proto-settlement-driver] started (tick ${intervalMs}ms, cap ${cap}/tick, network=${network})`);
  if (network !== 'mainnet') log.warn?.(`[proto-settlement-driver] NON-MAINNET network=${network}`);
}

export function stopProtoSettlementDriver() {
  if (_interval) { clearInterval(_interval); _interval = null; }
  _started = false;
}
