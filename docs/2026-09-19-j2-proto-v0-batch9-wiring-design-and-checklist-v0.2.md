> **Status**: CURRENT（草稿 v0.3.3，2026-09-20，J2；**v0.3.2 之上加 §19：9-2 设计细化**（9-2a 出口分闸的判据矩阵 / 锚点 / commit 形状 / 变异，两处对 §3.8 的修正提案；9-2b 清单汇总与落码三笔拆法）；此前 v0.3.2：批9 接线设计 + 验收清单；v0.3.1 之上加 **§18：9-1 设计细化**——S10 来源表逐格核对、NWT 9-0 审转来的 9-1 清单项、9-1 文件清单、以及一个**基线依赖**（§18.0）；本文不含任何代码改动。v0.2→v0.3 见 §16，v0.3→v0.3.1 见 §17，v0.3.1→v0.3.2 见 §18）

# 原型 v0 结算批9（驱动接线）设计与验收清单 v0.3.3

> 文件名沿用 `…-v0.2.md`（账本 1527/1528/1529 与 NWT 审稿均以此路径引用，改名会断引用）；**正文即 v0.3.3**，v0.2→v0.3 差异见 §16，v0.3→v0.3.1 见 §17，v0.3.1→v0.3.2 见 §18，v0.3.2→v0.3.3 见 §19。

取代 `2026-09-19-j2-proto-v0-batch9-driver-wiring-acceptance-checklist-v0.1.md` 中关于批9范围与接线的部分（v0.1 保留作历史，其 C1/C2/C3、pmt、SLA、NO-TX-NO-STATE 各条本文继承并细化）。
依据：Bettor 账本 1494/1520/1523/1524 与本轮裁定 ③、Codex 对 C1 的接受条件、NWT 批3–7 审、代码现状盘点（§1，全部可 `grep` 复核）。D-021 合规：无真实地址/余额/私钥。

## 0. 范围与硬线

- **批9范围（Bettor 裁定 ③）：四步接线** —— `market_seal` / `close_commit`（意图 step 名 `resolve`）/ `convert_to_claim` / `claim_draw`。
- **排除**：`withdraw`（主网目的地允许清单 v0 为空，T-TOKEN-WALLET-COVENANT 未开）、`ticket_reclaim`（relay fee 估算器与节点最低费之间无可行 fee，即 T-FEE-PRICING；builder 与 simnet 证据保留，不接线）。驱动、HTTP、意图表都**不得出现**这两步的构造/广播路径（§11 审计项）。
- 硬线：不发起任何主网链上花费；不启用任何驱动开关（含 simnet 之外）；主网开闸走 D-022 另开闸、Owner 终端点 GO；合入主线不带运行时效果，主网 console 不为此重启；不动 relay 生产行为之前，relay 侧任何改动（§2 P1）先过 NWT 审 + Bettor 批（铁律 0）。
- 🟡 route A 边界：`pool_value=1000` 恰在 `payout >= 1000`（RootClaim.sil:103）边界上；`deriveCloseCommitInputs` 已拒 `<1000`。改 min_bet/stake 的运营变更前必须先核这条。

## 1. 现状盘点（代码事实，接线设计的地基）

| # | 事实 | 出处 |
|---|---|---|
| F1 | 现有驱动 `startProtoDriver`：默认关；`isProtoDriverEnabled()` = `PROTO_DRIVER_ENABLED==='1' && !!PROTO_RELAY_ID`；关闭时打 `[proto-driver] disabled`；启动打 `[proto-driver] started (tick …ms, cap …/tick)`；单飞 + 每 tick cap；`network = process.env.KASPA_NETWORK \|\| 'mainnet'` | `src/services/proto-driver.mjs` |
| F2 | 驱动只处理 market_genesis 与 bet append；**没有任何结算步骤的处理分支** | 同上 |
| F3 | 意图状态机 `proto-settlement-intent.mjs`（六 step、`settle:<subject_type>:<subject_id>:<step>`）已落且有测试；`driveSettlementIntent`/`checkSettlementIntentLanded`/`resumeStaleSettlementIntents` 可直接复用；`isDependencyLanded` 只查同 subject 的前置 step；**没有任何调用方** | `src/lib/proto-settlement-intent.mjs`；`ingest.js` 已有 `settle:` 前缀分派 |
| F4 | HTTP `/api/proto-markets/:id/resolve`、`/claim`、`/withdraw` **仍是 501 占位**（`buildAndBroadcast` 总是抛错）；`/resolve` 只校验 `status==='sealed'` 与 outcome∈{0,1}，**不写 `winning_side`**；这些路由无任何鉴权调用 | `src/api/proto.js` |
| F5 | `proto_markets.status` CHECK 含 `betting/sealed/resolved/cancelled` 与 `genesis_*`；**没有 `sealing` 之类中间态**；`markMarketStatus` 对 RANK 表内的 status 做单调保护、表外的值不保护（再由 CHECK 约束兜底） | `migrate.js` v206/v207、`proto-market-intent.mjs` |
| F6 | **没有任何代码创建 `proto_claims` 行**（只有读）；`proto_settlement_intents` 的 `claim` 主体 id = `proto_claims.id` | grep `INSERT INTO proto_claims` 零命中 |
| F7 | Console→relay 命令白名单只有 `covenant_broadcast`(write)、`get_address_utxos`/`get_mempool_entry`/`check_utxo_landed`(read)；加/改此表 = 安全边界变更，须 NWT 审 | `src/lib/proto-relay-ipc.mjs` |
| F8 | 🔴 relay `get_address_utxos` 只回每个 UTXO 的 `outpoint`+`amount`：**没有 `scriptPublicKey`，没有 `covenantId`**。现有 register_append 接线靠"按预期 spk 推的地址去查，RPC 只回该地址下的 UTXO"隐含 spk 匹配 | `kasia-relay/src/lib/p2sh.mjs getAddressUtxos`；`proto-broadcast-ops.mjs findUtxoValueAt` |
| F9 | 🔴 **没有任何 Console→relay 通路能读 `pastMedianTime`**（`proto-close-commit-gate.mjs` 的 `readPastMedianTimeMs(rpc)` 要一个 kaspa RpcClient；relay 白名单里没有 dag-info 类命令；`get_rpc_state` 只回连接状态） | `proto-relay-ipc.mjs`、`relay.mjs get_rpc_state` |
| F10 | 节点侧事实（simnet 实测，`docs/provenance/2026-09-19-j2-*`）：节点的 UTXO 条目带 `covenantId` 字段（covenant UTXO 有、普通 P2PK 无），即"输入是否 covenant"是**可查的链上事实**，但要经 relay 暴露（见 F8） | `getUtxosByAddresses` 条目结构 |
| F11 | 六个 builder 中 market_seal/convert_to_claim/claim_draw 返回 `genesisOutputIndices`；**close_commit 不返回 `continuationOutputIndices`**（其 RootClose 续约输出 0 因此没被 relay 的固定面值校验覆盖）；relay `validateFixedValueOutputs` 在两组索引都空时是 no-op | `proto-tx-assembly-settlement.mjs`、`covenant-broadcast-relay.mjs` |
| F12 | 「胜方由 DB 派生」：`deriveCloseCommitInputs` 要求 `proto_markets.winning_side` **已由操作员的 resolve 裁决写入**；现在无人写它（F4） | `proto-settlement-inputs.mjs` |
| F13 | 各步骤之间的链上指针（seal 的 RootClose outpoint/covenant_id、held 代币 outpoint 等）**没有落库列**；`proto_markets` 只有旧的 `rootclose_txid/vout`（无写入方） | schema |
| F14 | 🔴（NWT E3，已复核其探针）`covenantId` **不在** kaspa-wasm UTXO 条目顶层：顶层读出恒 `undefined`（covenant 与普通 UTXO 都是），真实位置是 **`entry.covenantId`（`Hash` 对象）**，普通 UTXO 该处也是 `undefined`。生产 relay 与 console 的 kaspa-wasm 二进制相同 | NWT `batch9-design-review/probe-output.txt` |
| F15 | 🔴（NWT E4）relay 的提交路径 `covenant_broadcast` 用**共享** RpcClient（`waitForRpc()`）；现有 `getAddressUtxos` 每次调用 **new 一个 RpcClient**（`connectRpc`，URL 取自 `KASPA_RPC_URL`）——不保证与提交同一节点（Resolver 分支），且每个 `new RpcClient` 永久占用 wasm 线性内存（11–18 KB/个不回收，4 GiB 顶崩溃而 HTTP 仍 200） | `relay.mjs:529-535` vs `p2sh.mjs:191-200,1613-1627` |
| F16 | （NWT S1 实验，simnet）"带 covenant 绑定、spk 仍是普通 P2PK"的**毒化 fee UTXO**可被凭空创建（genesis 免权限）；当普通 fee 输入花掉（不续约）**节点接受**；同一笔 2 入 5 出交易节点 storage mass 165,133 = 毒化输入按 p=2 的公式值，wasm 本地估算（p 恒 1）191,448。covenant 输入使真实 mass 更低 ⇒ 本地偏高、不会被拒；后果仅是"断言信号 == 节点值"三源相等失配。创建到他人 spk 的形状是推断，未测 | NWT `06/07` 实验 |
| F17 | 🔴（NWT M5，已复核）`sendProtoCommand` 对 write 命令的闸**只读 `PROTO_DRIVER_ENABLED`**：与 3.1 的"独立开关"矛盾（结算开关=1 而旧开关=0 ⇒ 出口挡下结算广播；旧开关=1 而结算开关=0 ⇒ 出口不挡结算广播，全靠驱动/HTTP 自己查，违背账本1444"出口自身是唯一强制点"） | `proto-relay-ipc.mjs` `sendProtoCommand` |
| F18 | 🔴（NWT E1，已复核）`validateCommandPayload` 只校验 schema 里声明的字段，**未知字段静默放行**；旧 relay 的 `get_address_utxos` case 忽略 `cmd.facts`，照旧回 `{ok:true, utxos:[{outpoint,amount}]}`，不报错。且 console 重启会孤儿化在飞的 relay 子进程 ⇒ "新 console + 旧 relay 子进程"是现实场景 | `commands.mjs:268` `validateCommandPayload`；`relay.mjs:1271` |
| F19 | `waitForRpc(timeoutMs = 30000)` 默认 30 s，而 console 侧 proto 读命令的 IPC 超时是 15 s（console 会先超时）；relay 外层 catch 对 handler 抛错回 `{error, phase:'execution'}` | `rpc-listener.mjs:91`；`proto-broadcast-ops.mjs` 的 `sendCmd(..., 15000, ...)`；`relay.mjs:1393` |

## 2. 前置阻塞与需要先裁定的设计点（不裁定，后面的接线就无法成立）

