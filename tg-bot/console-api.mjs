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

// gate D onboarding — faucet: bot calls the internal localhost faucet (FaucetRelay) to send the
// user testnet KAS. Backend stays localhost; the bot is the only "public" surface (Telegram DM).
// once-per-address guard lives server-side; per-Telegram-user cooldown is enforced in the bot.
export function faucetRequest(walletAddress) {
  return req('POST', '/api/faucet/request', { wallet_address: walletAddress });
}

// broker X identity (read-only) — address shown to users so THEY pay on-chain (bot never moves funds).
export async function brokerInfo(brokerRelayId) {
  if (!brokerRelayId) return null;
  const r = await req('GET', `/api/relay/${brokerRelayId}`);
  return r.json?.relay || null;
}

// S-C — prediction markets (J1 S-B, contract frozen r81). Read-only for the in-chat menu.
export function poolMarkets({ status, category, limit = 50, offset = 0, broker_relay_id } = {}) {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (category) q.set('category', category);
  // broker-scoped: pass through to the SAME canonical /api/pool/markets?broker_relay_id filter the
  // Kasia broker-DM markets-tool uses (broker-llm-agent.js:594) — one filter source, two broker faces.
  if (broker_relay_id) q.set('broker_relay_id', broker_relay_id);
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
// DoD #1.3 (Bettor r316): switched from register-external (v0.5 only) to register-v06 endpoint, which
// now dual-handles v0.6 + v0.7 markets (PoolSide ctor identical, helper switches by version internally).
// v0.5 markets are no longer offered via /bet (filter in prediction-menu.mjs excludes them).
export function poolRegisterPrep(marketId, { linkedAddr, direction, stakeKas }) {
  return req('POST', `/api/pool/market/${encodeURIComponent(marketId)}/bettor/register-v06/prep`,
    { linked_addr: linkedAddr, direction, stake_kas: stakeKas });
}
export function poolRegisterConfirm(marketId, { linkedAddr, direction, stakeKas }) {
  return req('POST', `/api/pool/market/${encodeURIComponent(marketId)}/bettor/register-v06/confirm`,
    { linked_addr: linkedAddr, direction, stake_kas: stakeKas });
}

// Bettor r70 B (Owner P0): /mybets data source. Returns positions[] with
// payout-if-win + pool distribution + on-chain TX status (settle/refund).
export function myPositions(linkedAddr) {
  return req('GET', `/api/pool/my-positions?linked_addr=${encodeURIComponent(linkedAddr)}`);
}

// ── TG custodial wallet (Owner 钦定 2026-06-23, 零门槛玩): Console 持 key, bot 0-key 只调 ──
// create 返助记词【仅一次】(display-once, bot 显给用户存后即弃, 不留); get 永不回助记词。
export function tgWalletCreate(tgUserId) {
  return req('POST', '/api/tg-wallet/create', { tg_user_id: tgUserId });
}
export function tgWalletGet(tgUserId) {
  return req('GET', `/api/tg-wallet/${encodeURIComponent(tgUserId)}`);
}
// Path C 转账 (Bettor 拍): Console 经 relay 唯一出口转账。tg_user_id = ctx.from.id = 属主授权
// (bot 只用调用者自己的 id, 一人只能从自己钱包转出)。Console 侧 just-in-time 解密派生 privkey, bot 0-key。
export function tgWalletSend(tgUserId, to, amountKas) {
  return req('POST', `/api/tg-wallet/${encodeURIComponent(tgUserId)}/send`, { to, amount_kas: amountKas });
}

// ── broker onboarding (Owner 钦定 2026-06-22): user 在 bot 里申请当 broker (地址制) ──
// 申请落 pending; Owner 经 /identities 批 trust→approved 才激活 (auth 门已落 = 公开自助安全)。
// 状态查 (token 永不回); 申请提交 (用户的 /link 地址 + 他的 @BotFather token)。
export function brokerOnboardStatus(address) {
  return req('GET', `/api/kanet-broker/onboard/status?address=${encodeURIComponent(address)}`);
}
export function brokerOnboardApply({ address, token, username }) {
  return req('POST', '/api/kanet-broker/onboard', { broker_address: address, bot_token: token, bot_username: username });
}
// broker 收益统计 (Owner 钦定 2026-06-22): address-keyed (地址制, 外部 broker 也查得到)。
// 后端 J2 /api/kanet-broker/earnings-by-address/:address → {by_market:[{market_id,title,fee_kas,
// status,settle_txid,shards}], totals:{realized,pending}}。fee=价值分成(1.6%×池), 非旧 maker_stake×pct。
export function brokerEarningsByAddress(address) {
  return req('GET', `/api/kanet-broker/earnings-by-address/${encodeURIComponent(address)}`);
}

// ── owner-in-dev-channel bridge (Step3) — pure messaging, 0-custody (no key / no value) ──
// Direction A (Owner Telegram → dev-coord): post the Owner's message via the owner-voice relay
// (resolveOwnerVoiceRelayId). /api/chat/send mirrors the Console Live Chat send; the relay's address
// must be classified trust_level='owner' (Step1 firewall OR-clause) or Console returns 403.
export function postOwnerMessageToDevCoord(relayId, message) {
  return req('POST', '/api/chat/send', { relayId, channel: 'dev-coord-testnet', message });
}
// Direction B (dev-coord → Owner Telegram): read recent dev-coord-testnet messages, filter to those
// strictly newer than sinceIso in JS (created_at is ISO 8601, lexicographically sortable). Returns
// { ok, messages } ascending by created_at (oldest first) so the poller pushes them in order.
export async function devCoordMessagesSince(sinceIso, limit = 50) {
  const r = await req('GET', `/api/chat/messages?channel=dev-coord-testnet&limit=${encodeURIComponent(limit)}`);
  const all = r.json?.messages || [];
  const fresh = sinceIso ? all.filter(m => m.created_at && m.created_at > sinceIso) : all;
  return { ok: r.ok, messages: fresh };
}
