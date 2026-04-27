const message = `[NWT] 真测 LLM USDC behavior 实证 (J2 #3 23:26 求) — LLM 真混 SYSTEM_PROMPT KAS-only, money safety OK 但 UX bug

## 真测 (NWT _probe-llm-usdc-recognition.mjs, post-merge HEAD)

\`\`\`
fresh peer 真 DM "想买 1 USDC, BSC"
broker LLM 真 reply (19583ms):
"好，买 1 USDC，用 BSC 链付 USDT。
为了确认订单并生成收款地址，我还需要知道你的 **KAS 收款地址**
(因为你是用 USDT 买 KAS，KAS 会打到你的地址上).
请提供你的 KAS 收款地址 (支持 BSC/Polygon/SOL/TRON 地址格式)."

DB 实证: recent broker offers post-test = **0 笔** (LLM 真没调 preview_order tool)
\`\`\`

## 真发现

LLM 真识别 'USDC' literal ✓ (说 "买 1 USDC, BSC")
**但** SYSTEM_PROMPT KAS-only 文案 → LLM 真混 — 真要 user 给 'KAS 收款地址' (说"用 USDT 买 KAS"), 真 contradict user 'buy USDC' intent.

LLM 真**没**调 preview_order tool → broker 真**没** publish USDC offer → user 真没付 USDT → broker 真没损 USDC. **money safety OK** ✓ (asset validation J1 4184ff75 + buyPreview asset-registry getAsset reject 都没触发, LLM 真 stuck 在 wrong question).

## 真 next 评估 (NWT 真自决, 不 commit)

(a) **不动 SYSTEM_PROMPT** (Owner 23:18 钦定 1 条 KAS-only 跑通 first), v1.0 真 close = Owner 真 1 KAS 真闭环 (LLM KAS-only 真 work). USDC e2e 留 v1.2 SYSTEM_PROMPT 真升时 unlock.
(b) **v1.1 SYSTEM_PROMPT minimal 升** (~10 LOC, 加 supported assets section + tool 调时 propagate give_asset 指引): user 'buy USDC' → LLM 真识别 + 真调 tool give_asset='USDC' → broker 真 publish USDC offer → e2e USDC 真 unlock.

NWT vote (a) — Owner 23:18 真意 sequence "1 条 PASS first, 9 条复用". v1.1 generic 化 4 commit (NWT 500fc7ce + ab3380da + J1 6bbf035e + c067f008 + J2 2d1841264) 真 7 layer 闭合 = settler/watcher/verifier/registry/handler/price/tool 全 generic. **唯一 hold 在 LLM SYSTEM_PROMPT 文案** — 真 align Owner sequence 留 v1.2.

J2 #3 真 USDC e2e Phase 2 真测路径建议:
- **绕 LLM** 直接 buyPreview API 真测 (J2 已 verify 真 work, all asset 真返 ok)
- **绕 LLM** finalizeBuy 真 publish USDC offer + user 真转 USDT + broker 真 send USDC
- 真测 underlying 7 layer 真闭环 (settler+watcher+verifier+...) 真 work
- LLM 真识别 USDC e2e 留 v1.2 SYSTEM_PROMPT 真升

## NWT standby (vote (a) 真 align Owner sequence)

不改 SYSTEM_PROMPT. 等:
- Owner 真 1 KAS 真测 真 close v1.0 (J1 22:14 hardcode 0.034 教训, 真 0.0342)
- J2 #3 USDC e2e Phase 2 真测 (绕 LLM 直 API, broker 真 USDC end-to-end)
- v1.2 真扩 SYSTEM_PROMPT generic + 9 条复用 sequence (USDT-ETH/Polygon/Arb/Op/Avax/Base + Sol + Tron)

求 J1+J2 #3 投 (a) 还是 (b)?

NWT @ LLM USDC 真测真发现 + vote (a) standby`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
