# KANet Developer Guide

> **本文件是索引**. 正文按章拆分在 `docs/guide/`. 改某章直接编辑对应文件.

## 北极星 (先对齐方向再写代码)

KANet = 建在 Kaspa 上的 **"操作系统 + 开放劳动市场"**：任何程序 / Agent 无许可接入、承接各式各样的 work、凭链上可验证的效果自动结算佣金、由 covenant 链上合约做真实裁决。四支柱（① Kaspa 上的操作系统 ② 无许可接活 ③ 凭效果付佣 ④ 链上裁决结算）+ **Track 合规锚**（协议使之可能 = Track B testnet/MIT；KANet 团队不运营付佣市场/不撮合/不托管/不收费）→ 权威表述见 [KANet-Positioning.md](KANet-Positioning.md)「北极星：Kaspa 上的开放协作协议」章。写任何功能前，先确认它服务这个北极星的哪一块。

> **⚠ 校准（Codex north-star 审查 2026-07-23）**：四支柱是 `[TARGET]` 愿景，**不是当前能力陈述**。涉及"系统当前是什么"的判断，以**代码 + 各里程碑验收（尤其 M-1.6 v0.3.1 / Gate 0）为准**，不以定位文档措辞为准 —— 定位文档含 target/current 混淆（Codex 判 RED），正照 8 条 acceptance criteria 逐行校准中，其阅读须知头列了 7 个校准点。

## 核心铁律 (永不违反)

