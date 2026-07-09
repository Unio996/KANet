// zk-autonomy-ticks.mjs — (b) zkCloseTickV2 + (c) claimAutonomousTick (J2, 2026-07-09).
//
// 设计: docs/2026-07-09-zk-autonomy-three-parts-design.md §2/§3(Bettor+NWT GREEN-with-notes)。
//
// 不修补 bshard-settle-daemon.mjs 里的旧 `_zkCloseCtx`/`zkCloseTick`(2026-07-06 vintage 骨架, 三处跟今天
// 真实实现脱节——checkLanded 查已知有缺口的 kaspa_tx_log 表/reconcile 不碰 zk_continuation/scanReadyZkMarkets
// 依赖从未被打过的 protocol_status='zk_ready' 标记, 见设计文档 §2 现状纠偏), 按 2026-07-09 正式场市场5
// (tyr91)真实驱动逻辑重写, 新函数名避免语义混淆。旧骨架保留不动(kill switch 各自独立, 互不影响)。
//
// ctx 注入(同 dispatchUnlockZkClose/rebuildZkCloseGateWitness 惯例, 本文件不碰 kaspa-wasm/relay 细节):
//   zkCloseTickV2(ctx)      ctx = { dispatchUnlockZkClose(args), checkLanded(address,txid,minDepth) }
//   claimAutonomousTick(ctx) ctx = { relayCall(cmd), checkLanded(address,txid,minDepth), mintFeeUtxo(),
//                                    p2shAddr(redeemHex), p2pkAddr(pkHex) }

import { sqlite } from '../db/client.js';
import {
  parseCloseZkV2State, buildClaimWitness, buildClaimCommand,
  spliceClaimContinuationRedeem, isNullifierBitSet,
} from './closezk-v2-claim-builder.mjs';
import { computePariMutuelPayout } from './pool-shard-settle.mjs';
import { advanceZkContinuationAfterSpend } from './closezk-v2-mint.mjs';
import { getMarketBets } from './pool-bettor-sides-query.mjs';
import { deriveCloseFeeLeaves } from '../services/bshard-close-voter.js';
import { randomUUID } from 'crypto';

const log = (...a) => console.log('[zk-autonomy]', new Date().toISOString().slice(11, 19), ...a);

