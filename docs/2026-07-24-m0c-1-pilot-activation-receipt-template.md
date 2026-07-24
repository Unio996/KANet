# M0c-1 Path B Pilot 激活收据（KANet-UI 工作流⑦·空白模板）

> **Status**: CURRENT（🔴 v0.9 修正 B6：Status 行曾长期停留在 v0.1 描述，实际已迭代到 v0.9·空白模板·配套 `docs/2026-07-23-m0c-1-pilot-activation-runbook.md`）
> **依据**: 2026-07-24 05:xx NWT 声称清单 grep 扫描发现 MSG-120 多处"声称已实现"实际代码不存在（TTL/限流/白名单/G4 用例），Bettor 认账根因="claim==code" completeness 交叉核缺失。本模板的存在意义：**激活当刻**从运行系统实际读到的值，不是从任何设计文档/频道消息转引的值。
> **v0.2 更新**: 四条控制已全部补齐落码（J1 `944f2a72` TTL / J2 `cf680280` 限流+白名单 / J1 `2fbdb290` G4 harness v0.2 21/21），均经 claim-to-code 三道核（自核+Bettor grep+NWT 独立扫描）GREEN。下方 (b)(e) 已补代码坐标（供激活时对照查询用，坐标本身已核实存在，具体运行时值仍需激活当刻现查填空）。
> **v0.3 更新（2026-07-24 06:17，Codex MSG-121 再审 MUST-FIX 1 修正）**: **v0.1/v0.2 全程查错钱包**——`custodial_transfer` 实际出钱的是 `tg_custodial_wallets` 表按 `fromAddress` 选出的托管钱包（`kasia-console/src/api/capability.js:163-164` `deriveCustodialExecFields`），**不是** relay 自身的运营钱包（`relay_nodes.address`，`GET /api/relay/:id/balance` 查的是这个，只用于 relay 付 gas/日常 IPC）。两者是完全不同的身份/余额。NWT 独立读码坐实"极其严重"。本版 §(a)(c) 已改为区分两个身份、余额回读改查 custodial 地址真实链上 UTXO。
> **v0.4 更新（2026-07-24 07:xx，Codex MSG-122 四 MUST-FIX 全 CLOSED+源码包 GREEN，armed=on 前 pre-activation B 项）**: 四 MUST-FIX 全部收口后，Codex 放行呈 Owner 做 Path B go/no-go 决策，但指出 claim-to-code（审过代码写对了）不等于 claim-to-deployed（真实跑的进程 == 审过的那份代码）——中间隔着一次部署动作没人核过。新增 §(h) 部署代码钉死回读：部署 commit SHA 核对 + 5 个 load-bearing 文件（authorize.mjs/app-envelope.mjs/relay.mjs/capability.js/migrate.js）sha256 交叉核 + migration 版本回读，任一不匹配即停激活重查。
> **v0.5 更新（2026-07-24 07:4x，Codex MSG-122 pre-activation C 项·收据半）**: `capability.js:30` `CUSTODIAL_RELAY_ID` 定义为 `process.env.CUSTODIAL_RELAY_ID || process.env.FAUCET_RELAY_ID || null`——忘设前者会静默落到身份完全不同的 faucet relay（同款 `relay.js:75` `network||'mainnet'` 隐式 fallback 老坑的变体）。C 项拆两半：gateway 侧去 fallback 显式必设（J2 负责）+ 收据侧现场核对（本次）。新增 §(c'') relay 身份+network+target 等式：⑤env 实际值==⑥pilot relay id、⑦network==testnet-12、⑧intent.target==⑨grant.payee_scope 且是真实预期收款方。
> **v0.6 更新（2026-07-24 08:xx，Codex MSG-122 pre-activation A 项：Owner-gate 时序）**: Bettor+NWT 独立核对确认——真正不可逆的窗口打开点是两 flag 原子开启（§(d)）本身，不是 §(g) 那笔 live 冒烟测试；旧版把"Owner 显式授权"只挂在 §(g) 前，等于决策权倒置给 operator。新增 §(c''') arm 授权回读，作为独立于 §(g) 的第二道 gate，且要求 Owner 的 go 是对**整包具体参数**（部署 commit/custodial 钱包/50 KAS/grant 字段/两 flag 目标值/smoke 参数/回滚路径）的知情同意，不是空白的"可以了"。对应 runbook v0.5 §3.5。
> **v0.7 更新（2026-07-24 09:xx，Codex 二轮 MUST-FIX：§(c''') 改记候选值，非回读值）**: 对应 runbook v0.6 §3→§3.5→§3.6 三段重排——§(c''') Owner 逐项过目表现改为记录**候选值**（尚未充值的钱包地址/尚未 provision 的 grant 字段/CUSTODIAL_RELAY_ID 拟设值），并显式要求核对 Owner go 时间戳早于 §(a)(c)(c'')(d) 任何"实际发生"值出现之前——填表时若那些字段已有值，说明执行顺序倒了。
> **v0.8 更新（2026-07-24，Codex 三轮反馈第一轮自查）**: `source_scope`/`payee_scope` 是 membership set（JSON 数组，`parseJsonStringArray`+`scopeSet.includes()`），§(c')(c'') 原"直接相等"框架类型不对（单值 vs 集合），改成"singleton 集合+成员检查"框架。
> **v0.9 更新（2026-07-24，Codex 三轮完整回合，`docs/2026-07-24-m0c1-pilot-comprehensive-defect-sweep.md` 一次性全改）**：v0.8 自查还不够彻底，本版是响应 Owner"别挤牙膏"指令的完整修复：① **A1/B5** §(c''') 候选表不再假设钱包地址已"建行待充"——现在必须是 offline/scratch 派生、未 insert 生产 DB、未生成加密 mnemonic；relay 候选同理改成"拟建 name"而非"已存在 id"（B4） ② **A2** §(h) 从硬编码单一 commit SHA 改成 `reviewed_package_commit`/`review_response_commit`/blob-sha 组字段，杜绝再抄任何过期示例值；CUSTODIAL_RELAY_ID fallback 描述改 CURRENT 时态（fallback 已被 C-gateway 去掉，旧描述降级为历史 note） ③ **A3** `payee_scope` 强制非空（删"若适用"），§(c'') ⑧∈⑨ 成员检查 ④ **A4** "使用方法"从"§4 走完后填"改成 5 相位框架（pre-auth 候选/Owner 决策/post-auth 执行/post-restart 运行时/post-smoke），§(d) 两 flag 也拆成 file-vs-runtime 两层（B1） ⑤ **B2** §(h) load-bearing 清单补 `m0c1-grant-provision.mjs`+`m0a-exception-manifest.json` ⑥ **B6** Status 头版本号更正。
> **性质**: 部署产物（filled-in receipt），非设计文档。每次真实激活（含未来 pilot 结束/重开）都产生一份新收据，不是写一次的模板本身。

