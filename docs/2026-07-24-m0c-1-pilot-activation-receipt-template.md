# M0c-1 Path B Pilot 激活收据（KANet-UI 工作流⑦·空白模板）

> **Status**: CURRENT（v0.1 空白模板·配套 `docs/2026-07-23-m0c-1-pilot-activation-runbook.md`）
> **依据**: 2026-07-24 05:xx NWT 声称清单 grep 扫描发现 MSG-120 多处"声称已实现"实际代码不存在（TTL/限流/白名单/G4 用例），Bettor 认账根因="claim==code" completeness 交叉核缺失。本模板的存在意义：**激活当刻**从运行系统实际读到的值，不是从任何设计文档/频道消息转引的值。
> **v0.2 更新**: 四条控制已全部补齐落码（J1 `944f2a72` TTL / J2 `cf680280` 限流+白名单 / J1 `2fbdb290` G4 harness v0.2 21/21），均经 claim-to-code 三道核（自核+Bettor grep+NWT 独立扫描）GREEN。下方 (b)(e) 已补代码坐标（供激活时对照查询用，坐标本身已核实存在，具体运行时值仍需激活当刻现查填空）。
> **v0.3 更新（2026-07-24 06:17，Codex MSG-121 再审 MUST-FIX 1 修正）**: **v0.1/v0.2 全程查错钱包**——`custodial_transfer` 实际出钱的是 `tg_custodial_wallets` 表按 `fromAddress` 选出的托管钱包（`kasia-console/src/api/capability.js:163-164` `deriveCustodialExecFields`），**不是** relay 自身的运营钱包（`relay_nodes.address`，`GET /api/relay/:id/balance` 查的是这个，只用于 relay 付 gas/日常 IPC）。两者是完全不同的身份/余额。NWT 独立读码坐实"极其严重"。本版 §(a)(c) 已改为区分两个身份、余额回读改查 custodial 地址真实链上 UTXO。
> **v0.4 更新（2026-07-24 07:xx，Codex MSG-122 四 MUST-FIX 全 CLOSED+源码包 GREEN，armed=on 前 pre-activation B 项）**: 四 MUST-FIX 全部收口后，Codex 放行呈 Owner 做 Path B go/no-go 决策，但指出 claim-to-code（审过代码写对了）不等于 claim-to-deployed（真实跑的进程 == 审过的那份代码）——中间隔着一次部署动作没人核过。新增 §(h) 部署代码钉死回读：部署 commit SHA 核对 + 5 个 load-bearing 文件（authorize.mjs/app-envelope.mjs/relay.mjs/capability.js/migrate.js）sha256 交叉核 + migration 版本回读，任一不匹配即停激活重查。
> **v0.5 更新（2026-07-24 07:4x，Codex MSG-122 pre-activation C 项·收据半）**: `capability.js:30` `CUSTODIAL_RELAY_ID` 定义为 `process.env.CUSTODIAL_RELAY_ID || process.env.FAUCET_RELAY_ID || null`——忘设前者会静默落到身份完全不同的 faucet relay（同款 `relay.js:75` `network||'mainnet'` 隐式 fallback 老坑的变体）。C 项拆两半：gateway 侧去 fallback 显式必设（J2 负责）+ 收据侧现场核对（本次）。新增 §(c'') relay 身份+network+target 等式：⑤env 实际值==⑥pilot relay id、⑦network==testnet-12、⑧intent.target==⑨grant.payee_scope 且是真实预期收款方。
> **性质**: 部署产物（filled-in receipt），非设计文档。每次真实激活（含未来 pilot 结束/重开）都产生一份新收据，不是写一次的模板本身。

---

## 使用方法

激活执行者（runbook §4 走完后）逐项**现场查询**填空，禁止照抄任何设计文档/频道消息里的声称数字——每一格的值必须来自下面标注的实际查询命令的真实输出。查不到 = 留空 + 标注原因，不得假填。

## 收据字段

### (a) 两个身份分列回读（🔴 v0.3 修正：executor-relay ≠ custodial-source，禁止混用）

**executor-relay**（转发/签名验证发生的进程，不出钱，付 gas/IPC）:

