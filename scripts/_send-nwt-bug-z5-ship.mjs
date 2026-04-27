const message = `[NWT] ✅ Bug-Z5 ship 70eb4b888 — det-preview parse current msg FIRST (J1 3c4a02216b 真 critical 真测撞 fix)

## 真 root (NWT 真自承 — Bug-W v1 9a3b3ffce 真**真 own bug**)
我 Bug-W v1 真**took asset/qty from stale broker history blindly**, 真 user explicit asset 真**ignored**:
- Eric '想买 0.5 USDC, BSC, 0x94053e04...' → my code 真 grep history → 真 first match Eric prior PASS '买 1 KAS' → asset=KAS, qty=1 (ignore user 0.5 USDC)
- broker preview 'buy KAS / 1 KAS / 0.0347 USDT' → 真 catastrophic if user confirm

## 真 fix (~30 LOC swap, 真 priority order)
**before** (Bug-W v1, BAD):
\`\`\`js
const qtyM = brokerLastBuy.match(/(?:买|buy)\s*\d+\s*(KAS|USDT|USDC)/i);
const asset = qtyM ? qtyM[2] : 'KAS';  // 真 ignored user explicit asset
\`\`\`

**after** (Bug-Z5 fix, current msg FIRST):
\`\`\`js
const buyMsgM = trimmed.match(/(?:买|想买|buy|want|...)\s*(\d+(?:\.\d+)?)\s*(KAS|USDT|USDC)\b/i);
if (buyMsgM) { direction='buy'; qty=...; asset=buyMsgM[2].toUpperCase(); }
// 真 history fallback ONLY for MISSING fields:
if (!direction || !qty || !asset || !chainInMsgMatch) { /* fill from history */ }
\`\`\`

## 真 verify (NWT 真 live console post 70eb4b888)
真 inject STALE '买 1 KAS' history + probe '想买 0.5 USDC, BSC, 0x...':
\`\`\`
[probe] reply <empty>
console.log: [broker-queue] dm_failed FAIL (fake test addr) ✓
  → dm_failed branch 真 hit → previewResult.ok=false (qty 0.5 < MIN_QTY_KAS 1.0 USDC)
  → message='最小买 1 USDC' (真 proves asset parsed as USDC, NOT KAS from stale history)
\`\`\`

真 contrast Bug-W v1 same probe:
\`\`\`
console.log: [broker-buy] det-preview: 1 KAS bnb  (真 stale history wrong asset)
\`\`\`

## 真 catastrophic 真 prevention 真 thanks J1 cancel safe
Eric 'NO' → 真 cancel safe ✓ 假 confirm 真 production 灾难:
- broker would publish 1 KAS offer (0.0347 USDT) instead 0.5 USDC offer (0.5 USDT)
- user 真 pay 0.0347 USDT → 真 receive 1 KAS (NOT 0.5 USDC)
- 真 wrong asset deliver 真同 R19/R20 wrong addr severity

## 真 lesson R28 propose 真沉淀 (J2 ANTI-PATTERNS R21-R27 series 真 align)
**R28**: deterministic mitigation 真**ALWAYS** parse current input FIRST, history 真**ONLY** fill missing fields. 真 history 真 frozen-in-time 真**absolutely 不 trump** user explicit input.
- 真原 Bug-W v1 violated this — history-first 真 design 真 wrong
- 真 fix Bug-Z5 swap priority 真 align spirit

## 真 NWT 真 turn 真 stats (Owner 25:42 mandate cycle 5 commits)
- ✅ Bug-Z3 R19-EXT (J2 af2376c44) verify ✓
- ✅ Bug-Z4 _detectIntent SELL/BUY (NWT 78b3b2081) ship + verify ✓
- ✅ broker-broker runaway (NWT edfad42a2) ship + verify ✓
- ✅ Bug-W det-preview v1 (NWT 9a3b3ffce) ship + verify ✓ (但 真 own Bug-Z5 expose)
- ✅ Bug-Z5 fix (NWT 70eb4b888) ship + verify ✓ (本)
- 🎉 J1 Phase A1 PASS Eric BUY 3 KAS via BUY_REGEX strict path
- 🚨 J2 brain reactive_reply→broker root 真 finding (J2 self-id, 真 deeper mind-manager scope)

## bundle refresh
D:\kanet-sync.bundle HEAD=70eb4b888 (15.3MB) — J1/J2 lan-bundle :9202 真 ready

NWT @ Bug-Z5 fix 真 ship + R28 propose + 真承认 own Bug-W v1 mistake (J1 catch saved) + 真不停推动`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
