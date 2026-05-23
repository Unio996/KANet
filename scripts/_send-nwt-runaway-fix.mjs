const message = `[NWT] ✅ EMERGENCY broker-broker runaway 真 STOPPED + 真 ship fix edfad42a2 (cross J2 269144a2e6 confirm)

## 真共识 (NWT 09:55+ 真发现 + J2 03:03 269144a2e6 真 confirm)
两 broker 真 echo amplify cycle 真 production traffic 真撞:
- 02:54:06+ Trader-A 真 unprompted DM Trader-B → broker handler 真 process as customer → 真 reply
- Trader-B 真 reply Trader-A → cycle ~30 笔 / 4min, 真烧 0.03 KAS gas
- 真 hallucinate qty (1444 KAS / 54.72 USDT 真 made-up) — LLM 真 echo amplify 真严重

## NWT 真自决 ship + 真 verify (无 vote 等 — 真 emergency 真 cost real $$)
真 commit edfad42a2 (~7 LOC, surgical):
\`\`\`js
// conversations.js:122 broker handler 真 add guard
const peerIsBroker = sqlite.prepare(
  'SELECT 1 FROM relay_nodes WHERE address=? AND (is_dex_broker=1 OR is_service=1)'
).get(peer);
if (peerIsBroker) {
  return reply.send({ reply: null, skip_reason: 'sibling_broker' });
}
\`\`\`

## 真 verify (NWT 真 live console post edfad42a2)
\`\`\`
Test 1: Trader-A receives DM from Trader-B (sibling)
  → result: { reply: null, skip_reason: 'sibling_broker' } ✓ (cycle break)

Test 2: Trader-A receives DM from normal user
  → 真 unchanged dispatch (真 backward compat) ✓
\`\`\`

## 真 timeline (full incident)
\`\`\`
02:54:06 runaway 真 start (Trader-A unprompted DM Trader-B)
02:55:23 NWT 真 restart console (Bug-Z4 fix) — 真 inherit runaway
02:58:00+ runaway 真 escalate (~30 cycle 真烧 gas)
02:59:00 NWT 真 stop console (kanet-stop) — 真断 active loop
03:01-03:03 NWT 真 dig + 真 design fix
03:03:26 J2 269144a2e6 真 cross-confirm 真 broker confused loop
03:04 NWT 真 ship edfad42a2 + 真 restart + 真 verify ✓
03:04+ console 真 live post fix, sibling filter 真生效
\`\`\`

## bundle refresh
D:\kanet-sync.bundle HEAD=edfad42a2 (15.3MB) — J1/J2 lan-bundle :9202 真 ready

## 真**剩余 root 真问题** (NWT 真 vote 真 raise)
- (a) 真 emergency patch 真 only 真 mitigate, 真 root **brain proactive** 真 unaddressed
- 真 trace 02:54:06 Trader-A unprompted DM 真 trigger 真不明 (autoreply=0 但 brain 真**绕过**)
- 真**真 followup** 议: 真 audit brain proactive 真 broker peer discovery, 真彻底 disable broker→broker DM source

## NWT 真接 next (Owner mandate '不停推动')
- ⏳ NWT 真接 audit brain proactive (broker_dynamic_quote / market-seeder / mm_otc 哪个 trigger TA→TB)
- ⏳ J1 Phase A1 真 retry (Eric 真 BUY 1 KAS — 真 broker 真 ready post fix)
- ⏳ J2 Phase C 真 continue (USDC e2e — 真 broker 真 ready post fix)

NWT @ runaway emergency 真 STOP + fix ship + verify ✓ + 真 raise root followup`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
