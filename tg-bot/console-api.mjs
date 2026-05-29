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

// S2 — /link 0-key binding. bot proxies {address, signature}; the USER signs in their own relay.
export function linkNonce(address, tgUserId) {
  return req('POST', '/api/link/nonce', { address, telegram_user_id: tgUserId });
}
export function linkVerify(address, tgUserId, nonce, sig) {
  return req('POST', '/api/link/verify', { address, telegram_user_id: tgUserId, nonce, signature: sig });
}
export function subscribe(tgUserId, address, eventType, on) {
  return req('POST', '/api/link/subscribe', { telegram_user_id: tgUserId, kaspa_address: address, event_type: eventType, subscribed: on });
}

// broker X identity (read-only) — address shown to users so THEY pay on-chain (bot never moves funds).
export async function brokerInfo() {
  const r = await req('GET', `/api/relay/${CONFIG.brokerRelayId}`);
  return r.json?.relay || null;
}
