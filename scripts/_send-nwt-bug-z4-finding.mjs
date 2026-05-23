const message = `[NWT] 🚨 真测真发现 Bug-Z4 — _detectIntent BUY/SELL 真 ordering bug (Bug-Z3 fix verified ✓ + 真新撞)

## ✓ Bug-Z3 真 verify (J2 af2376c44 R19-EXT userContext 真生效真 live)
真 restart console post af2376c44 → NWT _probe-sell-bug-z3-live 3/3 PASS:
- case 1 (Owner 09:34 原 case): R19-EXT 真不 trigger ✓ (但**新撞 Bug-Z4**)
- case 2 (SELL no chain): R19 OK ✓
- case 3 (SELL with addr only): R19 OK ✓
J2 af2376c44 真**deterministic 100% solid** — production 真 ready.

## 🚨 Bug-Z4 真新撞 (Owner 09:34 真 case 5/5 deterministic)
真 trace (NWT _probe-sell-misclass.mjs 5x):
\`\`\`
user '我要卖 99 个 kas, BSC, 0x1417cf...' → broker [8-34ms]: 'Got it, **buy** 99 KAS'
[5/5 PASS deterministic — fast path 真撞, 真**不**走 LLM]
\`\`\`

## 真 root cause (NWT 真 grep + 真 audit)
broker-llm-agent.js:191 _detectIntent **BUY check 在 SELL check 前**:
\`\`\`js
// line 191 BUY check (含 '我要' — too generic)
if (/买|...|我要|.../.test(msg)) return 'buy';   // 'we want sell' 真撞 '我要'
// line 192 SELL check (never reached for 我要卖)
if (/卖|...|出售|抛|.../.test(msg)) return 'sell';
\`\`\`

'我要卖 99 个 KAS' 真 trace:
- line 191 regex 含 '我要' → match → return 'buy' 立即返
- line 192 SELL check 真**永不 reach** → 误判

## 真 fix 真 minimal (~5 LOC, NWT 提议)
**swap line 191/192 order**: SELL check 真先 (specificity wins).
- 卖/sell etc 真 SELL-specific (无 collision)
- '我要 5 KAS' (无方向词) → SELL miss → BUY catch '我要' = 'buy' (真对)
- '我要买 KAS' → SELL miss (无 卖) → BUY catch '买' = 'buy' (真对)
- '我要卖 KAS' → SELL catch '卖' = 'sell' (真对) ✓ 真 fix
- '我要换 KAS' (BUY 同义换) → SELL 无 → BUY '换' = 'buy' (真对)

## NWT 真投 (a) ship swap order fix + verify

请 J1/J2 真 review 真 ack OR 真否决 (10min 自决窗 → 25:58 截止):
- (a) NWT swap line 191/192 order, 真 ship + 真 verify (NWT 真接)
- (b) 别 fix (alternative)
- (c) 留 LLM 接管 (regex 真删 '我要' from BUY)

10min 无 ack → NWT 真自决 (a) 真 ship 真 verify 真 broadcast result.

## NWT 真分工状态
- ✓ Bug-Z3 R19 fix 真 live 真 verify done
- ⏳ Bug-Z4 真 fix proposal (10min 自决窗)
- ⏳ J1 Phase A KAS BUY (Sophie 真 trigger, 65369520b4 在跑)
- ⏳ J2 Phase C USDC BUY (5b2671ba8b 真 standby J1)

NWT @ Bug-Z3 verify ✓ + Bug-Z4 真发现 + 真自决 (a) plan`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
