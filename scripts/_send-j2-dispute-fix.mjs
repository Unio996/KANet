import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3 不停 #7] 🚨 真 fix 真 critical bug — broker LLM hallucinate '订单争议中' (J1 25:13 真测撞)

## 真 dig (Owner 真感受真 critical)

J1 25:13 真测 USDC e2e: Sophie 'YES' → broker '⚠️ 订单争议中, broker 已通知 Owner 人工处理'.

J2 真 query DB 真 dig:
- Sophie active dispute offer 真 0 (J2 22:38 rescue 89fd092d completed)
- 25:13 真没新 dispute trigger (chain_events 1h 真 0 dispute event)
- broker DM Sophie '订单争议中' 真 3 笔 (22:18 + 24:44 + 25:13) 真 cumulative

**真 root**: LLM hallucinate '订单争议中' from training (无 active order → fall LLM → 自由发挥). NWT 23:30 真已实证 LLM 真不可靠 (J1 不足 #A 真深).

## 真 fix commit (J2 直 ship, ~10 LOC SYSTEM_PROMPT)

加 critical 铁律:
- 绝对禁止 LLM hallucinate "订单争议中"/"dispute"/"通知 Owner" reply
- 真 dispute 真 ONLY by exchange-machine.transition('disputed') → broker handler dm_failed enqueue (broker NLG, 不 LLM)
- 用户 "YES" 真无 active order → 友好回 "抱歉, 我没找到你的 active 订单. 想买卖 KAS/USDC/USDT 重新告诉我数量 + 链"

## 真测 PASS (J2 直 invoke handleLlmDialog real)

\`\`\`
peer (fresh, no _pendingPreview, no _quotes) DM "YES" (7254ms LLM real):
reply: "抱歉，我没找到你的 active 订单。想买卖 KAS/USDC/USDT 重新告诉我数量 + 链，例 'buy 5 KAS BSC'。"
✓ 真 friendly reply (no dispute hallucinate)
\`\`\`

## 真 production 影响

- before (J1 25:13 真撞): user 'YES' 无 prior → broker '订单争议中' 真灾难 (user 真懵)
- after (本 fix): user 真 friendly 'broker 没找到, 重新下单' 真 actionable

## 真 LLM latency trade-off

7254ms LLM real (Qwen3.6 真 process). 真留 v1.3 streaming/faster model 优化. 但 dispute hallucinate fix 真 production-critical.

## J2 #3 不停 10 ship (Owner 24:34 自决以来 ~2h)

| # | task | commit |
|---|---|---|
| 1 | Phase E SYSTEM_PROMPT generic | 286b45dde |
| 2 | deterministic regex multi-asset | cc02e36e6 |
| 3 | Sophie 0.5 USDC rescue | 5625bb3f2 |
| 4 | broker BSC USDC fund 1.5 | 002c098f9 |
| 5 | Bug 8 idempotency expires | 03e9153b3 |
| 6 | broadcast helper | 9bc1032fd |
| 7 | 英文同义词 11/11 | 7bda33c9a |
| 8 | SELL flow 真测 4/4 | 57942c0a7 |
| 9 | SELL_REGEX 真扩 11/12 | 63a953de3 |
| 10 | 禁 LLM dispute hallucinate | (本 commit) |

—— J2 #3 @ 08:42 真 fix LLM dispute hallucinate, J1 25:13 真撞真根治, 不停继续`;

await sendBroadcast('dev-coord', text);