- **P1（relay 只读扩展，须 NWT 审 + Bettor 批）**：F8 + F9 决定了 C1 的"spk/covenant 分类是链上事实"与"pmt 同节点门"在现有 relay 接口下**做不到**。最小方案：
  - **R1（v0.3.1，M1/M2/N1/E1/O1）** `get_address_utxos` 加**可选布尔字段 `facts`**（`COMMAND_FIELD_TYPES` 登记 `'boolean'`，validator 的 typeof 检查会拒 `"true"` 字符串；`case` 里判据**严格 `cmd.facts === true`**）：**仅当 `facts === true`** 才走 relay 的**共享 RpcClient（`waitForRpc()`，即 `covenant_broadcast` 提交所用的那一个）——没有回退到 per-call `new RpcClient` 的路径**；**不带 `facts` 时输出与现状字节不变**（旧路径原样保留，现有消费者零回归，NWT E5 已核）。`facts:true` 有**两种形态**，二者互斥：
    - **形态 O（`outpoints`，C1 的全部 8 处 covenant/ticket 父 UTXO 检查一律用它，N1）**：入参 `address` + `outpoints:[{transactionId,index}]`，1–8 项；服务端校验 `transactionId` 为 64 位 hex、`index` 为 uint32、无重复，**格式不符整条报错**；服务端在**完整** RPC 结果里按 outpoint **精确过滤**，回 `found:[{outpoint,amount,scriptPublicKey:{version,scriptHex},covenantId|null}]` 与 `missing:[{transactionId,index}]`（请求了但不在该地址 UTXO 集里的）；**不受 N 影响、没有 `truncated`**；`missing` 使"确实不在集里"成为显式证据，而不是靠"没看见"推断。
    - **形态 L（列表，仅 fee 输入选取用）**：入参 `address` + 可选 `minAmount`/`maxAmount`（**十进制字符串**，服务端 BigInt 解析；`COMMAND_FIELD_TYPES` 只登记 `'string'`，不收 number——Number 在 >2^53 处丢精度）；返回 `utxos:[…每项同上…]` 与 `truncated`。**顺序写死（O1）**：**过滤（min/max）→ 按 `amount` 降序 → 同额按 `(transactionId 字节序升序, index 升序)` 全序 tiebreak → 取前 `FACTS_LIST_MAX` 项 → `truncated = 过滤后条数 > FACTS_LIST_MAX`**。**方向不可反**：升序截断保留最小的 N 个 = dust 优先，攻击者撒 >N 个 dust 就把正常 UTXO 挤出窗口；降序下要挤掉合法候选必须撒面值不小于它、且 ≤ `maxAmount` 的 UTXO，而窗口内每一项本身都是可用 fee 候选，挤掉只是捐款。（J2 在 9-0 清单里口头拟的"面值升序"方向反了，由 NWT O1 更正。）
    - **`outpoints` 与 `minAmount`/`maxAmount` 互斥**（同时给 ⇒ 整条报错）。**C1 不得用形态 L 判定任何 covenant/ticket 输入的存在性**：R1 的 `address` 是由市场状态确定性算出的公开 P2SH 地址，任何人可往上撒 dust；形态 L 的"缺失 + `truncated` ⇒ fail-closed"会被 >N 个 dust 永久卡死该市场步骤（N1，NWT `99affacb`/`82cd2fb9` 首提；按 KIP-9 撒 200 个约几十 KAS，是可接受的封死成本）。
    - **`FACTS_LIST_MAX = 200`**：具名导出常量，测试断言其值，**不可由 env 调整**（调大要走审）。N1 落地后 N 只影响 fee 输入的列表形态，不再是安全参数。
    - **响应回声（E1）**：`facts:true` 的响应**恒带** `facts:true`、`factsVersion:1`（整数，是**响应 schema 版本**，不是 relay 构建号）与 `form:'outpoints'|'list'`；每个 `found[]`/`utxos[]` 项**必含** `scriptPublicKey.scriptHex`（string）与 `covenantId` 键（`null` 或 64 位 hex）。**消费方（9-1）对以下一律 fail-closed**：缺 `facts`、`factsVersion !== 1`、`form` 与请求不符、任一项缺上述键（F18）。顶层回声防不住"relay 已升级但 wasm 旧"，条目级回声 + M1 哨兵合起来覆盖。
    - **取值位置（M1）**：`covenantId` 必须读 **`e.entry.covenantId`**（`Hash`→hex 字符串，`String()` 化），**不得**按现有归一化 `e.amount ?? e.utxoEntry?.amount ?? e.entry?.amount` 的惯性读 `e.covenantId`（那会对所有 UTXO 恒为 null，使 ticket 行"期望无 covenant"空判通过）；**能力哨兵**：`'covenantId' in e.entry` 为假 ⇒ **整条命令报错**（`covenant_id_field_missing`），**不得**回 null。NWT 核过哨兵语义：`covenantId` 是 wasm 类原型上的 getter，`in` 对**所有**条目恒真，只在旧 wasm 构建（类上无该 getter）才为假。**夹具约束**：夹具若用普通对象，非 covenant 条目必须显式写 `covenantId: undefined`（键存在），只省略键会让哨兵对普通 P2PK 误报；更稳是夹具用带原型 getter 的类或由真实 wasm 条目生成，真实性由 9-0 的"对真实节点逐字节比对"承担。
    - **结构性证明"没有 per-call 客户端"（取代 v0.3 的 spy 判据）**：ESM 下 `connectRpc` 是 `p2sh.mjs` 的模块内部绑定，测试换不掉它，spy 永远"没被调用"是**空判据**。改为：① 新建 `kasia-relay/src/lib/utxo-facts.mjs`（纯函数 + 依赖注入），**源码扫描断言其不含 `connectRpc` / `new RpcClient`**；② handler 只把 `waitForRpc()` 的结果注入它。
    - **`waitForRpc` 超时（F19）**：默认 30 s 而 console 读命令 IPC 超时 15 s。9-0 的 diff 里**须写明** facts 路径与 R2 使用的 `waitForRpc` 超时值（J2 提议 8 s，小于 console 的 15 s，NWT 审 diff 时定）与失败行为：抛错原样上抛，由 relay 外层 catch 回 `{error, phase:'execution'}`（现有行为），**不吞、不回落到 per-call 客户端**。
  - **R2（v0.3，M2）** 新增只读命令 `get_past_median_time`，走**共享 RpcClient**（同 R1），**只回 `{ok, pastMedianTimeMs:number, observedAtMs:number}`**（`observedAtMs` = relay 读取时的墙钟，供 §8 的 `pmtEvidence` 带新鲜度）；**不**返回 RPC URL/节点标识，**不**顺带返回 `virtualDaaScore`/`sink` 等用不上的字段。同一个 relay 既读 pmt 又用同一共享连接提交交易，"同节点"**无条件**成立（不依赖 `KASPA_RPC_URL` 与共享客户端解析到同一节点）。**旧 relay 兼容（E1 附）**：R2 不需响应回声——旧 relay 的 `COMMAND_TYPES` 里没有 `get_past_median_time`，validator 以 `unknown command type` 拒，天然 fail-closed；9-0 加测试证明"旧 relay 对 R2 回的是错误而不是 `{ok:true}`"。R2 同样受 R1 末条的 `waitForRpc` 超时约束。
  - **登记面（M3）**：新只读命令与新字段要登记的位置**不止"白名单一行"**——① console 侧 `PROTO_COMMAND_ALLOWLIST`（加 `get_past_median_time: 'read'`）；② relay `commands.mjs` 三处：`COMMAND_TYPES`、`COMMAND_PAYLOAD_SCHEMA`、`COMMAND_FIELD_TYPES`（`facts:'boolean'`、`outpoints:'array'`、`minAmount`/`maxAmount:'string'`，均为可选字段；金额不收 number）；③ relay `authorize.mjs` 的 `READONLY_ALLOWLIST`；④ `relay.mjs` 的 handler。漏 ③ 的后果：现在（gate 未 arm）只打 warn，将来 arm 后该命令被当"需信封类"静默拒绝——pmt 门与 C1 永远读不到的隐蔽故障。现状已有 3 个"半截注册"的 `chain_get_*`（`lint-kanet` 的 R-COMMAND-REGISTRATION 每次提交都报），**不得再添第 4 个**。9-0 验收测试：枚举 `COMMAND_TYPES` ∩ console 允许表 ∩ relay `READONLY_ALLOWLIST`，新命令**六个位置（①、②三处、③、④）齐全**；`PROTO_COMMAND_ALLOWLIST` 对旧表做差分只多一行 `read`。
  - 被否决的替代：console 用自己的共享 RpcClient 读 pmt——它与 relay 提交所用节点不保证同一个（console 共享 RpcClient 有回退公网的既往），违背"同节点"；不能只靠 `getMempoolEntry` 之类现有命令间接推断。
  - **（Bettor 裁定 D1：采纳，作独立小批 9-0 先落；条件 = NWT 审过边界：只读、不开签名或广播路径、字段只加不改）**。9-0 自带回归：① relay 返回的 `scriptPublicKey` 与 `covenantId` 必须与节点直读**逐字节一致**（对着同一节点同一 UTXO 两条路径比对，含 covenant 与普通 P2PK 两类）；② `PROTO_COMMAND_ALLOWLIST` **只多一行 `read`**（对旧表做差分断言：新表 = 旧表 + 恰一项，且该项值为 `'read'`）；③ 现有 `get_address_utxos` 全部消费者不因新增字段而变（grep + 快照测试）。
- **诚实边界**：R1/R2 不引入新的 write 面，但**改了 relay 的对外输出/白名单**（F7 说这本身是安全边界变更）。**若不采纳 R1/R2，批9 的 C1 covenant 分类与 pmt 同节点两条无法按 Codex/NWT 的要求证明，接线不得继续。**
- **P2（`/resolve` 是"任意结果签名预言机"的入口）**：F4 + F12：`winning_side` 是 close_commit 5 个委员槽自动签名的输入。接线时 `/resolve` 必须：① **write-once**（`winning_side IS NULL` 才写，写后不可改；改需人工 SQL 且报警）；② 校验 `status==='sealed'` 且 market 的 seal intent 已 `landed`；③ **操作员鉴权**——现有 proto 路由无鉴权，主网暴露面上不能让任意请求决定结算结果。**（Bettor 裁定 D2）鉴权复用 admin-secret 分级机制，新开一档 `ADMIN_SECRET_SETTLEMENT`**（新生成；env 只写键名、值不入库/不入文档）；write-once 在任何环境强制；批 9-3 之前 `/resolve` 保持 501。
  - **`/resolve` 唯一规范文本（S11：取代 v0.3 里 §2 P2 三段、§13 9-3 行、§14 D2 行、S3b 判定各写各的；其余位置只引用本段）。** 来源 = NWT `RESOLVE-AUTHZ-VERDICT.md`（`82cd2fb9`）的 R1–R6，此处记作 **A1–A6**（避免与上文 relay 的 R1/R2 混名），全部是 9-3 的规格。Verdict：三层"够"的前提是**把 IP allowlist 当 0 分**——承重的是专档密钥的保密性 + write-once 的原子性 + `confirm` 回显；console 只绑回环（KANet-UI 1530 核过无本机反代），allowlist 挡得住的"非回环源"本来就进不来，挡不住的（本机任何进程、`ssh -L`）恰是所有满足 allowlist 的源。`ssh -L`（已认证 SSH 用户，目前仅 J1）为**已接受的剩余风险**。
    - **A1 请求准入**（**路由级 preHandler**，不用全局钩子——`index.js` 现有全局 preHandler 是 UTF-8 校验，别混进来）。顺序 ①→⑤，前三条失败**不回显**任何关于密钥的信息（统一 403，日志记原因）：① **拒绝**任何带 `X-Forwarded-For` / `Forwarded` / `Via` / `X-Real-IP` 头的请求（这条路由只被运维者从本机 shell 直连，没有合法的代理跳）；② `request.socket.remoteAddress ∈ {127.0.0.1, ::1, ::ffff:127.0.0.1}`——**固定字面量集合，不读 `ADMIN_IP_ALLOWLIST`**（若复用 env，启动时必须断言其只含回环字面量，否则运维者一次"临时加个 IP"就把本条掏空；直接写死更简单）；③ `Host` 头必须是回环字面量 + 本进程端口（`127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>`），缺失/域名/他人 IP/无端口一律拒（挡 DNS rebinding 与保留原 Host 的转发）；④ `checkAdminSecretTier(request,'ADMIN_SECRET_SETTLEMENT')`（专档，A2/A3）；⑤ write-once（A4）+ `confirm` 校验。
    - **A2 tier 隔离是值的性质，不是名字的性质**：`checkAdminSecretTier` 只按 env **名**区分档；运维者若图省事把 `ADMIN_SECRET_FUNDS`（主网 env 已设）与新档设成同值，"拿 FUNDS 打 `/resolve` 必 403"在代码测试里绿、在生产里恒为 200。console **启动时对所有已设的 `ADMIN_SECRET_*` 做两两 SHA-256 摘要比较**（不打印值、不打印摘要），**撞值 ⇒ LOUD 日志 + `/resolve` 保持 503（disabled），直到修正**。（NWT 新发现，v0.3 没有。）
    - **A3 常数时间且不泄露长度**：对两边先取 SHA-256 再 `crypto.timingSafeEqual`（定长，规避长度不等时抛错与长度泄露）；`provided` 非 string（重复头/数组）一律拒。倾向**改 helper 本身**（对所有档受益），条件：503（env 未设）/403（缺/错）语义与 `src/api/t-loopback-authz-funds-hotfix.test.mjs` 现有全部用例逐一不变；若改 helper，9-3 diff 里**单列一个 commit 并附该文件跑分**。密钥值 ≥32 字节随机（hex 64），启动检查长度 <32 ⇒ 该档保持 503 + LOUD。
    - **A4 write-once 是单事务原子块**：`UPDATE proto_markets SET winning_side=? WHERE id=? AND winning_side IS NULL AND status='sealed'` + 断言 `changes===1`；"seal 意图已 `landed`"的检查与该 UPDATE 放在**同一个同步 `db.transaction` 块、之间无 `await`**。并发测试：`Promise.all` 两个不同 outcome ⇒ 恰一个 200、另一个 409。**写入路径唯一**：源码扫描测试断言 `src/` 下对 `winning_side` 的 `UPDATE`/`INSERT` 赋值**恰好一处**（今天为零处；9-3 后应恰一处，出现第二处 ⇒ 红）。请求体 `confirm:"<market_id>:<outcome>"` 回显必填（write-once + 自动签名 ⇒ 录错不可撤销）；SQLite 触发器 `BEFORE UPDATE OF winning_side … WHEN OLD.winning_side IS NOT NULL ⇒ RAISE(ABORT)` 为**可选**（需迁移与人工改库例外流程，由 Bettor 裁，不作 MUST）；建议（不阻塞）加 `dry-run`（`?dry=1`）：只返回"将写入 `{market_id, outcome, 派生 payouts, committeeMode}`"而不写，让运维者在不可撤销写入前看到 close_commit 会据此签什么；冷静期留给 Bettor 裁定。
    - **A5 审计与失败信号**：成功/失败（403/409/400）都写 `events`：时间、市场 id、outcome、`socket.remoteAddress`、`User-Agent`、拒绝原因码；**绝不写密钥/摘要/`confirm` 之外的请求头**。同一进程内 1 分钟 ≥5 次 403 ⇒ `error` 级报警；**不做锁定**（锁定本身是运维者被锁在外的 DoS 面，且 64 hex 密钥暴力不可行）。
    - **A6 运维口径**：调用 `/resolve` 的脚本从**文件或环境变量**读密钥，**不放命令行参数**（同用户进程读得到命令行）；密钥文件不得在任何 git 工作树内；提交的 runbook 只写"从 `<路径>` 读"，不写值。
    - **测试矩阵**：无头/错头/env 未设/密钥长度不足/与其他档撞值 ⇒ 拒；带 `X-Forwarded-For`/`Forwarded`/`Via`/`X-Real-IP` 任一头 ⇒ 拒；`Host` 非回环字面量（含域名、他人 IP、缺失、端口缺失）⇒ 拒；`request.ip` 在名单但 `socket.remoteAddress` 非回环 ⇒ 拒；拿 `ADMIN_SECRET_FUNDS` 打 `/resolve` ⇒ 403；重复头（数组）⇒ 拒；write-once 并发；`winning_side` 唯一写入点扫描。
    - **旧口径作废与事实存档**：v0.3 里"以 `health.js` runtime-identity 为模板：`ADMIN_IP_ALLOWLIST` 同时核 `request.ip` 与 `socket.remoteAddress`"的读法作废——`trustProxy:'127.0.0.1'` 下直连回环时 `request.ip` 会改读 X-Forwarded-For，不可信；runtime-identity 只借其"路由级 preHandler + 专档"的形态，不再作 IP 判据。事实：`checkAdminSecretTier(request, envVarName)` 本身无任何 loopback/IP 判断，只做 env 未设 ⇒ 503、`x-kanet-admin-secret` 缺失或 `!==` 不等 ⇒ 403（`src/lib/admin-secret-tier.mjs:36`，非常量时间，A3 处理）。

