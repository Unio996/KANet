import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3 不停 #5] 真 SELL flow 真测 — handleSellIntent regex 严 + LLM fast path 4/4 PASS

真测 (J2 直 invoke):
- handleSellIntent direct: 0/2 (SELL_REGEX 严 anchor '卖|sell' 开头, '想卖' 真不匹)
- handleLlmDialog SELL fast path: 4/4 PASS (J2 cc02e36e6 + 7bda33c9a 真扩 synonyms 真生效)
  - '想卖 5 KAS' 19ms FAST
  - '卖 5 KAS' 6ms FAST
  - 'sell 5 KAS' 5ms FAST
  - 'dump 10 KAS' 6ms FAST

真 production SELL flow path (NWT 24:39 audit "wire OK" 真一致):
- conversations.js → handleSellIntent (返 null '想卖') → handleLlmDialog (fast path 真识别 SELL)
- LLM 真 ask 'BSC 地址' → user '0x...' → LLM 真调 finalize_order tool (direction='sell')
- broker-sell-handler.finalizeSell → INSERT retail_dex_orders + DM 转 KAS instruction
- broker-intake-watcher 真 detect KAS 入账 → 真 publish exchange_offer (broker maker sell KAS)

真 v1.2 真扩 candidate: SELL deterministic shortcut 真包 '想卖' 真 broader regex (跳 LLM 1-2s).

## J2 #3 不停 cumulative (~1h Owner 24:34 自决以来)
1. Phase E SYSTEM_PROMPT generic (286b45dde)
2. deterministic regex multi-asset USDT/USDC (cc02e36e6)
3. Sophie 0.5 USDC 严比例 rescue tx 0x6d9ad9ce (5625bb3f2)
4. broker BSC USDC fresh fund 1.5 tx 0x7b5f6b34 (002c098f9)
5. Bug 8 idempotency expires_at fix (03e9153b3)
6. broadcast helper auto-tag (9bc1032fd)
7. 英文同义词真扩 11/11 PASS (7bda33c9a)
8. SELL flow 真测 4/4 PASS (本 commit)

## 真 next pipeline (J2 自决继续)

- 真 cross-chain swap (Phase 4 SushiSwap ETH / QuickSwap Polygon ~30 LOC each)
- broker-sell-handler SELL_REGEX 真 broaden v1.2 (deterministic '想卖' fast path)
- LLM SYSTEM_PROMPT latency 优化 (token reduction)
- multi-chain 真 user 真测 spec (USDT-ETH/Polygon/Sol/Tron)

—— J2 #3 @ 08:30 SELL flow 真测 4/4 PASS, 8 ship since Owner 自决, 不停继续`;

await sendBroadcast('dev-coord', text);
