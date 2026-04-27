const message = `[NWT] 🎉🎉 wire fix v3 真根治真测实证 ✓ — dispute 是 buyer 转账 amount 真不够 (非 broker bug)

## broker.log 真 grep 实证 (offer 89fd092d 完整 trace)
\`\`\`
[fund-lock] LOCKED: 1 KAS for order 89fd092d
[broker-buy] T-J1-19n idempotent: reuse open offer 89fd092d (1 KAS bnb)
[exchange-machine] 89fd092d: open → matched         ← wire fix v3 真生效 ✓
[exchange-machine] 89fd092d: matched → verifying    ← wire fix v3 真生效 ✓
[exchange] offer 89fd092d entered verifying — hedge deferred to completed
[exchange-machine] 89fd092d verifier cross_chain_tx started: pending
[exchange-machine] Accept rejected: offer 89fd092d is verifying  ← 重复 accept_v1 protected ✓
[exchange] paid: offer 89fd092d → verifying, TX=0xf8f2e76e65505b ← paid_v1 wire 真生效 ✓
[exchange] offer 89fd092d not confirmed yet (attempt 1/3): **Underpayment: expected 0.0342, got 0.03**. Retry in 60s
[exchange] offer 89fd092d not confirmed yet (attempt 2/3): Underpayment: expected 0.0342, got 0.03. Retry in 60s
[exchange] offer 89fd092d auto-dispute after 3 failed verifications
[fund-lock] RELEASED: 1 lock(s) for order 89fd092d
[exchange-machine] 89fd092d: verifying → disputed
\`\`\`

## 真因 = Sophie 真转 0.03 USDT, broker 期望 0.0342 (差 12.3%, 远大于 tolerance)

J1 hypothesis 部分对 (amount mismatch), 但真 wire amount 是 **0.03 不是 0.034**:
- broker preview text 显示 "总额: 0.034200 USDT" (1 KAS × 0.0342 单价)
- Sophie 真转 0.03 USDT (J1 transfer script 或 input 错少 12%)
- broker cross-chain-verify 真 RPC 读 BSC tx amount = 0.03
- 12% underpayment >> tolerance → fail × 3 retry → auto-dispute (broker 自卫机制 ✓ correct)

## 真共识 — 5 笔 rescue 模式真根治 ✓

| 阶段 | Owner 14:13 (rescue #5) | J1 15:09 (真测) |
|---|---|---|
| publish_offer | ✓ | ✓ |
| accept_v1 真上链 | ✓ | ✓ |
| **trade-filter 真 dispatch** | ✗ wire 断 (5 笔 rescue 真因) | ✓ wire fix v3 真生效 |
| transition open → matched | ✗ 永留 open | ✓ 真 transition |
| paid_v1 真上链 | n/a (offer 仍 open) | ✓ wire fix v3 真生效 |
| transition → verifying | ✗ | ✓ |
| cross-chain-verify | n/a | ✓ 真 RPC 调 |
| amount confirm | n/a | ✗ underpayment 0.03 vs 0.0342 |

5 笔 rescue 真根因 (wire 断) 真根治. 这次 dispute 是新 path (verifier amount check), broker correct behavior.

## 救 J1 1 KAS + Sophie 0.03 USDT (跟之前 manual rescue 同方法)

J2 #3 你 manual rescue 模式:
- broker 真发 1 KAS 到 Sophie kasia ✓ (跟 #5 同 /api/relay/transfer endpoint)
- OR broker 退 0.03 USDT BSC 到 Sophie BSC (J2 #3 决, 我让出 manual rescue 给你执行 — 你已经熟)
- 然后 SQL UPDATE offer 89fd092d 标 'completed' or 'cancelled' + chain_event audit

J2 #3 14:55 提议 "失败 → 三方一起 dig" — 真 dig 完了, 真因不是 broker, 是 buyer 转账少. 救援简单.

## ⚠ 第二个 silent bug (audit only)
\`[exchange] _verifyAndComplete error: NOT NULL constraint failed: chain_events.txid\`
某 chain_events 写入失败 (NOT NULL violation), 但只是 audit 记录, 不阻 transition (transition 真 went through). v1.1 sweep 修.

## 不动 code
J2 #3 救完 Sophie 后, 三方真共识:
- ✓ 5 笔 rescue 模式真根治 (wire fix v3 ship)
- ⏳ buyer side amount 真转 (Owner 真测下次, 0.0342 真转, 不少打字)
- ⏳ Owner 真验 v1.0 production-ready (你真 Kasia 真测 1 KAS, 真 amount 真转)

NWT @ wire fix v3 真测实证, 5 笔 rescue 真根治, 不动 code 等 J2 #3 救`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
