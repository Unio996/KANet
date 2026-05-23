# 第 18 章 — 测试框架 (test-framework)

> 自治测试体系。Owner 2026-04-27 钦定 "可复用体系，超过真人测试效果"。
> 详细设计说明书 → [docs/TEST-FRAMEWORK.md](../TEST-FRAMEWORK.md)
> 实操教程（写 case / 跑 case） → `kasia-console/test-framework/README.md`

## 一句话

业务级 E2E + 用户体验 + 安全攻击 综合测试框架，落地在 `kasia-console/test-framework/`，作为 kasia-console 的 QA 子系统（不另起独立 repo）。

## 为什么是它，不是 jest

KANet 测的是 **Agent 之间通过 Kasia DM 自然语言对话**。这不是函数返回值的对错（jest 适用），是：
- broker 收到自然话能否正确回应（NLG 评估）
- 真实用户人格化模拟（"中文新手"vs"恶意攻击者"行为完全不同）
- 多维度评估（reply 自然度 / 信任信号 / 安全 invariant）
- 体验问题（broker 复读 preview 不答问题这种"软 bug" jest 抓不到）

## 三层结构

```
kasia-console/test-framework/
├── lib/                  ← 领域无关核心（runner + actions + assertions + peers）
├── personas/             ← 用户人格库（cn_newbie / liar / malicious / ...）
├── adversarial/          ← 攻击向量探针（fuzz / race / state-attack）
└── cases/<domain>/       ← 业务测试场景（broker / future seeker / exchange）
scripts/test.mjs          ← cli 入口
```

加新业务（例如 seeker）：写 `cases/seeker/*.test.mjs` + 复用现有 personas/lib，**不动框架**。

## 跑

```bash
node scripts/test.mjs --case=...      # 单个
node scripts/test.mjs --domain=broker # 整个 domain
node scripts/test.mjs --all           # 全部 (除 skip_in_batch)
```

输出 PASS/FAIL 加 trace。`must` assertion 失败 → 整个 case FAIL；`should` 失败 → warning 不算 fail。

## 现有覆盖（截至 2026-04-27 18:00）

`cases/broker/` 11 个 case：
- `sell_kas_no_buy_hallucinate` — Bug-Z6 回归
- `multi_turn_sell_state_persists` — Bug-Z9 回归
- `malicious_addr_swap_locked` — Bug-Z11 critical 安全回归
- `persona_cn_newbie_buy_5_kas` — happy path
- `persona_mind_changer_buy_to_sell` — 改主意
- `persona_fumbler_chain_addr_mismatch` — 误操作
- `persona_liar_fake_payment` — 谎报付款
- `persona_malicious_addr_swap` — 恶意 swap
- `ux_p01_broker_answers_questions` — UX P0-1
- `ux_p02_sell_confirm_words` — UX P0-2
- `ux_p03_cancel_after_confirm` — UX P0-3
- `ux_p04_buy_confirm_sync_ack` — UX P0-4
- `ux_p15_non_custodial_explanation` — UX P1-5
- `buy_kas_happy_e2e` — 真链 e2e (skip_in_batch, 手动)
- `human_buy_full_journey` — 完整 BUY UX 评估

`personas/` 6 个角色：cn_newbie / cn_newbie_sell / en_neat / mind_changer / liar / fumbler / malicious

`adversarial/` 待 J1 填

## 自动化（计划中）

- pre-commit: lint + 跑 critical case (30s)
- post-commit: 跑相关 domain (异步, broadcast 结果)
- cron: 定期跑 --all, 失败通报 dev-coord

## 长期 owner

- lib/ ← NWT 主，三方 review
- personas/ ← J2 主
- adversarial/ ← J1 主
- cases/ ← 谁加谁 own

## 跟核心铁律的关系

- "NO TX NO STATE CHANGE" → 测试有专门 `wait_for_offer_status` action 验链上状态推进
- "不猜代码" → 测试本身就是验证假设的工具，写 case = 把假设落成代码
- ANTI-PATTERNS 循环：测试发现 bug → 修 → case 守住 → ANTI-PATTERNS 加 R 条目

## 历史决策

- 2026-04-27 11:25 Owner 钦定建可复用体系
- 11:33 三方 6 问 RFC 全 align ship MVP
- 11:39 J2 ship 6 personas 第一次跑就抓 broker bug
- 12:01 三角验证 Bug-Z9 fix（NWT framework + J2 persona + J1 真链）
- 12:15 malicious persona 抓 critical R19 bypass
- 12:50 Owner 钦定固化为系统组件
