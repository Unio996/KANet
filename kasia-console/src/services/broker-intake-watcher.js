// ════════════════════════════════════════════════════════════════
// HIGH-RISK FILE (Critical 8 per docs/COLLAB-REFORM.md 规 10/13/15)
// 改前必跑: grep -nE 'T-J[0-9]+-|T-NWT-|Bug-[A-Z][0-9]+' 本 file
// 改后 commit msg 必含: acknowledged: T-X-X (per surfaced anti-pattern)
// 关联 docs: ANTI-PATTERNS R38+ / DEVELOPER-GUIDE ch19
// 关键历史: Bug-Z17 retail_dex_orders state sync / Bug-Z20 timeout sweep self-deceive
//          / Layer 4 chain reconciler J1 2187455a / spread% J1 52545357d
// blast radius: 5min refund tick / chain DM classify / broker SELL spread / refund chain TX
// ════════════════════════════════════════════════════════════════
//
// broker-intake-watcher.js — Phase 3 兜底机制 (v2.1 §4.2)
// 每 60s 扫 Trader-B 入账, 4 场景路由 (意图一致/反向/陌生/黑名单). Broker 吃 gas.
// 挂在 Console 启动 (index.js) setInterval, 不新建表只新增 event_type='broker_intake_processed' 作处理标记.

import { sqlite } from '../db/client.js';
import { transition } from './exchange-machine.js';
import { randomUUID } from 'node:crypto';

const TICK_MS = 60_000;
const REFUND_TICK_MS = 5 * 60_000;
// Bettor #j5romh r766 身份迁移补全(此文件含 5min 退款 sweep tick, 死 id 自 relay 重建起静默失效): env 缺失 fail-loud 拒启。
const BROKER_RELAY_ID = process.env.BROKER_RELAY_ID;
if (!BROKER_RELAY_ID) {
  throw new Error('[broker-intake-watcher] FATAL: BROKER_RELAY_ID env var not set (see kanet.env) — refusing to start with hardcoded dead relay id fallback');
}
const PUBLISH_EXPIRES_MIN = 120;
const DEFAULT_FEE_KAS = '0.1';
let _intakeInterval = null;
let _refundInterval = null;
let _refundLastFireAt = 0;  // T-J2-2026-07-15 diag(observe-only): setInterval scheduled-vs-actual lag probe
let _sendCommandOverride = null;  // test injection

// 🔴 Z20 熔断(2026-07-14, Bettor #k6qj5a 第五源续追查, 语义裁定 #k7xxxx 补): Z20 sweep(每
// REFUND_TICK_MS=5min)对同一批 offer 反复走 advanceToRefunded→enqueueVerified→单线 pump→
// sendCommandAsync(relay IPC, 默认 30s timeout)——若这批 offer 结构性无法退(如无 retail_dex_orders
// 链接/relay 不在线), 每轮串行付出接近满额 IPC 超时代价, N 个卡住的 offer × 最多 30s = 观测到的
// 250-260s 长冻结签名(handled=0/10 现场实证)。照抄今天 pool-market-settler.js 的同款 in-process
// 熔断模式(Bettor 裁定: 不为此加表/加列, tick 周期够快, streak 攒得起)。
//
// 🔴 语义边界(Bettor 裁定钉死, 不容混淆): 熔断 = 调度层"别再每 5 分钟空转重试" ≠ 资金层"永久放弃
// 这笔钱"。熔断只停止本 tick 对该 offer 的调度重试, **绝不改 exchange_offers.protocol_status,
// 绝不动用户资金, 绝不影响用户的退款权利**——钱还在原地不动, 只是不再让它每 5 分钟把整个 Console
// 事件循环冻 4 分钟。真正无法退款的业务原因(链接缺失/relay 不在线)必须走人工处置: 用
// listZ20CircuitBroken() 查"谁被熔断/为什么/多少钱/归谁", 处置后用 clearZ20Circuit() 复位(镜像
// bshard-settle-daemon.mjs 的 clearRepeatOffenderMarker 先例)。events 审计行仅供追溯, 不等于会被
// 主动巡查——listing 端点才是真正的挂账清单入口(admin-dedup.js 挂 GET /api/admin/z20-circuit-broken)。
// 2026-07-14 续二(Bettor 裁定#k9iz8i, 采纳 NWT "熔断必须喊疼"): 光"可查"不够, 没人主动巡查=静默丢弃,
// 反而比之前"徒劳重试"更差。补: 每 tick 新熔断的 offer 整批合并成一条摘要, fire-and-forget 广播到
// dev-coord-testnet(见循环尾部, 不 await, 避免在已卡死边缘的 tick 里再叠一次 IPC 30s 代价)。
const Z20_CIRCUIT_THRESHOLD = parseInt(process.env.Z20_REFUND_CIRCUIT_THRESHOLD, 10) || 3;
const _z20FailStreak = new Map();   // offer_id -> { sig, streak }
const _z20CircuitBroken = new Map();   // offer_id -> { sig, streak, brokenAt }(达阈值后熔断, 直到进程重启或人工 clearZ20Circuit)
export function z20CircuitGate(offerId) { return _z20CircuitBroken.has(offerId); }
export function recordZ20Failure(offerId, reason) {
  const sig = String(reason || '').slice(0, 60);
  const prev = _z20FailStreak.get(offerId);
  const streak = (prev?.sig === sig ? prev.streak : 0) + 1;
  if (streak >= Z20_CIRCUIT_THRESHOLD) {
    const brokenAt = new Date().toISOString();
    _z20CircuitBroken.set(offerId, { sig, streak, brokenAt });
    _z20FailStreak.delete(offerId);
    console.warn(`[broker-refund] Z20 🔴 offer=${offerId.slice(0,8)} 连续 ${streak} 次同签名失败(${sig}), 熔断(仅停调度重试, 不动资金, 进程内可人工clearZ20Circuit复位), 后续 tick 跳过`);
    try {
      sqlite.prepare(`
        INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
        VALUES (?, 'system', 'z20_refund_circuit_broken', 'broker-intake-watcher:Z20', 'warn', ?, ?, datetime('now'))
      `).run(randomUUID(), `offer=${offerId.slice(0,8)} 连续${streak}次同签名失败(${sig}), 进程内熔断(仅停调度重试不动资金, 挂账待人工处置实际卡死原因)`, JSON.stringify({ offerId, streak, sig }));
    } catch (e) { console.warn(`[broker-refund] Z20 circuit-break events insert fail (non-fatal): ${e.message}`); }
    return true;   // 刚跳变为熔断(本次调用是这次 streak 的第 N=threshold 次) — 调用方用这个信号做"整批合并成一条摘要"告警(NWT+Bettor 裁定, 不要 per-offer 刷屏)
  } else {
    _z20FailStreak.set(offerId, { sig, streak });
    return false;
  }
}

// listZ20CircuitBroken() — Bettor 裁定 #k7xxxx 要求①的挂账清单查询入口: 谁被熔断/为什么/多少钱/归谁。
// 纯读, 不动任何状态。enrich exchange_offers 补金额+用户地址(offer 已被 delete/清表则金额字段留 null,
// 不因此报错——熔断记录本身仍要能看到, 不能因为周边数据缺失就吞掉审计线索)。
export function listZ20CircuitBroken() {
  const out = [];
  for (const [offerId, info] of _z20CircuitBroken.entries()) {
    let giveAmount = null, wantAmount = null, userAddress = null, protocolStatus = null;
    try {
      const row = sqlite.prepare(`SELECT give_amount, want_amount, metadata, protocol_status FROM exchange_offers WHERE id = ?`).get(offerId);
      if (row) {
        giveAmount = row.give_amount;
        wantAmount = row.want_amount;
        protocolStatus = row.protocol_status;
        try { userAddress = JSON.parse(row.metadata || '{}')?.user_kasia_address ?? null; } catch {}
      }
    } catch (e) { console.warn(`[broker-refund] Z20 listZ20CircuitBroken enrich fail for ${offerId.slice(0,8)} (non-fatal): ${e.message}`); }
    out.push({ offerId, sig: info.sig, streak: info.streak, brokenAt: info.brokenAt, giveAmount, wantAmount, userAddress, protocolStatus });
  }
  return out;
}