- **P3（seal 触发与下注上限）**：F5：无 `sealing` 中间态（加 status 值要重建表，代价大）。设计：seal 触发条件 = `status='betting'` ∧ 已确认下注数 == `seal_count` ∧ 该市场**无** pending/prepared/submitted 的 append 意图（`assertNoInFlightAppend` 同款）；**seal 意图 landed 后**才 `markMarketStatus('sealed')`。为防第 `seal_count+1` 笔下注在链上被合约拒（卡死 append 意图），`/bet` 须在 `已确认+在途 ≥ seal_count` 时 409（现状**未见此校验**，须核并补——属 proto.js 小改）。
  - **NWT 条件（S4，D5）**：① 计数把 `ambiguous` 以及"失败但未证不在链上"的下注**算作在途**（保守；否则会放进第 `seal_count+1` 笔，被合约拒后卡死 append 意图）；② **检查与 `INSERT` 在同一同步块内、之间无 `await`**（better-sqlite3 同步，才原子），并加并发测试；③ 现状 `/bet` 只校验 `stake >= min_bet`，`Number(amount)` 可为非整数/超大值而状态字段是 int64 ⇒ 顺带要求 `Number.isSafeInteger(amount)`（读代码时顺带看到，不在原设计范围，Bettor 已纳入）。
- **P4（`proto_claims` 行创建时机）**：F6：`resolve` 意图 landed 后，驱动按 `deriveCloseCommitInputs` 的 payouts（v0 恰 1 条）**创建一行 `proto_claims`（side='win', amount=pool_value）**，其 id 作为 `convert_to_claim`/`claim_draw` 的 subject_id；创建走 `INSERT OR IGNORE`（按 market_id 唯一约束的等价查询保证只有一行），不引入迁移。
- **P5（链上指针的存放）**：F13：**不加列、不迁移**——新增纯函数模块 `proto-settlement-pointers.mjs`，从已 `landed` 的结算意图的 `prepared_tx_json` 反序列化取：txid（**必须**等于 `submitted_txid`，否则 fail-closed）、输出下标（用 builder 导出的具名常量）、covenant_id（输出的 `covenant.covenantId`）。所有指针**仅作"预期 outpoint"**，是否真实存在与未花费由 C1 用链上事实证明（§6）。
- **P6（builder 小改，放批 9-1，Bettor 要求）**：close_commit 返回 `continuationOutputIndices:[0]`，使 relay 固定面值校验覆盖其 RootClose 续约输出（F11）；四个 builder 新增**必填**入参 `chainParents`（§6.3），在 mass/fee 判定前交叉核对。
- **P5 补（S10：8 个角色的预期 outpoint 来源表）**：P5 只写了"从已 landed 结算意图的 `prepared_tx_json` 取指针"，但 seal 的 leaf/held 与 claim_draw 的 ticket 的预期 outpoint 来源是**下注 append 意图 / market genesis / 下注行**，不是结算意图。8 个角色各自的来源如下（J2 读码核过；输出下标为 `proto-tx-assembly-settlement.mjs` 的具名常量；**9-1 落码前逐格再对一次**）：

| 步骤·角色 | 预期 outpoint 来源 | 来源域 |
|---|---|---|
| seal·leaf | `deriveLeafOutpoint(marketId)`（`proto-leaf-state.mjs:42`）：最新 landed 的 append 意图（`proto_bet_intents` step=append）的 `submitted_txid` + `REGISTER_APPEND_LEAF_CONT_OUT_INDEX`；无下注时退回 genesis 的 `proto_markets.shardleaf_txid/vout` | 下注/genesis |
| seal·held | `deriveHeldKttOutpoint(marketId)`（同文件 `:64`）：同一笔最新 landed append 的 `submitted_txid` + `REGISTER_APPEND_TOK_OUT_INDEX` | 下注 |
| close_commit·rootClose | seal 结算意图 landed 的 `prepared_tx_json`（txid 须等于 `submitted_txid`），`MARKET_SEAL_ROOTCLOSE_OUT_INDEX`=0 | 结算 |
| convert_to_claim·rootClose | close_commit 意图 landed，`CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX`=0 | 结算 |
| convert_to_claim·held | **seal** 意图 landed（close_commit 不花代币），`MARKET_SEAL_TOKEN_OUT_INDEX`=1 | 结算（跨两步） |
| claim_draw·rootClaim | convert_to_claim 意图 landed，`CONVERT_TO_CLAIM_CLAIM_OUT_INDEX`=0 | 结算 |
| claim_draw·held | convert_to_claim 意图 landed，`CONVERT_TO_CLAIM_TOKEN_OUT_INDEX`=1 | 结算 |
| claim_draw·ticket | 赢家下注行 `proto_bets.ticket_txid/ticket_vout`（append 确认时由 `proto-broadcast-ops.mjs:288` 写入） | 下注 |

  - `expectedCovenantIds` 的来源与"最新 landed append"取法的核实结论，**以 §18.1 为准**（v0.3.2 已逐格核对，此处不再保留会漂移的第二份）。
  - `deriveLeafOutpoint`/`deriveHeldKttOutpoint` 的 `landed_at DESC LIMIT 1` 无 tiebreak：核实结论见 §18.1（**活性问题、不是安全问题**；修法一行，走审，放 9-1）。


## 3. 开关与启动（默认关闭）

| # | 要求 | 证明 |
|---|---|---|
| 3.1 | 新开关 `PROTO_SETTLEMENT_DRIVER_ENABLED`，**独立于** `PROTO_DRIVER_ENABLED`；`isProtoSettlementDriverEnabled()` = 该开关==='1' ∧ `!!PROTO_RELAY_ID`（`startProtoSettlementDriver` 与 HTTP 共用同一判据，同 F1 形状） | 单测：两开关 × PROTO_RELAY_ID 的 2×2×2 共 8 态，仅"结算开关真 ∧ relay 已配置"启动，其余全不启动；两开关互不影响 |
| 3.2 | 关闭：打 `[proto-settlement-driver] disabled`；启动：打 `[proto-settlement-driver] started (tick …ms, cap …/tick, network=…)`（同 F1 日志风格，`network` 显式打印，simnet 时 LOUD） | 单测捕获 console：两种形状各一 |
| 3.3 | 关闭态**零 IPC**：不启动 interval，不发任何 `sendCmd`；HTTP 在关闭态只建 pending 行并回 409 `proto_settlement_driver_disabled`（同 bet 端点先例） | 单测：注入 spy sendCmd，关闭态调用次数 = 0 |
| 3.4 | **（M4，替换 v0.2 的空判据）** 主网**实际生效**的 env 文件（`kanet.env`/`kanet.mainnet.env` 被 `.gitignore`，`git grep` 只搜被跟踪文件，无论开没开都零命中）**不含**新开关行；合入不带运行时效果 | ① 由 KANet-UI/运营者**现场核**实际生效的 env 文件，报文件路径与"该键不存在"的结论（不贴内容）；② 合入后主网 console **首次启动日志必须出现 `[proto-settlement-driver] disabled`**（运行时证据，不是静态搜索）；静态上仍检查 `kanet.env.example`/`.template` 里该键默认 0 |
| 3.5 | 单飞（in-flight 标志）+ 每 tick cap；重入 tick 直接跳过（同 F1） | 单测：并发两个 `driveOnce` 只有一个进入 |
| 3.6 | 与现有驱动共用 `assertProtoRelayHealthy()`（余额硬顶、relay 存活）；unhealthy ⇒ 跳过整 tick，不发命令 | 单测：注入 unhealthy ⇒ 无 IPC |
| 3.7 | `network` 一致性断言（NWT 审计项 ②的启动侧）：`network` 取自 `KASPA_NETWORK`（默认 mainnet），**必须与 relay 收款地址前缀一致**（`kaspa:`↔mainnet，`kaspasim:`↔simnet …；**S7：按冒号前的整段前缀精确比较** `kaspa`/`kaspasim`/`kaspatest`/`kaspadev`，**不得** `startsWith('kaspa')`——`kaspasim:` 会误判成 mainnet；relay 地址来自 `assertProtoRelayHealthy()` 的 `health.address`（relay 上报，非 console 配置），所以比的是两个独立来源，测试用真实 health 形状），不一致 ⇒ 拒绝启动并 LOUD | 单测：network=simnet 而 relay 地址为 mainnet 前缀 ⇒ 不启动 |
| 3.8 | **（M5/S9，出口分闸，v0.3.1 定稿）** `sendProtoCommand` 的 write 闸改为按 `intent_key` 分闸，且**闸与发送作用于同一份快照**：先 `const out = { ...payload, type }`，闸只判 `out.intent_key`（`typeof === 'string'`），发送的也是 `out`（防访问器/Proxy 使闸与发送读到不同值）。规则：① `intent_key` 为 string 且**以 `settle:` 开头** ⇒ 必须通过**严格格式校验**（S9），不符 ⇒ **直接拒绝，错误串 `proto_settlement_intent_key_invalid`，不回落到旧开关**；通过则需 `PROTO_SETTLEMENT_DRIVER_ENABLED==='1'`，否则拒，错误串 `proto_settlement_driver_disabled`；② 其余 write（含缺失/非字符串/数组/`String` 对象/`settle` 无冒号/`xsettle:`/`Settle:`）⇒ 需 `PROTO_DRIVER_ENABLED==='1'`，否则拒，错误串沿用 `proto_driver_disabled`（**两种拒绝错误串不同**，否则"两闸互换"的变异看不出来）；read 不受约束（账本1441）。**严格格式（S9）**：`settle:<subject_type>:<subject_id>:<step>` 加可选 `#<attempt>`；`subject_type`∈{market, claim}、`step`∈{seal, resolve, convert_to_claim, claim_draw}，且二者按 `STEP_SUBJECT_TYPE` 配对（seal/resolve ⇒ market，convert_to_claim/claim_draw ⇒ claim）；`subject_id` 为 **64 位小写十六进制**（`proto_markets.id` 由 `api/proto.js` 的 `randomBytes(32).toString('hex')` 生成，主网实测三行均 64 位 hex；`proto_claims.id` 由驱动同式生成，Bettor 裁定，P4 建 claim 行时写死；v0.3.1 写成"小写 UUID"是错的，NWT 9-2a 审 MUST-1 抓到）；`#<attempt>` 为 ≥2 的十进制整数（无前导零）。**批 9 排除的 `withdraw`/`reclaim` 及 `ticket` 主体的 `settle:` 键在出口即被拒**（与 §11.1 同向，把"不接线"从约定变成出口强制）。常量取自 `proto-settlement-intent.mjs` 已导出的 `SETTLEMENT_SUBJECT_TYPES`/`SETTLEMENT_STEPS`，不再抄一份字面量。**诚实边界**：这是**按标签**的闸而非**按内容**的闸——结算开关=0 意味着"没有 `settle:` 标签的广播"，不意味着"没有结算形状交易的广播"：`PROTO_DRIVER_ENABLED=1` 时一笔标成 `bet:…` 的结算形状交易仍会被放行（relay 只验固定面值/签名输入上限/fee 上限，不看交易种类）；防线 = 我方驱动是唯一调用方 + S9 严格格式 + §11.1 源码扫描，**不得读成内容级隔离**。这是对"M0a 唯一受控出口"的改动，**放 9-2a：单独一个 commit，先于任何驱动代码，NWT 单独审该 diff** | **锚点（红旗）**：既有 `proto-relay-ipc.test.mjs` 用例③（无 `intent_key` 的 `covenant_broadcast` 在旧开关未设时抛 `proto_driver_disabled`）与用例④（write 命令恰只有 `covenant_broadcast`）**必须原样通过**——9-2a 的 diff 若需改这两条才能绿 ⇒ 分闸破坏了旧行为。新矩阵作**新增用例**：两开关各 0/1 × `intent_key`（合法 `settle:` / 格式不符 / `withdraw` 步 / `ticket` 主体 / 非 settle / 缺失 / 非字符串 / `settle` 无冒号 / `xsettle:` / `Settle:` / 数组 / `String` 对象 / 访问器每次返回不同值）逐格断言放行/拒绝**与错误串**；`git diff -U0` 只应触及那一条 write 闸，白名单自有属性检查、payload 禁 `type/relay_id` 覆盖、数组拒绝、`origin` 恒 `'internal'` 五处字节不变 |

## 4. 意图与状态迁移

- 每步一个 subject/step：seal=`market/<market_id>/seal`；close_commit=`market/<market_id>/resolve`；convert_to_claim=`claim/<claim_id>/convert_to_claim`；claim_draw=`claim/<claim_id>/claim_draw`。依赖：resolve←seal；claim_draw←convert_to_claim；**convert_to_claim 依赖 resolve（跨 subject_type）**——`STEP_DEPENDS_ON` 里 convert_to_claim 现为 null，须由驱动在推进前**额外**检查 market 的 resolve 意图 `landed`（不改 F3 的模块语义，调用方职责，写进单测）。
- 状态推进只由 relay 回执（prepared/submitted）与 `check_utxo_landed`（`minDepth=REORG_SAFE_MIN_DEPTH`）驱动，**NO TX NO STATE**：广播失败/超时/进程死 ≠ 已发生；只有 landed 才推进 `proto_markets.status`（seal→`sealed`、close_commit→`resolved`）与创建后续意图。
- `markMarketStatus('sealed'|'resolved')` 与 landed 记账放在同一个纯函数里（`markSettlementLanded`，仿 `markBetAppendLanded`：`WHERE status=<前态>` 幂等）。

## 5. 每步接线规格（构造前的固定顺序，**全部在签名之前**）