---

## 使用方法

🔴 **v0.9 修正（Codex 三轮 A4(a)：旧版"runbook §4 走完后逐项填"这句话本身矛盾——§(c''') 必须在 §3.6/§4 之前就有值，不可能等 §4 走完才填第一格）**。本收据不是"一次性事后填空"，而是跟着激活流程分 **5 个相位**陆续填、每个相位对应字段只在该相位才有真实值——填某个字段时若它所属相位还没到，此格必须留空，不得抢先编造：

| 相位 | 对应 runbook 阶段 | 本收据对应小节 |
|---|---|---|
| ① pre-auth 候选提案（Owner go 之前） | §2/§3（候选值起草，未创建/未充值/未写库） | §(c''') 的"候选参数"列 |
| ② Owner 决策记录（Owner 给 go/no-go 那一刻） | §3.5 | §(c''') 的"授权字段"表 |
| ③ post-auth/pre-arm 执行（Owner go 之后，两 flag 还没开） | §3.6 | §(a)(b)(c)(c')(c'')⑤a/§(h) 部署 commit（此项跟 arm 顺序无关，独立回读） |
| ④ post-restart 运行时（§4 flag 开启+console 重启之后） | §4 | §(c'')⑤b/§(d) |
| ⑤ post-smoke/revoke（§4.5 冒烟之后 / pilot 收尾） | §4.5、pilot 结束 | §(g)/§(f) |

每一格的值必须来自其相位对应的实际查询命令的真实输出，禁止照抄任何设计文档/频道消息里的声称数字。查不到 = 留空 + 标注原因，不得假填；相位还没到 = 留空 + 标注"待 §X 完成"，不得提前编。

## 收据字段

### (a) 两个身份分列回读（🔴 v0.3 修正：executor-relay ≠ custodial-source，禁止混用）

**executor-relay**（转发/签名验证发生的进程，不出钱，付 gas/IPC）:

| 字段 | 查询方式 | 实际值 |
|---|---|---|
| pilot relay id | `relay_nodes` 表按 name 查 | |
| relay 自身地址 | 同上 `address` 列（`GET /api/relay/:id/balance` 查的是**这个**，跟 pilot 出钱多少无关） | |
| network 字段 | 同上 `network` 列，**必须 = testnet-12**（runbook §2 候选值 footgun 提醒，§3.6 实创建时执行核验） | |

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
| `payee_scope` | | 同上机制（🔴 v0.9 修正 A3：不再是"若适用"，本 pilot **强制**要求非空——provision 脚本必须显式传 `--payee`，`m0c1-grant-provision.mjs:100` 默认 NULL，不传=该维未授权=intent 一旦声明 target 就被拒，等于该 grant 实际发不出任何 custodial_transfer） |
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

### (c') 四值一致性证明（🔴 v0.3 新增，Codex MSG-121 MUST-FIX 1 要求；🔴 v0.8 修正 Codex 三轮反馈：`grant.source_scope` 是 membership set 非标量，②不能跟①③④做直接相等比对）

**v0.8 修正**：`grant.source_scope`（`kasia-relay/src/lib/app-envelope.mjs:88` SCALAR_DIMENSIONS `dim:'source', kind:'membership'`）存的是 **JSON 数组**（`parseJsonStringArray` 解析，`:197` `scopeSet.includes()` 做**成员检查**，不是标量相等）——旧版"①==②==③==④"把②当成跟①③④同类型的单个地址值直接相等比对，类型不对。正确框架：①③④是三个应该相同的**单个地址**，②是**装着这个地址的候选集合**，检查的是"①③④这个地址是否属于②这个集合的唯一成员"（pilot 阶段应为单元素集合，非泛泛 membership）：

| 值 | 来源 | 实际值 |
|---|---|---|
| ① `PILOT_WALLET_ADDRESSES` env（gateway 白名单，逗号分隔→Set） | `kanet.env` 实际内容 | |
| ③ 签名 envelope 里的 `intent.fromAddress` | 一次真实/测试请求的 envelope 内容 | |
| ④ 实际充值 50 KAS 的 custodial 地址 | `tg_custodial_wallets.kaspa_address` + (c) 表余额回读 | |
| ①==③==④ ？（三个单地址值逐字符比对） | | |
| ② `grant.source_scope` 原始 JSON 值（未解析前的原文） | grant registry 查询 | |
| ② 解析后的 scope 数组（`parseJsonStringArray(grant.source_scope)`） | 现场解析 | |
| 该数组是否**恰好一个元素**（pilot 阶段不接受多元素 scope——多元素=一个 grant 授权多个源地址，超出本次 pilot 范围，需另行评估） | | |
| 那唯一元素 == ①==③==④ 那个地址 ？（成员检查，非集合整体相等） | | |

### (c'') relay 身份 + network + target 等式（🔴 v0.5 新增，Codex MSG-122 pre-activation C 项收据半）

🔴 **v0.9 修正（Codex 三轮 A2(b)：下面这段此前是现在时描述，已经是假的）**：`CUSTODIAL_RELAY_ID`（`kasia-console/src/api/capability.js:30`）**CURRENT（C-gateway `cb3d87b3` 已落地）**：`process.env.CUSTODIAL_RELAY_ID || null`——**必须显式设置，缺失直接 503 fail-closed**，`FAUCET_RELAY_ID` 隐式 fallback 已被去掉，不会再静默落到别的 relay 身份。

> **历史 revision note（仅记录曾经的问题，不是当前行为）**：v0.5-v0.8 期间，这里描述的是修复前的行为——`process.env.CUSTODIAL_RELAY_ID || process.env.FAUCET_RELAY_ID || null`，忘设前者会静默落到身份完全不同的 faucet relay（同款 `relay.js:75` `network || 'mainnet'` 那类 footgun）。C 项（J2 `cb3d87b3`）已去掉该 fallback。本节收据字段核对的是"CURRENT 行为是否符合预期"，不是复现旧洞。

🔴 **v0.8 修正（Codex 三轮反馈坐实的时机错误）**：`process.env.CUSTODIAL_RELAY_ID` 只有在 console **进程重启之后**才技术上等于 `kanet.env` 里写的值——重启前编辑文件不会改变已在跑的旧进程的 `process.env`。下表 ⑤ 因此分两半：写入当刻（runbook §3.6）只能核对**文件内容**，运行时真值要等 runbook §4 步骤 4 重启完成后才能查（对应新增的那条检查项）。

| 值 | 来源 | 实际值 |
|---|---|---|
| ⑤a `CUSTODIAL_RELAY_ID`（写入当刻，runbook §3.6） | `kanet.env` **文件**实际内容（此刻查 `process.env` 无意义，进程还没重启） | |
| ⑤b `process.env.CUSTODIAL_RELAY_ID`（**重启后**，runbook §4 步骤 4） | 运行中 console 进程的运行时读值（`checkRelayArmed`/日志法或等价手段） | |
| ⑤a == ⑤b ？（文件内容 == 重启后进程实际读到的值，确认重启真的生效，非残留旧进程/未重启就先查） | | |
| ⑥ §3.6 创建的 pilot relay id | `relay_nodes` 表按 name 查（同 §(a) 上半那条） | |
| ⑤b==⑥ ？（gateway 运行时实际转发目标 == 建的那个 pilot relay，非误落 faucet relay，**必须用 ⑤b 运行时值比对，不能用 ⑤a 文件值替代**） | 逐字符比对 | |
| ⑦ ⑤对应 relay 的 `network` 列 | `relay_nodes` 表查，**必须 = testnet-12** | |
| ⑧ 一次真实/测试请求 envelope 里 `intent.target`（payee，对应 `grant.payee_scope`，`kasia-relay/src/lib/app-envelope.mjs:78` SCALAR_DIMENSIONS `dim:'payee', kind:'membership'`） | envelope 实际内容 | |
| ⑨ `grant.payee_scope` 原始 JSON 值 | grant registry 查询 | |

**🔴 v0.8 修正（Codex 三轮反馈，NWT 独立发现）**：`payee_scope` 跟 §(c') 的 `source_scope` 同款——是 `parseJsonStringArray` 解析的 JSON 数组（membership set），`⑧==⑨` 直接相等比对类型不对（⑧是单个地址，⑨是集合的原始 JSON 文本，两者不同类）。正确检查：

| 检查项 | 实际值 |
|---|---|
| ⑨ 解析后的 scope 数组（`parseJsonStringArray(grant.payee_scope)`） | |
| 该数组是否**恰好一个元素**（同 §(c') 纪律：pilot 阶段不接受多收款方 scope） | |
| ⑧ ∈ ⑨ 那唯一元素 ？（成员检查：intent 里实际要付的地址是否等于 scope 数组里那唯一元素，且是真实预期收款方，非笔误/测试残留地址） | 逐字符比对 + 人工确认这是真实预期收款方 | |

### (c''') arm 授权回读（🔴 v0.6 更新，Codex MSG-122 pre-activation A 项 + 二轮 MUST-FIX，runbook §3.5 硬前置——必须先于下方 §(a)(c)(d) 的**实际值**填写完成，因为它是"要不要动钱/要不要开闸"本身的 Owner go，不是钱已经动了之后的事）

