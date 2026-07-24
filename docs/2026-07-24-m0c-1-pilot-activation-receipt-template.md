# M0c-1 Path B Pilot 激活收据（KANet-UI 工作流⑦·空白模板）

> **Status**: CURRENT（v0.1 空白模板·配套 `docs/2026-07-23-m0c-1-pilot-activation-runbook.md`）
> **依据**: 2026-07-24 05:xx NWT 声称清单 grep 扫描发现 MSG-120 多处"声称已实现"实际代码不存在（TTL/限流/白名单/G4 用例），Bettor 认账根因="claim==code" completeness 交叉核缺失。本模板的存在意义：**激活当刻**从运行系统实际读到的值，不是从任何设计文档/频道消息转引的值。
> **性质**: 部署产物（filled-in receipt），非设计文档。每次真实激活（含未来 pilot 结束/重开）都产生一份新收据，不是写一次的模板本身。

---

## 使用方法

激活执行者（runbook §4 走完后）逐项**现场查询**填空，禁止照抄任何设计文档/频道消息里的声称数字——每一格的值必须来自下面标注的实际查询命令的真实输出。查不到 = 留空 + 标注原因，不得假填。

## 收据字段

### (a) pilot 钱包身份 + network 回读

| 字段 | 查询方式 | 实际值 |
|---|---|---|
| pilot relay id | `relay_nodes` 表按 name 查 | |
| pilot 钱包地址 | 同上 `address` 列 | |
| network 字段 | 同上 `network` 列，**必须 = testnet-12**（runbook §2 footgun 检查） | |

### (b) pilot grant 逐字段回读（`m0c1_app_grants` 表，非设计文档写的值）

| 字段 | grant registry 实际存的值 | 对应设计声称（供比对，非权威） |
|---|---|---|
| `source_scope` | | 单一 pilot 地址 |
| `payee_scope` | | （若适用） |
| 单笔上限（amount cap 字段名待定） | | 2 KAS |
| TTL（对应字段名待定，J1 补 minute-TTL 落码后填） | | 5 min（**Codex RED 前是假声称，需以 J1 落码后的真实实现值填**） |
| `valid_from` / `valid_until` | | |

### (c) pilot 钱包余额回读

| 查询方式 | 实际值 |
|---|---|
| `GET /api/relay/:id/balance` | |
| 是否 = 50 KAS 硬顶 | |

### (d) 两 flag 状态同时回读（runbook §1 依赖，缺一不可）

| flag | 查询方式 | 实际值 |
|---|---|---|
| `ADMIN_CAPABILITY_GATEWAY_ENABLED` | kanet.env 实际内容 + `GATEWAY_ENABLED()` 运行时读值 | |
| `ADMIN_M0C1_GATE_ARMED` | kanet.env 实际内容 + `armReport()`/日志法读值 | |
| 两者是否同批次生效（无中间态窗口） | 对比两次重启日志时间戳 | |

### (e) 限流 + 网关白名单回读（J2 补齐后填，Codex MUST-FIX 2/3）

| 字段 | 查询方式 | 实际值 |
|---|---|---|
| 限流表/机制是否存在 | grep 代码库确认符号存在 | |
| 限流阈值实际配置 | | |
| gateway pilot-wallet 白名单是否存在 | grep `PILOT_WALLET_ADDRESSES` 或等价符号 | |
| 白名单内容 | | |

### (f) pilot 窗口结束后吊销回读

| 字段 | 查询方式 | 实际值 |
|---|---|---|
| revoke 命令执行时间 | | |
| `grant.revoked` 回读 | 吊销后立即查 grant registry | |
| 吊销后下一条请求是否即时拒 | 实发一条验证（G4 harness 或手工） | |

---

## 填写纪律（防重演 2026-07-24 事故）

1. **每一格都是查询结果，不是转引**——若某项设计文档声称但代码/运行时查不到，此格留空并写"未实现，见 Codex RED / issue #xxx"，不得抄设计文档的目标值充数。
2. 本收据本身不是审查环节的 GREEN 依据——它是**激活发生之后**留存的证据快照，供事后审计/事故复盘用。
3. 激活前的 GREEN/RED 判定权威仍是 NWT diff 审 + Codex 外审（本模板不替代）。

---

**关联**: `docs/2026-07-23-m0c-1-pilot-activation-runbook.md`（部署时序）、`docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md`（围栏设计权威）、coord/codex-bridge `RESPONSE-20260724-M0C1-PATHB-ACTIVATION-READINESS-CODEX-REVIEW.md`（2026-07-24 RED 判定，本模板直接回应其"claim without code-evidence"问题）。