通用顺序（每步都一致，每一项都有单测的"反向必红"）：
1. 建 pending 意图行（`ensureSettlementIntent`，必须先于任何 IPC）。
2. 依赖已 landed（同 subject + 跨 subject 额外检查，§4）。
3. **取链上事实**：对该步每个输入角色，按"预期 spk 推地址"调 `get_address_utxos{facts:true, outpoints:[预期 outpoint]}`（**形态 O**，N1；预期 outpoint 来自 P5/S10 来源表，绝不取"第一个匹配面值的"）；读 `found`/`missing`：`missing` ⇒ 中止（未落链/已花，显式证据）；响应回声（E1）任一不符 ⇒ fail-closed；得到 `{value, scriptPublicKey, covenantId}`（依赖 R1）。**C1 不使用形态 L。**
4. **C1**（§6）：值/spk/covenant 分类逐输入断言，不符 ⇒ 中止，不构造。
5. **DB 派生入参**（C2/B4-4）：close_commit 的 `newWinningSide/newPayoutRootHex` 由 `assertCloseCommitArgsFromDb(marketId, {…, expectedPoolValue})` 派生并核对（`expectedPoolValue` = 由 C1 的 RootClose spk 断言证明的链上 pool_value）；其余步骤的 state 由 DB 派生并与链上 spk 交叉。
6. **步骤专属闸**：close_commit 的 pmt 同节点门（§8）；claim_draw 的 full 分支闸/赢票闸（builder 已 fail-closed，驱动再核一次不冲突）。
7. 调 builder（签名前断言 `assertTicketSigningKey` 在 claim_draw builder 内；close_commit 的委员私钥解密即用即弃在 builder 内；**驱动层永不接触私钥**，§11）。
8. `covenant_broadcast`：`intent_key`、`tx_json`、`sign_input_indices`、`expected_txid`、`genesis_output_indices`、`continuation_output_indices`（P6 补全）——relay 侧 prepared 回执先落库、再广播（现有机制，不改）。
9. landed 检查（`check_utxo_landed(目标地址, submitted_txid, minDepth)`）→ landed 记账与后续意图创建。

| 步骤 | 触发 | 依赖 | 链上输入角色（C1） | 目标地址（landed 判据） | landed 后效果 |
|---|---|---|---|---|---|
| seal | P3 触发条件 | 无（要求全部下注 `confirmed`、无在途 append、held 存在(N2)） | leaf、held | seal 输出0 RootClose 的 P2SH 地址（预期 state 现算） | `status='sealed'` |
| close_commit(`resolve`) | 操作员 `/resolve` 已写 `winning_side`（P2）∧ pmt 门放行 | seal landed | rootClose | close_commit 输出0 RootClose(closed=1) 地址 | `status='resolved'`；创建 `proto_claims` 行与 convert_to_claim 意图（P4） |
| convert_to_claim | resolve landed 且 claim 行存在 | resolve landed（跨 subject） | rootClose、held | RootClaim 地址 | 创建 claim_draw 意图 |
| claim_draw | convert_to_claim landed | convert_to_claim landed | rootClaim、ticket、held | KanetTokenClaim 地址（winner_pk/amount 现算） | `proto_claims.claim_txid/vout/claimed_at` 记账；终态（withdraw 不接线） |

- fee 输入：从 `get_address_utxos{facts:true, maxAmount:SIGNED_INPUT_CEILING}(relayAddress)` 取（**形态 L**，降序窗口 `FACTS_LIST_MAX`；C1 不用此形态），`selectFeeUtxoByConstruction`（沿用 F1 已有做法，按真实构造逐个试，过滤 `> SIGNED_INPUT_CEILING_SOMPI`）；cap 用 `feeProfile.<kind>.cap`（seal 52M / close_commit 30M / convert_to_claim 52M / claim_draw 50M，均已是 NWT 推数）。
- **fee 输入选取阶段过滤（S1，NWT 建议；D6 仍不加中止型断言）**：R1 落地后，选取阶段**跳过**（不是中止）`covenantId != null` 或 `scriptPublicKey != relay P2PK spk` 的候选——避免"毒化 fee UTXO"（F16）造成三源相等失配与不必要的 fee 抬高；同时对 relay 地址 dust 数量靠形态 L 的 `maxAmount` + 降序窗口（S2/O1）兜底。
- 🔴 relay 的 `validateNetLoss`/`validateImpliedMinerFee` 天花板 = 2×relay 本地 wasm 估算：这四步都是 storage 占优、本地估算高估，simnet 全链已证 fee 落在天花板内；**接线离线测试须用 relay 真代码跑这两个校验**（同批8 ㉖ 的做法）覆盖四步，防止将来 builder/fee 变化后静默被 relay 拒。

## 6. C1 完整角色表与调用点覆盖（Codex 条件①③）

### 6.1 角色表（"输入种类逐一断言"）

| 步骤 | 输入下标 | 角色 | 期望面值(sompi) | spk 来源（现算） | 链上分类（R1 的 `covenantId`） | `inputHasCovenant` |
|---|---|---|---|---|---|---|
| seal | 0 | leaf | 20,000,000 | `computeShardLeafRedeemScript(deriveLeafState)` | covenant | true |
|  | 1 | held | 20,000,000 | `computeKttGenesisArtifact(pool_value, owner=leafCovId)` | covenant | true |
|  | 2 | fee | 变量（≤1 KAS，relay 签） | relay 地址 | 普通 | false |
| close_commit | 0 | rootClose | 20,000,000 | `computeRootCloseGenesisArtifact(sealedState)` | covenant | true |
|  | 1 | fee | 变量 | relay | 普通 | false |
| convert_to_claim | 0 | rootClose | 20,000,000 | `computeRootCloseGenesisArtifact(closedState)` | covenant | true |
|  | 1 | held | 20,000,000 | `computeKttGenesisArtifact(pool_value, owner=rootCloseCovId)` | covenant | true |
|  | 2 | fee | 变量 | relay | 普通 | false |
| claim_draw | 0 | rootClaim | 20,000,000 | `computeRootClaimGenesisArtifact(claimState)` | covenant | true |
|  | 1 | ticket | 20,000,000 | `computeTicketGenesisArtifact(bettorPk,side,stake,marketId)` | **普通 P2SH（无 covenant）** | false |
|  | 2 | held | 20,000,000 | `computeKttGenesisArtifact(pool_value, owner=rootClaimCovId)` | covenant | true |
|  | 3 | fee | 变量 | relay | 普通 | false |

（下标以各 builder 的具名常量为准；本表在落码时由测试逐项对着 builder 常量与 `STEP_INPUT_ROLES` 比对。fee 输入不在 C1 的固定面值表内——其面值是变量，但**必须**取自节点回报的 UTXO 而非本地库，并参与 relay 的 `validateSignedInputCeiling`。）

### 6.2 调用点覆盖清单

每个"链上固定面值输入 × 调用点"各一处 C1 调用，共 **8 处**（seal 2：leaf/held；close_commit 1：rootClose；convert_to_claim 2：rootClose/held；claim_draw 3：rootClaim/ticket/held，其中 ticket 是普通 P2SH 但同样断言值/spk/分类）；另加 4 处 fee 输入检查（每步一处：取自节点回报的 UTXO、面值 ≤ SIGNED_INPUT_CEILING）。落码验收：测试枚举 `STEP_INPUT_ROLES` 与本表，任何角色没有对应的调用点断言 ⇒ 红。C1 必须在**签名之前**、**mass/fee 判定之前**执行（见 §6.3）。

### 6.3 `chainParents`：由父 UTXO 事实交叉核对 `inputHasCovenant`（Codex 条件③）

- C1 通过后产出 `chainParents: { [role]: { value, spkLen, hasCovenant } }`（`hasCovenant = covenantId != null`，全部来自节点回报）。
- 四个 builder 新增必填入参 `chainParents`；builder 在**调用 `assertMassWithinCeiling`/`selectChangeShape` 之前**断言：各步导出的具名常量向量（落码时新增，与已有的 `WITHDRAW_INPUT_HAS_COVENANT`/`TICKET_RECLAIM_INPUT_HAS_COVENANT` 同型，如 `CLAIM_DRAW_INPUT_HAS_COVENANT=[true,false,true,false]`，四步现为 builder 内的字面量向量）与 `roles.map(r => chainParents[r]?.hasCovenant ?? false)` 逐项相等，且 `spkLen` 与现算 spk 长度相等。不符 ⇒ fail-closed，**在任何 mass/fee 计算前中止**。
- 目的：mass 的 plurality 取决于"该输入的父 UTXO 是不是 covenant/spk 多长"，这必须是**链上事实**，不能是 builder 里自己声明的常量（常量只是被交叉核对的一方）。

### 6.4 C1 纯函数补全（M6）

- 现有 `assertSettlementInputValuesOnChain` 只比 `value` 与 `scriptPublicKeyHex`，**函数本身不知道预期 outpoint**——§7 ③"同 spk 同面值但 outpoint 不同 ⇒ 不得退化成取第一个匹配"现在只能靠调用方自己按 outpoint 取来保证，任何调用点写错就静默通过。
- 改为入参加 **`expectedOutpoints[role]`** 与 **`expectedCovenantIds[role]`**（`null` 表示"必须无 covenant"，如 ticket），纯函数内断言 `u.outpoint == expected`、`u.covenantId == expected`——**相等，不只是有/无**（P5 指针里本来就有每个输出的 `covenantId`，链上事实与指针相等才算闭合）。错误码沿用 `<role>_outpoint_drift` / `<role>_covenant_class_mismatch`；文件头"fee 输入不在此列"的旧说明随之更新。变异对照：拆掉这两条 ⇒ §7 ③④ 必红。C1 取证一律走形态 O（N1）：服务端按请求的 outpoint 过滤，`expectedOutpoints` 断言的是"DB 指针 == 请求 == 回复"三者相等。
- 枚举测试（§6.2）**以 builder 导出的具名常量为准**（`*_INPUT_HAS_COVENANT`、`STEP_INPUT_ROLES`），四步现为 builder 内字面量，P6 一并导出。
- **S8**：`convert_to_claim`/`claim_draw` 的 builder 把 CONT 面值输出（RootClaim/KanetTokenClaim）放在 `genesisOutputIndices` 里，靠 `GENESIS_OUTPUT_SOMPI == CONTINUATION_OUTPUT_SOMPI == 20,000,000` 才过 relay 的 `validateFixedValueOutputs`（`covenant-broadcast.mjs:68-69`）——现在相等所以没问题，但是隐含耦合：加测试"两常量相等，或 builder 按角色拆分 index 集合"。

## 7. 每个调用点的负向回归（Codex 条件②）

对 seal / close_commit / convert_to_claim / claim_draw 每一步、对其**每个 covenant/ticket 输入角色**，都要有下列四类反向用例，**变异对照必红**（拆掉对应闸 ⇒ 测试变红）：

| 类 | 构造 | 期望 |
|---|---|---|
| ① 链上事实缺失 | 预期 outpoint 出现在 `missing`（含：已被花掉、地址查询空），或命令失败/超时 | 中止，不构造，不发 IPC；错误可区分"未落链/已花/查询失败" |
| ② 金额偏低 / 偏高 | 该 outpoint 面值 = 20M−1 与 20M+1（及 0、超大） | 中止（`<role>_value_drift`），不构造 |
| ③ 元数据相同、outpoint 不同 | 回复的 `found` 里是**同 spk、同面值但 outpoint 不同**的 UTXO（用假 relay 注入），而请求的预期 outpoint 并不在其中 | 中止——**不得**退化成"取第一个面值匹配的"；并有正向对照：预期 outpoint 存在时放行 |
| ④ spk 或 covenant 分类错 | 预期 outpoint 存在且面值对，但 `scriptPublicKey` 不等于现算 spk，或 `covenantId` 有/无与角色表不符（如 ticket 被回报成 covenant、held 被回报成普通） | 中止（spk 不符 / `covenant_class_mismatch`），在 mass/fee 判定之前 |

另加：⑤ `chainParents` 与 builder 常量向量不符 ⇒ 在 mass/fee 前中止（§6.3）；⑥ 指针 `prepared_tx_json` 重算 txid ≠ `submitted_txid` ⇒ 中止（P5）；⑦ 地址上撒 >`FACTS_LIST_MAX` 个 dust 时，形态 O 仍取到目标 outpoint、C1 放行；变异：C1 换成形态 L ⇒ 该用例必红（N1）；⑧ 响应回声缺失 / `factsVersion` 不符 / `form` 不符 / 条目缺键 ⇒ C1 中止（E1）。

## 8. close_commit 的同节点 pmt 门（条件⑤）与 SLA

- **同节点**：pmt 由 **R2 的 `get_past_median_time`（relay 自己的 RpcClient）**读出；提交交易的也是同一个 relay ⇒ 判据与 finality 检查同源。读不到/非法一律 `canSubmit=false`（fail-closed）。
- 判据沿用 `evaluateCloseCommitTiming({pastMedianTimeMs, deadlineMs})`（pmt 领先 deadline ≥ 30s 才放行）；驱动把**放行时读到的 pmt** 作为 `pmtEvidence` 传给 builder（builder 复核同一判据并免除 300s 墙钟余量，C3）；不传则 300s 墙钟守卫作第二层。
- **不用本地墙钟**判断能否提交（B4-2 根治）；墙钟只出现在 builder 的第二层守卫。
- **`pmtEvidence` 新鲜度（S5）**：R2 的 `observedAtMs` 让驱动能带上 `readAtMs` 与 `source:'relay'`；builder 只接受 **`source==='relay'` 且 `readAtMs` 距今 ≤ 60 s** 的 `pmtEvidence`，否则忽略（回退到 300 s 墙钟守卫）。风险本就有界（节点侧 lock_time 检查会拒、无资金损失、可重试），此条是收紧。
- SLA（以 pmt 计）：`≥ deadline+1h` ⇒ `warn` 报警；`≥ deadline+2h` ⇒ `refund_flip_open`（任何人可无签名把 `closed 0→2`，此后 close_commit 永不可入）。
- **`refund_flip_open` 时驱动行为**（Bettor 2026-09-19，本文落细）：仍尽力提交 close_commit（抢先）；若 C1 发现 RootClose 输入已不在预期 outpoint，则**额外**探测 `closed=2` 形态的 RootClose 地址（按同 state 现算 spk）是否有 UTXO：有 ⇒ 已被翻——意图置 `ambiguous`（`last_error='refund_flip_observed'`）+ 报警 `error`，**不重试、不重建**；取消/退款路径 v0 未实现（Bettor 裁定④），转人工。重复检测幂等（不重复报警）。
- **NotFinalized**（节点因 lock_time ≥ pmt 拒）：属"可重试、无状态变更"——走现有 prepared 行的**同字节重播**路径（`resolvePrepared` 的 replay），**不得**进 `ambiguous`（`ambiguous` 只留给 `inputs_spent` 且无正向证据）。需单测：注入 NotFinalized 拒绝 ⇒ 意图仍 `prepared`、下一 tick 重播同一字节。