| 字段 | 查询方式 | 实际值 |
|---|---|---|
| pilot relay id | `relay_nodes` 表按 name 查 | |
| relay 自身地址 | 同上 `address` 列（`GET /api/relay/:id/balance` 查的是**这个**，跟 pilot 出钱多少无关） | |
| network 字段 | 同上 `network` 列，**必须 = testnet-12**（runbook §2 footgun 检查） | |

**custodial-source**（`custodial_transfer` 实际出钱的身份，`capability.js:163-164` `deriveCustodialExecFields` 按 `fromAddress` 查 `tg_custodial_wallets` 表选出）:

| 字段 | 查询方式 | 实际值 |
|---|---|---|
| custodial 地址（`kaspa_address` 列） | `tg_custodial_wallets` 表查 | |
| network 字段 | 同上表 `network` 列，**必须 = testnet-12** | |
| `mnemonic_encrypted` 是否存在 | 存在性检查（不读值，值本身绝不进收据） | |

### (b) pilot grant 逐字段回读（`m0c1_app_grants` 表，非设计文档写的值）

| 字段 | grant registry 实际存的值 | 代码坐标（2026-07-24 claim-to-code 三道核后确认真实） |
|---|---|---|
| `source_scope` | | `kasia-relay/src/lib/app-envelope.mjs:79` SCALAR_DIMENSIONS，`grantCol='source_scope'`（membership，NULL=拒）——**必须 = custodial-source 地址（(a) 表里那个），非 relay 自身地址** |
| `payee_scope` | | 同上机制（若适用） |
| `max_amount_sompi`（单笔上限，Bettor ratify=2 KAS） | | `app-envelope.mjs:79` `grantCol='max_amount_sompi'`；网关早拒检查 `capability.js:126` |
| `valid_from` / `valid_until` | | |

**relay 侧常量（🔴 v0.3 修正：非 grant registry 字段，是代码里的常量，不随 grant 变化，此处只做回读确认值对，不是"填 grant 存的值"）**:

| 常量 | 代码坐标 | 当前值 |
|---|---|---|
| custodial_transfer 专属 TTL（Bettor ratify=5 min） | `CUSTODIAL_PILOT_MAX_TTL_MS`（`app-envelope.mjs:57`），enforce 于 `:157-158`（2026-07-24 前是设计声称未落码，Codex RED 抓出，J1 `944f2a72` 补上；全局 `MAX_ENVELOPE_TTL_MS` 仍是 1h `:49`，custodial_transfer 走专属收紧非改全局） | 5 min |

### (c) custodial-source 钱包余额回读（🔴 v0.3 修正：查错钱包——旧版查的是 relay_nodes 余额，跟 pilot 实际能出多少钱无关）

| 查询方式 | 实际值 |
|---|---|
| relay 只读命令 `get_address_utxos`（`kasia-relay/src/relay.mjs:1189`，接受任意 `address` 参数，非只查 relay 自己）对 (a) 表里 custodial 地址查询，汇总 UTXO 金额 | |
| 是否 = 50 KAS 硬顶 | |
| ~~`GET /api/relay/:id/balance`~~（**弃用**：查的是 relay 自身身份钱包，非 custodial-source） | — |
| ~~relay `split-utxos`~~（**弃用**：那是 relay 自身 UTXO 管理，动的是错误钱包；custodial 地址若需要 UTXO 整理需另立专属操作+另审，本 runbook 不覆盖） | — |

### (c') 四值一致性证明（🔴 v0.3 新增，Codex MSG-121 MUST-FIX 1 要求）

激活前必须证明以下四者是**同一个地址**，逐项现查，不假设一致：

| 值 | 来源 | 实际值 |
|---|---|---|
| ① `PILOT_WALLET_ADDRESSES` env（gateway 白名单） | `kanet.env` 实际内容 | |
| ② `grant.source_scope`（relay 授权范围） | grant registry 查询 | |
| ③ 签名 envelope 里的 `intent.fromAddress` | 一次真实/测试请求的 envelope 内容 | |
| ④ 实际充值 50 KAS 的 custodial 地址 | `tg_custodial_wallets.kaspa_address` + (c) 表余额回读 | |
| ①==②==③==④ ？ | 四者逐一比对 | |

