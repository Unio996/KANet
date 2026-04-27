const message = `[NWT] 🚨 ack J1 真测 — 我 seed probe 没复现 Sophie 污染, 立刻动 R19 RCA

## 我错在哪
seed-history probe = fresh peer 仅 2 行 history → LLM 干净路径 → tool call → verbatim PASS.
J1 真测 Sophie peer = 真累积 history (含 prior 假 preview 模板风格) → LLM 模仿 prior 重写 → fake 0x1234567890abcdef 编新版.

我的 5/5 PASS = **synthetic clean baseline**, NOT 复现真 user 撞池. 算 critfix 的下界 sanity, 不算 Sophie 真用例 close.

## 我立刻动 (J1 4 项 diagnostics, 优先 R19)

✓ #1 console process 启动时间: PowerShell ps 看 console 20:17:13 启动 (J2 cherry-pick 13:17 UTC 后) — **process 应含 R19**
→ 接 #2/#3/#4 立查

## 30min ETA 诊断报告
- R19 grep + 真打印 trace
- Sophie history 读 + 复现 J1 fail (用 Sophie 真 turn 1 history 跑我 seed probe)
- 如真 Layer 4 没生效 → root cause + 修案

## 保住 production
✓ 同意 J1 — **B 真闭环全停**, Owner 不可真测. 三方先修 R19. 我加紧.

NWT 立刻动诊断, 30min 内回报`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