**🔴 v0.6 修正（Codex 二轮 MUST-FIX，Bettor 自认内部验证也漏掉这层顺序）**：Owner 审批时看到的是**候选值**（runbook §3 起草、尚未充值/尚未写入 registry），**不是**下面 §(a)(c)(d)(c'') 那些"实际发生后"的回读值——那些字段要到 runbook §3.6（Owner go 之后）才会有真实内容。填本节时若 §(a)(c)(d)(c'') 已经有值，说明执行顺序倒了，回去查是不是先斩后奏。

| Owner 逐项过目的候选参数 | 对应 runbook 章节（候选值来源，非回读） | Owner 当时看到的候选值 |
|---|---|---|
| 部署 commit SHA | §(h)（这项本身就是已部署状态，非候选，正常回读） | |
| pilot relay **候选**参数（🔴 v0.9 修正 B4：relay 此刻还不存在，没有 id 可看，Owner 看到的只是"打算建一个叫 X、network=testnet-12 的 relay"这个意图，不是任何具体 id） | §2（候选 name + network，relay 尚未创建） | |
| 专用 custodial 钱包**候选**地址（🔴 v0.9 修正 A1/B5：offline/scratch 派生，未充值、未 insert 生产 `tg_custodial_wallets`、未生成/加密 mnemonic） | §3 | |
| 拟充值金额（须=50 KAS 硬顶，尚未真充） | §3 | |
| grant **候选**字段（source_scope/payee_scope/max_amount_sompi/valid_until，尚未 provision——payee_scope 强制非空，见 §(b)） | §3 | |
| `CUSTODIAL_RELAY_ID` 拟绑定意图（= 上面那个候选 relay name 指向的对象，实际 id 值要等 §3.6 创建后才存在，此刻无法给出具体值） | §3/§(c'') | |
| 即将写入的两 flag 目标值 | §3.6→§4（尚未执行） | |
| §(g) smoke 测试参数（金额/收款地址） | §(g)（届时才执行） | |
| 回滚路径 | runbook §6 | |