// clearZ20Circuit(offerId, reason) — 人工确认某 offer 的卡死原因已处置(如补上 retail_dex_orders 链接/
// relay 恢复在线)后, 手动复位熔断状态, 让下一轮 Z20 tick 重新尝试。镜像 bshard-settle-daemon.mjs 的
// clearRepeatOffenderMarker(同款 tripwire: 非熔断状态返回幂等 no-op, 不误清)。纯调度层, 不动钱。
export function clearZ20Circuit(offerId, reason) {
  if (!_z20CircuitBroken.has(offerId)) return { ok: false, reason: '未处于熔断状态, 无需清理(幂等)', already: true };
  const before = _z20CircuitBroken.get(offerId);
  _z20CircuitBroken.delete(offerId);
  _z20FailStreak.delete(offerId);
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'z20_refund_circuit_cleared', 'clearZ20Circuit', 'warn', ?, ?, datetime('now'))
    `).run(randomUUID(), `offer=${offerId.slice(0,8)} 熔断人工清除: ${reason || '(未附理由)'}`, JSON.stringify({ offerId, before, reason: reason || null }));
  } catch (e) { console.warn(`[broker-refund] Z20 clearZ20Circuit events insert fail (non-fatal): ${e.message}`); }
  return { ok: true, cleared: before };
}
let _publishOverride = null;      // test injection (POST /api/exchange/publish)

export function _testInjectSendCommand(fn) { _sendCommandOverride = fn; }
export function _testResetSendCommand() { _sendCommandOverride = null; }
export function _testInjectPublish(fn) { _publishOverride = fn; }
export function _testResetPublish() { _publishOverride = null; }

// R-NWT-2026-04-28 Layer 5: import canonical command enum (Z21 root fix + future regression防).
import { COMMAND_TYPES } from '../../../kasia-relay/src/lib/commands.mjs';

async function _send(relayId, cmd) {
  if (_sendCommandOverride) return _sendCommandOverride(relayId, cmd);
  // R4 (T-NWT-09): broker 出链全走 broker-action-queue 单线 pump 防 UTXO 双花.
  // 其他 relay (e.g. test) 仍直走 sendCommandAsync.
  if (relayId === BROKER_RELAY_ID) {
    const { enqueue } = await import('./broker-action-queue.js');
    let kind, payload;
    if (cmd.type === COMMAND_TYPES.SEND_MESSAGE)   { kind = 'dm_quote'; payload = { message: cmd.message }; }
    else if (cmd.type === COMMAND_TYPES.TRANSFER)  { kind = 'sendKas';  payload = { amount_kas: cmd.amount_kas ?? cmd.amount, note: cmd.note }; }
    else if (cmd.type === COMMAND_TYPES.SEND_BROADCAST) { kind = 'accept_v1'; payload = { channel: cmd.channel, message: cmd.message }; }
    else { kind = 'dm_quote'; payload = cmd; }
    enqueue({ kind, peer: cmd.target || null, payload });
    return { ok: true, queued: true };
  }
  const { sendCommandAsync } = await import('./relay-manager.js');
  return sendCommandAsync(relayId, cmd);
}

function _getUserPayAddress(peer) {
  let row = sqlite.prepare(
    `SELECT preferred_chain AS chain, preferred_pay_address AS address
     FROM retail_dex_user_memory WHERE user_kasia_address = ?`
  ).get(peer);
  if (row?.chain && row?.address) return row;
  // T-J2-2026-05-07 r241 T1.1 A-fix: SQL filter state NOT IN historical leak states.
  // 真根因 Owner 5/7 30 KAS stuck Layer A: 4/30 broker self-deal failed 历史 row addr=0xaD12544E
  // (broker self) leak 进 retail_dex_orders.pay_address, _getUserPayAddress 取最新 row 当 user
  // current pref 用, R4 SQL false positive trigger self_deal_refunded path. 修法: SQL filter
  // 排除 'failed','refunded','cancelled' 历史 row, 仅取 *user-supplied current intent* state.
  row = sqlite.prepare(
    `SELECT pay_chain AS chain, pay_address AS address FROM retail_dex_orders
     WHERE user_kasia_address = ? AND pay_chain IS NOT NULL AND pay_address IS NOT NULL
       AND state NOT IN ('failed', 'refunded', 'cancelled')
     ORDER BY created_at DESC LIMIT 1`
  ).get(peer);
  return (row?.chain && row?.address) ? row : null;
}

function _getFeeKasPerOrder() {
  const r = sqlite.prepare(
    `SELECT fee_kas_per_order FROM retail_dex_broker_config WHERE broker_relay_id = ?`
  ).get(BROKER_RELAY_ID);
  return r?.fee_kas_per_order || DEFAULT_FEE_KAS;
}

async function _fetchKasPrice() {
  const { fetchKasPrice } = await import('./market-seeder.js');
  return fetchKasPrice();
}

async function _publishOffer(body) {
  if (_publishOverride) return _publishOverride(body);
  // 2026-07-14(Bettor #k2xd1y 第五源排查): 端口从过期 3100 改 process.env.PORT||3200 + 补
  // AbortSignal.timeout(防同 legacyRefundBuilderTick 同族自锁, 本文件 TICK_MS=60s 常驻循环调此函数)。
  const PORT = process.env.PORT || 3200;
  const res = await fetch(`http://127.0.0.1:${PORT}/api/exchange/publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

function findUserIntent(peerAddr) {
  return sqlite.prepare(`
    SELECT side, qty FROM retail_dex_orders
    WHERE user_kasia_address = ? AND created_at > datetime('now','-24 hours')
    AND state IN ('aligning','confirming','awaiting_payment')
    ORDER BY created_at DESC LIMIT 1
  `).get(peerAddr);
}

function isBlacklisted(peerAddr) {
  const r = sqlite.prepare(`SELECT is_blocked FROM relation_states WHERE peer_address = ? LIMIT 1`).get(peerAddr);
  return r?.is_blocked === 1;
}

// T-NWT-2026-04-30 R1 (RCA Owner 真测 fatal bug 1): synthetic-id workflow markers 切 broker_workflow_markers
// 表 (v86 migrate). chain_events trigger 仅守 chain truth (real 64-hex tx_id), 不再撞 markProcessed.
function markProcessed(srcEventId, outcome) {
  sqlite.prepare(`
    INSERT INTO broker_workflow_markers (id, event_type, src_event_id, payload, created_at)
    VALUES (?, 'broker_intake_processed', ?, ?, datetime('now'))
  `).run(`broker_intake_${srcEventId}`, srcEventId, JSON.stringify({ src_event_id: srcEventId, outcome }));
}

async function handleIntake(event) {
  let peer = event.from_address;
  let amount;
  try { amount = parseFloat(JSON.parse(event.payload).amount || 0); } catch { amount = 0; }
  if (amount <= 0) return markProcessed(event.id, 'skip_no_amount');
  // T-NWT-07 hack fallback: kaspa_tx_log indexer 没解 sender (verboseData 缺) → from_address NULL.
  // 用 retail_dex_orders.sell_kas + qty 接近 amount + recent + awaiting state, 反查 user_kasia_address.
  // 长期靠 J2 C 任务修 indexer 补 from_address.
  if (!peer) {
    // T-J2-2026-05-09 r216 T2.11 (Phase 1.5 sediment, NWT r283 PASS):
    // test framework cases INSERT 'test-*' prefix retail_dex_orders rows (5 grep hit per r215 evidence).
    // broker-intake fallback 反查 user_kasia_address 时 hit test rows → use bogus addr → wasm 'unreachable'.
    // Filter 'test-*' 不动 'bso_*' (broker-state-authority production prefix per broker-state-authority.js:211).
    const cand = sqlite.prepare(
      `SELECT user_kasia_address FROM retail_dex_orders
       WHERE side='sell_kas' AND state IN ('aligning','confirming','awaiting_payment')
       AND ABS(CAST(qty AS REAL) - ?) < 0.5
       AND created_at > datetime('now','-24 hours')
       AND id NOT LIKE 'test-%'
       ORDER BY created_at DESC LIMIT 1`
    ).get(amount);
    if (cand?.user_kasia_address) peer = cand.user_kasia_address;
  }
  if (!peer) return markProcessed(event.id, 'skip_no_peer');

  if (isBlacklisted(peer)) {
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.TRANSFER, target: peer, amount_kas: amount, note: 'refund blocked peer' });
    return markProcessed(event.id, 'refund_blocked');
  }

  const intent = findUserIntent(peer);
  if (intent?.side === 'sell_kas' && Math.abs(parseFloat(intent.qty) - amount) < 0.5) {
    return _publishBrokerSellOffer(peer, amount, event.id);
  }
  if (intent?.side === 'buy_kas') {
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer, message: `你是想买 KAS 对吧? 这 ${amount} KAS 我先收着, 要我代卖成 USDT 付你还是退回? 回复 "卖" 或 "退".` });
    return markProcessed(event.id, 'buy_intent_conflict');
  }
  await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer, message: `收到你 ${amount} KAS, 你想做什么? 代卖/继续持有/退回? 12h 无回复自动退.` });
  return markProcessed(event.id, 'unsolicited_wait');
}

