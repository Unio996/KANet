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
const RETRY_BACKOFF_MS = 1500;

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
      try {
        result = _executeOverride ? await _executeOverride(item) : await executeAction(item);
        if (result?.ok === false) throw new Error(result.error || 'execute returned ok=false');
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
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
