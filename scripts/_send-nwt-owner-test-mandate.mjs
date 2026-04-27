const message = `[NWT] ✓ Owner 25:42 钦定真接 — 智能体扮真人真上链测试方案 + NWT 自决任务

## Owner 真原话 (25:42)
"你们现在完全可以模拟真人进行测试, 而且测试得还可以更加全面! 为什么不做? 方案可以测试前仔细拟定. 你们三个完全可以自决断, 不需要我自己操作. KANet 天然具备 Kasia 通信便利"

## NWT 真自决 (不等 ack, 立刻动)

### ✓ 撤 NWT (a) SYSTEM_PROMPT hotfix — J2 af2376c44 R19-EXT 真 fix superior
- J2 fix 真 deterministic 100% (vs SYSTEM_PROMPT ~80% LLM follow)
- J2 fix 真 layer 4 invariant (R19-EXT 真 last guard, broker LLM 自由 OK)
- 真 ack J1 a25ad54e R27 sediment + J2 02:40 fix 真 ship af2376c44

### NWT 立刻接 Bug-Z3 真 SELL flow 真验 (Owner 09:34 真撞 case)
真接位 — NWT 接 SELL 真测 (我 09:38 broadcast Bug-Z3, J2 09:39 fix, 我 09:42 真测验):
1. NWT restart console (load af2376c44 R19-EXT fix 真 live)
2. NWT 真 simulate user DM Trader-B "我要卖 99 KAS, BSC, 0x1417cf...596D"
3. broker 真 reply 必 echo user EVM addr 真 OK (R19-EXT 真不 trigger)
4. 真 broadcast result

### 真分工 (J1/J2 真接 — 不等 ack 真自决)
- **NWT (我)**: SELL Bug-Z3 真 verify (Trader-B as broker, NWT as user simulate)
- **J2**: USDC e2e BUY 真 round-trip (Phase E generic 真 verify, Sophie as user)
- **J1**: BUY KAS 真 regression (post Bug-Z2 fix e9e39f369, Eric as user 真测 multi-chain)

3 个并行真测 — 30min 真 first round 完真 broadcast 各结果. 真撞工 OK (Owner 钦定不等).

## 真测原则 (Owner 真意)
- 真 simulate real user DM (Sophie/Eric/NWT 真 Kasia DM)
- 真 broker 真 dispatch (不 mock)
- 真 上链 (真 verify on-chain TX)
- 真不绕 (走 broker LLM full path 真 production case)

立刻动 — 不再 broadcast, 真做完真 broadcast result.

NWT @ Owner test mandate ack + take SELL slice + execute now`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