| 铁律 | 位置 |
|---|---|
| 不猜代码, 查了再写 | [guide/rules/00-no-guess.md](guide/rules/00-no-guess.md) |
| NO TX NO STATE CHANGE — 链上先上链再写 DB | [guide/rules/00-no-tx-no-state.md](guide/rules/00-no-tx-no-state.md) |
| **真钱 endpoint 不准 "测试"** — 见 [ANTI-PATTERNS.md R-BETTOR-REAL-MONEY-API](ANTI-PATTERNS.md#规则-r-bettor-real-money-api-2026-05-14-owner-雷霆-钦定-真金白银-api-endpoint-不准-测试-每次-call--真链上-tx) | Owner 2026-05-14 雷霆钦定 — Bettor 一天 3 次越界 trigger `$1280` unauthorized 真链上交易, R-BETTOR-REAL-MONEY-API 列 13+ 黑名单 endpoint + 三段铁律 (诊断必 read-only / Mental check 三问 / explicit ack 必含 size) |

## 功能章节

| 章 | 主题 | 文件 | 行数 |
|---|---|---|---|
| 01 | 系统架构 (五大模块) | [01-architecture.md](guide/01-architecture.md) | 61 |
| 02 | 消息管道 (5 发出路径) | [02-message-pipeline.md](guide/02-message-pipeline.md) | 44 |
| 03 | Agent Mind + Skill 系统 | [03-agent-mind.md](guide/03-agent-mind.md) | 220 |
| 04 | 交易系统 (order-machine + 三模式) | [04-trading.md](guide/04-trading.md) | 37 |
| 05 | Health Monitor + Self-Healing | [05-health.md](guide/05-health.md) | 23 |
| 06 | UI 组件系统 (Alpine + Tailwind) | [06-ui.md](guide/06-ui.md) | 75 |
| 07 | Conversational Ops | [07-conv-ops.md](guide/07-conv-ops.md) | 25 |
| 08 | 市场系统 (8 数据源 + 券商 + 预测) | [08-market.md](guide/08-market.md) | 90 |
| 09 | Episode 系统 | [09-episode.md](guide/09-episode.md) | 10 |
| 10 | 关键文件速查 | [10-key-files.md](guide/10-key-files.md) | 71 |
| 11 | 时间显示规范 | [11-time.md](guide/11-time.md) | 20 |
| 12 | 已知局限 (不修, 记录在案) | [12-known-limits.md](guide/12-known-limits.md) | 30 |
| 13 | 认证系统 (agent_connections) | [13-auth.md](guide/13-auth.md) | 70 |
| 14 | 协议级自由市场 (/exchange) | [14-free-market.md](guide/14-free-market.md) | 314 |
| 15 | API 速查表 | [15-api-ref.md](guide/15-api-ref.md) | 487 |
| 16 | TN12 合约系统 (Silverscript + P2SH) | [16-tn12.md](guide/16-tn12.md) | 185 |
| 17 | 零售 DEX Agent (retail-dex, 非托管) | [17-retail-dex.md](guide/17-retail-dex.md) | 154 |
| 18 | 测试框架 (test-framework, QA 子系统) | [18-test-framework.md](guide/18-test-framework.md) | ~70 |
| 19 | broker LLM 调用 format 与多 LLM 兼容性 | [19-broker-llm-format.md](guide/19-broker-llm-format.md) | ~150 |
| 20 | Oracle 演进 (并行判定/执照/吊销, Owner thesis 落地) | [20-oracle-evolution.md](guide/20-oracle-evolution.md) | ~120 |

## 附录

| 主题 | 文件 |
|---|---|
| Agent 身份 + auto-reply 规则 (T-2026-04-22-02, v66+) | [appendix-a-auto-reply.md](guide/appendix-a-auto-reply.md) |

## 相关文档

- [DATABASE.md](DATABASE.md) — 数据库字典 (34 活跃表, 改表前必查)
- [ALPHA-CHECKLIST.md](ALPHA-CHECKLIST.md) — Alpha 达标标准
- [kanet-system-architecture.md](kanet-system-architecture.md) — 架构详细版
- [kanet-investigation-methodology.md](kanet-investigation-methodology.md) — 系统调查方法论 (六层)
- [TEST-FRAMEWORK.md](TEST-FRAMEWORK.md) — 测试框架设计说明书 (可复用体系)

## 写作规范

- 改任何章节 → 直接编辑对应 `guide/*.md`, **不要**改本索引 (除非加章)
- 新增章节: 加 `guide/NN-主题.md` + 在本索引对应位置加一行
- 跨章引用用相对路径: `[见第三章](guide/03-agent-mind.md#skill-系统)`
- 单章超 400 行考虑拆二级目录 (如 `guide/14-free-market/`)

## 最后全文结构更新

2026-04-24 拆分: 单文件 2032 行 → 19 章节文件 + 2 铁律 + 1 附录. 原 `DEVELOPER-GUIDE.md` 瘦身为本索引.

## 最近内容更新

2026-06-16: 第 20 章 oracle 演进新增 §20.12-20.16 (W1 用户路机制闭环 PASS / 403 vote-fetch 根治 / bshard M3 设计 sound+PARKED / Kaspa SS cost-model 陷阱 / oracle 强化拓展 charter 指针).
2026-06-19: 第 20 章新增 §20.17 oracle 强化 wave1 (落码前对抗共识=四正交闸框架[源/码/指令/证据文本]+三轴 determinism+abstain 三态; D-L1 judgeLine 算术判+确定性抽取+wire 落码; 离线 495/495 → 部署两节点 byte-equal 44f0982c/tree ee742325 cutover → **核心 LIVE 跑通**: 真 predicate 市场 judgeLine 真判对 verdict=NO; wave2 加固 hold). bshard 人数无限制已开启 probe 到 register+fold 13738>9999 spend-unit 墙(可解性 SIZE/COUNT probe 进行中).
2026-06-21: 第 20 章新增 §20.18 **bshard 命门链上收官** (复活 §20.14 PARKED). 部署 canonical 018df29b 双节点 byte-equal 4-vantage. **件1 deadline-gate**: `if(count!=seal_count)require(tx.time>=deadline*1000)` 编成 CLTV(共识层 enforce) 解 rolling-shard 最后一片资金卡死; tx.time=ms/deadline 烤秒/三处单位一致; 链上三臂 teeth(premature BUST/after LAND/full skip). **命门③ settle-enforce(防假赢家)**: 委员各自 re-derive payoutRoot from 链上 predicate_commit+judgeLine, claimed≠re-derive 拒签; 四 teeth(happy LAND+claim 100KAS / 假 predicate 命门① BUST / 假 payoutRoot 命门③ BUST / cross-node determinism); attack BUST 在 off-chain refuse 层. 跨节点 happy 铁证 f34c49f1+bf6bf100 witness 5 委员含 :3300 Bob. 残留 mainnet-before: RefundClaim refund-merkle 虚高 stake.
