// proto-driver.mjs — 原型 v0 后台驱动(账本1438③, J2 buildAndBroadcast 接线 Stage 1 覆盖
// market_genesis; Stage 2 本笔补 bet_mint 步骤A(铸stake筹码); 步骤B(register_append)留 Stage 3)。
//
// 职责: bet_mint/market_genesis 都需要"广播后等 landed 才能推进下一步", 单次 HTTP 请求内不可能
// 同步等完——本文件是那个"在后台反复检查、能推进的推进一步"的循环, 照抄 services/tx-landed-
// reconciler.mjs 的既有模式(startX/stopX、_started 防重复启动、in-flight 单飞、wrapTick 观测)。
//
// 🔴 硬条件①(钱路闸, 最重要): 默认关闭。只有同时满足 PROTO_DRIVER_ENABLED=1 与 PROTO_RELAY_ID 已
// 配置才启动; 否则打一行 `[proto-driver] disabled` 日志, 什么都不做。理由: resumeStale*/本驱动会
// 自动续发卡住的意图, 合并加重启不该在没有 Owner GO 的情况下自动发起真实交易。HTTP handler(proto.js)
// 侧同样在驱动关闭时不得发 IPC, 只建 pending 行 + 返回 409 proto_driver_disabled(那部分逻辑在 proto.js
// 里做, 本文件只暴露 isProtoDriverEnabled() 给它复用同一个判据, 不重复写一份)。
//
// 🔴 M0a 门(账本1440/1441, considered amendment #8): 本文件不 bare-import relay-manager——发命令
// 一律走 lib/proto-relay-ipc.mjs 的 protoSendCmd(全仓唯一裸 import relay-manager 的受控出口)。
//
// 🔴 单飞: 若上一次 tick 仍在跑, 本次直接跳过(in-flight 标志), 避免同一 intent 被两个 tick 并发推进。
// 🔴 每 tick 上限: cap(默认5, 可用 PROTO_DRIVER_TICK_CAP 覆盖) 个动作, 每个动作(driveMarketGenesis
// maxAttempts=1 / checkMarketGenesisLanded 一次) 本身是幂等的(状态机 status 单调 + INSERT OR IGNORE)。

import { sqlite } from '../db/client.js';
import { wrapTick } from '../lib/diag-step.mjs';
import { PROTO_RELAY_ID, assertProtoRelayHealthy } from '../lib/proto-relay-guard.mjs';
import { getMarketRow, driveMarketGenesis, checkMarketGenesisLanded } from '../lib/proto-market-intent.mjs';
import { getBetIntent, driveBetIntent, checkBetIntentLanded } from '../lib/proto-bet-intent.mjs';
import {
  buildMarketGenesisAndBroadcast, shardLeafTargetAddress,
  buildBetMintStepAAndBroadcast, betMintStepATargetAddress, markBetMintStepALanded,
} from '../lib/proto-broadcast-ops.mjs';

const DEFAULT_INTERVAL_MS = 20_000; // 账本1438③-6, 可用 PROTO_DRIVER_INTERVAL_MS 覆盖
const DEFAULT_TICK_CAP = 5;         // 账本1438③-4, 可用 PROTO_DRIVER_TICK_CAP 覆盖
const REORG_SAFE_MIN_DEPTH = 20;    // 同 pool-shard-register.mjs 既有具名常量的数值(实测校准值), 本文件独立持有一份避免多一层跨模块耦合——数值必须与 pool-shard-register.mjs 保持一致