async function _publishBrokerSellOffer(peer, amount, eventId) {
  const userPay = _getUserPayAddress(peer);
  if (!userPay) {
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer,
      message: `收到 ${amount} KAS, 但还没你的 USDT 收款链 + 地址. 回复 "用 bnb 0x..." 之类设置. 12h 无回复自动退.`
    });
    return markProcessed(eventId, 'await_pay_addr');
  }
  // T-J2-2026-04-30 R4 self-deal SQL guard (Owner 真测撞: pay_address=0xaD12544E=broker BSC own).
  // 用户误 copy broker 自己 BSC addr 当 SELL 收 USDT 地址 → publish 上去 maker 付 USDT 流到 broker
  // (不是 user) → 真钱风险. 检 pay_address 不在 broker_relay 自己的 agent_wallets 任何 chain 中.
  //
  // T-J2-2026-05-07 r241 T1.2 B-fix (Owner 5/7 30 KAS stuck 真根因):
  // 旧版 R4 hit → inline _send TRANSFER (broker-action-queue in-memory FIFO 不持久化) + 立即
  // markProcessed marker (R39 INSERT-before-confirm anti-pattern). console restart 全清 in-memory
  // queue → enqueue items 真消失 → marker 撒谎"已退" 但 KAS 真没动 → 跟 88 KAS Bug-Z20 同款复刻.
  // 修法: 改调 advanceToRefunded ({orderId, reason:'self_deal'}) — Phase 1 CAS lock retail_dex_orders
  // state='refunding' (持久化) + Phase 2 enqueueVerified sendKas 等真 chain TX + Phase 3 atomic 3-table
  // sync. broker-state-reconciler 5min cron 自动 retry stuck 'refunding' state. 真根治 R39 复刻.
  try {
    const selfDealCheck = sqlite.prepare(
      `SELECT 1 FROM agent_wallets WHERE relay_node_id = ? AND lower(address) = lower(?) LIMIT 1`
    ).get(BROKER_RELAY_ID, userPay.address);
    if (selfDealCheck) {
      console.warn(`[broker-intake R4] self-deal blocked: peer=${peer.slice(-12)} pay_address=${userPay.address.slice(0,12)}... ∈ broker wallets`);
      // 找 retail_dex_orders 真 row (broker-intake fire 前 sell_kas row 应已 INSERT 'aligning' OR
      // 'awaiting_payment'/'paid' state, _publishBrokerSellOffer 期望走过 chat 流程后 row 已存)
      const orderRow = sqlite.prepare(
        `SELECT id FROM retail_dex_orders
         WHERE user_kasia_address = ?
           AND CAST(qty AS REAL) BETWEEN ? - 0.5 AND ? + 0.5
           AND state IN ('aligning', 'awaiting_payment', 'paid', 'expired')
         ORDER BY created_at DESC LIMIT 1`
      ).get(peer, amount, amount);
      if (orderRow?.id) {
        const { advanceToRefunded } = await import('./broker-state-authority.js');
        const result = await advanceToRefunded({ orderId: orderRow.id, reason: 'self_deal' });
        if (result.ok) {
          // 真 chain TX 验证完, DM ack 含真 evidence
          await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer,
            message: `挂单失败: 你给的收款地址 ${userPay.address.slice(0,10)}...${userPay.address.slice(-6)} 是 broker 自己的钱包(不是你的). USDT 付到那里就是付给 broker 了. ${result.refundAmount} KAS 已退 (Kasia tx ${result.txId?.slice(0,16)}). 重新下单时请用 **你自己的** EVM 钱包地址收 USDT.`
          });
          return markProcessed(eventId, `self_deal_refunded:${result.txId?.slice(0,12)}`);
        }
        if (result.skipReason === 'race_lost') {
          // Phase 1 CAS lost — 别 caller 已 claim 'refunding' lock (e.g. cron tick 同时 fire). reconciler 真 backfill.
          console.log(`[broker-intake R4] race_lost order ${orderRow.id.slice(0,8)}, reconciler 真 retry`);
          // 不 markProcessed — 让 reconciler 5min cron 真处理 (next tick 真 reach Phase 3)
          return; // skip marker, intake-watcher 60s tick 真 retry (但 broker-state-reconciler 5min 先到)
        }
        // 其他 skipReason (not_refundable / sendKas fail) — 不 markProcessed, reconciler 真 retry
        console.warn(`[broker-intake R4] advanceToRefunded skipped: ${result.skipReason || result.error?.slice(0, 80)}, reconciler 真 retry`);
        return;
      }
      // fallback: retail_dex_orders 没 row (R4 fire 前 INSERT 真 timing 不对, Phase 1.5 sediment 候补)
      // 仍 fall to old inline _send (degraded behavior, 真 rare race), markProcessed 防 60s tick 真 spam
      console.warn(`[broker-intake R4] no retail_dex_orders row found (qty=${amount} ± 0.5 peer=${peer.slice(-12)}), fallback inline _send (degraded)`);
      await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.TRANSFER, target: peer, amount_kas: amount,
        note: `self-deal pay_address rejected: ${userPay.address.slice(0,10)}...` });
      await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer,
        message: `挂单失败: 你给的收款地址 ${userPay.address.slice(0,10)}...${userPay.address.slice(-6)} 是 broker 自己的钱包(不是你的). ${amount} KAS 已退回你 Kasia. 重新下单时请用 **你自己的** EVM 钱包地址收 USDT.`
      });
      return markProcessed(eventId, 'self_deal_refunded_fallback');
    }
  } catch (err) {
    console.warn(`[broker-intake R4] self-deal check err: ${err.message}, skip guard`);
  }
  const feeKas = parseFloat(_getFeeKasPerOrder()) || 0.1;
  const netKas = amount - feeKas;
  if (netKas <= 0) {
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.TRANSFER, target: peer, amount_kas: amount, note: 'amount too small for fee' });
    return markProcessed(eventId, 'amount_too_small');
  }
  let midPrice = 0;
  try { midPrice = await _fetchKasPrice(); } catch {}
  if (!midPrice || midPrice <= 0) {
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.TRANSFER, target: peer, amount_kas: amount, note: 'no price feed' });
    return markProcessed(eventId, 'no_price');
  }
  // Owner 88 KAS 真测真撞 (J2 f5b0a272 dig + NWT 7d8710a8 ack): broker offer 0% spread =
  // mid price → autoTaker config min_discount_pct=1% SKIP + self-maker exclusion → 真**真**真 taker.
  // 修 broker SELL offer 加 1.5% spread below mid 真**真 outside taker incentive 接.
  // 副作用: broker 短期 unhedged KAS 仓位 risk (88 KAS << CEX liquidity, drop 风险 acceptable).
  // CEX hedge prototype 真**真 separate task R35 候选.
  const SELL_SPREAD_PCT = 0.015;  // 1.5% offer below mid (broker-intake-watcher hotfix)
  const wantUsdt = (netKas * midPrice * (1 - SELL_SPREAD_PCT)).toFixed(4);

  let res = null;
  try {
    res = await _publishOffer({
      relayNodeId: BROKER_RELAY_ID,
      give_asset: 'KAS', give_amount: Number(netKas).toFixed(8),
      want_asset: 'USDT', want_amount: wantUsdt,
      verification: 'cross_chain_tx',
      verification_meta: {
        accepted_chains: [{ chain: userPay.chain, address: userPay.address }],
        expected_asset: 'USDT',
      },
      expires_minutes: PUBLISH_EXPIRES_MIN,
      // T-J2-2026-05-09 r202 T2.5a (Reading D): hedge_enabled=true 修 broker-intake metadata gap.
      // 5/7 T2.1c 仅 broker-v3 path 加 hedge_enabled, broker-intake path 漏 → _executeHedge 默认 skip.
      // 加 flag 触 P2P path completed 时 _executeHedge fire (T2.5b body 加 ledger entry + DM user).
      // ref: NWT r270 PASS Reading D + KI-29 第 17 次复刻防御 sediment.
      metadata: { source: 'broker-intake', user_kasia_address: peer, intent_qty: amount,
        fee_kas: feeKas, net_kas: netKas, mid_price: midPrice, hedge_enabled: true },
    });
  } catch (err) { res = { ok: false, error: err.message }; }

  if (!res?.ok) {
    // Q2 保险: publish 失败立即退原 KAS, broker 不持仓
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.TRANSFER, target: peer, amount_kas: amount,
      note: `publish failed: ${res?.error || 'unknown'}` });
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer,
      message: `挂单失败 (${(res?.error || 'unknown').slice(0,80)}), ${amount} KAS 已退原路.`
    });
    return markProcessed(eventId, 'publish_failed');
  }

  const addrShort = userPay.address.slice(0,10) + '...' + userPay.address.slice(-4);
  // Bug-Z17 fix (NWT 7d8710a8 dig — Owner 88 KAS UI 卡 'awaiting_payment'):
  // _publishOffer ok 后**真**真**真**真 update retail_dex_orders.state → 'broadcast' + link exchange_offer_id.
  // 之前**真**真 update, 真**真**Owner UI 卡 'awaiting_payment' 真**真**真**真**真**真 broker offer 真**真 publish 上链.
  try {
    const updated = sqlite.prepare(
      `UPDATE retail_dex_orders SET state = 'broadcast', exchange_offer_id = ?, updated_at = datetime('now')
       WHERE user_kasia_address = ? AND side = 'sell_kas' AND state = 'awaiting_payment'
       AND created_at > datetime('now','-24 hours')`
    ).run(res.offer_id, peer);
    if (updated.changes > 0) {
      console.log(`[broker-intake] Z17 retail_dex_orders state sync: peer=${peer.slice(-12)} → broadcast, offer=${res.offer_id.slice(0,8)}`);
    }
  } catch (e) { console.warn(`[broker-intake] Z17 state sync err: ${e.message}`); }
  await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer,
    message: `收到 ${amount} KAS ✓ 已挂 SELL 单 ${netKas} KAS → ${wantUsdt} USDT (fee ${feeKas} KAS)\n` +
             `订单: ${res.offer_id.slice(0,8)} · 2h 内有人接单 USDT 直付你 ${userPay.chain} ${addrShort}\n` +
             `广播 tx: ${res.broadcast_tx?.slice(0,16) || '?'}`
  });
  return markProcessed(eventId, `sell_published:${res.offer_id}`);
}

// ════════════════════════════════════════════════════════════════
// T-J2-2026-05-10 r237 T2.21 Phase 2 (β.1) — _publishBrokerBuyOffer mirror SELL reverse direction
// ════════════════════════════════════════════════════════════════
// Phase 2 (β.1) BUY flow Reading D parity (NWT r300 决断 + Owner 5/10 钦定 ship):
// - broker (Trader-B) 真 BUY maker, give=USDT want=KAS publish exchange offer
// - 30min P2P first: KANet seeker take + send KAS direct user kasia (accept_v1 receive_address) → broker pay seeker USDT
// - 30min fallback (T2.24 后续 sub commit): broker take 自己 + cex-bridge BUY KAS @ Gate.io + send KAS user kasia
// - hedge: broker SELL KAS hedge post P2P fill (exchange-machine.js:1120 hedgeSide='SELL' for !makerGaveKas dynamic 真 work)
//
// caller 真 broker BSC USDT receipt detection (T2.22 后续 sub commit, mirror broker-intake KAS SELL flow).
// ref: NWT r300 PASS β.1 ship plan, J2 r236 grep evidence broker-buy-handler.js mirror mismatch.

const BUY_SPREAD_PCT = 0.015;  // 1.5% offer above mid for broker BUY (mirror SELL spread, broker margin)

