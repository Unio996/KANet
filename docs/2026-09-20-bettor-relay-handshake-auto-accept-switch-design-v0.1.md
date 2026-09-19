# 设计稿：relay 入站握手自动接受加开关（主网默认关）v0.3

> 文件名沿用 `…-v0.1.md`（账本 1571 / NWT 审稿以此路径引用）；**正文即 v0.3**，v0.1→v0.2 差异在「v0.2 增补」、v0.2→v0.3 差异在「v0.3 增补」，与上文冲突处以该节为准。

> **Status**: CURRENT
>
> 起草 Bettor（架构师帽）· 2026-09-20 · 依据 Owner 本机终端原话「自动接单置 false，握手也加开关，主网默认关。」（DECISIONS.md **D-027** 决定 ②）· 起因 COORD-LEDGER (1554)：KANet-UI 只读盘点发现 relay 进程内建"入站握手自动接受"，收到新对端握手即发一笔接受交易，无任何开关；(1557) 该项的评估细节按 D-021 不入公开仓库，本页只写缓解设计。
>
> **执行门**：本页只是设计。顺序 = 本页 → NWT 设计审（审的是缓解设计，不是漏洞评估）→ Bettor 派实现 → NWT 审 diff → 合入 → 随下一次 console 重启（relay 子进程重启）生效。**Bettor 不写代码。**
>
> **写作依 D-021**：不含密钥、地址、余额；不写攻击路径与量级评估。

## 0. 结论

给 relay 加 env 开关 `RELAY_HANDSHAKE_AUTO_ACCEPT`，只认字面 `'1'`，**所有网络默认关**（同 D-026 约定）；主网 env 不写键（不写 = 关）。关闭态：入站握手照常登记（ingestTx / ingestMessage / pending_actions 不变），**不 claim、不 acceptHandshake、不 sendKaspa、不发问候**，每次留一行日志并 return；追赶路径（catchUpHistory 第 1 段 pending handshakes）整段跳过并留一行；relay 启动时打恰一行 disabled。开启态行为逐字节不变。

## 1. 现状（只读实核，2026-09-20）

| 项 | 读数 | 出处 |
|---|---|---|
| 实时路径 | `processHandshake(txId, payloadHex, senderAddress)`：step 1 ingestTx → BLOCKED 名单检查 → step 2 内存去重 → step 3 DB 去重 → step 4 ingestMessage（登记进 console，触发 pending_actions）→ step 5 claim（console API 原子锁）→ `acceptHandshake` → `sendKaspa` → 记 accept、markSeen → 可选问候再 `sendKaspa` | `kasia-relay/src/rpc-listener.mjs:900-1010`（step 标记行 917 / 920 / 931 / 944 / 953 / 983 / 985） |
| 追赶路径 | `catchUpHistory()` 第 1 段：从 console `/ingest/pending-handshakes` 取 pending，逐个 claim 后 `acceptHandshake` + `sendKaspa` | `rpc-listener.mjs:542-607` |
| 既有 env 闸先例（relay 内） | `KANET_CATCHUP_COMM === 'on'` 控追赶路径第 3 段，关闭态打 `catch-up comm: DISABLED (KANET_CATCHUP_COMM!=on)` | `rpc-listener.mjs:659-670` |
| relay 拿 env 的方式 | console 用 `fork('src/relay.mjs', [], { env })`，`env = { ...process.env, …密钥项 }` ⇒ console 注入的 env 原样流入 relay，无白名单 | `kasia-console/src/services/relay-manager.js:228-252` |
| 主网现状 | 本次与死机前两份 console stdout `HANDSHAKE ACCEPTED` 均 0 行（只证明这两个窗口没发生） | (1554) |

## 2. 设计

### 2.1 开关与语义
- 键名 `RELAY_HANDSHAKE_AUTO_ACCEPT`；**只认字面 `'1'`**（`'on'`、`'true'`、`' 1'`、`'"1"'`、未设等一律关），与 D-026 两开关同一约定；不沿用 `KANET_CATCHUP_COMM` 的 `'on'` 写法，避免仓内出现第三种"开"的拼法（那条既有闸不动）。
- 读取位置：模块顶层一次读入常量 `HANDSHAKE_AUTO_ACCEPT = process.env.RELAY_HANDSHAKE_AUTO_ACCEPT === '1'`（relay 子进程生命周期内 env 不变；与 console 侧"每次调用读"不同，这里进程级常量即可，但**测试须能注入**，见 2.4）。
- 默认关、不按网络分支（D-017 后只剩主网；与 D-026 §2.3 同理）。

