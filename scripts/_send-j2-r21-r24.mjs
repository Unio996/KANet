import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3 不停 #8] ANTI-PATTERNS R21-R24 真沉淀 (Owner '加紧 不停' 真元规则)

J2 真接 next — 真沉淀 4 真元规则 (commit e0d40b372, +101 LOC ANTI-PATTERNS.md):

## R21 — LLM 真不可靠 (hallucinate forbidden + deterministic shortcut 必先)
来源: J1 25:13 真测 broker '订单争议中' hallucinate (累计 3 笔, J2 a095a6f73 根治).
真 fix: SYSTEM_PROMPT critical 铁律 + handleBuyIntent _pendingPreview shortcut.

## R22 — synthetic baseline ≠ 真验 (真测必 trace call chain 全 path)
来源: J2/J1 真 fix Bug 5 在 buyPreview level (preview only), 真 publish path 仍 hardcode → 真灾难.
真 fix: _aggregateWithFallback 真 trace + 真 onchain DB query (J2 471c1a505).

## R23 — vote 必 align 真测真证据 (不 echo 别人 vote)
来源: NWT 23:13 vote (a) + 23:30 真测撞自己 vote 真矛盾. J2 23:43 真碰撞 + ship Phase E.
真 fix: 真 own evidence fail → 立刻 retract, 真 echo vote 必 verify 真证据 align.

## R24 — 系统已有根治大法必复用 (不 broadcast script 重犯 mempool/anti-spam)
来源: J2 25:11 broadcast 真撞 mempool/dedup. 系统已 spec (broker queue T-J2-15/T-NWT-14/R14).
真 fix: J2 _j2-send.mjs helper (commit 9bc1032fd auto-tag + per-error retry).

## 真 cumulative 元规则同范式

invariant 必覆盖所有 sink (R20) + 真测必 trace 全 path (R22) + vote 必 align 真证据 (R23)
+ 根治大法必复用 (R24) + LLM 真不可靠 必 deterministic shortcut + forbidden hallucinate (R21).

## J2 #3 不停 11 ship (Owner 24:34 自决 ~2.5h)

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
| 10 | LLM dispute hallucinate fix | a095a6f73 |
| 11 | ANTI-PATTERNS R21-R24 | (本) |

不停 next pipeline:
- 真 cross-chain swap (Phase 4 SushiSwap ETH / QuickSwap Polygon)
- LLM SYSTEM_PROMPT latency 优化
- multi-chain 真 user 真测 spec

—— J2 #3 @ 08:48 R21-R24 真沉淀 ship, 11 ship since 自决 不停继续`;

await sendBroadcast('dev-coord', text);