function _intervalMs() {
  const v = Number(process.env.PROTO_DRIVER_INTERVAL_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_INTERVAL_MS;
}
function _tickCap() {
  const v = Number(process.env.PROTO_DRIVER_TICK_CAP);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TICK_CAP;
}

/** proto-bet-intent.mjs 职责单一(文件头注: 不碰 proto_bets 表)——按 id 查 proto_bets 行的最小查询
 * 放在这里(driver 本来就已经 import sqlite 做市场表查询, 不算新增依赖面)。 */
function getBetRow(betId) {
  return sqlite.prepare('SELECT * FROM proto_bets WHERE id = ?').get(betId);
}

/** 硬条件①判据(HTTP handler 与本文件的 startProtoDriver 共用同一份, 不重复写)。 */
export function isProtoDriverEnabled() {
  return process.env.PROTO_DRIVER_ENABLED === '1' && !!PROTO_RELAY_ID;
}

/**
 * 单次 tick 的真正工作(可离线测试的纯逻辑层, 依赖全部注入)。
 *   market_genesis(Stage 1): ① genesis_pending/genesis_prepared 行 → driveMarketGenesis
 *      (maxAttempts=1, 一次尝试不重试, 重试交给下一次 tick, 避免单次 tick 因为某一行的 sleepMs
 *      重试阻塞太久)。② genesis_submitted 行 → checkMarketGenesisLanded(minDepth=REORG_SAFE_MIN_DEPTH)。
 *   bet_mint 步骤A(Stage 2, 铸stake筹码): ③ proto_bet_intents 里 step='mint' 且 pending/prepared
 *      的行 → driveBetIntent(maxAttempts=1, 同上不阻塞太久)。④ step='mint' 且 submitted 的行 →
 *      checkBetIntentLanded, landed 后额外调 markBetMintStepALanded 把结果写回 proto_bets(两张表
 *      之间唯一的桥, 见 proto-broadcast-ops.mjs 该函数的文档)。步骤B(register_append)留 Stage 3
 *      (需要 held 输入查找 + 同市场 append 串行, 账本1429/1441裁定, 尚未落码)。
 * 🔴 已知限制(如实记录, 不是忽略): fetchLandedGenesisTx 还没有对应的 relay IPC 命令("按 txid 查完整
 * 交易结构", 现有命令只按地址查 UTXO——见 proto-market-intent.mjs checkMarketGenesisLanded 的文档
 * 同一条已知限制), 本函数传 kaspa:null/fetchLandedGenesisTx:null, 落地判断退化为只做
 * check_utxo_landed(不做 1429/1431 的 shardleaf_cov_id 落链重算比对)。这个能力补齐后只需要在这里
 * 补两个参数, 不需要改其余逻辑。
 * @returns {Promise<{actioned:number, genesisAdvanced:number, genesisLandedChecked:number, genesisLanded:number, betMintAdvanced:number, betMintLandedChecked:number, betMintLanded:number, errored:number, held:number}>}
 */
export async function runProtoDriverTick({ sendCmd, relayId, kaspa, network, relayAddress, log = console, cap = DEFAULT_TICK_CAP }) {
  const out = {
    actioned: 0, genesisAdvanced: 0, genesisLandedChecked: 0, genesisLanded: 0,
    betMintAdvanced: 0, betMintLandedChecked: 0, betMintLanded: 0, errored: 0, held: 0,
  };

  const pendingRows = sqlite.prepare(`
    SELECT id FROM proto_markets WHERE status IN ('genesis_pending','genesis_prepared') ORDER BY created_at ASC LIMIT ?
  `).all(cap);
  for (const row of pendingRows) {
    if (out.actioned >= cap) return out;
    out.actioned++;
    try {
      const market = getMarketRow(row.id);
      const targetAddress = shardLeafTargetAddress({ kaspa, network, market });
      await driveMarketGenesis({
        sendCmd, relayId, marketId: market.id, targetAddress, origin: 'proto-driver', maxAttempts: 1, log,
        buildAndBroadcast: () => buildMarketGenesisAndBroadcast({ kaspa, network, market, sendCmd, relayId, relayAddress }),
      });
      out.genesisAdvanced++;
    } catch (e) {
      if (e.hold) out.held++; else out.errored++;
      log.log(`[proto-driver] genesis ${row.id} advance: ${e.message}`);
    }
  }

  const remaining = cap - out.actioned;
  if (remaining > 0) {
    const submittedRows = sqlite.prepare(`
      SELECT id FROM proto_markets WHERE status = 'genesis_submitted' ORDER BY updated_at ASC LIMIT ?
    `).all(remaining);
    for (const row of submittedRows) {
      if (out.actioned >= cap) return out;
      out.actioned++;
      try {
        const market = getMarketRow(row.id);
        const targetAddress = shardLeafTargetAddress({ kaspa, network, market });
        const r = await checkMarketGenesisLanded({
          sendCmd, relayId, market, targetAddress, minDepth: REORG_SAFE_MIN_DEPTH, origin: 'proto-driver',
          kaspa: null, fetchLandedGenesisTx: null, // 已知限制, 见函数头注
        });
        out.genesisLandedChecked++;
        if (r.landed) out.genesisLanded++;
      } catch (e) {
        if (e.hold) out.held++; else out.errored++;
        log.log(`[proto-driver] genesis ${row.id} landed-check: ${e.message}`);
      }
    }
  }

  const remaining2 = cap - out.actioned;
  if (remaining2 > 0) {
    const betPendingRows = sqlite.prepare(`
      SELECT intent_key, bet_id FROM proto_bet_intents WHERE step = 'mint' AND status IN ('pending','prepared') ORDER BY created_at ASC LIMIT ?
    `).all(remaining2);
    for (const row of betPendingRows) {
      if (out.actioned >= cap) return out;
      out.actioned++;
      try {
        const bet = getBetRow(row.bet_id);
        const targetAddress = betMintStepATargetAddress({ kaspa, network, bet });
        await driveBetIntent({
          sendCmd, relayId, betId: bet.id, step: 'mint', targetAddress, origin: 'proto-driver', maxAttempts: 1, log,
          buildAndBroadcast: () => buildBetMintStepAAndBroadcast({ kaspa, network, bet, sendCmd, relayId, relayAddress }),
        });
        out.betMintAdvanced++;
      } catch (e) {
        if (e.hold) out.held++; else out.errored++;
        log.log(`[proto-driver] bet_mint ${row.bet_id} advance: ${e.message}`);
      }
    }
  }

  const remaining3 = cap - out.actioned;
  if (remaining3 > 0) {
    const betSubmittedRows = sqlite.prepare(`
      SELECT intent_key, bet_id FROM proto_bet_intents WHERE step = 'mint' AND status = 'submitted' ORDER BY updated_at ASC LIMIT ?
    `).all(remaining3);
    for (const row of betSubmittedRows) {
      if (out.actioned >= cap) return out;
      out.actioned++;
      try {
        const bet = getBetRow(row.bet_id);
        const targetAddress = betMintStepATargetAddress({ kaspa, network, bet });
        const intent = getBetIntent(row.intent_key);
        const r = await checkBetIntentLanded({ sendCmd, relayId, intent, targetAddress, minDepth: REORG_SAFE_MIN_DEPTH, origin: 'proto-driver' });
        out.betMintLandedChecked++;
        if (r.landed) {
          out.betMintLanded++;
          markBetMintStepALanded({ betId: bet.id, txid: intent.submitted_txid });
        }
      } catch (e) {
        if (e.hold) out.held++; else out.errored++;
        log.log(`[proto-driver] bet_mint ${row.bet_id} landed-check: ${e.message}`);
      }
    }
  }
  return out;
}

let _interval = null, _started = false, _inFlight = false, _tickCount = 0, _skippedOverlap = 0;

export function _protoDriverTestState() { return { started: _started, inFlight: _inFlight, tickCount: _tickCount, skippedOverlap: _skippedOverlap }; }

/**
 * 单次 tick 入口(单飞守卫在这里)。sendCmd/kaspa 由调用方注入(生产由 startProtoDriver 动态 import
 * 提供)。assertHealthyFn 同样可注入(默认真实 assertProtoRelayHealthy, 会真的查链上余额——离线测试
 * 必须传假实现, 否则会真的打 RPC/REST)。
 */
export async function driveOnce({ sendCmd, relayId, kaspa, network, log = console, cap = _tickCap(), assertHealthyFn = assertProtoRelayHealthy }) {
  if (_inFlight) { _skippedOverlap++; log.log?.(`[proto-driver] tick skipped (previous tick still in flight, skipped=${_skippedOverlap})`); return { skipped: true }; }
  _inFlight = true;
  _tickCount++;
  const tickNo = _tickCount;
  try {
    let health;
    try { health = await assertHealthyFn(); }
    catch (e) { log.warn?.(`[proto-driver] tick ${tickNo} skipped: relay unhealthy: ${e.message}`); return { skipped: true, reason: 'relay_unhealthy' }; }
    const out = await runProtoDriverTick({ sendCmd, relayId, kaspa, network, relayAddress: health.address, log, cap });
    if (out.actioned) log.log(`[proto-driver] tick ${tickNo}: ${JSON.stringify(out)}`);
    return out;
  } finally {
    _inFlight = false;
  }
}

export function startProtoDriver() {
  if (_started) return;
  if (!isProtoDriverEnabled()) {
    console.log('[proto-driver] disabled');
    return;
  }
  _started = true;
  const intervalMs = _intervalMs();
  _interval = setInterval(wrapTick('proto-driver.tick', () => {
    return (async () => {
      const kaspa = await import('kaspa-wasm');
      const { protoSendCmd } = await import('../lib/proto-relay-ipc.mjs');
      const network = process.env.KASPA_NETWORK || 'mainnet';
      await driveOnce({ sendCmd: protoSendCmd, relayId: PROTO_RELAY_ID, kaspa, network, log: console });
    })().catch((e) => console.error('[proto-driver] tick error:', e.message));
  }), intervalMs);
  console.log(`[proto-driver] started (tick ${intervalMs}ms, cap ${_tickCap()}/tick)`);
}

export function stopProtoDriver() {
  if (_interval) { clearInterval(_interval); _interval = null; }
  _started = false;
}
