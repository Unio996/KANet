// tx-landed-reconciler.mjs — (c) NO-TX-NO-STATE F3 · submit/landed 对账器 v1(detect + alert + landed 回写, 不自愈)。
// 设计 docs/2026-09-13-j2-no-tx-no-state-two-violations-and-landed-reconciler-design-v0.1.md v0.3 (NWT PASS 29959d41 · Bettor 1044)。
// 形同 broker-state-reconciler.js: 5 min tick, 只读链 + 写账本列 + events 告警。
//
// 三源判"落链": ① kaspa_tx_log 命中(嵌入式索引器; 深度 = 当前 DAA − 块 DAA, 块 DAA 经 RPC getBlock 取, 过去剪枝点取不到则 depth NULL)
//               ② 收款地址 UTXO 集里有该 txid 的输出(深度 = 当前 DAA − blockDaaScore)
//               ③ mempool 有 ⇒ 还在飞, 不告警
// 三源无 且 age > 10 min ⇒ events tx_not_landed(限频: 首次 + 每 60 min)。v1 不改 tx_records.status(仍 'broadcasted'), 只写 landed_* 列。
// 冻结 relay(NWT 1001 ④-1)留 G-1 readonly 态落地后接, 本文件不做。
//
// 🔴 M0a: 不 import relay-manager —— 链读用 console 共享 RpcClient(rpc-health + kaspa-rpc-shared 单例, 不 per-call new)。
//    prepared 行的【解决】(mempool/landed/同字节重播)需要 relay 通道, 由 prediction-settler tick 的 resumeStaleIntents 做; 本文件只告警。
import { sqlite } from '../db/client.js';
import { wrapTick } from '../lib/diag-step.mjs';
import { randomUUID } from 'node:crypto';
import { listIntents, markIntent } from '../lib/submit-intent.mjs';

const TICK_MS = 5 * 60 * 1000;
export const NOT_LANDED_AFTER_MS = 10 * 60 * 1000;
const INTENT_NOT_LANDED_AFTER_MS = 30 * 60 * 1000;
const INTENT_PREPARED_STALE_MS = 2 * 60 * 1000;
const ALERT_EVERY_MS = 60 * 60 * 1000;
const BATCH = 50;

let _interval = null, _started = false, _tickCount = 0;
const _lastAlertAt = new Map();   // key → ms (进程内限频; 重启后首次会再告警一次, 可接受)

