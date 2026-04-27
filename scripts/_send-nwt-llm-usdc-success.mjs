const message = `[NWT] 🎉 真测实证 J2 #3 286b45dde Phase E SYSTEM_PROMPT generic 真生效 — LLM 真识别 USDC 真调 tool

## 真测 (NWT _probe-llm-usdc-recognition.mjs, post 286b45dde + merge 237b1cea1)

\`\`\`
fresh peer DM '想买 1 USDC, BSC' → broker LLM 真 reply (3095ms):

📋 订单画像 (确认前)
* 方向: 买 USDC          ← LLM 真识别 USDC ✓
* 数量: 1 USDC
* 付款链: BNB (USDT)
* 单价: 1.010000 USDT/USDC ← 真 generic 价 (peg + 1% spread, Bug 5+6 真 fix 真生效)
* 总额: 1.010000 USDT
  1. 1 USDC → 付 1.010000 USDT 到 0xaD12544E... (broker 自挂)
* USDC 收件 (你的 BNB): kaspa:qpr_nwt_usdc_test_... ← ⚠ NLG bug
\`\`\`

## 真自承 vote (a) 23:30 错估再次实证 — Owner 23:43 + J2 #3 真碰撞 + NWT 真测都对

Phase E SYSTEM_PROMPT generic 真**unlock LLM-driven multi-asset USDC e2e**. NWT 23:30 vote (a) "留 v1.2" 真错 (跟 NWT 自己 23:30 实证反证 + Owner 23:43 钦定 + J2 #3 286b45dde 真 ship 都对).

跟 NWT 16:37 BigInt + v2 spec over-spec + vote (a) 三次自承同模式 — spec 必 incorporate Owner 真意 + 真测必 reverse-test 自己 spec, 不 vote stage 假繁荣.

## v1.1 真 8 layer 真闭合实证 (NWT 真测全 verify)

| Layer | by | commit | NWT 真测 verify |
|---|---|---|---|
| 1 settler 7 EVM × USDT/USDC | NWT | 500fc7ce4 | ✓ direct func dispatch |
| 2 watcher 7 EVM | J1 | c067f008 | ✓ J1 true grep |
| 3 verifier | 现存 | — | ✓ generic |
| 4 asset-registry 14 entries | J1 | 6bbf035e | ✓ getAsset USDC ok |
| 5 handler validation | J1 | 4184ff75 | ✓ buyPreview USDC reject before merge, ok after |
| 6 price-oracle generic | J1 | 13acedba | ✓ USDC=1.01 (peg) |
| 7 真 publish path Bug 5+6 | J2 + J1 | 471c1a/de95f9224 + cf5e8d4f | ✓ price 1.01 真 generic |
| 8 LLM tool args generic | NWT | ab3380da3 | ✓ propagate give_asset |
| 9 LLM SYSTEM_PROMPT generic | J2 | 286b45dde | ✓ **真测 LLM 真识别 USDC 真调 tool ✓** |
| 10 9 chain wallets register | J2 | 17 wallets | ✓ J1 cross-machine merge ok |

## ⚠ 真小 NLG bug (NWT 真测发现, v1.1 minor 修)

\`* USDC 收件 (你的 BNB): kaspa:qpr_...\` — NLG 用 asset.chain ('bnb') 但 receive addr 仍传 user_kasia (kaspa:...). 真 USDC 真 user 应付 EVM 地址 (BSC peer wallet), 不 kaspa.

真 fix (NWT 真接, ~5 LOC):
- broker-buy-handler.js buyPreview 真 detect asset.chain !== 'kaspa' → 真用 user EVM addr (但**user 真没传** — 真 USDC e2e 真要 LLM step 2 收集 user EVM addr 同 sell flow)
- 或: USDC e2e 真 settle path 真要 user 真 wallet (EVM), 真要 LLM tool args 加 receive_address (sell flow 已有)

但 — 真 production 真 user 真 'buy USDC' 真 should provide user EVM addr (LLM 真问"BSC 收款地址"). 真 SYSTEM_PROMPT 已含 step 2 字段收集 buy → 数量+链, sell → 数量+链+收款地址. **buy USDC 真特殊 — 真 user 真要传 receive_address (EVM)**, 跟 sell flow 同模式.

NWT 真接 step: SYSTEM_PROMPT step 2 加 "买 stable 真要 receive_address" + buyPreview 真接 receive_address arg + NLG 用 receive_address 替 user_kasia. ~15 LOC.

不 ETA 真做出来才 broadcast.

## 真 next NWT 自决干 (Owner 00:13 钦定 "干啊")

立刻真接:
- buyPreview NLG receive_address 真 generic (asset.chain !== 'kaspa' 真用 EVM addr, ~15 LOC)
- 真测 LLM 'buy USDC, BSC, 0xMyAddr' 真 propagate
- 真 verify USDC e2e Phase 2 真 unlock (J2 #3 真接 e2e 真测)

NWT @ Phase E 真生效 + NLG receive_address fix 真接, vote (a) 撤回再次自承`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
