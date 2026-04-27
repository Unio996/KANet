import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3 不停 #6] SELL_REGEX broadcast 真扩 11/12 PASS — broker-sell-handler deterministic fast path 真 broaden

加 sell 同义词进 broker-sell-handler.SELL_REGEX (跟 BUY_OVERRIDE_REGEX 同模式):
'想卖/要卖/出售/抛/想抛/想出/dump/cash out/unload/offload'

真测 11/12 PASS (1 fail 'dump my 10 KAS' 中间 'my' 不匹, 留 v1.2):
- 想卖/要卖/抛/出售/想抛 ✓ 中文同义词
- dump/cash out/unload/offload ✓ 英文同义词
- 卖/sell ✓ 原 anchor

真 production 真感受:
- before: '想卖 5 KAS' → fall LLM 1-2s
- after: '想卖 5 KAS' → handleSellIntent 真 invoke 真 fast → set _pending 真 ask BSC address (deterministic)
- LLM fast path (broker-llm-agent _detectIntent cc02e36e6 + 7bda33c9a) 真 dual-layer fallback

## J2 #3 不停 9 ship (Owner 24:34 自决 ~1.5h)

| # | task | commit |
|---|---|---|
| 1 | Phase E SYSTEM_PROMPT generic | 286b45dde |
| 2 | deterministic regex multi-asset USDT/USDC | cc02e36e6 |
| 3 | Sophie 0.5 USDC 严比例 rescue (tx 0x6d9ad9ce) | 5625bb3f2 |
| 4 | broker BSC USDC fresh fund 1.5 (tx 0x7b5f6b34) | 002c098f9 |
| 5 | Bug 8 idempotency expires_at fix | 03e9153b3 |
| 6 | broadcast helper auto-tag | 9bc1032fd |
| 7 | 英文同义词真扩 11/11 | 7bda33c9a |
| 8 | SELL flow 真测 4/4 LLM fast | 57942c0a7 |
| 9 | SELL_REGEX 真扩 11/12 | (本) |

J2 cost 累计: ~$0.10 BNB gas + 1 USDC (broker zero-loss inventory).

不停 next pipeline:
- 真 cross-chain swap (SushiSwap ETH / QuickSwap Polygon)
- LLM SYSTEM_PROMPT latency 优化
- multi-chain 真 user 真测 spec

—— J2 #3 @ 08:35 SELL_REGEX 11/12 ship, 9 ship since 自决, 不停继续`;

await sendBroadcast('dev-coord', text);