### 2.2 三个落点
1. **启动日志**（`rpc-listener.mjs` 现 `protocol support: handshake, comm, payment` 那行附近）：关闭态恰一行 `handshake auto-accept: DISABLED (RELAY_HANDSHAKE_AUTO_ACCEPT!=1, raw=<JSON.stringify 原始值>)`；开启态一行 `handshake auto-accept: ENABLED`。console 侧会以 `[relay:<name>]` 前缀转发，18 个 relay 各一行 ⇒ 部署后 `grep -c 'handshake auto-accept: DISABLED'` 应恰等于 relay 子进程数。
2. **实时路径**：闸放在 **step 4 之后、step 5 claim 之前**——入站握手已被 ingestTx / ingestMessage 登记、pending_actions 行已由 console 建出（保留人工处理的可能）；关闭态打一行 `HANDSHAKE auto-accept disabled — left pending for <last12>`，**不 claim、不 markSeen**（与"漏洞 #6 fix"的注释一致：不 markSeen 才保留将来打开开关后由追赶路径接手的能力），return。
3. **追赶路径**：`catchUpHistory()` 第 1 段整段用同一常量包住，关闭态打一行 `catch-up handshakes: DISABLED (RELAY_HANDSHAKE_AUTO_ACCEPT!=1) — <n> pending left`（n 可选，取自 console 查询；查询本身只读可保留），`handshakeCount` 恒 0；第 2 / 3 段不动。

### 2.3 不做什么
- 不动 `acceptHandshake` / `sendKaspa` / `chain.mjs`；不动 console 侧 `/ingest/pending-handshakes` API 与 pending_actions 状态机；不动 BLOCKED 名单逻辑；不动 `KANET_CATCHUP_COMM`。
- 不加"按对端白名单接受"之类的策略——那是另一个设计，本页只做总闸。
- 不改 `kanet.mainnet.env`；`kanet.env.example` 加一行注释掉的键 + 说明（同 D-026 SHOULD ②）。

### 2.4 可测性
`rpc-listener.mjs` 是长驻监听模块，静态 import `chain.mjs`。为让闸可被单测：把判定抽成小纯函数 `handshakeAutoAcceptEnabled(env = process.env)`（导出），三个落点都调它；`processHandshake` 与 `catchUpHistory` 若无法在测试里直接驱动，实现者用 `--experimental-test-module-mocks` mock `./chain.mjs` 的 `acceptHandshake` / `sendKaspa` 与 console fetch，断言关闭态零调用（console 测试已有此模式先例）。

## 3. 验收判据（落码时逐条过，每条带变异对照）

| # | 判据 | 变异对照（必红） |
|---|---|---|
| V1 | `handshakeAutoAcceptEnabled` 对未设 / `'0'` / `'on'` / `'true'` / `' 1'` / `'"1"'` / `''` / `'01'` / 全角 `'１'` / `'1\n'` 全部为 false，`'1'` 为 true | 改成宽松判断 ⇒ `'on'` 或 `'true'` 那条红 |
| V2 | 关闭态 `processHandshake`：ingestTx 与 ingestMessage 各被调 1 次（登记不变），claim fetch 0 次、`acceptHandshake` 0 次、`sendKaspa` 0 次、markSeen 0 次，stdout 恰一行 `HANDSHAKE auto-accept disabled` | 删闸 ⇒ V2 红；闸挪到 step 4 之前 ⇒ "ingestMessage 1 次"红 |
| V3 | 关闭态 `catchUpHistory` 第 1 段：`acceptHandshake` 0 次、`sendKaspa` 0 次、claim 0 次，一行 `catch-up handshakes: DISABLED`；第 2 / 3 段行为不变 | 删追赶闸 ⇒ V3 红 |
| V4 | 开启态（env=`'1'`）：既有行为逐字节不变（现有涉及握手的测试若有则原样通过；无则加一条"开启态 sendKaspa 恰 1 次"的阳性对照） | 闸写反 ⇒ 阳性对照红 |
| V5 | 启动日志恰一行 DISABLED（关闭）或 ENABLED（开启），带 raw | — |
| V6 | 部署后（下一次 console 重启）：console stdout 中 `handshake auto-accept: DISABLED` 行数 == relay.mjs 子进程数（现 18）；`HANDSHAKE ACCEPTED` 0 行；`auto-accepting handshake` 0 行 | — |
| V7 | 现场 `grep -cE '^\s*RELAY_HANDSHAKE_AUTO_ACCEPT=' kanet.mainnet.env` = 0（静态辅助，权威是 V6）；`kanet.env.example` 有注释行 | — |
| V8 | lint-kanet 0 error；回执附各测试原始输出与变异输出 | — |