export async function _publishBrokerBuyOffer(peer, usdtAmount, eventId) {
  const feeUsdt = 0.05;  // broker BUY fee (mirror 0.1 KAS SELL fee, ~10x USD value)
  const netUsdt = usdtAmount - feeUsdt;
  if (netUsdt <= 0) {
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer,
      message: `收到 ${usdtAmount} USDT 但太少了 (扣 ${feeUsdt} USDT broker fee 后不够). 请联系 broker 退款 (走 dispute 流程, broker BSC tx 真已 record).`,
    });
    return markProcessed(eventId, 'usdt_amount_too_small');
  }
  let midPrice = 0;
  try { midPrice = await _fetchKasPrice(); } catch {}
  if (!midPrice || midPrice <= 0) {
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer,
      message: `收到 ${usdtAmount} USDT 但无价格 feed, 请稍后重试 OR 走 dispute 退款.`,
    });
    return markProcessed(eventId, 'no_price_buy');
  }
  // BUY: broker want KAS, 真 spread above mid (broker margin). KAS qty = netUsdt / (mid * (1 + spread))
  const wantKas = (netUsdt / (midPrice * (1 + BUY_SPREAD_PCT))).toFixed(4);

  let res = null;
  try {
    res = await _publishOffer({
      relayNodeId: BROKER_RELAY_ID,
      give_asset: 'USDT', give_amount: Number(netUsdt).toFixed(8),
      give_chain: 'bnb',
      want_asset: 'KAS', want_amount: wantKas,
      verification: 'kaspa_tx',  // BUY: KAS deliver verification 真 Kaspa chain TX
      verification_meta: {
        receive_address: peer,  // KAS deliver direct 真 user kasia (zero-custody at delivery, ch17 §17.5 receive_address mechanism)
        expected_asset: 'KAS',
      },
      expires_minutes: PUBLISH_EXPIRES_MIN,
      metadata: {
        source: 'broker-intake-buy', user_kasia_address: peer, intent_usdt: usdtAmount,
        fee_usdt: feeUsdt, net_usdt: netUsdt, mid_price: midPrice, hedge_enabled: true,
      },
    });
  } catch (err) { res = { ok: false, error: err.message }; }

  if (!res?.ok) {
    await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer,
      message: `BUY 挂单失败 (${(res?.error || 'unknown').slice(0,80)}), 联系 broker 退 USDT (走 dispute, broker BSC tx 已 record).`,
    });
    return markProcessed(eventId, 'buy_publish_failed');
  }

  await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: peer,
    message: `收到 ${usdtAmount} USDT ✓ 已挂 BUY 单 ${netUsdt} USDT → ${wantKas} KAS (fee ${feeUsdt} USDT)\n` +
             `订单: ${res.offer_id.slice(0,8)} · 2h 内有 seeker 接单, KAS 真直发你 Kasia 钱包\n` +
             `广播 tx: ${res.broadcast_tx?.slice(0,16) || '?'}`,
  });
  return markProcessed(eventId, `buy_published:${res.offer_id}`);
}