## 9. 失败策略：不盲重试，先读链

- 构造前失败（C1/DB 派生/闸拒绝）：nothing broadcast，意图保持 `pending`，`last_error` 记原因，下一 tick 重评估；连续 N 次同因报警。
- 已 `prepared`（字节已落库）：**只允许同字节重播**（`resolvePrepared`：先 `get_mempool_entry`、再 `check_utxo_landed`、最后 replay）；**永不重建/重签**。
- 广播返回不明（超时/进程死/孤儿化 relay 子进程日志丢失）：视为"未知"，先链读（mempool → landed），不因"没有日志"就重发（既往教训：console 重启会孤儿化在飞的 relay 子，`没日志≠没发`）。
- `inputs_spent` 无正向证据 ⇒ `ambiguous`，人工，不自动放弃、不重建。
- 每 tick cap；同一 intent 单飞；`maxAttempts=1`（重试交给下一 tick，避免单 tick 被 sleep 阻塞）。
- 重启恢复：启动时跑 `resumeStaleSettlementIntents`（F3 已有）；`targetAddressFor(row)` 与 `relayIdFor(row)` 由驱动提供（本模块不碰业务表）。
- **`prepared_stale` 报警（S6，四步都加，不只 close_commit 的 SLA）**：任一步意图停在 `prepared` 超过 10 分钟仍未 landed ⇒ 报警 `settlement_prepared_stale`（warn；含 intent_key、prepared_txid 前缀、停留时长）。理由：同字节重播救不了"fee 低于节点最低费"的 prepared 行（批 8 ticket_reclaim 就是这个形状）；四步现为 storage 占优、估费偏高所以现不触发，但这是通用兜底。

## 10. 报警（沿用 `alertSettlementIntent` → `events` 表）

| 事件 | 级别 | 触发 |
|---|---|---|
| `settlement_close_commit_sla_warn` | warn | pmt ≥ deadline+1h 且 close_commit 未提交 |
| `settlement_close_commit_refund_flip_open` | error | pmt ≥ deadline+2h 且未 landed |
| `settlement_refund_flip_observed` | error | §8 探测到 closed=2 |
| `settlement_intent_ambiguous_*` | error | 沿用现有三个（inputs_spent / replay_txid_mismatch / prepared_without_bytes） |
| `settlement_signing_key_mismatch` | error | builder 的 `signing_key_mismatch`（claim_draw）；close_commit 的委员槽私钥/公钥不符同理 |
| `settlement_close_commit_args_not_from_db` | error | `assertCloseCommitArgsFromDb` 拒绝 |
| `settlement_chain_fact_drift` | error | C1 的 `<role>_value_drift` / `covenant_class_mismatch` / spk 不符 |
| `settlement_pmt_read_failed` | warn | 连续 3 次读 pmt 失败 |
| `settlement_relay_fee_rejected` | error | relay 返回 `net_loss_exceeded`/`implied_fee_exceeded`（fee 与 relay 天花板背离的早期信号） |
- `committeeMode='single_operator_5x_same_key'` **必须**写入意图记录/响应（B4-6，放 `last_error` 之外的位置：`proto_settlement_intents` 现无该列，**待裁定**：加列走迁移，或放 `prepared_tx_json` 旁的 events payload/响应体），不得把 close_commit 成功读成 4-of-5 门限安全。
- **D3 补（NWT）**：`committeeMode` 同时放进 `/resolve` 与 `GET /api/proto-markets/:id` 的响应，且与意图状态更新在**同一事务**里写（避免"响应体有、events 无"）。

## 11. 审计项（无绕过）

1. **withdraw/ticket_reclaim 不接线**：驱动模块、意图创建入口、HTTP 处理器**均不得 import** `buildWithdrawTxJson`/`buildTicketReclaimTxJson`；`/api/proto-markets/:id/withdraw` 保持 501 并在报文里写明"批9排除（目的地允许清单空 / T-FEE-PRICING）"。测试：扫描驱动/HTTP 源文件，出现这两个标识符 ⇒ 红。
2. **目的地闸**：任何将来接入 withdraw 的调用点**不得绕过** `assertWithdrawDestinationAllowed`，不得传 `destinationAllowlistSpkHex` 造出主网可用目的地（本批不接，此条防后人）。
3. **network 闸**：`network` 只取自配置（`KASPA_NETWORK`），**不得取自请求体/意图行/调用方**；`allowUnlistedTestDestination` 只在 `network !== 'mainnet'` 时生效，驱动**永不传**该标志。启动侧断言见 §3.7。测试：`git grep allowUnlistedTestDestination -- src/services src/api` 零命中。
4. **签名闸**：驱动层**永不接触私钥**（只传 `committeePrivkeyEnvelope`/让 builder 自取信封）；私钥值不出现在日志/events/响应/`prepared_tx_json`/意图列；`PrivateKey.free()` 在 builder 内（已测）。测试：以哨兵私钥跑全流程，扫描 stdout/events/DB 全文不含该值。；**哨兵私钥必须由真实信封解密路径产生**（不是绕过解密直接注入），否则扫的是一条不经过生产解密的假路径（NWT）。
5. **DB 派生不可被入参覆盖**：close_commit 的 `newWinningSide/newPayoutRootHex` 不接受调用方传入，`/resolve` 只写 `winning_side`（write-once，P2），`payout_root` 由现算写入并与库内值交叉（`db_payout_root_drift`）。
6. **relay 边界不放宽**：驱动不新增 write 命令；R1/R2 只读；`covenant_broadcast` 仍要求非空 `signInputIndices`（四步都有 relay 签的 fee 输入，成立）。
7. **M0a 门**：驱动新文件不 bare-import `relay-manager`，只经 `protoSendCmd`（`lint-kanet` 的 M0a 差分门在 staged diff 上会验）。

## 12. 验收测试清单（落码时逐条要有，反向必红）

1. 开关 8 态 + 两种启动日志形状 + 关闭态零 IPC + 单飞 + unhealthy 跳过 + network/地址前缀一致（§3）。
2. 每步"通用顺序 1–9"的每一环各一个正/反向量；变异对照：拆掉任一闸（C1、DB 派生、pmt 门、chainParents 核对、依赖检查、指针 txid 校验）⇒ 对应测试变红。
3. §6/§7：角色表×调用点覆盖枚举测试 + 四类负向回归 × 每个调用点。
4. §8：pmt 同节点门（注入 rpc 假实现：读失败/非法/未到 deadline+30s/刚好到/跨 1h/跨 2h）、`pmtEvidence` 传递、NotFinalized 不进 ambiguous、refund_flip_observed 幂等。
5. §9：prepared 同字节重播、孤儿化不重发、`inputs_spent` 有/无正向证据两分支、重启恢复。
6. §11 各条审计测试（源文件扫描 + 哨兵私钥扫描）。
7. **relay 真代码校验**：四步的成品交易全部通过 `validateFixedValueOutputs`/`validateSignedInputCeiling`/`validateNetLoss`/`validateImpliedMinerFee`（同批8 ㉖ 做法）。
8. **端到端集成验证**：driver 开关在**隔离 simnet console**（KASPA_NETWORK=simnet，非主网 console）上开启，走一次完整 genesis→…→claim_draw（withdraw/reclaim 不走），每步记录：交易 version、编码器 commit、节点 sha256+`--version`、断言信号 vs 节点值（不等即停）、区块记录节点原始字段；证据入 `docs/provenance/<日期>-…`。
9. 合入前全套 proto 测试 + lint 0 error；迁移编号接主线末块（本设计**默认不加迁移**；committeeMode 列若要加则单列）。
10. 夹具真实性：所有 UTXO mock 的面值/spk/covenant 分类必须能追溯到一笔真实链上交易（ANTI-PATTERNS 候选：夹具与生产路径不一致族）。**（M1）`covenantId` 相关夹具必须由真实 kaspa-wasm 条目生成（或逐字节复制自真实节点回复）**；变异对照：把测试夹具的 `covenantId` 从 `entry.covenantId` 挪到顶层 ⇒ 生产读取代码必须回"能力哨兵报错"而不是 null（防"手写夹具绿、生产恒 null"）。
11. **9-0（R1/R2，M1–M3/N1/E1/O1）**：① 对同一节点同一 UTXO，relay `facts:true` 回的 `scriptPublicKey`/`covenantId` 与节点直读逐字节一致（含 covenant 与普通 P2PK 两类；形态 O 与形态 L 各一）——**此项要起 simnet，须先报 Bettor 放行**；② `'covenantId' in entry` 为假 ⇒ 整条命令报错、不回 null；③ 不带 `facts` 时输出与改前字节相同（旧函数注入 + 快照）；`facts` 非布尔 `true`（`'true'`/`1`）⇒ validator 拒；④ **结构性证明**：`utxo-facts.mjs` 源码扫描不含 `connectRpc`/`new RpcClient`，handler 只注入 `waitForRpc()`（**不用 spy**，见 §2 P1）；⑤ 形态 O：1–8 项、64 位 hex、uint32、无重复、与 `minAmount`/`maxAmount` 互斥，违者整条报错；`found`/`missing` 划分正确；**地址上有 >`FACTS_LIST_MAX` 个 dust 时仍取到目标 outpoint**（N1）；⑥ 形态 L：同一批 UTXO **打乱顺序输入 ⇒ 输出字节相同**；构造 300 个（250 dust + 50 可用）且无 `minAmount` 时返回窗口含全部 50 个可用（O1）；`truncated` 语义；金额一律 BigInt 比较（含 >2^53 的值）；⑦ 响应回声：恒带 `facts:true`/`factsVersion:1`/`form`，每项含 `scriptPublicKey.scriptHex` 与 `covenantId` 键；**旧 relay 模拟**（忽略 `facts` 的假 relay）⇒ 消费方 fail-closed；⑧ R2 只回 `{ok,pastMedianTimeMs,observedAtMs}`，无 URL/节点标识/其他字段；**旧 relay 对 R2 回的是 `unknown command type` 错误而不是 `{ok:true}`**；⑨ 登记六处齐全（枚举测试，不新增第 4 个"半截注册"）；⑩ `PROTO_COMMAND_ALLOWLIST` 对旧表差分恰多一行 `read`；⑪ `FACTS_LIST_MAX` 导出且值为 200，代码里无 env 读取；⑫ `waitForRpc` 超时值与失败行为写在 diff 里；⑬ **变异对照**（必红）：夹具 `covenantId` 挪到顶层；C1 换成形态 L；排序改升序；拆掉回声；不带 `facts` 快照被改；`facts` 判据改成真值判断。
12. **9-1**：S10 来源表逐格对着 builder 常量核；8 角色 × 四类负向变异必红；**毒化 fee 向量**（NWT 审 9-1 时起 simnet 补：第三方密钥创建"covenant 绑定 + spk = relay P2PK"的 UTXO，喂给真实 fee 选取函数，断言被跳过且选中的是干净候选，同时验证 S1 代码与"创建到他人 spk"的推断）。
13. **9-2a（M5/S9，出口分闸，单独 commit、NWT 单独审）**：见 §3.8 的锚点与矩阵；变异对照（NWT 在自己的 worktree 做）：分闸判据改回只读旧开关 ⇒ 矩阵红；`startsWith('settle:')` 改 `includes('settle')`/忽略大小写 ⇒ 伪造行红；两个 env 名互换 ⇒ 红；拆掉"闸与发送同一份快照" ⇒ 访问器行红；去掉 S9 严格校验 ⇒ 格式不符行红。
14. **9-3（/resolve）**：见 §2 P2 唯一规范文本 A1–A6 的测试矩阵。

## 13. 落码分批建议（每批先审后动）