function _writeZkAutonomyErrorEvent(scope, marketId, message) {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', ?, 'zk-autonomy-ticks', 'warn', ?, ?, datetime('now'))
    `).run(randomUUID(), `${scope}_error`, `${scope} market=${String(marketId).slice(-8)}: ${String(message).slice(0, 300)}`, JSON.stringify({ marketId, message: String(message) }));
  } catch (e) { log(`events insert fail for ${scope} (non-fatal): ${e.message}`); }
}

/**
 * _scanZkAutonomyCandidates — (b)(c) 共用扫描条件(设计文档 §2/§3): zk_continuation.proving.status='ready'
 * 且 !exhausted。**对 closed==1(待 zk_close)和 closed==2(待 claim)两态都成立**——两个 tick 各自再用
 * parseCloseZkV2State 现读精确路由(下方 §注1 对称守卫), 不在这里按 closed 过滤(那需要先 parse redeemHex,
 * 放在各 tick 自己的 per-market 处理段, 避免这个共享扫描函数意外抛错影响另一个 tick)。
 */
function _scanZkAutonomyCandidates() {
  const rows = sqlite.prepare(`SELECT id, metadata FROM pool_markets WHERE metadata LIKE '%zk_continuation%'`).all();
  const out = [];
  for (const row of rows) {
    let meta; try { meta = JSON.parse(row.metadata || '{}'); } catch { continue; }
    const zc = meta.zk_continuation;
    if (!zc || zc.exhausted === true) continue;
    if (!zc.proving || zc.proving.status !== 'ready') continue;
    if (!zc.outpoint || !zc.redeemHex) continue;
    out.push({ marketId: row.id, zc });
  }
  return out;
}

// per-market running mutex(NWT 注: 直接复用 bshardCloseSubmitV2Tick 的 running 布尔模式, 这里用 Set 版本
// 因为要跨 zkCloseTickV2/claimAutonomousTick 两个 tick 共享——同一市场同一时刻只能被其中一个占用, 防止
// closed==1→2 转移中间态被两边同时误判/重复广播)。
const _zkAutonomyLeases = new Set();

let _zkCloseV2Running = false;
export async function zkCloseTickV2(ctx) {
  if (_zkCloseV2Running) return { skipped: true };
  _zkCloseV2Running = true;
  try {
    const candidates = _scanZkAutonomyCandidates();
    let dispatched = 0, notMine = 0, skipped = 0, errored = 0;
    for (const { marketId, zc } of candidates) {
      if (_zkAutonomyLeases.has(marketId)) { skipped++; continue; }
      // 注1(Bettor 必须项, 对称守卫): peek(expectedClosed:null, 只做 marker fail-closed 校验不比对值)判断
      // 这个市场现在归哪个 tick 管——closed==2 是 claimAutonomousTick 的态, 这里正常 skip 非错误。
      let peeked;
      try { peeked = parseCloseZkV2State(zc.redeemHex, { expectedClosed: null }); }
      catch (e) { errored++; _writeZkAutonomyErrorEvent('zkCloseTickV2_peek', marketId, e.message); continue; }
      if (peeked.closed !== 1) { notMine++; continue; }

      _zkAutonomyLeases.add(marketId);
      try {
        // 注3(Bettor, 并发/幂等): 广播前现读一次当前活 zk_continuation(可能已被人工 driver 领先一步花掉)。
        const row = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId);
        let freshMeta; try { freshMeta = JSON.parse(row?.metadata || '{}'); } catch { skipped++; continue; }
        const freshZc = freshMeta.zk_continuation;
        if (!freshZc || freshZc.exhausted === true) { skipped++; continue; }
        let freshState;
        try { freshState = parseCloseZkV2State(freshZc.redeemHex, { expectedClosed: 1 }); }
        catch { skipped++; continue; }   // 现读时已不是 closed==1(被并行处理领先)——正常 skip, 非错误

        const r = await ctx.dispatchUnlockZkClose({ marketId, continuationOutpoint: freshZc.outpoint, attestedWinner: freshZc.attestedWinner });
        if (!r.ok) { errored++; _writeZkAutonomyErrorEvent('zkCloseTickV2_dispatch', marketId, r.error); continue; }

        // (a) landed-gated 持久化(同门②纪律一字不差): check_utxo_landed 过了才 advanceZkContinuationAfterSpend。
        const landedOk = await ctx.checkLanded(r.closeZkContinuationAddress, r.txid, 20);
        if (!landedOk) {
          errored++;
          _writeZkAutonomyErrorEvent('zkCloseTickV2_landed_timeout', marketId, `广播 OK(txId=${r.txid}) 但 landed 确认超时 — 零持久化, 需人工核实链上实况`);
          continue;
        }
        advanceZkContinuationAfterSpend(marketId, {
          outpointTxid: r.txid, outpointIndex: 0, redeemHex: r.closeZkContinuationRedeemHex,
          valueSompi: freshZc.valueSompi, spentEntry: 'zk_close', spentTxid: r.txid,
        });
        dispatched++;
        log(`✅ market=${marketId.slice(-8)} zk_close dispatched+landed txId=${r.txid}`);
      } catch (e) {
        errored++; _writeZkAutonomyErrorEvent('zkCloseTickV2', marketId, e.message);
      } finally { _zkAutonomyLeases.delete(marketId); }
    }
    if (dispatched || errored) log(`tick: ${candidates.length} candidate(s) | dispatched=${dispatched} notMine=${notMine} skipped=${skipped} errored=${errored}`);
    return { ok: true, candidates: candidates.length, dispatched, notMine, skipped, errored };
  } finally { _zkCloseV2Running = false; }
}

/**
 * _claimOneMarket — 单市场单次 claim 尝试(每个 tick 每个市场最多 claim 一个 leaf, 镜像既有 canary 节奏
 * MAX_PER_TICK 哲学——多个 winner 靠后续多轮 tick 逐个领走, 不在一次 tick 调用里连环 claim N 笔)。
 */
async function _claimOneMarket(marketId, ctx) {
  const row = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId);
  let meta; try { meta = JSON.parse(row?.metadata || '{}'); } catch (e) { _writeZkAutonomyErrorEvent('claimAutonomousTick_parse', marketId, e.message); return { errored: true, claimed: 0 }; }
  const zc = meta.zk_continuation;
  if (!zc || zc.exhausted === true) return { errored: false, claimed: 0 };

  // 注(NWT 边界 case, last-claimant 场景没有 continuation, 上一轮已把 exhausted=true 写完的市场在上面
  // 已经 return 了; 这里是"还没 exhausted 但 poolAtZkCloseSompi 缺失"的情形——只可能是早于本次(a)+snapshot
  // 修复落地的历史市场, fail-closed 报警走人工, 不猜一个值糊弄过去)。
  if (zc.poolAtZkCloseSompi == null) {
    _writeZkAutonomyErrorEvent('claimAutonomousTick_missing_snapshot', marketId, 'zk_continuation.poolAtZkCloseSompi 缺失(zk_close 早于本次快照修复落地) — 需人工 backfill 或走 driver 手动流程, 自治 tick 拒绝猜值');
    return { errored: true, claimed: 0 };
  }

  let currentState;
  try { currentState = parseCloseZkV2State(zc.redeemHex, { expectedClosed: 2 }); }
  catch (e) { _writeZkAutonomyErrorEvent('claimAutonomousTick_parse_state', marketId, e.message); return { errored: true, claimed: 0 }; }

  const { bets: bettors } = getMarketBets(marketId, sqlite);
  // Bettor #bk28lo②/verify-value-source: fee-leaf 派生跟 zk_close mint 那一刻【同一份单源函数】, 不读 DB 缓存。
  const feeLeaves = deriveCloseFeeLeaves(marketId, zc.poolAtZkCloseSompi) || [];

  const pm = computePariMutuelPayout({ bettors, winningDirection: currentState.attestedWinner, poolTotalSompi: zc.poolAtZkCloseSompi, feeLeaves });
  if (pm.degenerate) { _writeZkAutonomyErrorEvent('claimAutonomousTick_degenerate', marketId, pm.reason); return { errored: true, claimed: 0 }; }

  let targetIdx = -1;
  for (let i = 0; i < pm.payoutLeaves.length; i++) {
    if (!isNullifierBitSet(currentState, i)) { targetIdx = i; break; }
  }
  if (targetIdx === -1) {
    // 全部 leaf 的 nullifier bit 都已置位但 zk_continuation 未被标 exhausted——不该发生(持久化没跟上), 报警非静默。
    _writeZkAutonomyErrorEvent('claimAutonomousTick_all_claimed_not_exhausted', marketId, 'payoutLeaves 全部 nullifier bit 已置位但 zk_continuation.exhausted 未标记, 需人工核对');
    return { errored: true, claimed: 0 };
  }

  const target = pm.payoutLeaves[targetIdx];
  const witness = buildClaimWitness(target.pk, targetIdx, currentState, { bettors, feeLeaves, poolTotalAtZkCloseSompi: zc.poolAtZkCloseSompi });
  // 权威源: witness.payout 是 buildClaimWitness 自验证过的值(root+climb 双锁), spliceClaimContinuationRedeem
  // 只做纯字节拼接, 不重新决定谁该拿多少钱(权限边界: tick 只执行, 不判断"谁该收钱")。
  const splice = spliceClaimContinuationRedeem(zc.redeemHex, targetIdx, witness.payout, currentState);

  const bettorAddress = await ctx.p2pkAddr(target.pk);
  const feeUtxo = await ctx.mintFeeUtxo();

  const cmd = buildClaimCommand({
    witness, closezkOutpointTxid: zc.outpoint.txid, closezkRedeemHex: zc.redeemHex, currentState,
    feeOutpointTxid: feeUtxo.outpointTxid, feeAddress: feeUtxo.address,
    selfOutIdx: 0, payoutOutIdx: splice.isLast ? 0 : 1,
    bettorAddress, changeAddress: feeUtxo.address,
  });
  cmd.inputs.fee.index = feeUtxo.index;

  let sj;
  try { sj = await ctx.relayCall(cmd); } catch (e) { _writeZkAutonomyErrorEvent('claimAutonomousTick_broadcast', marketId, e.message); return { errored: true, claimed: 0 }; }
  const txid = sj?.txId || sj?.txid;
  if (!txid) { _writeZkAutonomyErrorEvent('claimAutonomousTick_broadcast', marketId, `no txId in relay response: ${JSON.stringify(sj).slice(0, 200)}`); return { errored: true, claimed: 0 }; }

  // (a) landed-gated 持久化: check_utxo_landed 过了才 advanceZkContinuationAfterSpend——广播成功 ≠ 落链
  // (NO TX NO STATE CHANGE)。isLast 场景没有 continuation output 可核对地址, 直接用 bettorAddress 作为
  // landed-check 目标(payout 那笔本身就是这个 tx 的证明, 同驱动脚本isLast 分支的处理)。
  const contAddr = splice.isLast ? null : await ctx.p2shAddr(splice.redeemHex);
  const landAddr = sj.closeZkContinuationAddress || contAddr || bettorAddress;
  const landedOk = await ctx.checkLanded(landAddr, txid, 20);
  if (!landedOk) {
    _writeZkAutonomyErrorEvent('claimAutonomousTick_landed_timeout', marketId, `广播 OK(txId=${txid}) 但 landed 确认超时 — 零持久化, 需人工核实链上实况`);
    return { errored: true, claimed: 0 };
  }

  if (splice.isLast) {
    advanceZkContinuationAfterSpend(marketId, { outpointTxid: null, redeemHex: null, valueSompi: 0, spentEntry: 'claim', spentTxid: txid });
  } else {
    advanceZkContinuationAfterSpend(marketId, { outpointTxid: txid, outpointIndex: 0, redeemHex: splice.redeemHex, valueSompi: splice.newPool.toString(), spentEntry: 'claim', spentTxid: txid });
  }
  log(`✅ market=${marketId.slice(-8)} claim idx=${targetIdx} pk=${target.pk.slice(0, 12)} payout=${witness.payout} txId=${txid}${splice.isLast ? ' (last, exhausted)' : ''}`);
  return { errored: false, claimed: 1 };
}

let _claimTickRunning = false;
export async function claimAutonomousTick(ctx) {
  if (_claimTickRunning) return { skipped: true };
  _claimTickRunning = true;
  try {
    const candidates = _scanZkAutonomyCandidates();
    let claimed = 0, notMine = 0, skipped = 0, errored = 0;
    for (const { marketId, zc } of candidates) {
      if (_zkAutonomyLeases.has(marketId)) { skipped++; continue; }
      // 注1 对称守卫(同 zkCloseTickV2): peek 判断这个市场现在归哪个 tick 管, closed==1 正常 skip 非错误。
      let peeked;
      try { peeked = parseCloseZkV2State(zc.redeemHex, { expectedClosed: null }); }
      catch (e) { errored++; _writeZkAutonomyErrorEvent('claimAutonomousTick_peek', marketId, e.message); continue; }
      if (peeked.closed !== 2) { notMine++; continue; }

      _zkAutonomyLeases.add(marketId);
      try {
        const r = await _claimOneMarket(marketId, ctx);
        if (r.errored) errored++; else claimed += r.claimed;
      } catch (e) {
        errored++; _writeZkAutonomyErrorEvent('claimAutonomousTick', marketId, e.message);
      } finally { _zkAutonomyLeases.delete(marketId); }
    }
    if (claimed || errored) log(`tick: ${candidates.length} candidate(s) | claimed=${claimed} notMine=${notMine} skipped=${skipped} errored=${errored}`);
    return { ok: true, candidates: candidates.length, claimed, notMine, skipped, errored };
  } finally { _claimTickRunning = false; }
}

// 测试专用(仅供 offline test 断言 mutex 状态, 不供生产代码调用)。
export function _zkAutonomyLeasesForTest() { return _zkAutonomyLeases; }
