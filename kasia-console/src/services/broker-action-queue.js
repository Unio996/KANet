// broker-action-queue.js — Phase 4 Round 4 broker FIFO queue (T-NWT-09)
// 治本 R3 揭出的 kasia-wasm Generator greedy UTXO selection 多路并发抢 largest 双花.
// 一切 broker 对外发链动作 (broadcast accept_v1/paid_v1/delivered + DM + sendKas + publish) 进
// 单一 queue, pump 一次只跑一项, 等 sendCommandAsync 返回再下一项. mempool 单线无双花.
//
// 用户位置反馈 (J2 #B): J2 调 getQueuePosition(peer) 取 ahead 数, 嵌入 broker-buy/sell-handler
// 已有 ack DM 文案末尾 ("你前面 N 人, 排队号 #abcd"). 不发独立 position DM 防递归.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const TTL_DEFAULT_MS = 10 * 60 * 1000;
const RETRY_MAX = 3;
// R4 Bug 9 (J2 RCA 4e7be515): relay anti-spam fail-closed 5s 内同 message dedup 拒.
// 旧 backoff 1500 → retry 1.5s/3s 都在 dedup 窗口内, 100% similar 拒. 改 6000ms 跳过 5s 窗口.
const RETRY_BACKOFF_MS = 6000;
// T-NWT-11: tx-producing kinds 必须返 txId 否则当失败 retry. publish_offer 例外 (返 offer_id+broadcast_tx).
// T-J2-26b (J1 case 2 8/12 TIMEOUT 真因): dm_paid_no_tx 漏注册导致 'unknown queue kind' FAIL after 3 = 90s 静默.
// T-NWT-V2: dm_auto_payment_detected — bsc-incoming-watcher 主动 DM user 汇报检测到链上入账.
// T-J2-V2 议 2: dm_kas_delivered — exchange-machine deliver 后主动 DM user 'KAS 已发' (Owner 痛点 #2).
// T-NWT-V2 议 1: dm_order_confirmed — handleBuyIntent YES 路径首发"订单已确认"信号 (Owner 要求 #1).
// T-NWT-V2-hotfix: dm_price_query — 询价 deterministic 短路 (避 LLM 60s timeout, Owner 真测 #3 撞).
const TX_PRODUCING_KINDS = new Set(['dm_quote', 'dm_pay_instr', 'dm_completion', 'dm_position', 'dm_paid_no_tx', 'dm_auto_payment_detected', 'dm_kas_delivered', 'dm_order_confirmed', 'dm_price_query', 'accept_v1', 'paid_v1', 'sendKas']);

const _queue = [];               // FIFO array, items dequeue from head
const _userActions = new Map();  // peer → Set(actionId)  (J2 #B 用 getQueuePosition)
let _busy = false;
let _executeOverride = null;     // smoke

export function _testInjectExecute(fn) { _executeOverride = fn; }
export function _testResetExecute() { _executeOverride = null; }
export function _testReset() { _queue.length = 0; _userActions.clear(); _busy = false; _executeOverride = null; }

export function getQueuePosition(peer) {
  if (!peer || !_userActions.has(peer)) return { ahead: 0, total_in_queue: _queue.length, my_actions: [] };
  const myIds = Array.from(_userActions.get(peer) || []);
  // ahead = 队列中 peer 第一项之前的不同 user 数 (包括自己之前的待办)
  let ahead = 0;
  for (const item of _queue) {
    if (item.peer === peer) break;
    ahead++;
  }
  return { ahead, total_in_queue: _queue.length, my_actions: myIds };
}

export function getQueueStats() {
  const oldest = _queue[0];
  return {
    length: _queue.length,
    busy: _busy,
    oldest_age_ms: oldest ? Date.now() - oldest.queued_at : 0,
    distinct_users: _userActions.size,
  };
}

// 主入口
// kind ∈ 'accept_v1' | 'paid_v1' | 'dm_quote' | 'dm_pay_instr' | 'dm_completion'
//        | 'dm_position' | 'publish_offer' | 'sendKas' | 'sendUsdt'
// payload 由 kind 决定结构, 见 executeAction 路由.
// payload.on_done 可选 callback (传 result) 给 J2 #B 在 enqueue 后做后续 (不常用).
// 返 actionId.
export function enqueue({ kind, peer, payload, ttl_ms = TTL_DEFAULT_MS }) {
  const id = randomUUID();
  const item = { id, kind, peer: peer || null, payload: payload || {}, queued_at: Date.now(), ttl_at: Date.now() + ttl_ms, attempts: 0 };
  _queue.push(item);
  if (peer) {
    if (!_userActions.has(peer)) _userActions.set(peer, new Set());
    _userActions.get(peer).add(id);
  }
  if (!_busy) pump().catch(e => console.error('[broker-queue] pump err:', e.message));
  return id;
}

