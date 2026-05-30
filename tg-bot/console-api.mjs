// Console API client for the TG bot. READ + proxy ONLY (J1 S5 0-custody):
//   - NO key primitives, NO value relay commands, NO escrow/value functions.
//   - Value/trust is NEVER executed here — bot deep-links the user to Console/relay to act.
//   - All authed endpoints carry x-ingest-secret (env INGEST_SECRET).
import { CONFIG } from './config.mjs';

function headers() {
  return { 'Content-Type': 'application/json', 'x-ingest-secret': CONFIG.ingestSecret };
}
async function req(method, path, body) {
  try {
    const res = await fetch(`${CONFIG.consoleUrl}${path}`, {
      method, headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: { error: e.message } };
  }
}

// S1 — poll chain_events for ONE linked address (notifications). Server filters by address.
export function eventsSince(address, sinceMs, eventType) {
  const q = new URLSearchParams({ address });
  if (eventType) q.set('event_type', eventType);
  return req('GET', `/api/events/since/${sinceMs}?${q.toString()}`);
}

// S2 — /link binding. r275 全砍共识 (Bettor r277 GO): no signature challenge — paying FROM an address
// proves control + PoolSide claim needs the real key, so nonce/verify were redundant (notification
// "privacy" they protected is a false premise on a public ledger). bind just records (tg_user, address);
// betting auth is the on-chain from-addr check at register-external/confirm. Backend: link.js a03c357.
export function linkBind(address, tgUserId) {
  return req('POST', '/api/link/bind', { address, telegram_user_id: tgUserId });
}
export function subscribe(tgUserId, address, eventType, on) {
  return req('POST', '/api/link/subscribe', { telegram_user_id: tgUserId, kaspa_address: address, event_type: eventType, subscribed: on });
}

// broker X identity (read-only) — address shown to users so THEY pay on-chain (bot never moves funds).
export async function brokerInfo(brokerRelayId) {
  if (!brokerRelayId) return null;
  const r = await req('GET', `/api/relay/${brokerRelayId}`);
  return r.json?.relay || null;
}

// S-C — prediction markets (J1 S-B, contract frozen r81). Read-only for the in-chat menu.
export function poolMarkets({ status, category, limit = 50, offset = 0 } = {}) {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (category) q.set('category', category);
  q.set('limit', String(limit));
  q.set('offset', String(offset));
  return req('GET', `/api/pool/markets?${q.toString()}`);
}
export function poolMarket(id) {
  return req('GET', `/api/pool/market/${encodeURIComponent(id)}`);
}

// S-C stage4-5 — POOL external bettor registration (design LOCKED Bettor r263; J1 building backend).
// 0-custody (J1 S5): bot NEVER moves funds — prep computes the deterministic side-P2SH so the bot can
// SHOW the user the exact address + exact amount; the USER pays from their own wallet.
// prep = deterministic side-P2SH compute, NO state change. → {side_p2sh, exact_sompi(=baked stake), redeem_script}.
// confirm = bot reports it's awaiting payment; backend runs the 3 validations (dest==side_p2sh +
//   amount==exact_sompi + UNIQUE tx) against on-chain state → inserts pool_bettor_sides when detected.
// Path mirrors the existing /api/pool/market/:id/bettor/register convention; exact -external path pending J1 ship.
export function poolRegisterPrep(marketId, { linkedAddr, direction, stakeKas }) {
  return req('POST', `/api/pool/market/${encodeURIComponent(marketId)}/bettor/register-external/prep`,
    { linked_addr: linkedAddr, direction, stake_kas: stakeKas });
}
export function poolRegisterConfirm(marketId, { linkedAddr, direction, stakeKas }) {
  return req('POST', `/api/pool/market/${encodeURIComponent(marketId)}/bettor/register-external/confirm`,
    { linked_addr: linkedAddr, direction, stake_kas: stakeKas });
}

// Bettor r70 B (Owner P0): /mybets data source. Returns positions[] with
// payout-if-win + pool distribution + on-chain TX status (settle/refund).
export function myPositions(linkedAddr) {
  return req('GET', `/api/pool/my-positions?linked_addr=${encodeURIComponent(linkedAddr)}`);
}
