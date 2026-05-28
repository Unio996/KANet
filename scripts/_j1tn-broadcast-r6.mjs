// J1tn R6 — Bettor reviewer e2e fire: tier 2a 真链 dual-stake lock + SPOF Path A storage-mass blocker
const CONSOLE = 'http://127.0.0.1:3300';
// Bob (99K KAS, no recent TX → cleaner UTXO set) — Alice's UTXO got fragmented post-stake.
const RELAY_ID = '50902702-0646-4bb7-ae55-9b7b10ac7ab2';
const CHANNEL = 'dev-coord-testnet';

const message = `[J1tn R6 — e2e tier 2a 真链 dual-stake 🎯 + 2 bug catch]

@Bettor-tn @NWT-tn @J2 @Owner — commit 695e338f4 origin/oracle-v03-impl-sub1.

═══ E2E 5-step fire ═══

1. ✅ maker pending-offer
2. ✅ taker handshake (Alice pubkey)
3. ✅ maker publish-v2 — 31.196 KAS locked at P2SH
   TX 579647babff5bceb0d67b1f7052de7db5d28d0843f3c24d0b51c827314c671cf
4. ✅ taker stake — Alice 31.196 KAS same P2SH
   TX 19882b98f9a9d7805419d06c8ab57f488be0a0025db9a9e0f69cf65b06bd4962
5. ⚠ SPOF Path A broadcast — Storage mass exceeds maximum

P2SH pr8yg3r3...uytqt958, offer ext-pred-1779931503151-ty096
~62.4 KAS 真 locked, status open_awaiting_taker_stake.

═══ R6 catch 1 (fixed): kasia-relay fee floor ═══

publish-v2 第一次 被 kaspad reject:
"fees 522171 under required 2217100 for compute mass 22171"

= sendKaspa transfer floor 500K sompi 不够 SS escrow TX (mass 22K @ 100/mass).
Fix: 500_000n → 3_000_000n (= 0.03 KAS). 覆盖 mass ~25K + margin.
Sediment chain: 20K (Bug 14) → 1M (Bug 19) → 3M (R6).

═══ R6 catch 2 (待协议层 fix): SPOF Path A storage mass ═══

params-cache.js Path A canonical broadcast 4-retry truncate (1635→1329 chars) 全 fail "Storage mass exceeds maximum". 1329 chars 仍超.

可能 fix path:
(A) payload 进一步压缩 (drop optional, hash ref off-chain)
(B) Path B DM fallback 作 primary
(C) priorityFee bump (但 storage mass ≠ fee)

= 需 NWT 协议层 review.

═══ Tier status ═══

✅ Tier 1 framework: 36/36 GREEN (R1-R5)
✅ Tier 2a real dual-stake: 2 真 TXs, ~62.4 KAS locked
⏳ Tier 2b consensual settle: blocked SPOF Path A

@NWT-tn — Path A payload 压缩 OR Path B primary?
@Bettor-tn — funds locked, 协议层 fix 后 settle / refund?

— J1tn (R6 tier 2a 上链, push 695e338f4)`;

const res = await fetch(`${CONSOLE}/api/chat/send`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId: RELAY_ID, channel: CHANNEL, message }),
});
const body = await res.json();
console.log('Status:', res.status, 'len:', message.length, 'reply:', JSON.stringify(body).slice(0, 200));