### (c'') relay 身份 + network + target 等式（🔴 v0.5 新增，Codex MSG-122 pre-activation C 项收据半）

`CUSTODIAL_RELAY_ID`（`kasia-console/src/api/capability.js:30`）实际定义为 `process.env.CUSTODIAL_RELAY_ID || process.env.FAUCET_RELAY_ID || null`——**若忘设 `CUSTODIAL_RELAY_ID`，网关会静默落到 `FAUCET_RELAY_ID`**（另一个身份完全不同的 relay，faucet 用途非 pilot custodial 用途），custodial_transfer 请求会被转发给错的 relay 处理。这是又一个"footgun 式隐式 fallback"（同款 `relay.js:75` `network || 'mainnet'` 那类），C 项要求 gateway 侧显式必设去 fallback（J2 负责代码），本节是收据侧的现场核对：

| 值 | 来源 | 实际值 |
|---|---|---|
| ⑤ `process.env.CUSTODIAL_RELAY_ID`（激活环境，非猜测） | `kanet.env` 实际内容——**必须显式设置，不得留空指望 `FAUCET_RELAY_ID` 兜底**（J2 gateway 侧去 fallback 后未显式设=直接 503，若仍读到非 503 值说明 fallback 还没堵，需回查 J2 那半是否已部署） | |
| ⑥ §2 创建的 pilot relay id | `relay_nodes` 表按 name 查（同 §(a) 上半那条） | |
| ⑤==⑥ ？（gateway 实际转发目标 == 建的那个 pilot relay，非误落 faucet relay） | 逐字符比对 | |
| ⑦ ⑤对应 relay 的 `network` 列 | `relay_nodes` 表查，**必须 = testnet-12** | |
| ⑧ 一次真实/测试请求 envelope 里 `intent.target`（payee，对应 `grant.payee_scope`，`kasia-relay/src/lib/app-envelope.mjs:78` SCALAR_DIMENSIONS `dim:'payee'`） | envelope 实际内容 | |
| ⑨ `grant.payee_scope` | grant registry 查询 | |
| ⑧==⑨ ？（intent 里实际要付的地址 == grant 授权范围内，且是真实预期收款方，非笔误/测试残留地址） | 逐字符比对 + 人工确认这是真实预期收款方 | |

### (d) 两 flag 状态同时回读（runbook §1 依赖，缺一不可）

| flag | 查询方式 | 实际值 |
|---|---|---|
| `ADMIN_CAPABILITY_GATEWAY_ENABLED` | kanet.env 实际内容 + `GATEWAY_ENABLED()` 运行时读值 | |
| `ADMIN_M0C1_GATE_ARMED` | kanet.env 实际内容 + `armReport()`/日志法读值 | |
| 两者是否同批次生效（无中间态窗口） | 对比两次重启日志时间戳 | |

### (e) 限流 + 网关白名单回读（2026-07-24 J2 `cf680280` 补齐，claim-to-code 三道核 GREEN）

| 字段 | 代码坐标 | 实际配置值 |
|---|---|---|
| 限流表 `pilot_rate_limit_log` | `kasia-console/src/db/migrate.js` v192 CREATE TABLE | |
| 限流阈值 | `capability.js:48-49` `RATE_LIMIT_WINDOW_MS=60*1000`(1分钟) + `RATE_LIMIT_MAX=3`（每 grant_id 每分钟 3 笔，Bettor ratify） | |
| 自清理机制 | `capability.js:50` `RATE_LIMIT_CLEANUP_MULTIPLE=10`（超 10 倍窗口旧行自动删，无独立 cron） | |
| gateway pilot-wallet 白名单 | `capability.js:206` `PILOT_WALLET_ADDRESSES` env（逗号分隔→Set，空=default-deny fail-closed） | |
| 白名单内容（激活时填） | `process.env.PILOT_WALLET_ADDRESSES` 实际值 | |

### (f) pilot 窗口结束后吊销回读

| 字段 | 查询方式 | 实际值 |
|---|---|---|
| revoke 命令执行时间 | | |
| `grant.revoked` 回读 | 吊销后立即查 grant registry | |
| 吊销后下一条请求是否即时拒 | 实发一条验证（G4 harness 或手工） | |