async function pump() {
  _busy = true;
  // T-J2-24 (J1 a242bfd5 R5): 防 console-restart relay race —
  // pump 第一次跑前先 waitForRelay 探活, 60s 上限. 启动期 hold queue (默认 _busy=true 不让其他 pump 重入)
  // 而非靠 retry backoff (RETRY_BACKOFF_MS * 3 = 36s 可能仍 race). 避免 NWT 报 'Relay not running'
  // 全 FAIL after 3 attempts.
  if (!_executeOverride && _queue.length > 0) {
    try {
      const { waitForRelay } = await import('./relay-manager.js');
      await waitForRelay(BROKER_RELAY_ID, 60000);
    } catch (e) {
      console.warn(`[broker-queue] waitForRelay timeout: ${e.message} — pump 继续, 单项 retry 兜底`);
    }
  }
  while (_queue.length > 0) {
    const item = _queue.shift();
    if (Date.now() > item.ttl_at) {
      _removeUserAction(item);
      console.warn(`[broker-queue] ${item.kind} #${item.id.slice(0,8)} expired (queued ${Date.now() - item.queued_at}ms)`);
      continue;
    }
    let result, lastErr;
    while (item.attempts < RETRY_MAX) {
      item.attempts++;
      // R4 Bug 9 fix follow-up (T-NWT-14): retry 时 anti-spam 看到同 message (含 broker-buy/sell-handler
      // 加的唯一 tag) 100% similar 撞自己 (J2 6559c9eb 实测). retry≥2 给 message 加 [r${attempts}]
      // 后缀让 anti-spam 视为新 message. tag fix (T-NWT-13/T-J2-15) 解跨 session, retry 后缀解同 message retry.
      if (item.attempts > 1 && item.payload?.message) {
        item.payload.message = item.payload.message.replace(/\s*\[r\d+\]\s*$/, '') + ` [r${item.attempts}]`;
      }
      try {
        result = _executeOverride ? await _executeOverride(item) : await executeAction(item);
        // R4 Bug 8 (J2 RCA af805fe1): relay-manager.sendCommandAsync resolve(msg.result || {})
        // 失败时 result = {error: '...'} 不含 ok 字段, 旧 check `result?.ok === false` 通过 throw,
        // queue 静默吞失败 retry 0. 加 result?.error 检测.
        if (result?.ok === false || result?.error) throw new Error(result?.error || 'execute returned ok=false');
        // R4 Bug 8 follow-up (T-NWT-11, J1 e78feb2 同模式): result={} 空兜底 — relay-manager
        // resolve(msg.result || {}) 当 msg.result undefined 走 ||{} 既无 .ok 也无 .error,
        // 通过上面 throw, queue 当 OK '-' (NWT 17cd5b8d 漏此 case). tx-producing kind 必须有
        // txId 否则 throw 触发 retry. (publish_offer 例外: 返 {ok, offer_id, broadcast_tx} 不含 txId)
        if (TX_PRODUCING_KINDS.has(item.kind) && !result?.txId) {
          throw new Error(result?.error || `no txId from sendCommandAsync (relay returned empty result)`);
        }
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        // T-J1-19m (J2 新 monitor 命中): 不可重试错误 fail-fast (Invalid Kaspa address /
        // payload too short / unknown peer / address parse). retry 3 次只是浪费 + 阻塞 queue.
        if (/Invalid Kaspa address|payload too short|invalid.*address|address.*invalid|bech32/i.test(err.message || '')) {
          console.warn(`[broker-queue] ${item.kind} #${item.id.slice(0,8)} FAIL-FAST: ${err.message} (no retry)`);
          break;
        }
        if (item.attempts < RETRY_MAX) await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS * item.attempts));
      }
    }
    _removeUserAction(item);
    if (lastErr) {
      console.warn(`[broker-queue] ${item.kind} #${item.id.slice(0,8)} FAIL after ${item.attempts}: ${lastErr.message}`);
    } else {
      console.log(`[broker-queue] ${item.kind} #${item.id.slice(0,8)} OK ${result?.txId?.slice(0,12) || '-'}`);
    }
    try { item.payload?.on_done?.({ ok: !lastErr, result, error: lastErr?.message }); } catch {}
  }
  _busy = false;
}

function _removeUserAction(item) {
  if (!item.peer) return;
  const set = _userActions.get(item.peer);
  if (set) {
    set.delete(item.id);
    if (set.size === 0) _userActions.delete(item.peer);
  }
}

// 路由
async function executeAction(item) {
  const { sendCommandAsync } = await import('./relay-manager.js');
  const p = item.payload || {};
  switch (item.kind) {
    case 'dm_quote':
    case 'dm_pay_instr':
    case 'dm_completion':
    case 'dm_position':
    case 'dm_paid_no_tx':  // T-J2-26b: PAID_NO_TX_REGEX 引导 reply, 路由跟其他 DM 一致
    case 'dm_auto_payment_detected':  // T-NWT-V2: bsc-incoming-watcher 主动汇报检测到入账
    case 'dm_kas_delivered':  // T-J2-V2 议 2: 主动汇报 KAS 已发 (Owner 痛点 #2)
    case 'dm_order_confirmed':  // T-NWT-V2 议 1: YES 路径首发订单确认 (Owner 要求 #1)
    case 'dm_price_query':  // T-NWT-V2-hotfix: 询价短路 (避 LLM 60s timeout)
      return sendCommandAsync(BROKER_RELAY_ID, { type: 'send_message', target: item.peer, message: p.message });
    case 'accept_v1':
      return sendCommandAsync(BROKER_RELAY_ID, { type: 'send_broadcast', channel: p.channel || 'kanet-exchange', message: p.message });
    case 'paid_v1':
      return sendCommandAsync(BROKER_RELAY_ID, { type: 'send_broadcast', channel: p.channel || 'kanet-exchange', message: p.message });
    case 'sendKas':
      return sendCommandAsync(BROKER_RELAY_ID, { type: 'send_kas', target: item.peer, amount_kas: p.amount_kas, note: p.note });
    case 'publish_offer': {
      const PORT = process.env.PORT || 3100;
      const res = await fetch(`http://127.0.0.1:${PORT}/api/exchange/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p.body || {}),
      });
      return res.json();
    }
    default:
      throw new Error(`unknown queue kind: ${item.kind}`);
  }
}
