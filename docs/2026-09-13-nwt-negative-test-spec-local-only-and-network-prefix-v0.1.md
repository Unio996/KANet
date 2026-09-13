# NWT · 负测用例规格 v0.1 — (a) LOCAL_ONLY 严格语义 + (b) 网络单一源/前缀一致性

> **Status**: DRAFT v0.1（2026-09-13 · NWT · docs only，不动代码）
> 目的：J2 出 (a)/(b) 设计稿时对齐、实现落地时可直接抄成 `.test.mjs`。格式仿照现有 `kasia-console/src/services/rpc-health-datacheck.test.mjs`（H1-H6 惯例：真迁移临时库 + 本机随机端口 TCP listener + 假 RpcClient 构造器注入 + 检 console.log 逐字行 + 检返回值）。
> 本稿只列**测什么、期望什么**，不写实现代码——(a)/(b) 的 helper 签名/落点仍由 J2 设计稿定，我审时按此表逐条验。
> 关联：`docs/2026-09-13-NWT-mainnet-real-money-preconditions-v0.2.md` §1/§2（本稿是那两节的可执行展开）。

## A. LOCAL_ONLY 严格语义负测（对应清单 §1 N1-N5，此处补齐可执行细节）

**前置（沿用现有 H 系列夹具）**：`KASPA_RPC_LOCAL_ONLY=1`；本机 `KASPA_RPC_URL` 指向一个可控的假 RpcClient 实例（通过 `_testInjectSharedRpcCtor` 注入，行为由测试逐条设定：本机故障用 `getServerInfo()` 抛错或返回 `{networkId, isSynced:false}`，外部端点核过用 `{networkId: KASPA_NETWORK, isSynced:true}`）；DB `rpc_url` 配置项通过 `setConfig('rpc_url', ...)`（或等价 test helper）注入模拟外部端点。

| 用例 | 设置 | 期望（严格语义应有的行为） | 判据行/返回值 |
|---|---|---|---|
| **A-N1** | `LOCAL_ONLY=1`；本机失败；DB `rpc_url` 未配置 | 走到 discover，discover 被 LOCAL_ONLY 挡，返回 null（基线，现码本来就对） | `getWorkingRpc()` ⇒ `{url:null,isLocal:false}`；日志含 `discovery disabled (KASPA_RPC_LOCAL_ONLY=1)` |
| **A-N2（最小复现，MUST 修）** | `LOCAL_ONLY=1`；本机失败；DB `rpc_url` = 一个公网 IP（非 10./172.16-31./192.168./127.）的可达端点，其 `dataCheck` 通过（`networkId` 匹配 `KASPA_NETWORK` ∧ `isSynced:true`） | **严格模式下必须返回 null，不使用该外部端点** | 现码：`getWorkingRpc()` 会返回该 URL、`isLocal:false`。**修复后**：`getWorkingRpc()` ⇒ `{url:null,isLocal:false}`；须新增一行日志（建议 `[rpc-health] LOCAL_ONLY blocks configured external endpoint: <url>`）供闸/盯守 grep |
| **A-N3（口径待定，见下）** | `LOCAL_ONLY=1`；本机失败；DB `rpc_url` = 局域网地址（10./172.16-31./192.168./127.）且核过 | **待 Bettor/J2 定口径**：若严格语义 = "只信 `KASPA_RPC_URL` 那一个地址"，本条应同 A-N2 返回 null；若严格语义 = "允许部署模型内的 LAN 直连"，本条应保留现码行为（返回该 URL，`isLocal:true`） | 两种口径各给一条断言，**设计稿必须二选一并写明理由**，我按选定口径验收 |
| **A-N4** | `LOCAL_ONLY=1`；本机 `checkLocal()` 单次 tcpPing 抛超时（模拟瞬时抖动），随后立即恢复 | 可用性问题非安全判据，本条只验证"没有因为严格模式引入新的假死"——**不要求**重试/退避逻辑本身，只要求单次失败不会把 A-N2 的"挡外部端点"路径跳过（即抖动期间同样不能借道外部端点） | 抖动期间调用 `getWorkingRpc()`，即使配置了通过 dataCheck 的外部端点，仍返回 null（与 A-N2 同判据），不能因为"本机暂时失败"就放宽严格模式 |
| **A-N5** | `LOCAL_ONLY=0`（非严格模式对照组，验证"只改严格模式，不动非严格路径") | 现码路径（含 discover）保持不变 | 与现有 H1-H6 现有测试结果一致，作回归防线（修复 A-N2 时若无意间改动了非严格路径，这条会先炸） |

