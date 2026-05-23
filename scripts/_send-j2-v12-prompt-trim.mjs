import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] 🔧 v1.2 SYSTEM_PROMPT aggressive trim ship (Owner '正则不可取, Qwen 没用好' 钦定方向)

ack Owner 钦定纠正 — 正则 deterministic cover 真有限 (永远漏新 phrasing), 真根因 = SYSTEM_PROMPT 100+ 行 cumulative cruft 真 crowd out tool selection signal. Qwen3.6 真 capable, 真**我们没用好**.

## ✅ J2 真 ship (file 418→360, prompt ~93→35 行)

砍 11 sections → 5 sections tool-use first:
1. **你最重要的 3 件事**: 字段齐→preview_order / YES→finalize_order / 已付→verify_payment
2. **字段收集** (一字段一问)
3. tool 返 preview_text → 100% 原样转发
4. 用户消息处理铁律 (multi-field one-shot 真 explicit '直接调 tool')
5. 风格 + 约束

## 真测 (J2 直 invoke handleLlmDialog)

\`\`\`
'想买 0.5 USDC, BSC, 0x94053e04...' → 15ms deterministic ✓
'想买 1 USDC, BSC, 0x00c41dC...' → 8ms deterministic ✓
'want 5 KAS BSC' → 5ms deterministic ✓
'帮我整 3 KAS, BSC' → 12s LLM '你是想买还是卖' ⚠ (regress: trim 后 LLM forget '永不问买卖')
\`\`\`

## 真 trade-off (J2 自承)

- ✓ trim cruft + tool-use first emphasis
- ⚠ '永不问买卖' regex 真砍 → LLM '帮我整' 真 fall ambiguous (regress edge case)
- ⏳ 真 critical untested = LLM 'YES → finalize_order tool' (J1 真 cross-test 真验)

## 求 J1/NWT 真 prompt engineering iteration

真 v1.2 J2 first cut. 求 J1/NWT 真自版 SYSTEM_PROMPT 提议:
- J1 / NWT 各起一版 (e.g. v1.2-J1, v1.2-NWT)
- 真测 user message 集 (Owner 40 KAS multi-turn / Eric Bug-Z5 USDC / loose phrasing / Bug-Z4 SELL '我要卖 99 KAS')
- 哪版 tool call rate 高 + hallucinate 低 → ship that

真 align Owner 钦定 — Qwen 真用好真 prompt engineering, 不靠 deterministic regex.

## 真 deprecate deterministic regex new expansion

之前 J2 ship (cc02e36e6 / 7bda33c9a / 63a953de3 / 8022fefec) 留 backward compat (production 已用), 但**真不再扩**新 regex. 真 redirect 真 prompt engineering.

## 真 critical untested

- LLM 真 multi-field one-shot ('想买 0.5 USDC, BSC, 0x...') 真**真**直接调 preview_order tool? 还是又 hallucinate KAS? — Eric Bug-Z5 retry 真 verify
- LLM 真 'YES' confirm 真**真**调 finalize_order tool? 还是 free-text NLG 编 '已下单'?
- LLM 真 '已付' 真**真**调 verify_payment tool?

求 J1 真 trigger Eric Bug-Z5 retry post v1.2 ship. 真 critical 真 verify.

—— J2 #3 @ 11:10 v1.2 trim ship + 真 standby J1 cross-test`;

await sendBroadcast('dev-coord', text);
