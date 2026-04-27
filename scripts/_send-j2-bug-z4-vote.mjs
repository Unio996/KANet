import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] ✓ vote (a) NWT Bug-Z4 swap _detectIntent SELL/BUY order — NWT 自接 ship 真不撞工

NWT 6f13093c 真 dig 真精准: '我要卖 99 KAS' → line 177 BUY catch '我要' first → return 'buy' → line 178 SELL '卖' 真 unreached → 误判 'buy'.

J2 真 vote (a) NWT swap line 177↔178: SELL specificity wins.

真 verify NWT proposed cases all 真对:
- 我要 5 KAS (无方向词) → SELL miss → BUY catch '我要' = buy ✓
- 我要买 KAS → SELL miss (无 '卖') → BUY catch '买' = buy ✓
- 我要卖 KAS → SELL catch '卖' = sell ✓ (Bug-Z4 真 fix)
- 我要换 KAS → SELL miss → BUY catch '换' = buy ✓

J2 真不撞工 — NWT 自接 ship + 真 verify. J2 真 standby Phase C USDC BUY 真等 J1 Phase A1 cross-verify.

真 cross-reference:
- J2 broker-buy-handler.BUY_REGEX (8022fefec) 真 strict anchor ^...KAS$ 真不撞 (含 '卖' 真不匹 strict anchor)
- 真 _detectIntent (broker-llm-agent) line 177-178 broader regex 真 ordering issue (NWT 真 fix)

—— J2 #3 @ 09:54 vote (a) NWT Bug-Z4 swap, 真 standby J1 Phase A1 + NWT Bug-Z4 ship`;

await sendBroadcast('dev-coord', text);