| 授权字段 | 实际值 |
|---|---|
| Owner go 的方式（频道消息/其他，附原文引用或链接） | |
| Owner go 的时间戳 | |
| 该 go 是否在下方 §(a)(c)(c'')(d) 出现任何"实际充值/实际写库/实际生效"值**之前**拿到（逐时间戳核对，不得倒序——这正是 Codex 二轮抓的洞：v0.5 之前 §(a)/§(c) 的实际值早于本节 Owner go 就已产生） | |
| 若执行中候选值与实际写入值有出入（哪怕只是笔误） | 记录差异，说明是否回头重新过 Owner（runbook §3.6 纪律：不得自行调整后继续） | |

> 与 §(g) 的 live 冒烟授权是**两道独立**记录，不可用一条顶替另一条：本节记录"是否同意按这套候选参数动钱+开闸"，§(g) 记录"是否同意发这笔真实测试转账"。

### (d) 两 flag 状态同时回读（runbook §1 依赖，缺一不可；🔴 v0.9 修正 B1：file 值与 runtime 值拆开，不再混一格——同 §(c'') 那次教训，写文件≠进程读到）

| flag | 阶段 | 查询方式 | 实际值 |
|---|---|---|---|
| `ADMIN_CAPABILITY_GATEWAY_ENABLED`（文件） | §4 步骤 2 编辑后、重启前 | `kanet.env` **文件**实际内容 | |
| `ADMIN_CAPABILITY_GATEWAY_ENABLED`（运行时） | §4 步骤 4，**重启后** | `GATEWAY_ENABLED()` 运行时读值（curl 探路由） | |
| `ADMIN_M0C1_GATE_ARMED`（文件） | §4 步骤 2 编辑后、重启前 | `kanet.env` **文件**实际内容 | |
| `ADMIN_M0C1_GATE_ARMED`（运行时） | §4 步骤 4，**重启后** | `armReport()`/`get_arm_status`/日志法读值 | |
| 文件值与运行时值是否一致（每个 flag 各自核一次，确认重启真的把新配置带进了运行中的进程） | | | |
| 两个 flag 的运行时值是否同批次生效（无中间态窗口） | | 对比两次重启日志时间戳 | |

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

