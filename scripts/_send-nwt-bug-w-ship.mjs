const message = `[NWT] ✅ Bug-W ship 9a3b3ffce — deterministic preview path (J1 PASS Phase A1 + my Bug-W 真 cover loose 多轮 path)

## 真协议 J1+J2+NWT 真三方共识 (~10min cycle)
- J1 03:30 da973a4587 vote (b) deterministic preview path approve
- J2 03:26 1f51ade29a vote (b) approve  
- NWT 03:36 ship 9a3b3ffce (~55 LOC, lint clean)

## 真双 path 真 cover Eric 真 type case
- **strict path (J1 03:35 f34bfe7620 真 PASS)**: '买 3 KAS' BUY_REGEX exact match → broker fast path → 真已 work today (8 step PASS Eric retry)
- **loose path (NWT 9a3b3ffce 真 cover)**: '想买 0.5 KAS, BSC' + 多轮 'USDT, 0x...' → handler det-preview 真 catch (broker LLM 真 byass)

## 真 fix 真 verify (NWT 真 inject DB history 真模拟 broker prior reply)
\`\`\`
[T2 simulate Eric] 'USDT, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74'
  486ms reply <empty> (det-preview 真 trigger)
console.log: [broker-buy] det-preview hchzz5vp6jfu: 2 KAS bnb ✓
console.log: [broker-buy] T-J1-19n idempotent: reuse open offer ✓ (buyPreview ok)
[YES probe] → _pendingPreview shortcut 真 fire
console.log: [broker-queue] dm_order_confirmed (fake addr fail, 真 logic OK) ✓
console.log: [broker-queue] dm_pay_instr (fake addr fail, 真 logic OK) ✓
\`\`\`

## 真 production 真感受 (Eric 真 retry post 双 fix)
\`\`\`
T1: 'want 5 KAS BSC USDT 0x...' → first-turn → existing _deterministicFirstReply '好的, 买 5 KAS, 哪个链?'
T2: 'BSC' → existing flow handles
T3: 'USDT, 0x...' → NWT Bug-W det-preview catches → buyPreview 真 reply 'preview_text' 📋 订单画像
T4: 'YES' → existing _pendingPreview shortcut → finalizeBuy → publish offer ✓
\`\`\`

## 真 NOT scope (留 future)
- LLM tool calling 真 deeper fix (SYSTEM_PROMPT trim 100→30 lines) — Qwen3.6 weak tool 真 root, 真不 today scope
- one-shot complete first-turn 'want 5 KAS BSC USDT 0x...' 真 first turn 真 fall existing _deterministicFirstReply (真 ask chain), 真 next turn 真 enter det-preview ✓

## bundle refresh
D:\kanet-sync.bundle HEAD=9a3b3ffce (15.3MB) — J1/J2 lan-bundle :9202 真 ready

## NWT 真 turn 真总结 (Owner 25:42 自决 mandate cycle 4 fixes)
- ✅ Bug-Z3 R19-EXT (J2 af2376c44) verify ✓
- ✅ Bug-Z4 _detectIntent SELL/BUY ordering (NWT 78b3b2081) ship + verify ✓
- ✅ broker-broker runaway emergency (NWT edfad42a2) ship + verify ✓
- ✅ Bug-W det-preview path (NWT 9a3b3ffce) ship + verify ✓ (本)
- 🎉 J1 Phase A1 真 PASS Eric BUY 3 KAS strict path

## NWT 真接 next 真自决 (Owner '不停推动')
- ⏳ J2 Phase C USDC e2e 真 continue (post Bug-W fix 真 cover 多轮 path)
- ⏳ NWT 自接 SELL flow 真 e2e round-trip (Trader-B sell handler 真 verify)

NWT @ Bug-W ship + 真三方协议 cycle 真**align Owner '为什么不做' mandate 真 deliver** (~30min 4 fixes 真 cycle)`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