| 批 | 内容 | 门 |
|---|---|---|
| 9-0 | **R1/R2**（M1–M3/N1/E1/O1 形状：`get_address_utxos` 可选 `facts:true` 两形态〔`outpoints` 精确取证 / `list` 仅 fee 选取〕走共享 RpcClient、`entry.covenantId` 读取 + 能力哨兵、响应回声、`FACTS_LIST_MAX=200`、降序截断；`get_past_median_time` 只回 `{ok,pastMedianTimeMs,observedAtMs}`；六处登记；新建纯函数模块 `utxo-facts.mjs`）+ §12.11 全部回归 | NWT 审边界 + Bettor 批；D1 已裁；**v0.3.1 已含 N1/E1/O1，Bettor 放行后 J2 直接开工，NWT 审 9-0 diff 时对照 v0.3.1**；附条件：`case` 里严格 `cmd.facts === true`、`facts` 登记 `'boolean'`、`waitForRpc` 超时行为写在 diff 里；合入说明注明"新命令需 relay 重启才生效，主网 relay 重启另走闸，不在 9-0"；第 ① 项对照要起 simnet，先报 Bettor 放行 |
| 9-1 | `proto-settlement-pointers.mjs`（P5 + **S10 来源表**，§18.1）+ C1 调用点模块（含 `chainParents`，取证走形态 O，消费方响应校验 §18.2）+ builder 小改（P6，含 close_commit 的 `continuationOutputIndices:[0]` 与 seal/close_commit 的输入下标具名常量导出）+ 全部负向回归（含 N1/E1 两类）+ 毒化 fee 向量 + `landed_at` tiebreak 小改；文件清单见 §18.3 | NWT 审；**前置：§18.0 基线依赖——批 6–8 与 C1 纯函数尚未合主线，9-1 落码前须先合入** |
| 9-2a | **出口分闸（M5/S9，§3.8）——单独一个 commit，先于任何驱动代码**；锚点：既有 `proto-relay-ipc.test.mjs` 用例③④原样通过 | NWT 单独审该 diff（含变异） |
| 9-2b | 驱动分支 + 开关 + 启动日志 + `markSettlementLanded` + pmt 门接线（`pmtEvidence` 新鲜度）+ SLA 报警 + `prepared_stale` + 重启恢复（依赖 9-2a） | 9-2a 已审后 NWT 审 |
| 9-3 | HTTP：`/resolve` 按 **§2 P2 唯一规范文本 A1–A6** 实现（write-once + `ADMIN_SECRET_SETTLEMENT` 专档 + 路由级准入 + 值撞档检查 + 常数时间比较 + 审计）、`/claim`（建 claim 行 + 意图）、`/bet` 上限校验（P3/D5：已确认+在途 ≥ seal_count ⇒ 409）、`/withdraw` 仍 501；`checkAdminSecretTier` 改常数时间（A3）若改 helper 须单列 commit 并附 `t-loopback-authz-funds-hotfix.test.mjs` 跑分 | Bettor 批（用户面/鉴权）+ NWT 审 |
| 9-4 | 隔离 simnet console 端到端 + provenance；**用全新 DB 与全新 env 副本**（新建库、新 env 文件，不复用/不指向主网库与主网 env，`DB_PATH`/`CONSOLE_ENCRYPTION_KEY`/`PROTO_RELAY_ID` 均为一次性测试值；env 副本里 `KASPA_NETWORK=simnet`） | NWT 复核证据 |
| 主网开闸 | D-022 另开闸，Owner 终端点 GO | 不在批9内 |

## 14. 裁定记录（Bettor 2026-09-19，D1–D6 已裁）

| # | 问题 | 裁定 |
|---|---|---|
| D1 | 采纳 R1/R2？ | **采纳**，独立小批 9-0 先落；条件 = NWT 审过边界（只读、不开签名或广播路径、字段只加不改）；9-0 自带回归：relay 返回的 spk/covenantId 与节点直读逐字节一致；白名单只多一行 read |
| D2 | `/resolve` 鉴权 | 复用 admin-secret 分级机制，新开一档 `ADMIN_SECRET_SETTLEMENT`（新生成、env 只写键名）；write-once 在任何环境强制；9-3 之前该路由保持 501。**具体规格见 §2 P2 唯一规范文本 A1–A6（S11：取代此前三处不一致的写法）**；IP allowlist 不计分，`ssh -L` 为已接受剩余风险 |
| D3 | `committeeMode` 记哪 | events payload + 响应体，不加迁移 |
| D4 | refund_flip 已翻的终态 | 意图 `ambiguous` + 专用报警，不加终态 |
| D5 | `/bet` 上限校验 | 做：已确认 + 在途 ≥ seal_count 即 409 |
| D6 | fee 输入额外断言 | 不新增 |
| 附加① | close_commit builder 补 `continuationOutputIndices` | 放 9-1，让 relay 固定面值校验覆盖续约输出 |
| 附加② | 9-4 端到端 | 全新 DB + 全新 env 副本，不碰主网库 |
| 流程 | 落码顺序 | NWT 设计审 GREEN 后按 9-0 → 9-1 → 9-2a → 9-2b → 9-3 → 9-4，每批提交给 Bettor 推、NWT 审 |

## 15. 与 v0.1 清单的关系

v0.1 的 §1–§7 各条本文均继承；差异：① 范围收窄为四步；② C1 从"面值+spk"升级为"面值+spk+covenant 分类（链上事实）"并要求 `chainParents` 在 mass/fee 前核对；③ 明确 P1（R1/R2）为前置阻塞；④ pmt 同节点由"提醒"变成有具体通路（R2）；⑤ withdraw/ticket_reclaim 从"待补"改为"排除并有审计项"；⑥ 新增 P2–P5 的设计点（原 v0.1 未发现 F4/F6/F9/F13 这些现状缺口）。


## 16. v0.2 → v0.3：NWT 设计审（8554ef6e）逐条落实

全文见 NWT 分支 `nwt/batch3-independent-verify` 的 `docs/provenance/2026-09-19-nwt-batch3-independent-verify/batch9-design-review/README.md`。J2 已逐条复核其事实（F14–F17 为其中我能在本树复核的；毒化 fee UTXO 实验为 NWT 的 simnet 实测，我未复跑）。

| NWT 项 | 落实位置 | 状态 |
|---|---|---|
| M1 `entry.covenantId` 读取位置 + `'covenantId' in entry` 能力哨兵 + 真实 wasm 夹具 | §2 P1 R1；§13 9-0 回归 | 已写入设计 |
| M2 共享 RpcClient、`facts:true` 可选、R2 只回 `{ok,pastMedianTimeMs,observedAtMs}` | §2 P1 R1/R2 | 已写入设计 |
| M3 登记面（console 允许表 + `commands.mjs` 三处 + `authorize.mjs` + handler）+ 枚举验收 | §2 P1 登记面；§13 9-0 | 已写入设计 |
| M4 3.4 空判据 ⇒ 现场核 env + 启动日志 | §3 3.4 | 已改 |
| M5 出口按 `intent_key` 前缀分闸 + 出口层 2×2 矩阵 | §1 F17；§3 3.8；§13 9-2（v0.3.1 起拆为 9-2a/9-2b，见 §17） | 已写入设计（改 M0a 出口，另审） |
| M6 C1 加 `expectedOutpoints`/`expectedCovenantIds`（相等） | §6.4 | 已写入设计 |
| S1 fee 选取阶段跳过毒化候选（不中止） | §1 F16；§5 | 已写入 |
| S2 R1 返回量上限 | §2 P1 R1（N=200 + `truncated` 语义） | 已写入（N 待 NWT 复核） |
| S3a–d `/resolve`：timingSafeEqual、allowlist/反代运营核对、原子 UPDATE + 并发测试、events 审计 + `confirm` 回显 | §2 P2；§13 9-3 | 已写入 |
| S4 D5：ambiguous 算在途、检查与 INSERT 同步块、`isSafeInteger` | §2 P3 | 已写入 |
| S5 `pmtEvidence` 新鲜度（`source==='relay'` 且 ≤ 60 s） | §8 | 已写入 |
| S6 四步 `prepared_stale` 报警（10 分钟） | §9 | 已写入 |
| S7 §3.7 前缀整段精确比较 | §3 3.7 | 已写入 |
| S8 GENESIS/CONTINUATION 常量相等耦合测试 | §6.4 | 已写入 |
| D3 committeeMode 同事务、同放 `/resolve` 与 GET 响应 | §10 | 已写入 |
| 私钥哨兵走真实信封解密路径 | §11.4 | 已写入 |
| （本轮自查补）§12 验收清单补 11 / 12 两条 | §12.10 补 M1 夹具与变异对照；§12.11 9-0 的 R1/R2 八项回归；§12.12 M5 出口 2×2 矩阵与前缀伪造用例 | 已写入（此前这些只在 §3.8/§13 出现，清单里没有对应条目） |

## 17. v0.3 → v0.3.1：NWT v0.3 设计审（`82cd2fb9`；死机前首提于 `99affacb`）逐条落实

审稿：NWT 分支 `nwt/batch9-v03-review` 的 `docs/provenance/2026-09-19-nwt-batch9-v03-review/README.md` 与 `RESOLVE-AUTHZ-VERDICT.md`。结论 GREEN（M1–M6、S1–S8、D3、哨兵私钥落点齐全），另有三条必须进 v0.3.1 的 MUST。N1/S9 在 NWT 死机前的 `99affacb`（20:36）已提，但那份当时不在 origin、也不在账本 1531，J2 新会话只看到 `8554ef6e`，所以 v0.3 没有——不是漏读，是死机把这一环吞了。

| NWT 项 | 落实位置 | 状态 |
|---|---|---|
| **N1** C1 全部 8 处父 UTXO 检查走 `outpoints` 精确形态（`found`/`missing`，不受 N 影响、无 `truncated`）；列表形态只留给 fee 选取 | §2 P1 R1（两形态）；§5 步骤 3；§6.4；§7 ⑦；§12.11⑤ | 已写入（v0.3 的"`truncated` ⇒ C1 fail-closed"是活性攻击面，已删） |
| **E1** R1 响应恒带 `facts:true`+`factsVersion:1`+`form`，每项含 `scriptPublicKey.scriptHex` 与 `covenantId` 键，消费方缺任一即 fail-closed；R2 不需回声（旧 relay 以 `unknown command type` 拒） | §1 F18；§2 P1 R1；§7 ⑧；§12.11⑦⑧ | 已写入 |
| **O1** 列表形态：过滤 → 面值**降序** → `(txid 字节序, index)` 全序 → 截断；金额 BigInt、min/max 用十进制字符串 | §2 P1 R1 形态 L；§12.11⑥ | 已写入（J2 口头拟的升序方向反，已更正） |
| M1 夹具约束：普通对象夹具非 covenant 条目须显式 `covenantId: undefined` | §2 P1 R1 取值位置 | 已写入 |
| M2 验收④ 的 spy 是空判据（`connectRpc` 是模块内部绑定）⇒ 改"`utxo-facts.mjs` 源码扫描不含 `connectRpc`/`new RpcClient` + handler 只注入 `waitForRpc()`" | §2 P1 R1；§12.11④ | 已改 |
| **S9** 出口对 `settle:` 键严格格式校验（格式不符直接拒、不回落旧开关；批9 排除的步骤/主体在出口拒） | §3.8；§12.13 | 已写入（9-2a） |
| **S10** 8 角色预期 outpoint 来源表 | §2 P5 补；**§18.1（v0.3.2 逐格核对，取代此行原先的"待列全"）** | 已核（8 格全部有代码依据；seal·held 与 ticket 的 covenantId 来源已补；`landed_at` 隐患定性为活性问题） |
| **S11** `/resolve` 三处矛盾 ⇒ 收成一处；NWT R1–R6 作 9-3 规格（R2 = 启动时对所有 `ADMIN_SECRET_*` 两两比 SHA-256，撞值则保持 503） | §2 P2（A1–A6）；§13 9-3；§14 D2 | 已收成一处 |
| `N=200` | §2 P1 R1（`FACTS_LIST_MAX`，具名常量、测试断言、不可 env 调） | 已写入 |
| 毒化 fee UTXO 到他人 spk | §12.12 | NWT 裁：9-0 前不测（结论对设计不敏感），9-1 审时补 simnet 向量 |
| M5 出口分闸审法：9-2a 单独 commit、既有用例③④原样通过为红旗、闸与发送同一份快照、两种拒绝错误串不同、按标签的诚实边界 | §3.8；§12.13；§13 | 已写入（9-2 拆成 9-2a/9-2b） |
| 9-0 附条件：`case` 严格 `cmd.facts === true`、`facts` 登记 `'boolean'`、`waitForRpc` 超时行为写在 diff 里 | §2 P1 R1；§13 9-0 | 已写入（超时提议值 8 s 待 NWT 审 diff 时定，F19） |

**仍开放（v0.3.1）**：`waitForRpc` 超时提议值 8 s 待 NWT 审 9-0 diff 时定；S9 严格格式的常量来源（`proto-settlement-intent.mjs` 导出）待 9-2a 落码时核；seal·held 与 ticket 的 `expectedCovenantIds` 来源待 9-1 列全；SQLite 触发器强化 write-once 为可选，待 Bettor 裁；`/resolve` 的 `dry-run` 为建议项。已定：`FACTS_LIST_MAX=200`（具名常量、不可 env 调）、M5 的 9-2a 锚点（既有用例③④原样通过）。

## 18. v0.3.1 → v0.3.2：9-1 设计细化（只文档）

依据：J2 读码（行号取自读码时的分支头：设计分支 `5bda9583` 侧代码；主线侧文件另注）、NWT 9-0 审 `4e34e9c9` 转来的 S-2/S-3/② 三条、Bettor 对"S10 来源表逐格核"的点头。**本节不含代码。**

### 18.0 🔴 基线依赖（先于一切，9-1 落码前必须解）

**主线（`origin/bshard-m3-deploy`）不包含 9-1 需要的代码。** 读码事实（`git grep` / `git ls-tree` 可复核）：
- 主线只有批 1–5（market_seal / close_commit / convert_to_claim 的 builder 与 `proto-settlement-inputs.mjs` / `proto-settlement-intent.mjs`）。`git grep CLAIM_DRAW_TICKET_IN_INDEX origin/bshard-m3-deploy -- kasia-console/src` **零命中**；`git diff --name-status origin/bshard-m3-deploy <设计分支> -- kasia-console/src` 显示这些文件**只在设计分支侧**：`proto-settlement-chain-checks.mjs`（C1 纯函数，含 `.test.mjs`）、`proto-claim-draw-witness.mjs`（含 `proto-claim-draw.test.mjs`）、`proto-ktt-claim-spend-witness.mjs`、`proto-payout-leaf.mjs`、`proto-ticket-authorize-witness.mjs`；claim_draw 的 builder 本体在 `proto-tx-assembly-settlement.mjs` 里（该文件主线也有，但主线版本不含 claim_draw/withdraw/ticket_reclaim）。
- 以下 **5 个代码提交只在设计分支侧**（比主线多 21 个提交，其余为文档）：`38e73130`（批 6 claim_draw builder）、`ef45f568`（结算接线前条件 C1/C2/C3 = `proto-settlement-chain-checks.mjs` 的 `assertSettlementInputValuesOnChain` + fee cap 替换）、`fd3bbbeb`（批 7 withdraw）、`5e62e24f` 与 `804349e3`（批 8 ticket_reclaim v1/v2）。
- 9-1 要给 claim_draw 加 `chainParents` 与 C1 调用点、要给 C1 纯函数加 `expectedOutpoints`/`expectedCovenantIds`（M6）——这两样都不在主线。

