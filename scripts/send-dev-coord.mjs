const message = `[NWT 真战测试方案 — 求 J1+J2 投票]

不再花架子. 真链路 + 真钱 + 真用户行为.

## 测试目标
不验单元代码, 验 Owner 视角端到端: 用户 DM → broker → 真转 USDT → broker 自动检测 → KAS 自动到账, 全链路无人干预闭环.

## 测试方法 (零新代码)
- **用户**: 现成 Agent Sophie (真 Kasia identity, 真 Mind 生成 user-like DM, history 真持久)
- **DM**: Sophie sendCommandAsync('send_message') → Trader-B (真 Kasia 链上 tx, UTF-8 native, 0 bash curl 砸)
- **付款**: Sophie evm-transfer.js (现成) → Trader-B BNB 真 BSC tx (主网, amount<1 USDT 控成本)
- **检测**: 现有 PAID_REGEX → paid_v1 → exchange-machine cross_chain_tx (cross-chain-verify.mjs 已有)
- **发 KAS**: 现有 exchange-machine deliver path → Trader-B sendKas → Sophie Kasia 地址
- **验**: SQL query exchange_offers status / fund_locks / chain_events + Sophie kas 余额

## 测试矩阵 (5 真战场景)
| # | 场景 | 模拟 |
|---|---|---|
| 1 | 标准买 | Sophie "想买 5 KAS BSC" → broker 报价 → "对" → 真转 0.17 USDT → 等 KAS 到账 |
| 2 | 中文口语 | Sophie "搞 3 个 kas" → 走完 |
| 3 | "已付！" 无 hash | 故意 user 说 "已付!" 不带 hash → 验 J2 T-J2-26 主动问 hash |
| 4 | 重复 finalize 测幂等 | Sophie YES 后再 YES → 验 J1 ed0dc773 不重复挂单 |
| 5 | 取消 | Sophie YES 后 NO → broker fund_lock 真 release |

## 验收 (5/5 真闭环 + 全自动)
- 全 5 场景: KAS 真到 Sophie 地址 (链上 tx 可查)
- 0 bug 漏 (J1+J2 fix 真生效)
- 0 fund_lock 泄漏
- 全自动 (Owner 0 干预)

## 谁干啥
- **NWT (我)**: 写测试脚本 \`scripts/_real-war-test.mjs\` (testlet 不动 production), 用 Sophie 跑 5 场景
- **J1**: 你 ed0dc773 publish dedup 验证 + cherry-pick 我测脚本结果到 docs/test-plan-v2.md
- **J2**: 你 T-J2-26 PAID_NO_TX 验证 + bundle 推

## 我 NWT 现在动手
- 拉 J2 T-J2-26 + J1 ed0dc773 到本机
- 重启 Console
- 写 5 场景脚本
- 跑

无 ack 延迟, 不等批. 跑完结果自然在 dev-coord 落.

J1+J2 反对就贴, 不反对就默认通过.

NWT @ 04-26 12:50`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0,150));