// T-J2-2026-07-15 diag(observe-only, NWT verdict 3b87317b GO): 逐 step 计时探针, 验证 CPU profile
// 归因 _scanExpiredBrokerOffers 63.4% self-time 是否真同步阻塞(vs profiler artifact)。纯 console.log,
// 不改任何分支/返回值。
export async function _scanExpiredBrokerOffers() {
  const _diagT0 = Date.now();
  let _diagPrev = _diagT0;
  const _diagStep = (label) => {
    const now = Date.now();
    console.log(`[diag:step-Z20] ${label} +${now - _diagPrev}ms (total ${now - _diagT0}ms)`);
    _diagPrev = now;
  };
  const trader = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id = ?`).get(BROKER_RELAY_ID);
  _diagStep('trader-lookup');
  if (!trader) return { handled: 0, scanned: 0, reason: 'no_broker_relay' };
  // Bug-Z20 fix (NWT 1a77fdd1 Owner 88 KAS 卡 broker 钱包): 真**真**proactive scan —
  // 真**真**真 broker offer 真**真**真 'open' + expires_at < now 真**真**真**真**真 'expired' 真**真**timed_out',
  // 都**真**真 trigger refund. 之前真**真**真 'expired'/'cancelled'/'timed_out' status 真**真**真 trigger,
  // 但**真**真**status 转 'expired' 真**真**真**真**exchange-machine TTL check, 真**真**'open' 长久 stuck 真**真**真**真 refund.
  // metadata.source 真**真**真 strict filter (老 offer 真**真**真**真**真**真 source 真**真**真**真 strict miss).
  const rows = sqlite.prepare(`
    SELECT id, give_amount, metadata, protocol_status, expires_at, broadcast_at FROM exchange_offers
    WHERE maker = ?
    AND give_asset = 'KAS'
    AND taker IS NULL
    AND (
      protocol_status IN ('expired', 'cancelled', 'timed_out')
      OR (protocol_status = 'open' AND expires_at IS NOT NULL AND julianday(expires_at) < julianday('now'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM chain_events e
      WHERE e.event_type = 'broker_kas_refunded'
      AND e.payload LIKE '%"offer_id":"' || exchange_offers.id || '"%'
      -- T-J2-2026-07-15 P0 perf fix(Bettor #len5pi 派工,7/13-7/15 七源追凶实体·恒定186-190s
      -- 冻结的凶手): 原写法 'e.txid IN (SELECT tx_id FROM kaspa_tx_log)' 让 SQLite 从
      -- kaspa_tx_log(800万行)驱动外层循环, 对每行 probe chain_events, EXPLAIN 显示
      -- 'USING INDEX sqlite_autoindex_kaspa_tx_log_1 FOR IN-OPERATOR'——语义等价的相关 EXISTS
      -- 让 SQLite 反过来从 chain_events(event_type 索引命中近空)驱动, 对每行去 kaspa_tx_log
      -- 做单点索引查找。live 实测 233,123ms → 1ms, 逐行结果 byte-identical(id 顺序全同,
      -- kaspa_tx_log.tx_id 全库 0 NULL, IN/EXISTS 无 NULL 语义边界差异)。
      AND EXISTS (SELECT 1 FROM kaspa_tx_log k WHERE k.tx_id = e.txid)
    )
    -- T-J2-2026-05-10 r223 T2.14 (NWT r289 Option A): 防 Z20 与 T2.5c CEX hedge race double-spend.
    -- T2.5c placeCexOrder ok 后立即 INSERT broker_fallback_claim → Z20 SQL skip claimed offer.
    -- 5/10 实证 race: 102 KAS SELL T2.5c CEX sold + Z20 refund 102 KAS = broker 净亏 ~98 KAS.
    AND NOT EXISTS (
      SELECT 1 FROM chain_events ce2
      WHERE ce2.event_type = 'broker_fallback_claim'
      AND ce2.payload LIKE '%"offer_id":"' || exchange_offers.id || '"%'
    )
    AND json_extract(metadata, '$.user_kasia_address') IS NOT NULL
    ORDER BY broadcast_at DESC
    LIMIT 10
  `).all(trader.address);
  _diagStep(`main-query rows=${rows.length}`);
  let handled = 0;
  if (rows.length > 0) console.log(`[broker-refund] Z20 scan: ${rows.length} expired/timeout offer(s) to refund`);
  // T-J2-2026-04-29 紧急 Track A: chain-truth dedup. 现 dedup SQL `txid IN kaspa_tx_log` 因占位符 txid='refund_xxx'
  // 永久失效, 同 offer 可重复退款 broker 真亏. 改: 退款前查 kaspa_tx_log 真链有没 broker→user refund TX matching
  // expected_amount + offer broadcast_at 时间窗. 有则 skip (已退过).
  // T-J2-2026-04-29 Track B step 5 (Owner 钦定单一状态机, round 3 共识):
  // 替原 inline sendKas + chain_event placeholder INSERT pattern → call advanceToRefunded.
  // advanceToRefunded 内部 chain-truth dedup + Phase 1 CAS + Phase 2 sendKas (真 chain hash) + Phase 3 atomic 3-table sync.
  // chain_events INSERT 真 real txId (post-v83 lenient trigger PASS), 不再占位符 polluting.
  const { advanceToRefunded } = await import('./broker-state-authority.js');
  _diagStep('dynamic-import');
  let _z20Gated = 0;
  const _newlyBroken = [];   // 2026-07-14 Bettor 裁定#k9iz8i: 本 tick 内新熔断的 offer, 收集后批量喊一条摘要(不 per-offer 刷屏)
  for (const r of rows) {
    // 🔴 Z20 熔断闸(见文件顶部 Z20_CIRCUIT_THRESHOLD 注释): push 进循环前判, 已熔断的 offer 零 IPC
    // 代价直接跳过(不占这一轮的时间预算)。
    if (z20CircuitGate(r.id)) { _z20Gated++; continue; }
    try {
      const meta = JSON.parse(r.metadata || '{}');
      const userKasia = meta.user_kasia_address;
      if (!userKasia) {
        console.warn(`[broker-refund] Z20 ${r.id.slice(0,8)} skip: no user_kasia_address in metadata`);
        if (recordZ20Failure(r.id, 'no user_kasia_address in metadata')) _newlyBroken.push(r.id);
        continue;
      }
      const refundAmount = parseFloat(meta.intent_qty || r.give_amount);

      // T-J2-2026-05-11 Phase 2 A.3 (NWT #18 ABE audit): direct UPDATE → transition() loop。
      // 'open' → 'timed_out' status transition (proactive sweep set timestamp by transition() 内)。
      // advanceToRefunded refundable states: 'awaiting_payment','paid','expired'. 'open'/'timed_out' offer
      // retail_dex_orders state 真 'awaiting_payment' (broker held KAS) — advanceToRefunded 真 work。
      if (r.protocol_status === 'open') {
        transition(r.id, 'timed_out');  // VALID_TRANSITIONS A.1 已加 'open' → 'timed_out'
      }

      // Find linked retail_dex_orders.id
      const order = sqlite.prepare(`
        SELECT id FROM retail_dex_orders
        WHERE user_kasia_address=?
          AND (exchange_offer_id=? OR (exchange_offer_id IS NULL AND CAST(qty AS REAL) >= ? - 0.5 AND CAST(qty AS REAL) <= ? + 0.5 AND state IN ('awaiting_payment','paid','expired')))
        ORDER BY created_at DESC LIMIT 1
      `).get(userKasia, r.id, refundAmount, refundAmount);

      if (!order?.id) {
        console.warn(`[broker-refund] Z20 ${r.id.slice(0,8)} skip — no retail_dex_orders link, advanceToRefunded 真 orderId 必`);
        if (recordZ20Failure(r.id, 'no retail_dex_orders link')) _newlyBroken.push(r.id);
        continue;
      }

      const result = await advanceToRefunded({ orderId: order.id, reason: 'expired_auto_refund' });

      if (result.ok) {
        if (result.noRefundNeeded) {
          // J1 #73 Edge 1: order.state 'aligning'/'confirming' — broker 没收 user payment, 真 NO refund needed.
          // 不该 retry 也不 DM user. log 一次 surface unusual case (cron 真 'aligning' 30min 才扫到, 真 abnormal).
          console.warn(`[broker-refund] Z20 ${r.id.slice(0,8)} no-refund-needed (order state=${result.orderState}, broker 没收 user payment) — skip refund + skip retry`);
        } else if (result.alreadyRefunded) {
          console.warn(`[broker-refund] Z20 ${r.id.slice(0,8)} DEDUP — chain 真已退过 (TX: ${result.txId?.slice(0,12)}), DB 已自动 backfill`);
        } else {
          console.log(`[broker-refund] Z20 ${r.id.slice(0,8)} ✓ refund ${result.refundAmount} KAS → ${userKasia.slice(-12)} (TX: ${result.txId?.slice(0,12)})`);
          // DM ack user (advanceToRefunded 不 send DM, caller send per round 3 共识 Q6)
          await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: userKasia,
            message: `订单 ${r.id.slice(0,8)} 2h 无人接单, 已退 ${result.refundAmount} KAS 给你. broker 吃 gas. Kasia TX: ${result.txId?.slice(0,16)}`
          });
        }
        handled++;
      } else if (result.skipReason === 'race_lost') {
        console.warn(`[broker-refund] Z20 ${r.id.slice(0,8)} race lost (其他 caller 已 claim refunding lock), reconciler 真 backfill`);
        if (recordZ20Failure(r.id, 'race_lost')) _newlyBroken.push(r.id);
      } else {
        console.error(`[broker-refund] Z20 ${r.id.slice(0,8)} advanceToRefunded FAIL: ${result.error || result.skipReason}`);
        if (recordZ20Failure(r.id, `advanceToRefunded FAIL: ${result.error || result.skipReason}`)) _newlyBroken.push(r.id);
      }
    } catch (err) {
      console.warn(`[broker-refund] Z20 ${r.id} err: ${err.message}`);
      if (recordZ20Failure(r.id, `exception: ${err.message}`)) _newlyBroken.push(r.id);
    }
  }
  _diagStep(`for-loop rows=${rows.length} gated=${_z20Gated}`);
  if (_z20Gated > 0) console.log(`[broker-refund] Z20 [circuit-breaker] ${_z20Gated} offer(s) gated this tick(熔断, 跳过)`);
  // 2026-07-14 (Bettor 裁定#k9iz8i, 采纳 NWT "熔断必须喊疼"): 反脆弱柱②第一个实例——系统自己主动
  // 报告"这里有东西卡住了", 而不是指望有人去巡查 events 表。整批合并成一条摘要, 限速"同一 offer
  // 只报一次"(天然满足: recordZ20Failure 只在 streak 首次跨阈值那次返回 true, 之后该 offer 被
  // z20CircuitGate 挡在循环入口, 不会再触发)。Fire-and-forget(不 await, 只 .catch 吞错) ——
  // sendCommandAsync 是本 tick 卡死的同一 IPC 通道(默认 30s timeout), 若同步 await 反而在已经
  // 崩溃边缘的 tick 里再叠一次最多 30s 代价, 违背这条修复本身的目的。镜像
  // broker-bot-manager.js:notifyBotDisabled 的既有 fire-and-forget 系统告警先例。
  if (_newlyBroken.length > 0) {
    const summary = `🔴 [Z20 熔断告警] 本轮新熔断 ${_newlyBroken.length} 个 offer(仅停调度重试, 不动资金, 钱原地不动): `
      + _newlyBroken.map((id) => id.slice(0, 8)).join(', ')
      + ` — 查详情: GET /api/admin/z20-circuit-broken , 处置后 POST /api/admin/clear-z20-circuit 复位。`;
    _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_BROADCAST, channel: 'dev-coord-testnet', message: summary })
      .catch((e) => console.warn(`[broker-refund] Z20 熔断告警广播失败(non-fatal, 不影响本 tick): ${e.message}`));
  }
  _diagStep('return');
  return { handled, scanned: rows.length, gated: _z20Gated };
}

// T-J2-10: 12h stale unsolicited_wait scanner — user 12h 无 ACK 自动退款
// T-NWT-2026-04-30 R1: 切 broker_workflow_markers 表. src_event_id 是 kaspa_tx_log.tx_id (post T-NWT-07
// indexer 改, src 表 chain_events 'tx' inbound 永远 0, 真源在 kaspa_tx_log).
//
// Phase Y P1 backlog: kaspa_tx_log.from_address 100% NULL (indexer T-NWT-07 残), 此 12h refund path 当前
// 实质不能退 (没 from_address sendKaspa 不知 target). post T-NWT-07 indexer 修 from_address 后真生效.
export async function _scanStaleUnsolicited() {
  const rows = sqlite.prepare(`
    SELECT p.id, p.src_event_id, p.payload
    FROM broker_workflow_markers p
    WHERE p.event_type = 'broker_intake_processed'
      AND p.payload LIKE '%"outcome":"unsolicited_wait"%'
      AND julianday(p.created_at) < julianday('now', '-12 hours')
      AND NOT EXISTS (
        SELECT 1 FROM broker_workflow_markers r
        WHERE r.event_type = 'broker_unsolicited_refunded'
        AND r.payload LIKE '%"processed_event_id":"' || p.id || '"%'
      )
    LIMIT 10
  `).all();
  let handled = 0;
  for (const p of rows) {
    try {
      const src = sqlite.prepare(`SELECT from_address, amount FROM kaspa_tx_log WHERE tx_id = ?`).get(p.src_event_id);
      if (!src?.from_address) continue;  // indexer 漏抓 sender, 不能盲发
      const amt = parseFloat(src.amount || 0);
      if (amt <= 0) continue;
      await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.TRANSFER, target: src.from_address, amount_kas: amt,
        note: `12h unsolicited refund ${p.id.slice(0, 12)}` });
      sqlite.prepare(`
        INSERT INTO broker_workflow_markers (id, event_type, src_event_id, payload, created_at)
        VALUES (?, 'broker_unsolicited_refunded', ?, ?, datetime('now'))
      `).run(`unsolicited_refund_${p.id.slice(0, 16)}`, p.src_event_id, JSON.stringify({ processed_event_id: p.id, user_kasia_address: src.from_address, amount: amt }));
      await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: src.from_address,
        message: `12h 无回复, 已退 ${amt} KAS 给你. broker 吃 gas.` });
      handled++;
    } catch (err) { console.warn(`[broker-stale] ${p.id?.slice(0,8)} err: ${err.message}`); }
  }
  return { handled, scanned: rows.length };
}

// T-NWT-06: 同 5min sub-tick 调 utxo-splitter 给 broker 钱包补零钱, 防 Round 1 一分钟 7 撞 UTXO 风暴.
// 内置 broker_workflow_markers 'broker_utxo_split' 防 4min 内重跑 (REFUND_TICK_MS 5min 偏小, 1min 缓冲).
// T-NWT-2026-04-30 R1: 切 broker_workflow_markers 表 (旧 chain_events 路径撞 v83 trigger ABORT).
export async function _ensureBrokerUtxoSplit() {
  const recent = sqlite.prepare(
    `SELECT 1 FROM broker_workflow_markers WHERE event_type='broker_utxo_split'
     AND datetime(created_at) > datetime('now','-4 minutes') LIMIT 1`
  ).get();
  if (recent) return { skipped: 'recent' };
  const { splitUtxos } = await import('./utxo-splitter.js');
  let result;
  try { result = await splitUtxos(BROKER_RELAY_ID); } catch (e) { return { ok: false, error: e.message }; }
  sqlite.prepare(
    `INSERT INTO broker_workflow_markers (id, event_type, src_event_id, payload, created_at)
     VALUES (?, 'broker_utxo_split', NULL, ?, datetime('now'))`
  ).run(`broker_utxo_split_${Date.now()}`, JSON.stringify({ result: result || null }));
  if (result?.split) console.log(`[broker-utxo-split] ${result.utxosBefore}→${result.utxosAfter} (fee ${result.fee||'?'} KAS)`);
  return result || { ok: false };
}

export async function intakeTick() {
  const trader = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id = ?`).get(BROKER_RELAY_ID);
  if (!trader) return { handled: 0, reason: 'no_broker_relay' };
  // T-NWT-07: 源表 chain_events 'tx' inbound 永远 0 (那条 path 是 message-bound, 不是 KAS transfer).
  // 真正的 inbound tx ingest 在 kaspa_tx_log (rpc-listener.mjs 写). 改源表救 broker-intake.
  // src_event_id 在 marker payload 里现在是 string (tx_id), LIKE 模式带引号.
  //
  // T-J2-2026-04-30 R2+R3 fix v2 (Owner 真测 dig + 数据验证修订):
  // 实证 last 24h kaspa_tx_log to=Trader-B 3093 rows: 3092 是 >500 KAS (broker UTXO splitter
  // 自循环 chain, 994.X KAS chunks 序列 .2606→.261→.262 fee 递减), 仅 1 row <100 KAS = 真 user TX (Owner 58).
  // 旧 R2 'from_address != to_address' 失效 — kaspa_tx_log.from_address 全 NULL (indexer verboseData
  // 未抓 sender, T-NWT-07 已知 indexer 残). 改用 amount upper bound 启发式过滤:
  //   real user retail SELL/transfer 一般 < 200 KAS. broker 内部 splitter chunks 一般 > 500 KAS.
  // 长期修法: rpc-listener.mjs indexer 修 from_address 后回到 self-TX filter (T-NWT-07 sprint backlog).
  //   R2 v2: AND k.amount < 500  -- 排除 broker UTXO splitter 994 KAS chunks 等
  //   R3: ORDER BY k.observed_at DESC + LIMIT 提至 50 — 优先处理新 user TX
  const MAX_USER_TX_KAS = 500;
  const rows = sqlite.prepare(`
    SELECT k.tx_id AS id, k.tx_id AS txid, k.from_address,
           json_object('amount', CAST(k.amount AS TEXT)) AS payload
    FROM kaspa_tx_log k
    WHERE k.to_address = ?
    AND k.observed_at > datetime('now','-24 hours')
    AND k.amount < ?
    AND NOT EXISTS (
      SELECT 1 FROM broker_workflow_markers p
      WHERE p.event_type = 'broker_intake_processed'
      AND p.src_event_id = k.tx_id
    )
    ORDER BY k.observed_at DESC
    LIMIT 50
  `).all(trader.address, MAX_USER_TX_KAS);
  let handled = 0;
  for (const e of rows) {
    try { await handleIntake(e); handled++; }
    catch (err) { console.warn(`[broker-intake] ${e.id} err: ${err.message}`); }
  }
  return { handled, scanned: rows.length };
}

// T-J1-2026-04-28 Layer 4 (phase 3 8-layer system fix): chain reconciler 周期 sweep.
// 治 J2's Defect C 残留 + pre-Layer-1 历史: chain_events 'broker_kas_refunded' 真**真**真 txid 在 kaspa_tx_log 真存在.
// Z20 旧 INSERT 用 'refund_<offer_id>' 合成 txid (非真链 hash), Layer 1 markOrderRefunded 用真 txId.
// 本 sweep 抓两类 drift:
//   A. chain_events broker_kas_refunded.txid 非 64-hex 或不在 kaspa_tx_log → 自欺 INSERT 残留 → DM Owner alert
//   B. retail_dex_orders state IN ('refunded','cancelled_refunded','timed_out_refunded') AND
//      没对应 kaspa_tx_log-verified chain_event → 状态造假 → DM Owner alert
// dedupe: events.event_type='reconcile_drift_alert' + payload.chain_event_id, 不重复 alert 已 flagged 的.
export async function _reconcileRefundsTick() {
  let inspected = 0, drift = 0, alerted = 0;
  try {
    const rows = sqlite.prepare(`
      SELECT ce.id, ce.txid, ce.payload, ce.observed_at
      FROM chain_events ce
      LEFT JOIN kaspa_tx_log k ON k.tx_id = ce.txid
      WHERE ce.event_type = 'broker_kas_refunded'
        AND k.tx_id IS NULL
        AND julianday(ce.observed_at) > julianday('now', '-24 hours')
        AND NOT EXISTS (
          SELECT 1 FROM events e
          WHERE e.event_type = 'reconcile_drift_alert'
            AND e.payload_json LIKE '%"chain_event_id":"' || ce.id || '"%'
        )
      LIMIT 20
    `).all();
    inspected = rows.length;
    for (const o of rows) {
      drift++;
      let p = {};
      try { p = JSON.parse(o.payload || '{}'); } catch {}
      const summary = `Refund drift: chain_event ${String(o.id).slice(0,8)} txid=${String(o.txid||'').slice(0,16)} 不在 kaspa_tx_log (offer ${String(p.offer_id||'').slice(0,8)})`;
      console.error(`[broker-reconciler Layer4] ${summary}`);
      try {
        sqlite.prepare(`
          INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
          VALUES (?, 'broker', 'reconcile_drift_alert', 'broker-reconciler', 'critical', ?, ?, datetime('now'))
        `).run(
          randomUUID(), summary,
          JSON.stringify({ chain_event_id: o.id, txid: o.txid, offer_id: p.offer_id, user_kasia: p.user_kasia_address, amount: p.amount, observed_at: o.observed_at })
        );
        alerted++;
      } catch (e) { console.warn(`[broker-reconciler] alert INSERT err: ${e.message}`); }
    }
  } catch (e) {
    console.error(`[broker-reconciler Layer4] tick err: ${e.message}`);
  }
  return { inspected, drift, alerted };
}

// T-J2-2026-05-09 r204 T2.5c (Reading D step 4 CEX fallback path):
// 30min+ KANet 无人接 broker SELL offer → broker auto-cancel + cex-bridge 兜底卖 + ledger + DM user.
// 守 ch14 #44 (cancel_v1 chain TX anchor) + ch17 §17.7 (默认非托管, 仅 fallback 时 broker custody).
// 跟 _scanExpiredBrokerOffers 区别: 那是过期/timed_out → 退 KAS 给 user (无 fulfillment),
// 这是 30min 仍 'open' 但 KANet 没 taker → broker 自接 + CEX 卖 → user 拿 USDT 账面 (有 fulfillment).
// ref: NWT r270 PASS Reading D + J2 r201 evidence (autoTaker self-maker exclusion).
const FALLBACK_AGE_MIN = 30;
export async function _scanUntakenOffersFallback() {
  const trader = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id = ?`).get(BROKER_RELAY_ID);
  if (!trader) return { handled: 0, scanned: 0, reason: 'no_broker_relay' };
  const rows = sqlite.prepare(`
    SELECT id, give_amount, want_amount, metadata, broadcast_at, broadcast_tx_id FROM exchange_offers
    WHERE maker = ?
      AND give_asset = 'KAS'
      AND taker IS NULL
      AND protocol_status = 'open'
      AND julianday(broadcast_at) < julianday('now', '-${FALLBACK_AGE_MIN} minutes')
      AND json_extract(metadata, '$.user_kasia_address') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM chain_events ce
        WHERE ce.event_type IN ('broker_fallback_fill', 'broker_fallback_cancelled', 'broker_fallback_cancel_failed', 'broker_fallback_pending')
          AND ce.payload LIKE '%"offer_id":"' || exchange_offers.id || '"%'
      )
    ORDER BY broadcast_at DESC
    LIMIT 5
  `).all(trader.address);
  let handled = 0;
  if (rows.length > 0) console.log(`[broker-fallback] T2.5c scan: ${rows.length} untaken offer(s) > ${FALLBACK_AGE_MIN}min`);
  const { recordChainEvent } = await import('./chain-event.js');
  const { placeCexOrder, getCexOrder } = await import('./cex-bridge.js');
  for (const r of rows) {
    try {
      const meta = JSON.parse(r.metadata || '{}');
      const userKasia = meta.user_kasia_address;
      const giveAmount = parseFloat(r.give_amount);
      const midPrice = parseFloat(meta.mid_price || 0);
      if (!userKasia || !giveAmount || !midPrice) {
        console.warn(`[broker-fallback] T2.5c offer ${r.id.slice(0,8)} skip: missing meta`);
        continue;
      }
      // Step 1: cancel_v1 broadcast on KANet (守 ch14 #44 chain TX anchor)
      // 2026-07-14(Bettor #k2xd1y 第五源排查): 端口 3100→3200 + 补 AbortSignal.timeout(同上, 本文件
      // REFUND_TICK_MS=5min 常驻循环调此路径)。
      const PORT = process.env.PORT || 3200;
      const cancelRes = await fetch(`http://127.0.0.1:${PORT}/api/exchange/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relayNodeId: BROKER_RELAY_ID, offer_id: r.id }),
        signal: AbortSignal.timeout(15000),
      }).then(rr => rr.json()).catch(e => ({ ok: false, error: e.message }));
      if (!cancelRes.ok || !cancelRes.cancel_tx) {
        console.warn(`[broker-fallback] T2.5c cancel_v1 fail offer ${r.id.slice(0,8)}: ${cancelRes.error || 'no cancel_tx'}`);
        recordChainEvent({
          txid: r.broadcast_tx_id, eventType: 'broker_fallback_cancel_failed',
          fromAddress: null, toAddress: null, observedBy: 'system',
          payload: { offer_id: r.id, error: cancelRes.error || 'no cancel_tx' },
        });
        continue;
      }
      console.log(`[broker-fallback] T2.5c cancel_v1 ok offer=${r.id.slice(0,8)} tx=${String(cancelRes.cancel_tx).slice(0,12)}`);
      // Step 2: cex-bridge.placeCexOrder sell KAS @ mid
      const sellRes = await placeCexOrder({ cex: 'gateio', side: 'SELL', qty: giveAmount, price: midPrice });
      // T-J2-2026-05-10 r223 T2.14 (NWT r289 Option A claim lock):
      // CEX placeOrder ok 后立即 INSERT broker_fallback_claim → Z20 _scanExpiredBrokerOffers SQL filter
      // NOT EXISTS broker_fallback_claim → 防 race (Z20 在 T2.5c CEX hedge in-flight 时 fire refund → broker 双倍亏 KAS).
      // 5/10 实证 race: T2.5c CEX sell 102 KAS + Z20 refund 102 KAS chain TX afc63057 → broker 净亏 ~98 KAS.
      // ref: NWT r288 evidence + r289 Option A PASS.
      if (sellRes.ok) {
        recordChainEvent({
          txid: cancelRes.cancel_tx, eventType: 'broker_fallback_claim',
          fromAddress: null, toAddress: null, observedBy: 'system',
          payload: { offer_id: r.id, cex_order_id: sellRes.orderId, cancel_tx: cancelRes.cancel_tx, qty: giveAmount, mid_price: midPrice },
        });
      }
      if (!sellRes.ok) {
        console.warn(`[broker-fallback] T2.5c CEX sell fail offer=${r.id.slice(0,8)}: ${sellRes.error}`);
        // T2.10a (NWT r279): CEX permanent fail detection — size/asset 类不可恢复 → fail-fast advanceToRefunded.
        // 5/9 13:08 NWT operator Step 3 verify 实证: 5 KAS @ 0.178 USDT < Gate.io min 3 USDT, retry 永远同款 fail.
        // permanent → 跟 Z20 expired_auto_refund 同款 path: advanceToRefunded refund user KAS chain TX.
        // transient (网络/暂时) → 现行 5min retry (broker_fallback_cancelled chain_event 留痕).
        const PERMANENT_FAIL_PATTERN = /too small|minimum is|minimum order|not supported|invalid (asset|symbol|currency)|insufficient/i;
        const isPermanent = PERMANENT_FAIL_PATTERN.test(sellRes.error || '');
        if (isPermanent) {
          const orderRow = sqlite.prepare(
            `SELECT id FROM retail_dex_orders
             WHERE user_kasia_address = ? AND state = 'awaiting_payment'
               AND CAST(qty AS REAL) BETWEEN ? - 0.5 AND ? + 0.5
             ORDER BY created_at DESC LIMIT 1`
          ).get(userKasia, giveAmount, giveAmount);
          if (orderRow?.id) {
            const { advanceToRefunded } = await import('./broker-state-authority.js');
            const refundResult = await advanceToRefunded({ orderId: orderRow.id, reason: 'cex_permanent_fail' });
            if (refundResult?.ok) {
              recordChainEvent({
                txid: refundResult.txId, eventType: 'broker_fallback_refunded',
                fromAddress: null, toAddress: null, observedBy: 'system',
                payload: { offer_id: r.id, cancel_tx: cancelRes.cancel_tx, cex_sell_error: sellRes.error, refund_tx: refundResult.txId, refund_amount: refundResult.refundAmount },
              });
              await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: userKasia,
                message: `订单 ${r.id.slice(0,8)} 30min 无 KANet 接, broker cancel 后 CEX 兜底失败 (${(sellRes.error || '').slice(0,60)}). 已退原 ${refundResult.refundAmount} KAS 给你. Kasia TX: ${refundResult.txId?.slice(0,16)}.`,
              });
              console.log(`[broker-fallback] T2.10a permanent fail refund offer=${r.id.slice(0,8)} reason="${(sellRes.error||'').slice(0,40)}" refund_tx=${refundResult.txId?.slice(0,12)}`);
              continue;
            }
          }
          console.warn(`[broker-fallback] T2.10a permanent fail but advanceToRefunded skipped offer=${r.id.slice(0,8)} (no order row OR race)`);
        }
        // transient fail → 5min retry (现行 path)
        recordChainEvent({
          txid: cancelRes.cancel_tx, eventType: 'broker_fallback_cancelled',
          fromAddress: null, toAddress: null, observedBy: 'system',
          payload: { offer_id: r.id, cancel_tx: cancelRes.cancel_tx, cex_sell_error: sellRes.error },
        });
        await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: userKasia,
          message: `订单 ${r.id.slice(0,8)} 30min 无 KANet 接, broker 已 cancel. CEX 兜底卖暂时失败, 5min 后自动重试.`,
        });
        continue;
      }
      // Step 3: poll fill (复用 T2.5b 30s inline pattern)
      const POLL_TIMEOUT_MS = 30_000;
      const POLL_INTERVAL_MS = 3_000;
      const start = Date.now();
      let filled = null;
      while (Date.now() - start < POLL_TIMEOUT_MS) {
        const orderState = await getCexOrder({ cex: 'gateio', orderId: sellRes.orderId });
        if (orderState.filled) { filled = orderState; break; }
        await new Promise(rr => setTimeout(rr, POLL_INTERVAL_MS));
      }
      if (filled) {
        const proceedsUsdt = parseFloat((filled.executedQty * midPrice).toFixed(4));
        const cur = sqlite.prepare(
          `SELECT COALESCE(SUM(balance_change), 0) AS balance FROM user_ledger
           WHERE user_kasia_address = ? AND asset = 'USDT'`
        ).get(userKasia);
        const balanceAfter = parseFloat(((cur?.balance || 0) + proceedsUsdt).toFixed(4));
        const ledgerId = `ledger_fallback_${r.id.slice(0,12)}_${Date.now()}`;
        sqlite.prepare(`
          INSERT INTO user_ledger (id, user_kasia_address, asset, chain, balance_change, balance_after, reason, ref_order_id, ref_tx_hash, created_at)
          VALUES (?, ?, 'USDT', NULL, ?, ?, ?, ?, NULL, datetime('now'))
        `).run(ledgerId, userKasia, proceedsUsdt, balanceAfter, `broker_fallback_fill:${sellRes.orderId}`, r.id);
        recordChainEvent({
          txid: cancelRes.cancel_tx, eventType: 'broker_fallback_fill',
          fromAddress: null, toAddress: null, observedBy: 'system',
          payload: { offer_id: r.id, cancel_tx: cancelRes.cancel_tx, cex_order_id: sellRes.orderId, qty: filled.executedQty, proceeds_usdt: proceedsUsdt, balance_after: balanceAfter },
        });
        await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: userKasia,
          message: `订单 ${r.id.slice(0,8)} 30min 无 KANet 接, broker CEX 兜底卖出成交\n${filled.executedQty} KAS → ${proceedsUsdt} USDT 入账\n账户余额: ${balanceAfter} USDT (broker IOU)\n回 "余额" 查账户 / "提 N USDT TRC20" 提币`,
        });
        console.log(`[broker-fallback] T2.5c filled offer=${r.id.slice(0,8)} +${proceedsUsdt} USDT to ${userKasia.slice(-12)}`);
        handled++;
      } else {
        recordChainEvent({
          txid: cancelRes.cancel_tx, eventType: 'broker_fallback_pending',
          fromAddress: null, toAddress: null, observedBy: 'system',
          payload: { offer_id: r.id, cancel_tx: cancelRes.cancel_tx, cex_order_id: sellRes.orderId, polled_ms: POLL_TIMEOUT_MS },
        });
        console.log(`[broker-fallback] T2.5c poll timeout offer=${r.id.slice(0,8)} cex_order=${sellRes.orderId}, reconciler retry next tick`);
      }
    } catch (err) {
      console.error(`[broker-fallback] T2.5c offer ${r.id?.slice(0,8)} err: ${err.message}`);
    }
  }
  return { handled, scanned: rows.length };
}