function _alert(eventType, summary, payload, level = 'warn') {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', ?, 'tx-landed-reconciler', ?, ?, ?, datetime('now'))
    `).run(randomUUID(), eventType, level, summary, JSON.stringify(payload || {}));
  } catch (e) { console.warn(`[tx-landed-reconciler] events INSERT err: ${e.message}`); }
}
function _throttled(key) {
  const last = _lastAlertAt.get(key) || 0;
  if (Date.now() - last < ALERT_EVERY_MS) return true;
  _lastAlertAt.set(key, Date.now());
  return false;
}

/** 链读器(依赖注入, 离线向量用假的): { virtualDaa(), blockDaa(hash), utxoOutpointDaa(address, txid), inMempool(txid) } */
export async function makeChainReader() {
  const { getWorkingRpc } = await import('./rpc-health.js');
  const { getSharedRpc } = await import('../lib/kaspa-rpc-shared.mjs');
  const { url } = await getWorkingRpc();
  if (!url) throw new Error('no working RPC (strict local-only: KASPA_RPC_URL node not trusted/reachable)');
  const networkId = process.env.KASPA_NETWORK || 'mainnet';
  const rpc = await getSharedRpc({ url, networkId });
  return {
    async virtualDaa() { const d = await rpc.getBlockDagInfo(); return Number(d.virtualDaaScore); },
    async blockDaa(hash) {
      try { const b = await rpc.getBlock({ hash, includeTransactions: false }); const s = b?.block?.header?.daaScore ?? b?.header?.daaScore; return s == null ? null : Number(s); }
      catch { return null; }   // 过去剪枝点以下的块 header 已剪: "取不到" ≠ "不在链上"(记忆: getBlock cannot find header)
    },
    async utxoOutpointDaa(address, txid) {
      const { entries } = await rpc.getUtxosByAddresses([address]);
      const e = (entries || []).find(x => (x.outpoint?.transactionId || x.entry?.outpoint?.transactionId) === txid);
      if (!e) return null;
      const bds = e.blockDaaScore ?? e.utxoEntry?.blockDaaScore ?? e.entry?.blockDaaScore ?? e.entry?.utxoEntry?.blockDaaScore;
      return { found: true, daa: bds == null ? null : Number(bds) };
    },
    async inMempool(txid) {
      try { const m = await rpc.getMempoolEntry({ transactionId: txid, includeOrphanPool: true, filterTransactionPool: false }); return !!(m?.entry || m?.mempoolEntry); }
      catch (e) {
        // 没找到 RPC 抛错; 不靠报错串分类 —— 活性探针: getBlockDagInfo 成功 ⇒ 这次抛错 = not found ⇒ false; 探针也失败 ⇒ 真 RPC 错 ⇒ throw(该行计 errored, 不告警)
        try { await rpc.getBlockDagInfo(); } catch { throw new Error(`mempool query failed: ${e?.message || e}`); }
        return false;
      }
    },
  };
}

/** 单笔三源判定。返回 { landed, landedAt, depth, source } | { landed:false, inMempool } */
export async function resolveLanded({ reader, txid, targetAddress, virtualDaa }) {
  const row = sqlite.prepare('SELECT block_hash, block_time FROM kaspa_tx_log WHERE tx_id = ?').get(txid);
  if (row) {
    const bd = row.block_hash ? await reader.blockDaa(row.block_hash) : null;
    return { landed: true, source: 'kaspa_tx_log', landedAt: row.block_time ? new Date(Number(row.block_time) * 1000).toISOString() : new Date().toISOString(), depth: bd == null ? null : virtualDaa - bd };
  }
  if (targetAddress) {
    const u = await reader.utxoOutpointDaa(targetAddress, txid);
    if (u?.found) return { landed: true, source: 'utxo_set', landedAt: new Date().toISOString(), depth: u.daa == null ? null : virtualDaa - u.daa };
  }
  const inMempool = await reader.inMempool(txid);
  return { landed: false, inMempool };
}

export async function reconcileTxRecords({ reader, now = Date.now(), limit = BATCH } = {}) {
  const network = process.env.KASPA_NETWORK || 'mainnet';
  const rows = sqlite.prepare(`
    SELECT id, txid, trace_id, local_address, target_address, created_at, landed_checked_at FROM tx_records
    WHERE direction = 'outbound' AND landed_at IS NULL AND network = ?
      AND julianday(created_at) < julianday(?)
    ORDER BY created_at DESC LIMIT ?
  `).all(network, new Date(now - NOT_LANDED_AFTER_MS).toISOString(), limit);
  const out = { scanned: rows.length, landed: 0, inMempool: 0, notLanded: 0, noTarget: 0, errored: 0 };
  if (!rows.length) return out;
  const virtualDaa = await reader.virtualDaa();
  const nowIso = new Date(now).toISOString();
  for (const r of rows) {
    try {
      const res = await resolveLanded({ reader, txid: r.txid, targetAddress: r.target_address, virtualDaa });
      if (res.landed) {
        sqlite.prepare('UPDATE tx_records SET landed_at = ?, landed_depth = ?, landed_checked_at = ?, updated_at = ? WHERE id = ?').run(res.landedAt, res.depth, nowIso, nowIso, r.id);
        out.landed++; continue;
      }
      sqlite.prepare('UPDATE tx_records SET landed_checked_at = ?, updated_at = ? WHERE id = ?').run(nowIso, nowIso, r.id);
      if (res.inMempool) { out.inMempool++; continue; }
      if (!r.target_address) { out.noTarget++; }   // 老行无收款地址: 只能靠索引器, 缺 UTXO 源 —— 如实计数, 不当"没落链"
      out.notLanded++;
      if (!_throttled(`tx:${r.txid}`)) {
        _alert('tx_not_landed', `outbound tx ${r.txid.slice(0, 12)} not in indexer/UTXO set/mempool after ${Math.round((now - new Date(r.created_at).getTime()) / 60000)} min${r.target_address ? '' : ' (no target_address: UTXO source unavailable)'}`,
          { txid: r.txid, trace_id: r.trace_id, local_address: r.local_address, target_address: r.target_address, created_at: r.created_at });
      }
    } catch (e) { out.errored++; console.warn(`[tx-landed-reconciler] ${r.txid.slice(0, 12)}: ${e.message}`); }
  }
  return out;
}

export async function reconcileIntents({ reader, now = Date.now(), limit = BATCH } = {}) {
  const out = { submittedScanned: 0, landed: 0, notLanded: 0, preparedStale: 0, errored: 0 };
  const submitted = listIntents({ status: 'submitted', olderThanMs: INTENT_NOT_LANDED_AFTER_MS, limit });
  out.submittedScanned = submitted.length;
  if (submitted.length) {
    const virtualDaa = await reader.virtualDaa();
    for (const it of submitted) {
      try {
        const res = await resolveLanded({ reader, txid: it.submitted_txid, targetAddress: it.target_address, virtualDaa });
        if (res.landed) { markIntent(it.intent_key, { status: 'landed', landed_depth: res.depth, landed_at: res.landedAt }); out.landed++; continue; }
        if (res.inMempool) continue;
        out.notLanded++;
        if (!_throttled(`intent:${it.intent_key}`)) {
          _alert('intent_not_landed', `${it.intent_kind} intent ${it.intent_key} txid ${String(it.submitted_txid).slice(0, 12)} not landed after ${Math.round((now - new Date(it.updated_at).getTime()) / 60000)} min`,
            { intent_key: it.intent_key, kind: it.intent_kind, offer_id: it.offer_id, txid: it.submitted_txid, target_address: it.target_address });
        }
      } catch (e) { out.errored++; console.warn(`[tx-landed-reconciler] intent ${it.intent_key}: ${e.message}`); }
    }
  }
  // prepared 陈行: 只告警(解决在 prediction-settler.resumeStaleIntents, 它持有 relay 通道)
  for (const it of listIntents({ status: 'prepared', olderThanMs: INTENT_PREPARED_STALE_MS, limit })) {
    out.preparedStale++;
    if (!_throttled(`prepared:${it.intent_key}`)) {
      _alert('intent_prepared_stale', `${it.intent_kind} intent ${it.intent_key} stuck in prepared (txid ${String(it.prepared_txid).slice(0, 12)}, bytes ${it.prepared_tx_json ? 'yes' : 'NO'}) — settler resume will replay same bytes / hold`,
        { intent_key: it.intent_key, kind: it.intent_kind, offer_id: it.offer_id, prepared_txid: it.prepared_txid, has_bytes: !!it.prepared_tx_json });
    }
  }
  return out;
}

async function _tick() {
  _tickCount++;
  let reader;
  try { reader = await makeChainReader(); }
  catch (e) { console.warn(`[tx-landed-reconciler] tick ${_tickCount} skipped: ${e.message}`); return; }
  const a = await reconcileTxRecords({ reader });
  const b = await reconcileIntents({ reader });
  if (a.scanned || b.submittedScanned || b.preparedStale) {
    console.log(`[tx-landed-reconciler] tick ${_tickCount}: tx_records scanned=${a.scanned} landed=${a.landed} mempool=${a.inMempool} not_landed=${a.notLanded} no_target=${a.noTarget} · intents submitted=${b.submittedScanned} landed=${b.landed} not_landed=${b.notLanded} prepared_stale=${b.preparedStale}`);
  }
}

export function startTxLandedReconciler() {
  if (_started) return;
  _started = true;
  _interval = setInterval(wrapTick('tx-landed-reconciler.tick', () => _tick().catch(e => console.error('[tx-landed-reconciler] tick:', e.message))), TICK_MS);
  console.log(`[tx-landed-reconciler] started (tick ${TICK_MS / 60000} min, detect+alert only, landed columns backfill)`);
}
export function stopTxLandedReconciler() { if (_interval) { clearInterval(_interval); _interval = null; } _started = false; }