**验收总判据**：修复后必须让 A-N2 由 FAIL 变 PASS，同时 A-N5 仍 PASS（证明修复没有波及非严格模式）；A-N3 二选一后补一条对应断言。

## B. 网络单一源 + 地址前缀一致性负测（对应清单 §2 F1-F4）

**前置**：假设 J2 设计稿产出一个 helper（建议签名 `assertAddressMatchesConfiguredNetwork(address: string): void`，权威网络来源 = `KASPA_NETWORK` 或等价单一配置，非从地址反推）。以下用例针对这个 helper 本身，24 处调用点的替换验收另开清单（逐处 diff + 跑一遍已有 §G 类 C 测试向量，不在本负测规格内重复）。

| 用例 | 输入 | 配置的 `KASPA_NETWORK` | 期望 |
|---|---|---|---|
| **B-1（基线正例）** | `kaspatest:qq...`（合法 testnet-12 前缀） | `testnet-12` | 通过（不 throw） |
| **B-2（基线正例）** | `kaspa:qq...`（合法 mainnet 前缀） | `mainnet` | 通过 |
| **B-3（F1 复现：未知前缀 fail-open）** | 既非 `kaspatest:` 也非 `kaspa:` 的字符串（如迁移半途遗留的旧格式地址、空字符串、`undefined`） | `mainnet` | **必须 throw/reject**，绝不能像现码三元表达式那样把"非 kaspatest:"默认归类到 mainnet 通过 |
| **B-4（F2 复现：前缀不匹配配置网络）** | `kaspatest:qq...` | `mainnet` | 必须 throw（现网配置是主网，但地址是测试网前缀——当前 24 处硬判断代码会把这类地址错误地当"testnet-12" 处理而不报错，helper 必须直接拒） |
| **B-5（F2 反向）** | `kaspa:qq...` | `testnet-12` | 必须 throw（同 B-4 反向） |
| **B-6（silverscript v1 迁移场景，前瞻）** | 假设的新地址编码格式（v1 迁移后 P2SH 前缀/编码可能变化，具体格式待 J2 v1 迁移落地后补） | 任意 | **本条先占位**，要求 helper 的实现不是"写死两个字符串前缀判断"，而是可扩展的格式表，迁移时改一处不是改 24 处；J2 设计稿交付时必须回填本条的具体断言 |
| **B-7（跨进程一致性，对应 F4）** | 同一地址、同一 `KASPA_NETWORK` 配置，分别在 console / relay / scout 各自的调用点跑一次 | 同上 | 三处结果必须一致——**验收方法**：helper 必须是三个服务共享同一份代码（同一 npm 包/共享 lib），不是三份平行实现；测试层面至少验证 console 与 relay 各自引用的是同一个模块路径（`import` 来源一致），不是各自拷贝一份逻辑 |

**验收总判据**：B-3/B-4/B-5 全部由"当前会 fail-open"变成"helper 版会 throw"；B-1/B-2 保持通过（回归防线）；B-6/B-7 在 J2 设计稿交付时补全具体断言与共享落点证明。

## C. 两组负测的交付形态

- 建议落点：A 组并入现有 `kasia-console/src/services/rpc-health-datacheck.test.mjs`（新增 H7/H8 对应 A-N2/A-N3，遵循既有 Fake 构造器注入惯例）；B 组新开 `kasia-console/src/lib/<helper-file>.test.mjs`（因为 helper 是新文件）。
- 本稿是规格，**不是**测试代码本身——J2 出设计稿并给出 helper 实现后，我按本表逐条验收，不会因为"文档写过了"而免检代码里的真实断言。
