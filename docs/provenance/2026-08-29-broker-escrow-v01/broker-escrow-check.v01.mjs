// broker-escrow-check.v01.mjs — checkBrokerEscrow 候选（J2 2026-08-29, 定级页 c6d0729b §②, NWT 裁: no_escrow 须 positive 证据）
// 目标: 替换 kasia-console/src/services/broker-state-machine.js:249-274 的 checkBrokerEscrow（硬编主网地址 ⇒ TN12 恒 false ⇒
// reconcileStaleOrders 一律 failed+no_escrow）。batch: broker-money-path, NOT maintenance-window。
//
// 三态而非布尔:
//   ESCROWED  — 链索引里有 peer→broker 匹配入金 (broker 持币; 不得 force-fail)
//   NOT_PAID  — 【coverage-attested absence】: 地址来源正确 ∧ 网络前缀一致 ∧ 索引在订单窗内持续存活 ∧ 零匹配行 ⇒ 允许 no_escrow
//   UNKNOWN   — 任一前提不成立 (地址缺/前缀错/索引陈/查询异常) ⇒ 【永不】no_escrow; 调用方 skip + 告警
// 诚实边界: Kaspa 节点无地址历史索引, "明确未付"的绝对 positive 证据不存在; 本候选给的是"索引覆盖了窗口且没有"——比裸 absence 强, 比链读弱。
// 可选 ctx.rpcUtxoLookup(addr) 让调用方注入一次链读作第三源 (有 UTXO 匹配 ⇒ ESCROWED 覆盖索引结论)。
export const ESCROW = Object.freeze({ ESCROWED: 'ESCROWED', NOT_PAID: 'NOT_PAID', UNKNOWN: 'UNKNOWN' });

const PREFIX_BY_NETWORK = (network) => (String(network || '').startsWith('testnet') ? 'kaspatest:' : String(network || '') === 'mainnet' ? 'kaspa:' : null);
export const INDEXER_FRESH_MS = 5 * 60 * 1000;   // spc_tip_heartbeat 陈 > 5 min ⇒ 索引不算"在岗"

/** 地址来源: env BROKER_KAS_ADDR > relay_nodes(id = env BROKER_RELAY_ID).address. 校验前缀与 network 一致。 */
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

/** 索引覆盖: spc_tip_heartbeat 新鲜 ∧ (可选) 订单创建前 broker relay 已存在 (= 地址在 watched 集合)。 */
export function indexerCoverage({ db, orderCreatedAt, nowMs = Date.now(), env = process.env }) {
  let hb = null;
  try { hb = db.prepare(`SELECT daa_score, updated_at FROM spc_tip_heartbeat WHERE id = 1`).get(); } catch (e) { return { ok: false, reason: `heartbeat_query_fail:${e.message}` }; }
  if (!hb?.updated_at) return { ok: false, reason: 'no_indexer_heartbeat' };
  const age = nowMs - Date.parse(hb.updated_at);
  if (!(age >= 0 && age <= INDEXER_FRESH_MS)) return { ok: false, reason: `indexer_heartbeat_stale:${Math.round(age / 1000)}s` };
  if (env.BROKER_RELAY_ID) {
    const r = db.prepare(`SELECT created_at FROM relay_nodes WHERE id = ?`).get(env.BROKER_RELAY_ID);
    if (!r) return { ok: false, reason: 'broker_relay_row_missing' };
    if (r.created_at && orderCreatedAt && String(r.created_at) > String(orderCreatedAt)) return { ok: false, reason: 'broker_watched_after_order' };
  }
  return { ok: true, heartbeat_age_ms: age };
}

/**
 * checkBrokerEscrowV2 — 三态。
 * @returns {{verdict:'ESCROWED'|'NOT_PAID'|'UNKNOWN', reason:string, evidence:object}}
 */
export function checkBrokerEscrowV2({ db, peerAddr, qty, orderCreatedAt, env = process.env, nowMs = Date.now(), rpcUtxoLookup = null }) {
  const evidence = {};
  const res = resolveBrokerKasAddr({ env, db });
  evidence.addr = res;
  if (!res.ok) return { verdict: ESCROW.UNKNOWN, reason: res.reason, evidence };
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) return { verdict: ESCROW.UNKNOWN, reason: 'bad_qty', evidence };
  let inbound;
  try {
    // 与原 :253-258 同形, 只换地址来源; 窗口用 observed_at >= orderCreatedAt (原样), 金额 ±0.5 KAS 容差 (原样)
    inbound = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM kaspa_tx_log WHERE to_address = ? AND observed_at >= ? AND amount BETWEEN ? AND ?`)
      .get(res.addr, orderCreatedAt, q - 0.5, q + 0.5);
  } catch (e) { return { verdict: ESCROW.UNKNOWN, reason: `inbound_query_fail:${e.message}`, evidence }; }
  evidence.inbound = inbound;
  if (Number(inbound?.n || 0) > 0 && Number(inbound.total) >= q - 0.5) return { verdict: ESCROW.ESCROWED, reason: 'indexed_inbound_match', evidence };
  // 可选第三源: 链读 UTXO (注入; 不在本候选内连 RPC)
  if (typeof rpcUtxoLookup === 'function') {
    try {
      const utxos = rpcUtxoLookup(res.addr) || [];
      evidence.rpc_utxos = utxos.length;
      if (utxos.some((u) => Math.abs(Number(u.amountKas) - q) <= 0.5)) return { verdict: ESCROW.ESCROWED, reason: 'rpc_utxo_match', evidence };
    } catch (e) { evidence.rpc_error = e.message; return { verdict: ESCROW.UNKNOWN, reason: `rpc_lookup_fail:${e.message}`, evidence }; }
  }
  const cov = indexerCoverage({ db, orderCreatedAt, nowMs, env });
  evidence.coverage = cov;
  if (!cov.ok) return { verdict: ESCROW.UNKNOWN, reason: cov.reason, evidence };
  return { verdict: ESCROW.NOT_PAID, reason: 'coverage_attested_absence', evidence };
}

/** 兼容壳 (旧调用方只认布尔): 只有 NOT_PAID 才 false; ESCROWED/UNKNOWN 都 true (= 别 force-fail)。 */
export function checkBrokerEscrowCompat(args) {
  const r = checkBrokerEscrowV2(args);
  return r.verdict !== ESCROW.NOT_PAID;
}
