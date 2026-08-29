// broker-escrow-check.mjs — checkBrokerEscrow 三态 (v0.2 候选转正, 2026-08-29; NWT GREEN)（J2 2026-08-29; NWT GREEN-with-MUST 收窄）
// v0.1 → v0.2 变更:
//   ① rpcUtxoLookup 从可选改【必需】: NOT_PAID 须 coverage-attested-absence AND RPC 成功且 no-match; RPC 缺/抛/劣化 ⇒ UNKNOWN。
//   ② coverage 判据改消费 L2 `indexerCoverage()`(v199 holes 账, 稿 70208425 §2.2), 注入; 无账/注入缺 ⇒ UNKNOWN(过渡形)。
//      旧 heuristic(relay created_at ≤ order)删除——它 capture 不了 relay 重启 gap / watched 集变更 / eventloop 丢 POST。
//   ③ spc_tip_heartbeat 保留为"indexer 在岗"必要非充分条件。
//   ④ 选项 B: decideReconcileAction(verdict, mode) — mode 'failed'(选项 A, 今天的终态) | 'held_for_review'(选项 B, 可逆; Owner 定)。
// 诚实边界(NWT ④): Kaspa 无地址历史索引; RPC UTXO 读只是 current-UTXO(收款后扫走 = 无 UTXO 但付过) ⇒ 任何 absence-based no_escrow 根本可错 ⇒ 这就是选项 B 存在的理由。
export const ESCROW = Object.freeze({ ESCROWED: 'ESCROWED', NOT_PAID: 'NOT_PAID', UNKNOWN: 'UNKNOWN' });
export const RECONCILE_MODE = Object.freeze({ A_FAILED: 'failed', B_HELD: 'held_for_review' });
export const INDEXER_FRESH_MS = 5 * 60 * 1000;
const PREFIX_BY_NETWORK = (network) => (String(network || '').startsWith('testnet') ? 'kaspatest:' : String(network || '') === 'mainnet' ? 'kaspa:' : null);

export function resolveBrokerKasAddr({ env = process.env, db } = {}) {
  const network = env.KASPA_NETWORK || env.NETWORK || 'mainnet';
  const want = PREFIX_BY_NETWORK(network);
  if (!want) return { ok: false, reason: `unknown_network:${network}` };
  let addr = env.BROKER_KAS_ADDR || null, source = 'env:BROKER_KAS_ADDR';
  if (!addr && env.BROKER_RELAY_ID && db) {
    const row = db.prepare(`SELECT address FROM relay_nodes WHERE id = ?`).get(env.BROKER_RELAY_ID);
    addr = row?.address || null; source = 'relay_nodes:BROKER_RELAY_ID';
  }
  if (!addr) return { ok: false, reason: 'broker_addr_unconfigured' };
  if (!String(addr).startsWith(want)) return { ok: false, reason: `network_prefix_mismatch: addr=${String(addr).slice(0, 12)}… network=${network} want=${want}`, addr, source };
  return { ok: true, addr, network, source };
}

/** 必要非充分: indexer 在岗心跳 */
export function indexerHeartbeatFresh({ db, nowMs = Date.now() }) {
  let hb = null;
  try { hb = db.prepare(`SELECT updated_at FROM spc_tip_heartbeat WHERE id = 1`).get(); } catch (e) { return { ok: false, reason: `heartbeat_query_fail:${e.message}` }; }
  if (!hb?.updated_at) return { ok: false, reason: 'no_indexer_heartbeat' };
  const age = nowMs - Date.parse(hb.updated_at);
  if (!(age >= 0 && age <= INDEXER_FRESH_MS)) return { ok: false, reason: `indexer_heartbeat_stale:${Math.round(age / 1000)}s` };
  return { ok: true, heartbeat_age_ms: age };
}

/**
 * checkBrokerEscrowV2
 * @param {object} a
 * @param {Function} a.rpcUtxoLookup   必需: (addr) => [{amountKas}] ; 抛 ⇒ UNKNOWN
 * @param {Function} a.indexerCoverage 必需(L2 期 1 原语): ({network, address, fromIso, toIso}) => {covered:boolean, holes:[]} ; 缺 ⇒ UNKNOWN
 */
