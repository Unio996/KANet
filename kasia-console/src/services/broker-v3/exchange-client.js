// ════════════════════════════════════════════════════════════════
// broker-v3/exchange-client.js — /api/exchange/* HTTP client (协议层调用单点)
//
// Spec: docs/INVARIANTS-broker-dual-path-v0.4.md (v0.6 iterate per NWT r225)
// Lock: NWT r217-r225 architect cross-hat + Owner 5/6 钦定双路并行 + 协议层汇聚
//
// 设计:
// - broker-v3 真所有协议交互走 fetchJson HTTP API (I-6 严守, 0 sqlite)
// - 不调 DEPRECATED /api/exchange/submit-payment (v0.6 §4 spec 撤回, 真 path 是 user 真付 + bsc-watcher 自动 detect + 异步 chain events 监听)
// - chain events monitor 复用 matcher.reactToChainEvents pattern (per-cycle 异步, 0 own state)
// ════════════════════════════════════════════════════════════════

const CONSOLE_URL = process.env.KASIA_CONSOLE_URL || 'http://127.0.0.1:3100';
const FETCH_TIMEOUT_MS = 10000;

async function fetchJson(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally { clearTimeout(t); }
}

/**
 * GET /api/exchange/offers — 列 active offers (BROWSE_MARKET / MY_ORDERS).
 * @param {object} params - { market_key?, status?, maker?, limit, offset }
 * @returns {Promise<{ ok, offers, total, kas_market_price }>}
 */
export async function listOffers(params = {}) {
  const qs = new URLSearchParams();
  if (params.market_key) qs.set('market_key', params.market_key);
  if (params.status) qs.set('status', params.status);
  if (params.maker) qs.set('maker', params.maker);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const r = await fetchJson(`${CONSOLE_URL}/api/exchange/offers?${qs.toString()}`);
  if (!r.ok) return { ok: false, error: r.data?.error || `HTTP ${r.status}` };
  return { ok: true, offers: r.data.offers || [], total: r.data.total || 0, kas_market_price: r.data.kas_market_price };
}

/**
 * GET /api/exchange/offers/:id — 单 offer 详情 (state verify before accept).
 */
export async function getOffer(offerId) {
  const r = await fetchJson(`${CONSOLE_URL}/api/exchange/offers/${encodeURIComponent(offerId)}`);
  if (!r.ok) return { ok: false, error: r.data?.error || `HTTP ${r.status}` };
  return { ok: true, offer: r.data };
}

/**
 * POST /api/exchange/publish — 发起报价 (BUY/SELL CONFIRM).
 * @param {object} body - { relayNodeId, give_asset, give_amount, give_chain, want_asset, want_amount, want_chain, expires_minutes, verification, verification_meta, metadata, channel }
 */
export async function publishOffer(body) {
  const r = await fetchJson(`${CONSOLE_URL}/api/exchange/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return { ok: false, error: r.data?.error || `HTTP ${r.status}`, detail: r.data?.detail };
  return { ok: true, offer_id: r.data.offer_id, broadcast_tx: r.data.broadcast_tx, expires_at: r.data.expires_at };
}

/**
 * POST /api/exchange/accept — taker 接 offer (ACCEPT_OFFER).
 * @param {object} body - { relayNodeId, offer_id, selected_chain, payment_asset }
 */
export async function acceptOffer(body) {
  const r = await fetchJson(`${CONSOLE_URL}/api/exchange/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return { ok: false, error: r.data?.error || `HTTP ${r.status}` };
  return { ok: true, offer_id: r.data.offer_id, status: r.data.status, accept_tx: r.data.accept_tx, reputationWarning: r.data.reputationWarning };
}

/**
 * GET /api/trade/kas-price — KAS USDT 中价 oracle (live, 跟 market-seeder 同 source).
 * T-J2-2026-05-07 r259 T2.1b — Layer 2 Price Oracle Gap fix (替 router.js MID_PRICE=0.04 hardcode).
 * @returns {Promise<number>} mid price in USDT, OR null if oracle down.
 */
export async function getKasPrice() {
  const r = await fetchJson(`${CONSOLE_URL}/api/trade/kas-price`);
  if (!r.ok) return null;
  const price = parseFloat(r.data?.price);
  return (price && price > 0) ? price : null;
}

/**
 * POST /api/exchange/cancel — maker 取消 offer (CANCEL_ORDER).
 * @param {object} body - { relayNodeId, offer_id }
 */
export async function cancelOffer(body) {
  const r = await fetchJson(`${CONSOLE_URL}/api/exchange/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return { ok: false, error: r.data?.error || `HTTP ${r.status}` };
  return { ok: true, offer_id: r.data.offer_id, cancel_tx: r.data.cancel_tx };
}

// Phase B P1 fix (J2 #339 per NWT spec 4324dccc): 4 endpoint helper coverage
// 菜单 user 闭环关键 — accept 后 user 真链转 USDT, 需 DM 报告 submit-payment 给 broker.

/**
 * POST /api/exchange/submit-payment — taker 报告 payment tx 触发 verify (WAIT_PAYMENT flow).
 * @param {object} body - { relayNodeId, offer_id, payment_tx, payment_chain }
 */
export async function submitPayment(body) {
  const r = await fetchJson(`${CONSOLE_URL}/api/exchange/submit-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return { ok: false, error: r.data?.error || `HTTP ${r.status}` };
  return { ok: true, offer_id: r.data.offer_id, status: r.data.status };
}

/**
 * POST /api/exchange/confirm — manual 双方确认 (verify fail 后 fallback path).
 * @param {object} body - { relayNodeId, offer_id }
 */
export async function confirmOffer(body) {
  const r = await fetchJson(`${CONSOLE_URL}/api/exchange/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return { ok: false, error: r.data?.error || `HTTP ${r.status}` };
  return { ok: true, offer_id: r.data.offer_id, status: r.data.status };
}

/**
 * POST /api/exchange/dispute — 发起争议 (verifying/delivering 卡死时 user 主动启).
 * @param {object} body - { relayNodeId, offer_id, reason, evidence? }
 */
export async function disputeOffer(body) {
  const r = await fetchJson(`${CONSOLE_URL}/api/exchange/dispute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return { ok: false, error: r.data?.error || `HTTP ${r.status}` };
  return { ok: true, offer_id: r.data.offer_id, status: r.data.status };
}

/**
 * POST /api/exchange/resolve — 仲裁结算 (arbiter / Owner final, dispute 后 close).
 * @param {object} body - { relayNodeId, offer_id, resolution: 'maker_wins'|'taker_wins'|'split' }
 */
export async function resolveOffer(body) {
  const r = await fetchJson(`${CONSOLE_URL}/api/exchange/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return { ok: false, error: r.data?.error || `HTTP ${r.status}` };
  return { ok: true, offer_id: r.data.offer_id, status: r.data.status };
}