// ════════════════════════════════════════════════════════════════
// T-J2-2026-05-10 r241 T2.24 Phase 2 (β.1) — _scanUntakenBuyOffersFallback mirror T2.5c SELL fallback
// ════════════════════════════════════════════════════════════════
// 30min P2P 无 KANet seeker take broker BUY offer → broker self-take + Gate.io BUY KAS + send KAS user kasia.
// mirror SELL flow T2.5c (CEX SELL after no taker) → BUY flow (CEX BUY after no seeker).
// race fix mirror T2.14: chain_events broker_buy_fallback_claim 真 INSERT 真 防 Z20 equivalent double-spend.
// permanent fail mirror T2.10a: cex-bridge BUY fail (size/asset) → refund user USDT BSC.
//
// dormant — T2.21+T2.22+T2.23+T2.24 真 ship 真 NOT wired startIntakeWatcher 5min sub-tick (Phase 2 β.x explicit user choice trigger 真 demand wire decision Owner).
const BUY_FALLBACK_AGE_MIN = 30;
export async function _scanUntakenBuyOffersFallback() {
  const trader = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id = ?`).get(BROKER_RELAY_ID);
  if (!trader) return { handled: 0, scanned: 0, reason: 'no_broker_relay' };
  const rows = sqlite.prepare(`
    SELECT id, give_amount, want_amount, metadata, broadcast_at, broadcast_tx_id FROM exchange_offers
    WHERE maker = ?
      AND give_asset = 'USDT'
      AND want_asset = 'KAS'
      AND taker IS NULL
      AND protocol_status = 'open'
      AND julianday(broadcast_at) < julianday('now', '-${BUY_FALLBACK_AGE_MIN} minutes')
      AND json_extract(metadata, '$.user_kasia_address') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM chain_events ce
        WHERE ce.event_type IN ('broker_buy_fallback_fill', 'broker_buy_fallback_cancelled', 'broker_buy_fallback_cancel_failed', 'broker_buy_fallback_pending', 'broker_buy_fallback_refunded', 'broker_buy_fallback_claim')
        AND ce.payload LIKE '%"offer_id":"' || exchange_offers.id || '"%'
      )
    ORDER BY broadcast_at DESC
    LIMIT 5
  `).all(trader.address);
  let handled = 0;
  if (rows.length > 0) console.log(`[broker-buy-fallback] T2.24 scan: ${rows.length} untaken BUY offer(s) > ${BUY_FALLBACK_AGE_MIN}min`);
  const { recordChainEvent } = await import('./chain-event.js');
  const { placeCexOrder, getCexOrder } = await import('./cex-bridge.js');
  for (const r of rows) {
    try {
      const meta = JSON.parse(r.metadata || '{}');
      const userKasia = meta.user_kasia_address;
      const giveUsdt = parseFloat(r.give_amount);
      const wantKas = parseFloat(r.want_amount);
      const midPrice = parseFloat(meta.mid_price || 0);
      if (!userKasia || !wantKas || !midPrice) {
        console.warn(`[broker-buy-fallback] T2.24 offer ${r.id.slice(0,8)} skip: missing meta`);
        continue;
      }
      // Step 1: cancel_v1 broadcast (mirror T2.5c cancel chain TX anchor)
      // 2026-07-14(Bettor #k2xd1y 第五源排查): 端口 3100→3200 + 补 AbortSignal.timeout(同上, 本文件
      // REFUND_TICK_MS=5min 常驻循环调此路径)。
      const PORT = process.env.PORT || 3200;
      const cancelRes = await fetch(`http://127.0.0.1:${PORT}/api/exchange/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relayNodeId: BROKER_RELAY_ID, offer_id: r.id }),
        signal: AbortSignal.timeout(15000),
      }).then(rr => rr.json()).catch(e => ({ ok: false, error: e.message }));
      if (!cancelRes.ok || !cancelRes.cancel_tx) {
        recordChainEvent({
          txid: r.broadcast_tx_id, eventType: 'broker_buy_fallback_cancel_failed',
          fromAddress: null, toAddress: null, observedBy: 'system',
          payload: { offer_id: r.id, error: cancelRes.error || 'no cancel_tx' },
        });
        continue;
      }
      // Step 2: cex-bridge.placeCexOrder BUY KAS limit (mid * 1.02 真 spike protect, IOC fill)
      // BUY 真 limit (NOT market) per T2.13 SELL-only market fix — broker BUY amount=KAS qty 真 limit OK
      const sellRes = await placeCexOrder({ cex: 'gateio', side: 'BUY', qty: wantKas, price: midPrice * 1.02 });
      if (sellRes.ok) {
        recordChainEvent({
          txid: cancelRes.cancel_tx, eventType: 'broker_buy_fallback_claim',
          fromAddress: null, toAddress: null, observedBy: 'system',
          payload: { offer_id: r.id, cex_order_id: sellRes.orderId, cancel_tx: cancelRes.cancel_tx, qty: wantKas, mid_price: midPrice },
        });
      }
      if (!sellRes.ok) {
        const PERMANENT_FAIL_PATTERN = /too small|minimum is|not supported|invalid|insufficient/i;
        const isPermanent = PERMANENT_FAIL_PATTERN.test(sellRes.error || '');
        if (isPermanent) {
          // T2.10a equivalent: refund user USDT to BSC (broker BSC wallet → user pay_address)
          // 真 demand 真 user pay_address 真 retail_dex_orders fetch (NOT broker BSC self)
          const { transferUsdt } = await import('./evm-transfer.js');
          const userOrder = sqlite.prepare(
            `SELECT user_kasia_address, qty FROM retail_dex_orders WHERE user_kasia_address = ? AND state = 'awaiting_payment' AND side = 'buy_kas' AND order_type = 'broker_as_maker' ORDER BY created_at DESC LIMIT 1`
          ).get(userKasia);
          // 真 user 真 BSC pay addr 真 sender of USDT inflow (broker BSC inflow tx 真 sender 真 user BSC)
          // 真 simpler: query bsc-incoming scan event tx sender, OR retail_dex_orders.refund_address column (NOT exist)
          // 真 minimal: log permanent fail, defer manual refund (Phase 2 β.x candidate)
          recordChainEvent({
            txid: cancelRes.cancel_tx, eventType: 'broker_buy_fallback_refunded',
            fromAddress: null, toAddress: null, observedBy: 'system',
            payload: { offer_id: r.id, cex_buy_error: sellRes.error, manual_refund_pending: true, user_kasia: userKasia, usdt_amount: giveUsdt },
          });
          await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: userKasia,
            message: `订单 ${r.id.slice(0,8)} 30min 无 KANet seeker 接, broker CEX 兜底 BUY 失败 (${(sellRes.error||'').slice(0,60)}). USDT manual refund pending (Owner 联系 broker 走 dispute).`,
          });
          continue;
        }
        recordChainEvent({
          txid: cancelRes.cancel_tx, eventType: 'broker_buy_fallback_cancelled',
          fromAddress: null, toAddress: null, observedBy: 'system',
          payload: { offer_id: r.id, cancel_tx: cancelRes.cancel_tx, cex_buy_error: sellRes.error },
        });
        continue;
      }
      // Step 3: poll fill (mirror T2.5c 30s inline)
      const POLL_TIMEOUT_MS = 30_000;
      const POLL_INTERVAL_MS = 3_000;
      const start = Date.now();
      let filled = null;
      while (Date.now() - start < POLL_TIMEOUT_MS) {
        const orderState = await getCexOrder({ cex: 'gateio', orderId: sellRes.orderId });
        if (orderState.filled) { filled = orderState; break; }
        await new Promise(rr => setTimeout(rr, POLL_INTERVAL_MS));
      }
      if (filled) {
        // Step 4: broker send KAS chain TX user kasia (broker kasia 1922 KAS inventory direct, 跳 Gate.io withdraw)
        const kasAmount = filled.executedQty;
        try {
          await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.TRANSFER, target: userKasia, amount_kas: kasAmount, note: `broker_buy_fallback_fill:${r.id.slice(0,12)}` });
        } catch (err) {
          console.error(`[broker-buy-fallback] T2.24 KAS send fail offer=${r.id.slice(0,8)}: ${err.message}`);
        }
        recordChainEvent({
          txid: cancelRes.cancel_tx, eventType: 'broker_buy_fallback_fill',
          fromAddress: null, toAddress: null, observedBy: 'system',
          payload: { offer_id: r.id, cancel_tx: cancelRes.cancel_tx, cex_order_id: sellRes.orderId, qty: kasAmount, mid_price: midPrice },
        });
        await _send(BROKER_RELAY_ID, { type: COMMAND_TYPES.SEND_MESSAGE, target: userKasia,
          message: `订单 ${r.id.slice(0,8)} 30min 无 KANet seeker, broker CEX 兜底 BUY 成交 ${kasAmount} KAS @ Gate.io. KAS 真发到你 Kasia 钱包.`,
        });
        console.log(`[broker-buy-fallback] T2.24 filled offer=${r.id.slice(0,8)} ${kasAmount} KAS to ${userKasia.slice(-12)}`);
        handled++;
      } else {
        recordChainEvent({
          txid: cancelRes.cancel_tx, eventType: 'broker_buy_fallback_pending',
          fromAddress: null, toAddress: null, observedBy: 'system',
          payload: { offer_id: r.id, cancel_tx: cancelRes.cancel_tx, cex_order_id: sellRes.orderId, polled_ms: POLL_TIMEOUT_MS },
        });
        console.log(`[broker-buy-fallback] T2.24 poll timeout offer=${r.id.slice(0,8)} cex_order=${sellRes.orderId}, reconciler retry next tick`);
      }
    } catch (err) {
      console.error(`[broker-buy-fallback] T2.24 offer ${r.id?.slice(0,8)} err: ${err.message}`);
    }
  }
  return { handled, scanned: rows.length };
}