export function checkBrokerEscrowV2({ db, peerAddr, qty, orderCreatedAt, env = process.env, nowMs = Date.now(), rpcUtxoLookup = null, indexerCoverage = null }) {
  const evidence = {};
  const res = resolveBrokerKasAddr({ env, db }); evidence.addr = res;
  if (!res.ok) return { verdict: ESCROW.UNKNOWN, reason: res.reason, evidence };
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) return { verdict: ESCROW.UNKNOWN, reason: 'bad_qty', evidence };
  // 1) 索引入金 (任一来源命中即 ESCROWED —— 肯定证据不需要 coverage)
  let inbound;
  try {
    inbound = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM kaspa_tx_log WHERE to_address = ? AND observed_at >= ? AND amount BETWEEN ? AND ?`).get(res.addr, orderCreatedAt, q - 0.5, q + 0.5);
  } catch (e) { return { verdict: ESCROW.UNKNOWN, reason: `inbound_query_fail:${e.message}`, evidence }; }
  evidence.inbound = inbound;
  if (Number(inbound?.n || 0) > 0 && Number(inbound.total) >= q - 0.5) return { verdict: ESCROW.ESCROWED, reason: 'indexed_inbound_match', evidence };
  // 2) RPC 链读 (必需; authoritative path)
  if (typeof rpcUtxoLookup !== 'function') return { verdict: ESCROW.UNKNOWN, reason: 'rpc_lookup_unavailable', evidence };
  let utxos;
  try { utxos = rpcUtxoLookup(res.addr); } catch (e) { evidence.rpc_error = e.message; return { verdict: ESCROW.UNKNOWN, reason: `rpc_lookup_fail:${e.message}`, evidence }; }
  if (!Array.isArray(utxos)) return { verdict: ESCROW.UNKNOWN, reason: 'rpc_lookup_degraded(non-array)', evidence };
  evidence.rpc_utxos = utxos.length;
  if (utxos.some((u) => Math.abs(Number(u?.amountKas) - q) <= 0.5)) return { verdict: ESCROW.ESCROWED, reason: 'rpc_utxo_match', evidence };
  // 3) 否定断言前置: 心跳(必要) + L2 coverage(充分性的账)
  const hb = indexerHeartbeatFresh({ db, nowMs }); evidence.heartbeat = hb;
  if (!hb.ok) return { verdict: ESCROW.UNKNOWN, reason: hb.reason, evidence };
  if (typeof indexerCoverage !== 'function') return { verdict: ESCROW.UNKNOWN, reason: 'coverage_ledger_unavailable(L2 phase-1 not deployed)', evidence };
  let cov;
  try { cov = indexerCoverage({ network: res.network, address: res.addr, fromIso: orderCreatedAt, toIso: new Date(nowMs).toISOString() }); } catch (e) { return { verdict: ESCROW.UNKNOWN, reason: `coverage_query_fail:${e.message}`, evidence }; }
  evidence.coverage = cov;
  if (!cov || cov.covered !== true || (Array.isArray(cov.holes) && cov.holes.length > 0)) return { verdict: ESCROW.UNKNOWN, reason: 'coverage_holes', evidence };
  return { verdict: ESCROW.NOT_PAID, reason: 'coverage_attested_absence+rpc_no_match', evidence };
}

/** reconcileStaleOrders 的决策 (纯函数): 只有 NOT_PAID 才动状态; mode 决定进 failed(A) 还是 held_for_review(B) */
export function decideReconcileAction(verdict, mode = RECONCILE_MODE.B_HELD) {
  if (verdict === ESCROW.NOT_PAID) {
    if (mode === RECONCILE_MODE.A_FAILED) return { action: 'transition', toState: 'failed', opts: { no_escrow: true, reason: 'reconcile_no_escrow' } };
    if (mode === RECONCILE_MODE.B_HELD) return { action: 'transition', toState: 'held_for_review', opts: { reason: 'reconcile_no_escrow_review', reversible: true } };
    throw new Error(`unknown mode ${mode}`);
  }
  if (verdict === ESCROW.UNKNOWN) return { action: 'alert_once', event_type: 'broker_escrow_unknown' };
  return { action: 'none' };
}

export function checkBrokerEscrowCompat(args) { return checkBrokerEscrowV2(args).verdict !== ESCROW.NOT_PAID; }