**因此 9-1 不能从主线现头起基线。** 选项（Bettor 裁）：**(a) 推荐**——先把设计分支的批 6–8 + C1/C2/C3 合入主线（沿用批 1–5 的 `--no-ff` 合入做法与 NWT 合入审；它们各自的 simnet 证据与 NWT/Codex 结论已在账本 1519–1526，是否需要补审由 Bettor/NWT 裁），再从合入后的主线切 9-1 分支；withdraw/ticket_reclaim builder 随之进主线但**不接线**，§11.1 的源码扫描（驱动/HTTP 不得 import 这两个 builder）与 §3.8 的出口拒绝保证它们不可达。(b) 不推荐——只 cherry-pick 批 6 与 C1 相关提交进 9-1 基线：产生与主线分叉的历史，且 ef45f568 同时改了 fee cap、与批 7/8 有交叠，拆不干净。

### 18.1 S10 来源表：逐格核对结果

预期 outpoint 与 covenantId 的来源（"结算域"= `proto_settlement_intents.prepared_tx_json`；"下注域"= `proto_bet_intents.prepared_tx_json` / `proto_bets`；两张意图表都有 `prepared_tx_json` 列，已核 `migrate.js`）。输出下标均为具名常量。

| # | 步骤·角色 | 预期 outpoint | 期望 covenantId | 代码依据 | 状态 |
|---|---|---|---|---|---|
| 1 | seal·leaf | 最新 landed 的 append 意图：`submitted_txid` + `REGISTER_APPEND_LEAF_CONT_OUT_INDEX`(0)；无下注时退回 genesis 的 `proto_markets.shardleaf_txid/vout` | `proto_markets.shardleaf_cov_id`（leaf 续约输出带 `CovenantBinding(0, leafCovId)`，同一个 id） | `proto-leaf-state.mjs:42-54`；`proto-tx-assembly.mjs:55,505` | ✅ |
| 2 | seal·held | 同一笔最新 landed append：`submitted_txid` + `REGISTER_APPEND_TOK_OUT_INDEX`(2) | 该 append 的 `prepared_tx_json` 的**输出[2].covenant.covenantId**（KTT 是 genesis 组，由该笔 append 的 fee 输入 outpoint 派生，**每笔 append 都不同**） | `proto-leaf-state.mjs:64-73`；`proto-tx-assembly.mjs:56-57,507` | ✅（原"待 9-1 列全"，已补） |
| 3 | close_commit·rootClose | seal 结算意图 landed：`submitted_txid`（重算 id，见下）+ `MARKET_SEAL_ROOTCLOSE_OUT_INDEX`(0) | 该输出的 `covenant.covenantId` | `proto-tx-assembly-settlement.mjs:34` | ✅ |
| 4 | convert_to_claim·rootClose | close_commit 结算意图 landed：`CLOSE_COMMIT_ROOTCLOSE_OUT_INDEX`(0) | 该输出的 `covenantId`——**必须与第 3 格相等**（续约保持 covenant id，第二个独立一致性检查） | `:234` | ✅ |
| 5 | convert_to_claim·held | **seal** 结算意图 landed（close_commit 不花代币）：`MARKET_SEAL_TOKEN_OUT_INDEX`(1) | seal 输出[1] 的 `covenantId` | `:35`；`CONVERT_TO_CLAIM_HELD_IN_INDEX`=1 `:446` | ✅ |
| 6 | claim_draw·rootClaim | convert_to_claim 意图 landed：`CONVERT_TO_CLAIM_CLAIM_OUT_INDEX`(0) | 该输出的 `covenantId`（= builder 入参 `rootClaimCovId` 的来源） | `:448`；builder 文档 `:653-678` | ✅ |
| 7 | claim_draw·held | convert_to_claim 意图 landed：`CONVERT_TO_CLAIM_TOKEN_OUT_INDEX`(1) | 该输出的 `covenantId` | `:449` | ✅ |
| 8 | claim_draw·ticket | **赢家那一条**下注的 `proto_bets.ticket_txid` + `ticket_vout`（= `REGISTER_APPEND_TICKET_OUT_INDEX`(1)，append 确认时由 `markBetAppendLanded` 写入） | **null**（输出[1]不在 genesis 组，普通 P2SH） | `proto-broadcast-ops.mjs:288`；`proto-tx-assembly.mjs:56,507`；builder 文档"赢家 ticket UTXO(register_append 输出1)" | ✅ |

**第 8 格补充（读码新发现，之前没想到）**：v0 里所有下注的 `bettor_pk` 是同一个委员公钥，可能有多张"赢家票"——用哪一张？`deriveCloseCommitInputs`（`proto-settlement-inputs.mjs:36-63`）要求**胜方恰 1 条已确认下注**，否则 fail-closed，并返回 `winnerBetId`；所以"赢家票" = 该 `winnerBetId` 那一行的 ticket 指针。`proto_claims` **没有** `bet_id` 列（已核 `migrate.js`），claim → 票的关联是**派生的、不是外键**：由 `market_id` + `winning_side` 经 `deriveCloseCommitInputs` 得出。P4 建 `proto_claims` 行时不得另存一份会漂移的 bet 指针。

**指针模块必须满足的不变量**（9-1 测试逐条守）：
1. **id 必须重算**：`kaspa-wasm` 的 `Transaction.deserializeFromSafeJSON` **沿用 JSON 自带的 id、不重算**——J2 在本仓 wasm（`kaspa_bg.wasm` sha256 前缀 `51cec45e`）上实测：篡改一个输出面值而不动 id 字段，反序列化后 `tx.id` 仍是旧值；`finalize()` 后才变。所以对 `prepared_tx_json` 必须 **`finalize()` 后再与 `submitted_txid` 比对**，否则"txid 一致"的断言是空判据。变异对照：去掉 `finalize()` ⇒ 篡改用例必红。
2. **谱系交叉核对（SHOULD，与 DB 无关的一致性）**：每笔产出交易的输入必须花掉上一个指针（如 close_commit 交易的输入 0 == seal 的输出 0 outpoint；convert_to_claim 的输入 0/1 == close_commit 输出 0 / seal 输出 1）。seal 与 close_commit 的输入下标现为 builder 内的字面量，9-1 一并导出 `MARKET_SEAL_*_IN_INDEX` / `CLOSE_COMMIT_*_IN_INDEX`（P6 已要求导出 `*_INPUT_HAS_COVENANT`，同批做）。
3. **covenantId 双重一致**：第 3、4 格的 covenantId 必须相等（续约保持 id）；第 4 格对第 6 格 builder 入参 `rootClaimCovId` 的传递链同理。
4. **指针只是"预期"**：是否真实存在、未花费、spk 与 covenantId 是否相等，由 C1 经形态 O 对链上取证并要求相等（M6）。DB 被本机写者改错，后果是 C1 报 `missing`/`outpoint_drift`/`covenant_class_mismatch` ⇒ 该步 fail-closed，不会花错 UTXO。

**`landed_at` 无 tiebreak（Bettor 裁定放 9-1）的核实结论**：`landed_at` 由 `nowIso()` = `new Date().toISOString()`（**毫秒精度**）写入（`proto-bet-intent.mjs:28,242`）。平局需要两笔 append 在同一毫秒被记账；append 严格串行（`assertNoInFlightAppend`）且每笔要等 `REORG_SAFE_MIN_DEPTH` 确认才 landed，正常不会发生；simnet 快速出块 + 同一 tick 内连续记账时**理论上**可能。**后果是活性问题、不是安全问题**：选错指针 ⇒ C1 形态 O 回 `missing` 或 spk/covenantId 不符 ⇒ 该步 fail-closed 卡住，不会花错资金。修法（既有文件小改，走审）：`deriveLeafOutpoint`/`deriveHeldKttOutpoint` 两处 `ORDER BY pbi.landed_at DESC` 后加 `, pbi.rowid DESC`（append 串行 ⇒ 创建顺序 == 落链顺序）。

### 18.2 9-1 清单补充项（NWT 9-0 审 `4e34e9c9` 转来 + J2 读码新增）

1. **消费方 IPC 超时 ≥ 15000**（NWT 裁定②）：relay 侧总预算 = `FACTS_RPC_WAIT_MS`(8000) + `FACTS_RPC_CALL_MS`(5000) = 13000；console 侧读命令 IPC 超时必须 ≥ 15000。测试断言"消费方超时 > 两常量之和"。
2. **S-2 消费方判定条件**：relay 的 `FactsError`/超时回执走外层 catch，形状是 `{error, phase:'execution'}`，**没有 `ok` 字段**。消费方成功判定必须是 **`ok === true` ∧ `facts === true` ∧ `factsVersion === 1` ∧ `form` 与请求相符 ∧ 条目级键齐全**（每项 `scriptPublicKey.scriptHex` 为 string 且 `covenantId` 键存在），**不得**用 `!result.error` 或 `result.ok !== false`（错误回执里 `ok` 是 `undefined`）。落成一个消费方纯函数 `assertFactsResponse(res, {form, requested})`：另断言 `found ∪ missing` 恰等于请求集合且无重复、`found` 的每个 outpoint 都在请求里。变异对照：拆掉任一条件、把 `ok===true` 换成 `!error` ⇒ 用真实错误回执形状的用例必红。
3. **C1 调用形状与预算**：形态 O 一次请求 = 一个地址 + 1–8 个 outpoint；各角色的地址互不相同 ⇒ 一步最多 3 次形态 O + 1 次形态 L（取 fee 输入）；串行发出。最坏一步 4 × 13 s = 52 s，驱动层必须有**每步总预算**：超出 ⇒ 本 tick 放弃、不推进任何状态（NO TX NO STATE）、下一 tick 重评估；不得因为"等太久"而降级跳过 C1 的任一检查。
4. **S-3（写进 9-4 威胁说明，不阻塞 9-1）**：`getUtxosByAddresses` 把整个地址 UTXO 集读进 wasm 内存后才过滤；地址上撒到"不可读"量级时，kaspa-wasm 的 trap 是**整个 wasm 实例**级的，会波及同一 relay 进程里的签名——既有、与 9-0 无关的残余风险；9-4 后应看一次 relay 的 wasm 线性内存曲线。
5. **毒化 fee 向量**（NWT 审 9-1 时起 simnet 补，§12.12）：第三方密钥创建"covenant 绑定 + spk = relay P2PK"的 UTXO，喂给**真实的 fee 选取函数**，断言被跳过且选中干净候选。
6. **`landed_at` tiebreak 小改**（§18.1）与 **`finalize()` 重算 id** 的变异对照（§18.1 不变量 1）。
7. **9-0 已合入的部分不再回头改**：形态 O/L、回声、`FACTS_*` 常量与 T1–T6b 测试属 9-0，9-1 只消费；9-1 若发现需改 `utxo-facts.mjs`，走 9-0 同款审。

### 18.3 9-1 落码文件清单与预期行数（无代码；±30%，**我上一批低估过新文件行数——新文件按"校验与注释比直觉多"估**）

| 文件 | 性质 | 预期 | 说明 |
|---|---|---|---|
| `kasia-console/src/lib/proto-settlement-pointers.mjs` | 新 | ~220 | 纯函数：从两张意图表的 `prepared_tx_json` 取 8 格指针（§18.1），`finalize()` 重算 id，谱系核对 |
| `kasia-console/src/lib/proto-settlement-c1.mjs` | 新 | ~260 | C1 调用点模块：每角色形态 O 取证 + `assertFactsResponse`（§18.2.2）+ 产出 `chainParents`；fee 选取走形态 L 并跳过毒化候选（S1） |
| `kasia-console/src/lib/proto-settlement-chain-checks.mjs` | 改（基线合入后） | +40/−8 | M6：`assertSettlementInputValuesOnChain` 加 `expectedOutpoints`/`expectedCovenantIds`（相等），错误码 `<role>_outpoint_drift`/`<role>_covenant_class_mismatch` |
| `kasia-console/src/lib/proto-tx-assembly-settlement.mjs` | 改 | +110/−12 | 四个 builder 加必填 `chainParents` 且在 mass/fee 前核对；导出 `*_INPUT_HAS_COVENANT` 与 seal/close_commit 的 `*_IN_INDEX`；close_commit 返回 `continuationOutputIndices:[0]`（P6） |
| `kasia-console/src/lib/proto-leaf-state.mjs` | 改 | +2/−2 | 两处 `ORDER BY` 加 `, pbi.rowid DESC` |
| 测试（pointers / c1 / builders 的 chainParents / chain-checks M6）+ 变异跑批 + 证据 README | 新/改 | ~900 | 8 角色 × 四类负向变异必红（≥32 用例）；`assertFactsResponse` 全条件与真实错误回执形状；`finalize()` 变异；谱系与 covenantId 双重一致 |

**不动**：`utxo-facts.mjs`（9-0 已合入）、`relay.mjs`、`proto-relay-ipc.mjs`（**不改它 ⇒ M0a 摘要不变**）、迁移、env、驱动开关。9-1 仍**无运行时效果**（无任何调用方，驱动分支是 9-2b）。

**仍开放（v0.3.2）**：§18.0 基线依赖（Bettor 裁）；驱动层"每步总预算"的具体数值（§18.2.3，建议 = tick 间隔的一半，9-2b 定）；第 2 格的 covenantId 从 `prepared_tx_json` 取还是用 `kaspa.covenantId(feeOutpoint, outputs)` 独立重算——两者都可，倾向**两者都做并要求相等**（多一个独立来源，成本≈0），待 NWT 审 9-1 时定。

## 19. v0.3.2 → v0.3.3：9-2 设计细化（只文档；Bettor 2026-09-20 流程：NWT 一轮只报 MUST，SHOULD 记票）