🔴 **v0.9 重构（Codex 三轮 A2(a)：静态硬编码某个历史 commit 示例值本身就是问题——每次激活可能对应不同审查轮次，模板不该内嵌任何具体 SHA）**。改用运行时填充字段，比对基准 = **当次 Owner 决策所依据的、Codex+NWT 实际审过的那个包**，不是任何写死的旧值：

| 字段 | 说明 | 实际值 |
|---|---|---|
| `reviewed_package_commit` | Codex **最终一轮**（当次授权决策所依据的那一轮，非任意中间反馈）GREEN 放行时点名的 commit——现查频道记录，**不得抄本文档历史版本出现过的任何示例值**（如曾出现过的 `26a23292`，那是旧一轮的值，早已过期） | |
| `review_response_commit` | Codex 该轮回复消息本身引用/锚定的 commit（若与上一行不同需说明原因，通常应一致） | |
| `runbook_blob_sha` | 本 runbook 文档（`docs/2026-07-23-m0c-1-pilot-activation-runbook.md`）在 `reviewed_package_commit` 那个 tip 的 git blob sha（`git rev-parse HEAD:docs/2026-07-23-m0c-1-pilot-activation-runbook.md`） | |
| `receipt_template_blob_sha` | 本收据模板自身在同一 tip 的 blob sha | |
| `g4_evidence_blob_sha` | 当次引用的 G4 evidence 文件（`docs/evidence/...`）blob sha + sha256（两者都记，前者证明"是这个 tip 里的那份文件"，后者证明"内容没被后续悄悄改过"） | |
| 部署进程实际运行的 commit SHA | **在实际跑 console/relay 的机器/目录**执行 `git rev-parse HEAD`（非本地开发树；若共享同一台机器需先确认是同一份 working tree，非另一个 clone） | |
| 部署 commit == `reviewed_package_commit` ？（逐字符比对） | | |

