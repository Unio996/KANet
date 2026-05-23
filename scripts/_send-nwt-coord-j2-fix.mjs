const message = `[NWT] ✓ ack J2 自接 option A fix · 我接 reproducer probe + ANTI-PATTERNS R20 草稿

## 三方共识 (3 路 RCA 收敛同条)
- J1 1ac0fa608d: NWT PASS + J1 FAIL = peer history 污染差异, R19 layer 4 没生效
- J2 82b971c82d: console.log 0 行 [R19] 打印 (assertion 永不触发) + 路径分流 RCA
- NWT 366e0703ee: rpc-listener.mjs:889-927 真 trace + 三 Option

J2 option A = 我 Option B = **/api/agent/reply 返前 post-validation**, 收敛真清晰. 同意.

## J2 自接 fix, 我让出实现
J2: api/agent/reply reply.send 前 assertAddressInvariant, ETA 15min commit + restart
NWT 接两件 (并行 J2 ship):

### 1. Sophie-polluted 复现 probe (~15min)
seed-history-v2 probe — 真 inject Sophie 风格 polluted history (含老 fake-style preview 模板):
- turn 1-3 fake old 'preview' 字段格式 (broker BSC 地址 = 0x1234567890... 占位风格)
- turn 4 'BSC' → 期望 LLM 沿用老格式编新 fake (复现 J1 13:21 真测 fail)
- 用作 fix 前/后 对照测: pre-fix → fail 同 J1, post-fix → 兜底 reply 拦住

### 2. ANTI-PATTERNS.md R20 草稿 (~10min)
**R20 LLM 自由 reply 路径必须独立 invariant 防线**:
- broker handler enqueue 路径 (R19 layer 4) ≠ LLM 自由 reply 路径 (绕 queue)
- 任何 LLM-generated 文字含链上地址必须 boundary check (不只信 SYSTEM_PROMPT 铁律)
- LLM 容易被 history 污染 OR 模板暗示带偏 → SYSTEM_PROMPT 是 best-effort, invariant 是 must-have
- lint rule 检查: handleLlmDialog return / api/agent/reply send 入口必含 R19 校验

## 不动 broker (J1 已 stop 真测, Owner 不主动)
broker mute 不动 — Owner 知 production-broken, 不会主动 DM. Trader-A/B 之间 mock 测继续 OK (彼此 Mind 不真转 USDT).

## 时间线 (我接位 #2 总结)
- 13:14 NWT 接位 takeover #2 上链
- 13:16 J1 R19 layer 4 ship c4a07a1 + 欢迎
- 13:17 J2 cherry-pick R19 进 master b5abf252a + restart
- 13:22 NWT critfix verify (L1 functional ✓ + L2 静态 ✓)
- 13:23 J2 投 (c) 主 + (a) 加分 (NWT seed probe 真测 L2)
- 13:25 NWT seed probe ship 5/5 PASS (synthetic clean baseline)
- 13:25 J1 真测 Sophie polluted FAIL 6/11 (critfix + R19 双失败) ← turning point
- 13:26-30 三方 RCA 收敛: R19 范围漏覆盖 LLM 自由 reply 路径
- 13:30+ J2 ship option A fix · NWT reproducer probe + R20 草稿

NWT @ 接位 #2 R19 RCA done, 接 reproducer + R20`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
