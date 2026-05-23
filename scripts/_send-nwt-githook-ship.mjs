const message = `[NWT] git post-commit hook ship 2df7d8861+a7ede0245 — 自治测试闭环达成 (台阶 3/4 done)

ack J2 99ecafb7f baseline + Owner 钦定 git hook. 我接做 + LIVE E2E verify.

## 完整闭环 trace (LIVE 真测)

\`\`\`
1. NWT touch broker case file (sell_kas_no_buy_hallucinate.test.mjs)
2. git commit -m "..."  → pre-commit lint PASS → commit 进了 master
3. post-commit hook 自动 fork 异步, post-commit 立刻返 (不阻塞)
4. 后台 60s 内: 推断 domain=broker (因为改了 cases/broker/), 调 scripts/test.mjs --domain=broker --quiet
5. logs/post-commit-test.log:
   files: kasia-console/test-framework/cases/broker/sell_kas_no_buy_hallucinate.test.mjs
   domains: broker
   ✓ human_buy_full_journey
   ✓ malicious_addr_swap_locked  (Bug-Z11 critical guard)
   ... 14 case 全 PASS ...
   Summary: 14 PASS / 0 FAIL / 14 run
   broker: PASS
6. PASS 静默 (设计如此, 不打扰); FAIL 才 broadcast dev-coord
\`\`\`

## hook 设计要点

- **不阻塞 commit** (post-commit 已经过, 跑测失败也不撤 commit, 是 warning)
- **智能 domain 推断**: 看 git diff 文件 → 推 domain
   - broker: src/services/broker-* / exchange-machine / asset-registry / chains / price-oracle / evm-transfer / api/conversations / test-framework/cases/broker/
   - persona/lib 改动: 触发所有 domain (lib 影响全域)
   - 未来 seeker / exchange domain 加同模式
- **console 不在跑 → 静默跳** (不报错, 不阻 commit)
- **PASS 静默 / FAIL 喧闹** (失败 broadcast dev-coord 通报作者 + 怀疑 commit hash)

## J1/J2 怎么用

跨 repo 共用: hook 文件 commit 进 \`scripts/git-hooks/\`, 你们各自机器跑一次:
\`\`\`
bash scripts/git-hooks/install.sh
\`\`\`
就把 hook 装到本机 .git/hooks/. 之后任何 commit 自动跑相关 domain test.

## 完整台阶状态

1. ✅ 文档固化 (a39ea4155)
2. ✅ 干净 baseline (99ecafb7f + 我跑测 verify)
3. ✅ **git post-commit hook** (本)
4. ⏳ cron 24/7 (next, 估 30min)

bundle: D:/kanet-sync.bundle HEAD=a7ede0245`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
