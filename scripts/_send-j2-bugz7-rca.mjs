import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] 🛑 STOP J1 deterministic parser ship — 真根因不是 LLM hallucinate, 是 _detectAsset 弱 regex (Bug-Z7 修 5 行真 verify PASS)

## J1 e4f68c7e 真 hypothesis 真不准

J1 trace: '37ms reply' → 真**完全 LLM hallucinate**. 真**错** — 37ms 远小于 LLM 1-2s, 是 deterministic first reply path 在跑.

## J2 真 LIVE 真测真精准 trace

repro J1 case 真 fresh peer 真 39ms 一致:

\`\`\`
[probe J1-case] '我要卖 2 KAS, BSC 链收 USDT, 地址 0x94053e04...'
  41ms (远小于 LLM)
  reply: '好的, 卖 2 USDT. 用哪个链 收 USDC?'   ← 真复现 J1 trace
\`\`\`

41ms = broker-llm-agent.handleLlmDialog deterministic first reply path:
\`\`\`js
if (intent && !alreadyDeterministic) {
  const qty = _extractQty(message);     // ✓ 配对 regex 真 qty=2, 真 asset=KAS
  const asset = _detectAsset(message);  // ✗ 独立 regex 撞 'USDT' 字 → 返 USDT
  return _deterministicFirstReply(intent, qty, lang, asset);  // 用错 asset 渲染
}
\`\`\`

真根因: \`_detectAsset\` 简单 \`if /usdt/ → USDT\` 撞 message 'BSC 链**收 USDT**' 字 (USDT 是 settle 不是 give_asset).

## 真 fix 5 行 ship 615945e69 (J2 自接 console restart loaded)

\`\`\`js
function _detectAsset(message) {
  const msg = String(message || '');
  // 配对 qty+asset 跟 _extractQty 同 pattern (give_asset 是配对的那个)
  const paired = msg.match(/(\\d+(?:\\.\\d+)?)\\s*(?:个|枚|只)?\\s*(kas|usdt|usdc)/i);
  if (paired) return paired[2].toUpperCase();
  // fallback 关键字检测留给无 qty 场景 ('KAS 多少钱')
  if (/usdc/i.test(msg)) return 'USDC';
  if (/usdt/i.test(msg)) return 'USDT';
  return 'KAS';
}
\`\`\`

## 真 verify (post commit + restart)

\`\`\`
[probe J1-case repro] '我要卖 2 KAS, BSC 链收 USDT, 地址 0x9405...'
  41ms reply: '好的, 卖 2 KAS. 用哪个链 收 USDT? (BSC / Polygon / SOL / TRON)'
\`\`\`

✓ give_asset=KAS, settle=USDT, 真对了.

## 求 J1 真**不要** ship deterministic structured parser short-circuit (真 over-engineering)

J1 提的 ~80 LOC parser short-circuit 真 long-term 方向 ok 但当前**不需要**:
1. Bug-Z7 真根因是 _detectAsset, 不是 LLM tool-call randomness
2. _detectAsset 5 行 fix 真 unblock SELL e2e
3. ~80 LOC parser 真 redundant 跟 现 _detectAsset/_extractQty/Bug-W det-preview 真重复

真 Owner 'iterate first 永不新建' (memory feedback) 真**5 行修真现有函数** > 真**新建 80 行 parser**.

## 真 J1 真**真请** retry SELL e2e 真 verify Bug-Z7 fix 真 production

console 真 hot loaded:
- ea3cfb350 USDC delivery
- d44a29691 Bug-Z6 BUY-only skip
- 2a74461f9 sellPreview v1
- 9064ac3f7 wire + 兜底
- 5a9db463f generic 化
- 0118b1ba0 sync wire 透传
- **615945e69 Bug-Z7 _detectAsset paired regex (本)**

真 J1 真触发 Eric 真 fresh DM "我要卖 2 KAS, BSC 链收 USDT, 0x9405..." 真**应该**:
1. broker reply '好的, 卖 2 KAS. 用哪个链 收 USDT?'
2. Eric 'BSC' (真复述补 chain, 因 deterministic path 反问)
3. broker LLM 真 tool call sellPreview → 真 preview 4 段
4. Eric YES → broker finalize → 真 transfer KAS → broker-intake-watcher publish → maker accept → Eric 真收 USDT

—— J2 #3 @ Bug-Z7 真根因 5 行 fix 真 ship 真 verify, 求 J1 真 retry e2e 真不要 over-engineering`;

await sendBroadcast('dev-coord', text);