依据：J2 读码（行号取自主线 `ff86ce89` 的 `proto-relay-ipc.mjs` / `proto-relay-ipc.test.mjs`）、账本 1563/1566/1567/1568/1572/1574/1576/1584/1585/1588/1589。**本节不含代码。** 9-0、9-1、F5 已在主线；§18.0 基线依赖已解（批 6–8 + C1/C2/C3 已在主线，9-1 已合入）。§18.3 两个"仍开放"：第 2 格 covenantId 双来源——**9-1 D 笔已两者都做并要求相等**（`proto-settlement-pointers.mjs` 用 `kaspa.covenantId` 独立重算），关闭；每步总预算——见 19.3。

### 19.1 9-2a：出口分闸（单独一个 commit，先于任何驱动代码）

**现状锚点**：`sendProtoCommand`（`proto-relay-ipc.mjs:69-98`）现闸在第 90 行 `mode === 'write' && PROTO_DRIVER_ENABLED !== '1'` ⇒ 抛 `proto_driver_disabled`；发送在第 94/97 行 `{ ...payload, type }`。既有用例：③（`proto-relay-ipc.test.mjs:81`，无 `intent_key` 的 write 在旧开关未设时抛 `proto_driver_disabled`、三条 read 不被挡）与 ④（`:104`，write 恰只有 `covenant_broadcast`）是**红旗锚点**，9-2a 后须原样通过、**一字不改**。

**判据（覆盖 §3.8 文字，矩阵为准）**——write 命令，先取快照 `const out = { ...payload, type }`，闸只判 `out.intent_key`，发送的也是 `out`：

| `out.intent_key` 类别 | PDE=0 PSDE=0 | PDE=1 PSDE=0 | PDE=0 PSDE=1 | PDE=1 PSDE=1 |
|---|---|---|---|---|
| A 合法 `settle:` 键（S9 严格格式） | 拒 `proto_settlement_driver_disabled` | 拒 `proto_settlement_driver_disabled` | **放行** | **放行** |
| B `settle:` 开头但格式不合法（含 withdraw / reclaim / ticket 主体、配对错、非 64 位小写 hex 的 id…） | 拒 `proto_settlement_intent_key_invalid` | 同左 | 同左 | 同左 |
| C 其它（缺失 / `genesis:…` / `proto-bet:…` / `xsettle:` / `Settle:` / `settle` 无冒号 / 首部空白…） | 拒 `proto_driver_disabled` | **放行** | 拒 `proto_driver_disabled` | **放行** |

read 命令四格全放行（账本 1441）。PDE = `PROTO_DRIVER_ENABLED`，PSDE = `PROTO_SETTLEMENT_DRIVER_ENABLED`，均只认字面 `'1'`、每次调用读 `process.env`（同握手开关约定）。三个拒绝串互不为子串（测试按 `assert` 精确匹配，防"两闸互换"看不出）。

**S9 严格格式**（在出口内联，见发现 1）：`^settle:(market|claim):<64 位小写 hex>:<step>(#<n>)?$`；`step` 与 `subject_type` 配对 = `seal|resolve`⇒`market`，`convert_to_claim|claim_draw`⇒`claim`；`<n>` ≥ 2、十进制、无前导零；无 `m` 标志（JS `$` 不匹配末尾换行，加 `…\n` 向量守）。

**发现 1（修正 §3.8 一句话，MUST 请核）——S9 常量不要从 `proto-settlement-intent.mjs` 导入。** ① `STEP_SUBJECT_TYPE` 在该文件是未导出的 `const`（`:33`）；② 已导出的 `SETTLEMENT_SUBJECT_TYPES` / `SETTLEMENT_STEPS` 含 `ticket` / `withdraw` / `reclaim`，批 9 要在出口拒它们，所以必须再取子集；③ 更要紧：`proto-relay-ipc.mjs` 是 M0a `content_digest` 钉住的 TCB，把判据绑到一个**不受摘要保护、可独立改动**的模块 = 改那个常量表就静默改了出口判据而摘要不变。（实测：无 `DB_PATH` 时 `proto-relay-ipc` 与 `proto-settlement-intent` 都因 `db/client.js` 被拒——**出口本来就经 `proto-relay-guard` 拖着 DB 客户端，所以这不是"新增开默认库风险"，不夸大。）**修法**：常量与校验函数**内联进 `proto-relay-ipc.mjs`**（摘要覆盖、零新 import），再加**漂移测试**对 `proto-settlement-intent` 的导出核对：`settlementIntentKeyFor` 对批 9 四个（主体, 步骤）配对产出的键（含 `#2`/`#10`）全部通过出口校验；`withdraw` / `reclaim` / `ticket` 产出的键被拒。

**发现 2（SHOULD，S9-b，NWT 裁）——非字符串 `intent_key` 出口应一律拒，不走旧开关。** 出口按 `typeof === 'string'` 判类别，`new String('settle:market:…')`（§3.8 列为"走旧开关"）在 IPC 上经 `fork` 默认 JSON 序列化（`relay-manager.js` 未设 `serialization`）变成**原始字符串**，而 relay 侧 `commands.mjs` 的 `intent_key: 'string'` 类型校验会通过——即"出口判为 C 类、线上却是 A 类字面"，PDE=1、PSDE=0 时可发出一个未过 S9 的 `settle:` 标签。修法（3 行）：write 命令 `out` 含自有 `intent_key` 且非原始 string ⇒ 拒（新串 `proto_intent_key_not_string`，四开关格同）。影响面：现有 producer（`genesis:` / `proto-bet:` / `settle:`，见 `marketIntentKeyFor` / `betIntentKeyFor` / `settlementIntentKeyFor`）全传原始 string ⇒ 无行为变化；§3.8 里"数组 / String 对象"两行由"走旧开关"改为"无条件拒"。**若 NWT 不采纳，退路**：按 `String(key)` 判类别（与线上值一致）。

**commit 形状（单一 commit，不含任何驱动代码 / 调用方）**：`proto-relay-ipc.mjs`（闸 + 校验，无新 import）；`scripts/m0a-exception-manifest.json` 的 `PVF-proto-relay-ipc-funnel.content_digest` 同步（`review_ref` 仍 `4e34e9c9`，NWT 审后另开 `chore(m0a)` 单独更新，同 `812f56ee` 先例）；`proto-relay-ipc.test.mjs` 只**追加**（既有 ①–⑥b 与 9-0 的 5 项一字不改，`git diff` 旧行无 `-`）；`kanet.env.example` 加一行注释掉的 `PROTO_SETTLEMENT_DRIVER_ENABLED`（不写 = 关）。**不动**：`relay.mjs` / `commands.mjs`（relay 侧无改动 ⇒ 无需重启 relay）、迁移、任何 env 文件、驱动。

**测试**：矩阵 3 类 × 4 格 × 向量（A：四个批 9 配对 ×（无后缀 / `#2` / `#10`）；B：`withdraw`、`reclaim`、`ticket` 主体、配对错、大写 hex、非 hex、长度 63 / 65 / 32、首版 UUID 形状（必须落 B）、`#1` / `#0` / `#01` / `#a` / `#٢`、尾随 `\n`、空 id、裸 `settle:`、多冒号；C：缺失、`genesis:` / `proto-bet:`、`xsettle:`、`Settle:`、`settle`、首部空白、空串）；快照三向量（getter 每读换值 / Proxy 每读换值 / 原型继承的 `intent_key` 不被复制）断言"闸判定值 == `_sendCommandAsyncForTest` 收到的值"；read 四格；S9-b 向量（String 对象 / 数组 / 数字 / 对象）；漂移测试；`m0a-lint` 全套通过。

**变异（J2 自做 ≥14；NWT 自己 worktree 再做）**：判据只读旧开关 / PDE↔PSDE 互换 / `startsWith` 改 `includes` 或忽略大小写 / 拆掉快照（闸另读一次 `payload.intent_key`）/ 去掉 S9 校验 / B 类回落旧开关 / A 类也要求 PDE（AND）/ read 被闸挡 / 三个拒绝串两两互换 / 配对表去掉 / 放行 `withdraw` / `#1` 或前导零放行 / 大写 UUID 放行 / 去掉 S9-b。

**诚实边界（沿用 §3.8）**：按标签不按内容——PDE=1 时标成 `proto-bet:…` 的结算形状交易仍放行；防线 = 驱动是唯一调用方 + S9 + §11.1 源码扫描。

### 19.2 9-2b 清单（账本汇总；重复出现的合并；"J2 9 项 + Bettor 1 项"的精确切分我无法从账本复原，全部列出，请 Bettor 核有无漏）

| # | 项 | 来源 | 验收 |
|---|---|---|---|
| 1 | F3-1：`covenantId` 抛错路径的 probe `TransactionOutput` 释放 | 1584 | 注入会抛的 `covenantId`，断言创建数 == 释放数、报 `pointer_covenant_inconsistent`、`genesisId=null`（变异 i9 红） |
| 2 | 大写 txid：pointers → C1 → withFeeParent → builder 边界统一 `toLowerCase`（一处） | 1572/1576 | DB 大写 txid ⇒ 规范化后通过或大声失败，不静默错花 |
| 3 | IPC 超时一致性：真实 wrapper 发出的命令超时 == 声明的 `ipcTimeoutMs`（≥15000） | 1568 | 抓真实 wrapper 的发送实参 |
| 4 | `unrecognized_error` 报警带 `err.name` / 消息前缀 | 1568 | 报警负载断言 |
| 5 | 意图终态清分级器 key（失败后被放弃 / 取消的 key 不常驻） | 1568 | 终态后 `states` 无该 key |
| 6 | E-3：四个 builder 调用点的 `chainParents` 只能来自 `verifyStepInputsOnChain` / `withFeeParent` 结果，禁字面量；`withFeeParent` 可要求候选 ∈ `fee.candidates` | 1563 | 共享扫描器 + 变异（字面量 `chainParents` ⇒ 红） |
| 7 | D-3：`pointer_covenant_inconsistent` 承担三种语义，报警别只按 `code` 分处理（给 `.kind` 枚举或按 `.detail`） | 1566 | 三语义各一报警断言 |
| 8 | 登记事件名 `fee_candidate_out_of_range_skipped` | 1567 | 事件表 / 文档登记 |
| 9 | 驱动是 F1-2 / E-4 守卫的**第一个真实调用方**：非测试源码不得引用 `verifyStepInputsOnChainWithTimers` 与夹具模块的扫描须仍绿 | 1568/1563 | 扫描随接线跑 |
| 10 | 临时 DB bootstrap 清理：既有 c1 / chain-checks 测试里"起临时 DB 只为过 import 链"已多余（F3 后可无 DB 直接 import） | 1574/1584 | 删后测试仍绿 + 无 `DB_PATH` 子进程 import 断言 |
| 11 | 共享扫描器提到两包可引用位置（如 `shared/test-fixtures/`），relay `utxo-facts.test.mjs:73` 那份简单正则版改 import | 1588 | relay 测试 import 共享版且原断言仍红 / 绿 |
| 12 | F5-1：扫描器自测补两条对照——`const s = "a"; // <引用>` 不报、"一行含未闭合引号、下一行 `// <引用>`" 不报 | 1589 | 两条向量 |
| 13 | wasm：getter 隐式包装（`tx.inputs` / `outputs` 元素、`previousOutpoint`、`covenant`、`scriptPublicKey`）靠 `FinalizationRegistry`，接线后盯 `wasmBytes` | 1584 | 见 19.3(b) |
| 14 | 驱动按 `classifyC1Error` 的类处理；`chain_parents_mismatch` ⇒ `programming_error` 不重试（E-2 已在 F1 落）；`unrecognized_error` 不当瞬时故障 | 1563/1568 | 每类一个驱动行为断言 |

### 19.3 9-2b 补充决定（两条，其余按 §3–§12 原设计）

(a) **每步总预算**：取 **tick 间隔的一半**（§18.3 建议），且不低于单次形态 O 的 13 s；超出 ⇒ 本 tick 放弃、零状态推进（NO TX NO STATE）、下一 tick 重评估，**绝不降级跳过 C1 任一检查**。具体毫秒值在 9-2b 落码时按 `startProtoSettlementDriver` 的 tick 常量定，写进测试。
(b) **wasm 观察的可验收化**：9-4 simnet 端到端每步前后记 `wasmBytes`（console 现有的 wasm 线性内存采样口径：盯 wasm 线性内存而非进程私有内存），证据入 provenance；先出基线再定阈值，**不在设计里编一个数**。9-2b 代码侧：驱动内每个 `new Transaction` / `new TransactionOutput` 必须在 `finally` 释放，沿用 F3 D-1 的"创建数 == 释放数"计数夹具。

### 19.4 落码顺序与门（更新 §13）

9-2a（单 commit）→ NWT 审（一轮，只报 MUST）→ `chore(m0a)` 更新 `review_ref` → 9-2b 分三笔提交给 Bettor 推：**(i)** 清理 + F3-1（清单 1、10、11、12：纯测试 / 小改，无运行时效果）；**(ii)** 驱动核心（纯函数 + 注入 `sendCmd`：每步顺序 1–9、失败策略、`markSettlementLanded`、`pmtEvidence`、SLA / `prepared_stale`、重启恢复、清单 2–9、14；**关闭态零 IPC**）；**(iii)** 接线（`startProtoSettlementDriver` + `isProtoSettlementDriverEnabled` 8 态 + 启动 / 关闭日志 + env 示例）。(ii)(iii) 依赖 9-2a 已合。预期新文件行数按 §18.3 的教训偏大估（驱动核心 ~450，测试 ~1200）。**均无运行时效果，不改 relay，不启用任何开关。**

**仍开放**：S9-b 是否采纳（19.1 发现 2，NWT 裁）；每步总预算毫秒值（9-2b 定）；`wasmBytes` 阈值（9-4 基线后定）。

> **修正记录（2026-09-20，v0.3.3 上追加）**：§3.8 / §19.1 的 `subject_id` 形状由"小写 UUID"改为"64 位小写 hex"（NWT 9-2a 审 MUST-1）；9-2a 已在修正笔 `ed6bb165` 落码并加"生产者↔出口"对照测试；§19.1 发现 2（S9-b）已由 Bettor 采纳为 MUST（小）并落在 9-2a。