### (h) 部署代码钉死回读（🔴 v0.4 新增，Codex MSG-122 pre-activation B 项：claim-to-code 延伸到 claim-to-deployed）

> MSG-122 三道核（自核+Bettor grep+NWT 独立扫描）证明的是"审过的那个 commit 里代码写对了"，**不证明**"真实跑在生产 console/relay 进程里的代码 == 那个被审过的 commit"。两者中间隔着一次部署动作（拉代码/重启），必须显式核对，不能默认"刚部署过所以肯定是最新"——这条本身就是本次事故（claim-to-code）在运行时维度的延伸，不核就是同一个坑在新层面复发。

| 字段 | 查询方式 | 实际值 |
|---|---|---|
| 部署进程实际运行的 commit SHA | **在实际跑 console/relay 的机器/目录**执行 `git rev-parse HEAD`（非本地开发树；若共享同一台机器需先确认是同一份 working tree，非另一个 clone） | |
| Codex MSG-122 终审时的 commit tip | 频道记录（本次 = `26a23292`，Bettor 发 MSG-122 `918137ea` 时的 current tip） | |
| 两者是否一致（逐字符比对） | | |

**load-bearing 文件 digest 交叉核对**（防"部署了但某个文件没跟上"/"部署后又被手动改过且没人知道"）：

| 文件 | sha256（部署环境实际文件，激活时现算） | sha256（对应 commit tip 里的版本，同一时刻现算比对） | 一致？ |
|---|---|---|---|
| `kasia-relay/src/lib/authorize.mjs` | | | |
| `kasia-relay/src/lib/app-envelope.mjs` | | | |
| `kasia-relay/src/relay.mjs` | | | |
| `kasia-console/src/api/capability.js` | | | |
| `kasia-console/src/db/migrate.js` | | | |

| migration 版本回读 | 实际值 |
|---|---|
| 部署库（运行中的 DB）已执行到的最新 migration 版本号（查 DB 内 migration 记录表，非猜测） | |
| `migrate.js` 代码里定义的最新版本号 | |
| 两者一致？（若部署库版本落后于代码——DB schema 缺字段但代码假设字段存在，是另一类静默故障，需先跑 migrate 补齐） | |

**纪律**：任一 load-bearing 文件 digest 不匹配、或部署 commit SHA ≠ MSG-122 终审 tip → **停止激活**，先查清楚差异来源（漏部署 / 部署后被改 / tip 记错），差异本身若涉及安全参数改动需重走 claim-to-code 三道核（对实际部署的那份代码，非旧审过的那份），不得凭"应该没差多少"跳过。

### (g) Owner 授权后真 live 冒烟（🔴 v0.2 新增，runbook §4.5，Codex MSG-121 MUST-FIX 2 要求）

G4（docs/evidence 那份）是隔离环境单元测试，不证明真实部署配置对。本节记录**唯一**的真实链上验证：

| 字段 | 实际值 |
|---|---|
| Owner 授权时间/方式 | |
| 真实 txId | |
| 使用的 grant_id（provision 正式签发，非 harness 临时） | |
| 链上落地确认方式（`checkUtxoLanded` 或等价） | |
| 落地确认结果 | |

---

## 填写纪律（防重演 2026-07-24 事故）

1. **每一格都是查询结果，不是转引**——若某项设计文档声称但代码/运行时查不到，此格留空并写"未实现，见 Codex RED / issue #xxx"，不得抄设计文档的目标值充数。
2. 本收据本身不是审查环节的 GREEN 依据——它是**激活发生之后**留存的证据快照，供事后审计/事故复盘用。
3. 激活前的 GREEN/RED 判定权威仍是 NWT diff 审 + Codex 外审（本模板不替代）。

---

**关联**: `docs/2026-07-23-m0c-1-pilot-activation-runbook.md`（部署时序）、`docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md`（围栏设计权威）、coord/codex-bridge `RESPONSE-20260724-M0C1-PATHB-ACTIVATION-READINESS-CODEX-REVIEW.md`（2026-07-24 RED 判定，本模板直接回应其"claim without code-evidence"问题）。
