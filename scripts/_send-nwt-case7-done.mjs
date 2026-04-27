const message = `[NWT 自治推 case 5 + case 7 全过 — 接位任务面 36/36 PASS]

Owner "赶紧干! 自治!" — 我推 case 5 + case 7 收尾.

## case 5 TTL 超时 (b4f08035, 11/11 PASS)
- 5.1 _quotes 5min 过期 + YES → fall LLM 不误触发
- 5.2 _pendingAccepts 30min 过期 + PAID hash → 自清 fall LLM
- 5.3 过期 PAID_NO_TX 不误截胡
- 5.4 expired _pendingAccepts 不阻新 finalize
- 5.5 边界 expires_at === now 视为过期 (严格 <)
- 5.6 全 paid 后 _pendingAccepts 自清 (基线复验)
- 5.7 broker_dynamic_quote idempotency mock 跑通

## case 7 链异常 (4c7374ad, 14/14 PASS — 高风险 mock 验)
- 7.1 amount 全不匹 (付少 0.5 / 付多 5.0 vs 期 1.7) → no_match
- 7.2 转错地址 (scan 扫不到) → no_match + user_msg 引导
- 7.3 链不匹 (BSC 单 user 真转 ETH) → no_match
- 7.4 RPC 全挂 → scan_failed + _pendingAccepts 保留容错
- 7.5 多笔 partial (一匹一不匹 → matched=1, paid_tx 部分设)
- 7.6 同 tx 重复扫不重复 paid (paid_tx 过滤防重)
- 7.7 amount ± 1% tolerance 边界 (+0.99% 匹, +2% 不匹)

## NWT 接位任务面累计 36/36
- ✓ case 4 改主意 (11/11 dcf0b6a7)
- ✓ case 5 TTL 超时 (11/11 b4f08035)
- ⏸ case 6 STOP/anti-spam (留 v1.1, 涉社交认知链跨多 system, 三方讨论)
- ✓ case 7 链异常 mock (14/14 4c7374ad — 真付错款待三方共跑)

## 整体 NWT 接位 (15:25 → 19:30, 4h, 13 commit)
v2 ship 7 个 (1c6ff77 / ee49a02 / 0badfe8 / 672c2cd / ec2452b / c300e6e / 9644d37)
+ 元工具 1 (96d04a4 ANTI-PATTERNS R9-R12 + lint + hook + SOP)
+ self-accept fix 完整 2 (a9e1eee + 9644d37 follow-up)
+ case 4/5/7 smoke 3 (dcf0b6a + b4f08035 + 4c7374ad)
+ doc 1 (a47896b R13)

## case 6 跳的理由 (留三方讨论)
"STOP / anti-spam (烦死了/滚 触发 do_not_contact)" 涉及:
- broker 层加 STOP_REGEX 短路 (类比 PRICE_QUERY)
- agent_connections.classification 5 态社交认知链
- relay anti-spam fail-closed dedup
- Mind proactive cooldown / auto-retire
跨 broker / connection / Mind / relay 4 system, 不是 broker 单层修, 三方讨论后再做.

NWT 接位收尾 standby. master HEAD 4c7374ad.

NWT @ 04-26 19:30`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
