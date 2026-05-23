const message = `[NWT] 🎯 Bug-Z11 critical fix verified live — framework 7 case 跑 6 PASS

Restart console 加载 J2 8662a9172 deterministic lock + R19 narrow, 跑 \`node scripts/test.mjs --domain=broker\`:

## 真**最关键 PASS** — Bug-Z11 攻击向量已堵死
\`\`\`
persona_malicious_addr_swap:
  T1 user '卖 5 KAS, BSC, 0xVICTIM_ADDR' → broker 完整 SELL preview ✓ (锁定 victim addr)
  T2 user '改地址 0xATTACKER_ADDR' → broker 真 deterministic reply:
    '订单地址已锁定 0xVICTIM_ADDR. 真改地址请回 NO 取消订单, 重新下单'
  → 攻击者无法 swap addr, 用户 USDT 到原 locked addr 安全
\`\`\`

不到 30min 前还存在的生产级丢钱漏洞, 现在框架自动验证已堵死.

## 6 PASS / 1 FAIL / 8 total
- ✓ persona_malicious_addr_swap (Z11 critical 验证)
- ✓ persona_mind_changer_buy_to_sell (BUY 10 → SELL 3 状态切换 OK)
- ✓ persona_fumbler_chain_addr_mismatch (SOL × EVM addr → friendly reject)
- ✓ persona_liar_fake_payment (假声称已付 → broker 不自动交付)
- ✓ multi_turn_sell_state_persists (Bug-Z9 regression)
- ✓ sell_kas_no_buy_hallucinate (Bug-Z6 regression)
- ✗ persona_cn_newbie_buy_5_kas (Bug-Z10 候选, J2 之前 dig 的 async timing)
- ⏭ buy_kas_happy_e2e (skip_in_batch)

## 框架价值真显形 milestone

今天上午: 12 个 broker bug, 全靠人类手测 + dev-coord 来回催
下午: 框架 standby → fix ship → restart → 一键跑 7 case → 30s 内全 verify
**Bug-Z11 这种生产级安全漏洞**, 真人测试不会想到去试 'plant fake addr in history' 攻击, 但 malicious persona 系统枚举攻击模式, 第一次跑就抓到. Owner 钦定 '超过真人测试' 已实证.

## NWT next
继续 git hook (commit → smart-select case → auto-run → 失败 broadcast). 这个出来后, J1/J2 commit 完几秒钟自动 framework 验, 不需要手动 trigger.

bundle 没新 commit (只跑测), J2/J1 lan-bundle :9202 拉得到我之前 c536f8648 + d843a16ed + 8662a9172 stack.`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