## 4. 上线
- 合入主线后不自动生效：relay 是 console 子进程，随下一次 console 重启（与 D-026 / 9-0 relay 重启同批）加载新代码；不为本页单独重启。
- 上线后 pending 的入站握手会停在 pending_actions（不再自动接受），是预期行为；将来若要恢复自动接受，写 `RELAY_HANDSHAKE_AUTO_ACCEPT=1` 进主网 env = 另一次钱路决定，须 Owner 单独批。
- P2 守卫清单（(1569) N-2 第二类）加一项：`RELAY_HANDSHAKE_AUTO_ACCEPT` 不得为 `1`。

## 5. 给 NWT 的审点
- 2.2-2 闸的位置（step 4 后、step 5 前）：登记保留、不 claim 不 markSeen，与既有"漏洞 #6 fix"语义是否一致，有没有会让 pending 行无限堆积的副作用（console 侧 pending_actions 有没有过期机制）。
- 2.1 进程级常量 vs 每次读：relay 生命周期内 env 不变，你判是否接受。
- 追赶路径关闭后 `catch-up done` 汇总行仍打印、计数为 0，是否会被别的监控误读为"正常追赶完成"。
- 2.3 不做对端白名单：你判是否需要在本页之外另开票。
- V2 的"ingestMessage 1 次"是否足以证明登记不变，还是要断言 pending_actions 行真被建出（需 console 侧参与）。

## 6. v0.2 增补（NWT 设计审 `77e34e01`，Bettor 全部采纳；与上文冲突处以本节为准）

### 6.1 M-H1：第四个落点——`relay.mjs` 的 `doAcceptHandshake`（索引器 / 回落模式）
- **事实（NWT 读码 + Bettor 复核）**：relay 里 `acceptHandshake(` 调用点共三处：`rpc-listener.mjs:986`（实时，落点 2）、`rpc-listener.mjs:582`（追赶第 1 段，落点 3）、**`relay.mjs:256` `doAcceptHandshake`（v0.1 漏）**。后者由 `relay.mjs` 的 `poll()` 在会话 pending_incoming 时调用，自带去重、自己 sendKaspa。`poll()` 在两种情形下跑：① `RELAY_MODE=rpc` 时 `startRpcListener()` 失败 `.catch` 回落 `setInterval(poll)`（`relay.mjs:300-311`，例如节点在 relay 启动时不可达——无人值守开机的一种真实时序）；② `config_entries.relay_mode` 或 env `RELAY_MODE` 为 indexer（`relay-manager.js:224` 取 getConfig('relay_mode') || env || 'rpc'）。主网现状（Bettor 只读核）：config 无 relay_mode 行、env 无 RELAY_MODE 键 ⇒ 默认 rpc；当前 stdout 未匹配到回落字样（历史是否发生过无数据，定为**设计缺口**非已发生事故）。
- **设计**：落点 4 = `doAcceptHandshake` 入口同一纯函数判定，关闭态一行 `HANDSHAKE auto-accept disabled (poll) — left pending for <last12>` 并 return，不 sendKaspa；**启动日志改打在 `relay.mjs`（所有模式的共同入口）**，不打在 rpc-listener（否则回落 / 索引器模式的 relay 不打这行，V6 计数变少会被读成"少了几个 relay"）；**加源码扫描测试**（复用 F2-1 的共享扫描器 `kasia-console/test-fixtures/source-scan/scan-non-test-sources.mjs`）：`kasia-relay/src` 内每处 `acceptHandshake(` 调用必须位于经 `handshakeAutoAcceptEnabled` 保护的函数体内，防第四个再悄悄出现；V 表加 **V2c**：indexer / 回落模式下 `acceptHandshake` 0 次、`sendKaspa` 0 次。

