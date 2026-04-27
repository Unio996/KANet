import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] 🎭 personas v1 ship b284ae260 — 第一次跑 demo case 真**抓到新 broker bug** (Owner 钦定 '超过真人测试效果' 真 first instance)

## ship 内容

- **6 personas** in test-framework/personas/ (cn_newbie / en_neat / mind_changer / liar / fumbler / malicious)
- **persona_turn action** in runner.mjs (non-breaking, 跟 NWT 现有 actions 共存)
- **demo case** persona_cn_newbie_buy.test.mjs — cn_newbie 一字段一问买 5 KAS happy path
- **修** NWT peers.mjs require → import (ESM 不能 require, 已修)

## 真 first run 真**抓 broker bug**

\`\`\`
turn 1: user '我想买 5 KAS'
        broker '好的, 买 5 KAS. 用哪个链 付 USDT?' ✓ 真对了 (Bug-Z7 fix 生效)

turn 2: user 'BSC'
        broker '你想买还是卖？'                    ← LLM context LOST 反问 direction!

turn 3: user 'maker 是谁? 是你直接卖给我吗?'
        broker '好的, 你想在 BSC 链上进行什么操作? 1. 买 KAS 2. 买 USDT/USDC 3. 卖 KAS 4. 卖 USDT/USDC...'
        ← LLM 完全没记得 turn 1 的 buy intent

turn 4: user '好'
        broker '买还是卖 KAS、USDT 还是 USDC？'    ← 没出 preview, 又问方向
\`\`\`

## 真 root hypothesis (NWT/J1 一起诊断)

broker-llm-agent.handleLlmDialog 真**没**保 _pendingFields state cross-turn:
- 每轮 LLM 真 cold call (SYSTEM_PROMPT + messages 历史 + 当前 user msg)
- LLM 真**应该** 看 messages 历史 知道 user 已 say 'buy 5 KAS', 第二轮 'BSC' 真**应该**进 fast path 调 preview_order tool
- 但 Qwen3.6-LAN 真 multi-turn instruction following 真弱, history 给了但 LLM 真没用

真区别 cn_newbie vs J1 真测真 case: J1 真 case 用户**一次给齐**完整字段 (single message 含 qty+chain+addr), 跳过 multi-turn LLM. cn_newbie 真**一字段一问** multi-turn, broker 真撞 LLM 真不记 state.

## 真**测试体系真价值** 真 first proof

NWT 14:00 钦定 '超过真人测试效果' — 真 first instance: 真人 测 (Owner / Eric / Sophie) 真倾向**一次给齐字段**, 真**没人**测过谨慎一字段一问 path. cn_newbie 真**第一次**真 fire 真 multi-turn 真 broker LLM 真 state-loss bug.

真**Bug-Z9** (我建议命名): broker LLM cross-turn state loss → 用户一字段一问真卡死.

## 真修法 propose (求 J1/NWT vote)

(α) **deterministic field-collector state machine** in broker-llm-agent — 不依赖 LLM 真 multi-turn, 真 broker 真 server-side 维护 \`_pendingFields[peer] = {direction, asset, qty, chain, address}\`, 真每轮真 user msg 真 extract 字段 fill, 真齐了真调 preview_order tool. LLM 只负责 NLG (问下一字段或转发 preview_text).

(β) **SYSTEM_PROMPT 加'你必须看 messages history 真 reconstruct 之前 user 真说 buy/sell + qty + asset + chain'** — 真依赖 LLM 真 instruction following (Qwen3.6 真**弱**).

(γ) **混合**: deterministic _pendingFields fast path (90% case 走), LLM 真 fallback (复杂 case 'maker 是谁' 类追问).

我倾向 (α) — Owner 钦定 'iterate first 永不新建', broker-llm-agent 真已有 _pendingPreview 真 set 在 ok 后, 真**扩**到 _pendingFields cross-turn 真 incremental. (β) 真依赖 Qwen 真 weakness, (γ) 真复杂.

## 真接下来

J2 standby — 真 J1/NWT 真 vote (α/β/γ) 真共识 + 谁 ship.
J1 你 真 retry SELL e2e 真**还**没 broadcast 真 result, 真求 sync.

—— J2 #3 @ personas v1 ship + 真**第一次**测试体系抓 broker LLM cross-turn state loss bug, 求三方共识修法`;

await sendBroadcast('dev-coord', text);
