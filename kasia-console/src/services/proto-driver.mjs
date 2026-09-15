// proto-driver.mjs — 原型 v0 后台驱动(账本1438③, J2 buildAndBroadcast 接线: 覆盖 market_genesis
// 与 bet_mint(register_append))。
//
// 🔴 D-020(账本1446/1448, a4878d7d): bet_mint 原两步(步骤A铸stake筹码+步骤B register_append)
// 已取消——register_append 现在是下注唯一的单笔交易, 原步骤A的推进/落地检测循环、账本1443那套
// "步骤A landed 后同一tick内追发步骤B"的链式追发逻辑随之整段删除(不再有两步可链, 也不再需要
// dependsOn 这套机制)。
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
  buildRegisterAppendAndBroadcast, registerAppendTargetAddress, markBetAppendLanded,
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
 *   market_genesis: ① genesis_pending/genesis_prepared 行 → driveMarketGenesis(maxAttempts=1,
 *      一次尝试不重试, 重试交给下一次 tick, 避免单次 tick 因为某一行的 sleepMs 重试阻塞太久)。
 *      ② genesis_submitted 行 → checkMarketGenesisLanded(minDepth=REORG_SAFE_MIN_DEPTH)。
 *   bet_mint(register_append 单笔交易, D-020 账本1446/1448; 构造逻辑账本1425/1429/1436/1439):
 *      ③ proto_bet_intents 里 step='append' 且 pending/prepared 的行 → driveBetIntent(内部调
 *      buildRegisterAppendAndBroadcast, 构造前一并完成同市场串行/held推算+链上核对/一致性检查
 *      三项fail-closed, 见该函数文档)。④ step='append' 且 submitted 的行 → checkBetIntentLanded,
 *      landed 后调 markBetAppendLanded 把 proto_bets 推进到 confirmed(deriveLeafState 靠这个状态
 *      筛选已确认下注)。
 * 🔴 账本1444(NWT复核撤销1432③"已知限制"的定性, 不是新增待办): 本函数传 kaspa:null/
 * fetchLandedGenesisTx:null, 落地判断只做 check_utxo_landed, 不额外重算 shardleaf_cov_id 比对
 * ——这不是缺一个能力(fetchLandedGenesisTx 确实还没有对应的 relay IPC 命令"按 txid 查完整交易结构",
 * 但那不是这里需要它的理由)。check_utxo_landed 核的是"与 prepared 阶段记录的同一个 txid 已落链",
 * 而 txid 本身就是对该笔交易全部输入(含 authorizing input 的 outpoint)的密码学承诺——同一个 txid
 * 落链意味着输入完全相同, covenant_id(outpoint, auth_outputs) 是这些输入的纯函数, 因此必然相同,
 * 重算比对是同义反复的冗余检查, 不提供额外保证。这条本身在 verifyShardLeafCovIdAgainstLandedTx
 * (proto-tx-assembly.mjs)仍然保留、可用——只是生产路径不需要接线调用它。
 * @returns {Promise<{actioned:number, genesisAdvanced:number, genesisLandedChecked:number, genesisLanded:number, betAppendAdvanced:number, betAppendLandedChecked:number, betAppendLanded:number, errored:number, held:number}>}
 */
export async function runProtoDriverTick({ sendCmd, relayId, kaspa, network, relayAddress, log = console, cap = DEFAULT_TICK_CAP }) {
  const out = {
    actioned: 0, genesisAdvanced: 0, genesisLandedChecked: 0, genesisLanded: 0,
    betAppendAdvanced: 0, betAppendLandedChecked: 0, betAppendLanded: 0, errored: 0, held: 0,
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
          kaspa: null, fetchLandedGenesisTx: null, // 账本1444: 同txid落链⇒输入相同⇒covenant_id必然相同, 重算比对冗余, 见函数头注
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
    const appendPendingRows = sqlite.prepare(`
      SELECT intent_key, bet_id FROM proto_bet_intents WHERE step = 'append' AND status IN ('pending','prepared') ORDER BY created_at ASC LIMIT ?
    `).all(remaining2);
    for (const row of appendPendingRows) {
      if (out.actioned >= cap) return out;
      out.actioned++;
      try {
        const bet = getBetRow(row.bet_id);
        const market = getMarketRow(bet.market_id);
        const targetAddress = registerAppendTargetAddress({ kaspa, network, market, bet });
        await driveBetIntent({
          sendCmd, relayId, betId: bet.id, step: 'append', targetAddress, origin: 'proto-driver', maxAttempts: 1, log,
          buildAndBroadcast: () => buildRegisterAppendAndBroadcast({ kaspa, network, market, bet, sendCmd, relayId, relayAddress }),
        });
        out.betAppendAdvanced++;
      } catch (e) {
        if (e.hold) out.held++; else out.errored++;
        log.log(`[proto-driver] bet_append ${row.bet_id} advance: ${e.message}`);
      }
    }
  }

  const remaining3 = cap - out.actioned;
  if (remaining3 > 0) {
    const appendSubmittedRows = sqlite.prepare(`
      SELECT intent_key, bet_id FROM proto_bet_intents WHERE step = 'append' AND status = 'submitted' ORDER BY updated_at ASC LIMIT ?
    `).all(remaining3);
    for (const row of appendSubmittedRows) {
      if (out.actioned >= cap) return out;
      out.actioned++;
      try {
        const bet = getBetRow(row.bet_id);
        const market = getMarketRow(bet.market_id);
        const targetAddress = registerAppendTargetAddress({ kaspa, network, market, bet });
        const intent = getBetIntent(row.intent_key);
        const r = await checkBetIntentLanded({ sendCmd, relayId, intent, targetAddress, minDepth: REORG_SAFE_MIN_DEPTH, origin: 'proto-driver' });
        out.betAppendLandedChecked++;
        if (r.landed) {
          out.betAppendLanded++;
          markBetAppendLanded({ betId: bet.id, txid: intent.submitted_txid });
        }
      } catch (e) {
        if (e.hold) out.held++; else out.errored++;
        log.log(`[proto-driver] bet_append ${row.bet_id} landed-check: ${e.message}`);
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