### 6.2 五个审点的 verdict（采纳）
- ① 闸位置与"漏洞 #6 fix"语义一致：step 4 的 ingestMessage 在 console 侧（`ingest-service.js:86-140`）确会 INSERT handshake_accept / pending（已 active 跳过、旧行 failed / expired 重置），step 5 的 create_and_claim 是 INSERT OR IGNORE 后立即 claim，闸放其前正好不 claim。**堆积**：全仓无按时间的过期机制（仅 failPendingAction 超 max_retries 置 expired），pending 唯一消费者是 relay 追赶第 1 段（agent-mind 的 create_and_claim 是出站 handshake_init，由 autoHandshake 默认关另闸）⇒ 关闭期间每个（本地 relay, 对端）留一行永不过期，无害（小行、无消费者、getPendingHandshakes LIMIT 100），但见 6.3。
- ② **改为每次调用读**：四个落点每次调 `handshakeAutoAcceptEnabled(env = process.env)`，测试传 env 即可切换，不必重载有网络副作用的 rpc-listener 顶层模块；启动行读一次。§2.1"进程级常量"作废。
- ③ 关闭态 `catch-up done` 汇总行写 `handshakes: DISABLED` 不写 0（与 `KANET_CATCHUP_COMM` 关闭态先例一致，`rpc-listener.mjs:659-670`；:725 注释自陈"19551 次 catch-up done 全是 0/0/0"证明 0 会被忽视）。无程序消费该行。
- ④ 对端白名单 / 速率预算 / 每日上限 = **策略层，另开票、另一次钱路决定、须 Owner 批**；接口写明：策略层落在 `handshakeAutoAcceptEnabled` 之后、`acceptHandshake` 之前。
- ⑤ V2 保留 relay 侧调用次数断言，**加 V2b**（console 侧现状钉住）：真实迁移建临时库调真实 ingestMessage inbound handshake，断言恰一行 handshake_accept / pending，覆盖已 active 不入队、旧行 failed 重置。

### 6.3 S-H1：打开开关前的积压处置（写进 §4）
设计有意"不 markSeen 不 claim，保留将来打开后由追赶接手"——代价：关闭期间累积的 pending 行，在开关写成 1 后下一次 relay 启动的追赶第 1 段里，最老的（至多 100 条 / relay）会被逐个自动接受。**§4 补**：打开前 Owner 先决定积压处置——(a) 有意接受；(b) 经审的一次性 SQL 置 expired、保留审计行；(c) 先出策略层——并把"当前 pending 的 handshake_accept 行数"列为打开前必读读数。

### 6.4 验收表更新
- V2c（新）：indexer / 回落模式零 acceptHandshake 零 sendKaspa（变异：删落点 4 ⇒ 红）。
- V2b（新）：console 侧 pending 行现状钉住。
- V5：启动行在 `relay.mjs`，回落 / 索引器模式同样打；V6 计数口径不变（== relay 子进程数）。
- V9（新）：源码扫描——`kasia-relay/src` 每处 `acceptHandshake(` 都在受保护函数内（变异：在任意文件新增一处裸调用 ⇒ 红）。
- V10（新）：`catch-up done` 关闭态汇总行含 `handshakes: DISABLED`。

### 6.5 未证（沿用 NWT）
未在回落 / 索引器模式实跑（不动生产 relay）；`lib/indexer.mjs` 主网指向未核；回落在主网是否发生过无历史数据。

## 7. v0.3 增补（NWT 复审 `336bc3a9`，Bettor 全部采纳；与上文冲突处以本节为准）

### 7.1 M2-1：落点 4 须先抽成可 import 模块，V2c 才可执行
`relay.mjs` 无任何 export，顶层直接读钱包 / 索引器并按模式起 startRpcListener() / setInterval(poll)（:300-311）——import 它就真的启动 relay，`doAcceptHandshake`（脚本内非导出函数）无法被测试驱动，V2c "删落点 4 ⇒ 红" 不可执行。**设计**：把 `doAcceptHandshake`（连同 `_acceptedPeers` 与两级去重）抽到 `kasia-relay/src/lib/handshake-accept.mjs`，`acceptHandshake / sendKaspa / fetch / log` 由参数注入；`relay.mjs` 只留一行调用；`handshakeAutoAcceptEnabled` 独立成 `kasia-relay/src/lib/handshake-switch.mjs`。V2c = 注入桩驱动该模块，关闭态桩零调用（acceptHandshake 0、sendKaspa 0）。这是对 relay.mjs 的结构性小改，实现 diff 须逐字比对抽取前后行为（同 F3 拆 leaf-state-encode 的做法：BEFORE / AFTER 对照）。

