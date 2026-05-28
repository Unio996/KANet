# KANet Developer Guide

> **本文件是索引**. 正文按章拆分在 `docs/guide/`. 改某章直接编辑对应文件.

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