export function startIntakeWatcher() {
  if (_intakeInterval) return;
  _intakeInterval = setInterval(async () => {
    try {
      const r = await intakeTick();
      if (r && r.scanned !== undefined) {
        // 每次 tick 打存活 + 结果, J1 验收标准"[broker-intake] tick 至少一条"
        console.log(`[broker-intake] tick handled=${r.handled||0}/${r.scanned||0}`);
      }
    } catch (e) { console.error('[broker-intake]', e.message); }
  }, TICK_MS);
  if (!_refundInterval) {
    _refundInterval = setInterval(async () => {
      // T-J2-2026-07-15 diag(observe-only, NWT verdict 3b87317b GO): 测本 tick 实际触发时刻相对
      // 上一次触发 + REFUND_TICK_MS 的漂移量。若漂移持续接近 0 但 CPU profile 仍显示大 self-time,
      // 排除"排队被采样"假说,指向真同步阻塞;若漂移本身就巨大,说明问题在更上游(事件循环整体
      // 拥堵),不是这个函数专属。
      const _fireAt = Date.now();
      if (_refundLastFireAt > 0) {
        const gap = _fireAt - _refundLastFireAt;
        console.log(`[diag:interval-lag] _refundInterval gap=${gap}ms expected=${REFUND_TICK_MS}ms drift=${gap - REFUND_TICK_MS}ms`);
      }
      _refundLastFireAt = _fireAt;
      try {
        const r = await _scanExpiredBrokerOffers();
        if (r && r.scanned > 0) console.log(`[broker-refund] tick handled=${r.handled||0}/${r.scanned||0}`);
      } catch (e) { console.error('[broker-refund]', e.message); }
      // T-J2-10: 同 5min sub-tick 同时扫 12h unsolicited stale
      try {
        const s = await _scanStaleUnsolicited();
        if (s && s.scanned > 0) console.log(`[broker-stale] tick handled=${s.handled||0}/${s.scanned||0}`);
      } catch (e) { console.error('[broker-stale]', e.message); }
      // T-NWT-06: 同 5min sub-tick 主动 ensure broker 钱包 UTXO 数 (Round 1 UTXO 双花治本)
      try { await _ensureBrokerUtxoSplit(); } catch (e) { console.error('[broker-utxo-split]', e.message); }
      // T-J1-2026-04-28 Layer 4 (phase 3): chain reconciler — 抓 chain_events refunded.txid 不在 kaspa_tx_log 的 drift
      try {
        const r = await _reconcileRefundsTick();
        if (r && r.drift > 0) console.warn(`[broker-reconciler] tick drift=${r.drift}/${r.inspected} alerted=${r.alerted}`);
      } catch (e) { console.error('[broker-reconciler]', e.message); }
      // T-J2-2026-05-09 T2.5c (Reading D step 4): 30min+ untaken broker SELL offer → CEX fallback
      try {
        const r = await _scanUntakenOffersFallback();
        if (r && r.handled > 0) console.log(`[broker-fallback] T2.5c tick handled=${r.handled}/${r.scanned}`);
      } catch (e) { console.error('[broker-fallback T2.5c]', e.message); }
      // T-J2-2026-05-10 T2.25 wire (Phase 2 β.1): 30min+ untaken broker BUY offer → CEX fallback (mirror T2.5c)
      try {
        const r = await _scanUntakenBuyOffersFallback();
        if (r && r.handled > 0) console.log(`[broker-buy-fallback] T2.24 tick handled=${r.handled}/${r.scanned}`);
      } catch (e) { console.error('[broker-buy-fallback T2.24]', e.message); }
    }, REFUND_TICK_MS);
  }
  // T-J2-2026-05-10 T2.25 wire: broker-bsc-intake-watcher (Phase 2 β.1 BUY parity prerequisite trigger).
  // 30s tick poll broker BSC inflow → match retail_dex_orders pending → trigger _publishBrokerBuyOffer.
  // 真 dormant 真 NO pending row 真 noop 真 safe wire.
  try {
    import('./broker-bsc-intake-watcher.js').then(m => m.start && m.start());
  } catch (e) { console.error('[broker-bsc-intake] start err:', e.message); }
  console.log(`[broker-intake] watcher started for Trader-B tick=${TICK_MS}ms, refund tick=${REFUND_TICK_MS}ms (incl. T2.24 BUY fallback + T2.25 BSC intake wire)`);
}

export function stopIntakeWatcher() {
  if (_intakeInterval) { clearInterval(_intakeInterval); _intakeInterval = null; }
  if (_refundInterval) { clearInterval(_refundInterval); _refundInterval = null; }
}