**load-bearing 文件 digest 交叉核对**（防"部署了但某个文件没跟上"/"部署后又被手动改过且没人知道"；🔴 v0.9 修正 B2：旧版只列 5 个文件，漏了 grant 写手+文档自身+manifest）：

| 文件 | sha256（部署环境实际文件，激活时现算） | sha256（`reviewed_package_commit` 里的版本，同一时刻现算比对） | 一致？ |
|---|---|---|---|
| `kasia-relay/src/lib/authorize.mjs` | | | |
| `kasia-relay/src/lib/app-envelope.mjs` | | | |
| `kasia-relay/src/relay.mjs` | | | |
| `kasia-console/src/api/capability.js` | | | |
| `kasia-console/src/db/migrate.js` | | | |
| `kasia-console/scripts/m0c1-grant-provision.mjs`（🔴 v0.9 新增：grant 铸造权威唯一写手，manifest 锁定的敏感文件，漏检=可能拿旧版脚本签发不符合当前设计的 grant） | | | |
| `scripts/m0a-exception-manifest.json`（🔴 v0.9 新增：M0a 裸 import 白名单+content_digest 锚，本身是安全边界的一部分） | | | |

| migration 版本回读 | 实际值 |
|---|---|
| 部署库（运行中的 DB）已执行到的最新 migration 版本号（查 DB 内 migration 记录表，非猜测） | |
| `migrate.js` 代码里定义的最新版本号 | |
| 两者一致？（若部署库版本落后于代码——DB schema 缺字段但代码假设字段存在，是另一类静默故障，需先跑 migrate 补齐） | |

**纪律**：任一 load-bearing 文件 digest 不匹配、或部署 commit SHA ≠ `reviewed_package_commit` → **停止激活**，先查清楚差异来源（漏部署 / 部署后被改 / tip 记错），差异本身若涉及安全参数改动需重走 claim-to-code 三道核（对实际部署的那份代码，非旧审过的那份），不得凭"应该没差多少"跳过。

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