### 7.2 S2-1（采纳为设计主体）：闸下沉到 `acceptHandshake` 本身做 chokepoint
`chain.mjs:136-146` 的 `acceptHandshake` 只构造草稿 {to, amount, payload}（isResponse:true 的握手载荷），不花钱；花钱在调用点的 sendKaspa，而三个调用点都是"有 payload 才发"（rpc:986 `if (draft?.payload)`、relay.mjs:256 `if (!draft?.payload) { log; return }`、rpc:582 `if (draft?.payload)`）。**让 `acceptHandshake` 在关闭态返回 null（3 行早退，读 handshakeAutoAcceptEnabled）**，三个现有调用点与将来任何第 N 个调用点自动不花钱——结构性保护，不依赖有人记得加闸（M-H1 恰证明逐个列举会漏）。四个调用点各自的早退**保留**（语义清晰、日志明确），chokepoint 兜底。残余"绕过 acceptHandshake 自己拼 isResponse:true 载荷"由 7.3 (c) 覆盖。**注意**：console 侧 `relation-state.js` 另有同名 `acceptHandshake`（数据库状态推进，不发交易），实现者勿混淆、扫描范围只在 kasia-relay/src。

### 7.3 S2-2：V9 规格改为可机检
文本扫描证明的是"名字出现在哪"不是"闸支配调用"（守卫可在字符串 / 注释里或调用之后；`import {acceptHandshake as ah}` 别名绕过；`const f = acceptHandshake` / 传回调等非调用引用绕过）。**规格**：(a) 标识符 `acceptHandshake` 在 kasia-relay/src 每处出现（去注释去字符串）除 chain.mjs 定义外必须落在白名单确切 3 个 (文件, 函数)，其它出现含别名 / 非调用引用 ⇒ 红；(b) 白名单调用点所在函数须有守卫子句 `if (!handshakeAutoAcceptEnabled(…)) … return` 且位置在 `acceptHandshake(` 之前；(c) 另扫 `isResponse: true`，除 chain.mjs:acceptHandshake 外出现即红；(d) 用 F2-1 共享扫描器并带对照臂（无守卫红 / 守卫在调用后红 / 别名红 / 守卫只在字符串或注释里红）。有 7.2 之后 V9 是清单钉住，不是保护本身。

### 7.4 S2-3：poll 路径关闭态日志去重
`relay.mjs` POLL_MS 默认 2000 ms；indexer / 回落模式下 pending_incoming 会话永不被接受，每 tick 都再命中落点 4 ⇒ 关闭态日志每 2 s 每会话一行永不停。**要求**：每 peer 每进程生命周期只打一次（Set 去重）；V2c 加"同一 peer 连续 3 个 tick 只 1 行"。

### 7.5 S2-4：启动日志与只读读数
- 启动行放 `relay.mjs` 模块顶层读一次（RELAY_MODE 分支之前），带 `RELAY_MODE=<值>`：`handshake auto-accept: DISABLED (RELAY_HANDSHAKE_AUTO_ACCEPT!=1, raw=…, RELAY_MODE=rpc)`。
- §6.3 "打开前必读读数"的只读 SQL：`SELECT COUNT(*) FROM pending_actions WHERE action_type='handshake_accept' AND status='pending'`（主网库 readonly 打开）。

### 7.6 验收表最终版（覆盖 §3 / §6.4）
V1 纯函数取值；V2 实时路径关闭态零 claim / 零 acceptHandshake / 零 sendKaspa / 零 markSeen、登记调用不变；V2b console 侧 pending 行钉住；V2c 落点 4 模块注入桩零调用 + 同 peer 3 tick 只 1 行；V2d（新，对应 7.2）`acceptHandshake` 关闭态返回 null，开启态草稿逐字节不变，变异"去掉 chokepoint 早退"⇒ 红；V3 追赶第 1 段零调用 + 汇总行 `handshakes: DISABLED`；V4 开启态逐字节不变（阳性对照 sendKaspa 恰 1 次）；V5 启动行在 relay.mjs 顶层带 RELAY_MODE；V6 部署后 DISABLED 行数 == relay 子进程数、HANDSHAKE ACCEPTED 0 行；V7 env 静态辅助；V8 lint 与原始输出；V9 可机检扫描 (a)–(d)；V10 汇总行；抽取 BEFORE / AFTER 行为对照。
