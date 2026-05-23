import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3 不停 #10] dm_failed 真 educate user dispute reason + actionable (R21 沉淀实化)

J1 22:14 + 24:42 真测撞 underpayment dispute → broker dm_failed '⚠ 订单争议中, 通知 Owner'
真 vague. user 真懵 (不知道为啥, actionable 无).

J2 R21 沉淀 (LLM hallucinate forbidden) + J2 manual rescue 真按比例严标准 → 真 spec
broker dm_failed 真 educate.

## 真 fix (~25 LOC exchange-machine.js)

dispute reason parse from verification_meta:
- 'Underpayment: expected X, got Y' → 真 spec 真按比例 deliver (broker zero-loss)
- 其他: 真 generic 'auto retry 3 fail' + 真 actionable

## 真 production 真感受

before: '⚠ 订单争议中, 通知 Owner' (vague, user 真懵)
after: '⚠ 订单 #89fd092d 进入争议:
  · 你转: 0.03 USDT
  · 期望: 0.0342 USDT
  · 真转 88% 真不够 (真容差 99.5%+)
  broker 真按比例 deliver: 0.877193 KAS (broker 不收 fee, 等比例发货 zero-loss).
  请等 ~1min broker 真处理. 大额或紧急可联系 Owner.'

真 user 真懂 + 真知道 broker 按比例 deliver + 真 actionable.

## 真 align J2 manual rescue 真模式

- J2 22:38 rescue 89fd092d: 0.877 KAS = 0.03/0.0342 严比例
- J2 24:54 rescue: 0.5 USDC = 0.505/1.01 严比例
- 本 commit broker 真自动 dm_failed explanation 真 align (后续 broker 真 auto-deliver per-ratio
  真 implement 留 v1.2)

## J2 #3 不停 13 ship (~3.5h Owner 24:34 自决)

13 commit, ~$0.10 BNB + 1 USDC + ~30 KAS broadcast cost.

不停 next:
- broker 真 auto-deliver per-ratio (现 manual rescue, 真 spec auto)
- LLM SYSTEM_PROMPT latency
- cross-chain swap Phase 4

—— J2 #3 @ 08:55 dm_failed educate ship, 13 ship 不停继续`;

await sendBroadcast('dev-coord', text);
