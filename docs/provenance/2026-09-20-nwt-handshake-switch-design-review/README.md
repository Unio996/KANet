> **Status**: CURRENT（2026-09-20，NWT；对象 = `docs/2026-09-20-bettor-relay-handshake-auto-accept-switch-design-v0.1.md`（`origin/bshard-m3-deploy` 头 `52f6133d`）；**审的是缓解设计（开关是否完整、位置与语义是否成立），不是漏洞评估**）

# relay 入站握手自动接受加开关（主网默认关）设计 v0.1 —— NWT 设计审

方法：独立检出（`D:\kanet-nwt-cand`，`52f6133d`）逐处核设计稿 §1 的每一条"现状"与 §2.2 的三个落点；对 relay（`kasia-relay/src`）与 console（`kasia-console/src`）、`agent-mind` 全仓枚举与"握手接受"相关的调用点与消费者；不改任何代码、不碰任何生产进程。D-021：本页只写开关设计层面的事实（调用点、位置、语义、测试），不写攻击路径与量级。

## 结论：**方向 GREEN；有 1 条 MUST（设计稿漏了第四个调用点）+ 4 条 SHOULD，出 v0.2 后再审。**

设计稿 §1 表里我核过的几条现状——实时路径的 step 结构、追赶路径第 1 段、`KANET_CATCHUP_COMM` 先例、`relay_mode` 取值——**都成立**（我没有逐个核行号；relay-manager 的 env 透传与主网 `HANDSHAKE ACCEPTED` 0 行两条我没有重核，沿用 Bettor 的读数）。闸的位置与"漏洞 #6 fix"语义**一致**。问题是**落点不完整**：relay 里有**第四条**会自动接受入站握手的代码路径，三个落点都不覆盖它——开关落地后这条路径仍然开着。

## 一、MUST

### M-H1（MUST）`relay.mjs` 的 `doAcceptHandshake` 是第四个自动接受路径，设计稿没有覆盖
`acceptHandshake` 在 relay 里有**三个调用点**，设计稿只列了 rpc-listener 里的两个：

| # | 位置 | 触发 | 设计稿是否覆盖 |
|---|---|---|---|
| 1 | `rpc-listener.mjs:986`（`processHandshake` 实时路径 step 5 之后） | 区块订阅到入站握手 | ✅ 落点 2 |
| 2 | `rpc-listener.mjs:582`（`catchUpHistory` 第 1 段） | 追赶 | ✅ 落点 3 |
| **3** | **`relay.mjs:256`（`doAcceptHandshake(peer)`）** | **`poll()` 里会话状态 `pending_incoming` 时调用（`relay.mjs:285-286`）** | **❌ 未提** |

`poll()` 什么时候在跑：`relay.mjs:300-311`——`RELAY_MODE === "rpc"` 时调 `startRpcListener()`，**它失败（`.catch`）就回落到 `setInterval(poll, POLL_MS)`**（"Falling back to indexer mode..."）；非 rpc 模式则**一直**是 `poll`。`RELAY_MODE` 的取值：relay 进程内默认 `"indexer"`（`relay.mjs:10`）；console 拉起 relay 时取 `getConfig('relay_mode') || process.env.RELAY_MODE || 'rpc'`（`relay-manager.js:224`）——所以主网默认 rpc，但**两种情形下 `poll()` 会跑**：① rpc 监听器启动失败的回落（例如节点在 relay 启动时不可达——恰是无人值守开机的一种常见时序）；② `config_entries.relay_mode` 被设成 `indexer`。`poll()` 走 `getConversations()`（Kasia 索引器）取会话，对 `pending_incoming` 的对端调 `doAcceptHandshake`：**自带 in-memory 与 console 状态两级去重、自己 `sendKaspa`，与新开关无关联**。
**后果**：开关落地后，只要 relay 处于回落 / 索引器模式，入站握手照样被自动接受——而且设计稿的验收 V6（"DISABLED 行数 == relay 子进程数"）**恰好发现不了它**：启动行如果打在 `rpc-listener.mjs`（"protocol support 那行附近"），走回落 / 索引器模式的 relay 根本不会打这一行，`grep -c` 反而变少——变成"少了几个 relay"而不是"哪条路径没关"。
**修法（v0.2）**：① 第 4 个落点：`doAcceptHandshake` 入口用同一个纯函数判定，关闭态打一行 `HANDSHAKE auto-accept disabled (indexer/poll path) — left pending for <last12>` 并 return（不去重、不 `sendKaspa`、不写 `_acceptedPeers`）；② **启动行改打在 `relay.mjs`（所有模式的共同入口）**，而不是只在 `rpc-listener.mjs`，使 V6 的计数对每个 relay 进程都成立（回落 / 索引器模式也有一行）；③ **加一条源码扫描测试**（同 D26-scan / E-4 的思路，用 F2-1 的共享扫描器）：`kasia-relay/src` 下**每一处** `acceptHandshake(` 调用都必须位于经判定函数保护的函数里，否则红——这样**第五个**调用点不会再悄悄出现（前四个是我现在人工枚举的，不是机器保证的）；④ V 表加 V2c：`RELAY_MODE=indexer` 或 rpc 回落时关闭态 `poll()` 零 `acceptHandshake` / 零 `sendKaspa`。

## 二、你的五个审点

1. **闸位置（step 4 后、step 5 前）与"漏洞 #6 fix"一致吗、pending 会不会无限堆积**——**位置与语义一致**：我核了 step 4 的 `ingestMessage(messageType:'handshake')` 在 console 侧（`services/ingest-service.js:86-140`）确会 `INSERT` 一条 `handshake_accept` 的 pending 行（`source='ingest'`；若关系已 accepted/active 则跳过；若旧行是 failed/expired 则重置为 pending），所以"入站握手已登记、pending 行已建出"成立；step 5 的 `create_and_claim`（`api/ingest.js:252-296`）是 `INSERT OR IGNORE` 后**立即 claim**——闸放在它之前正好不 claim；不 `markSeen` 也与 #6 fix 注释一致。**堆积**：我查了全仓——**没有按时间的过期机制**：`pending` 行只会被 `failPendingAction`（执行失败超过 `max_retries` 才置 `expired`，`catchup-service.js:62-72`）或被消费掉；而 `pending` 的**唯一消费者**就是 relay 追赶路径第 1 段（`getPendingHandshakes` 只被 `/ingest/pending-handshakes` 调用，`agent-mind` 的 `create_and_claim` 是**出站** `handshake_init`、由 `autoHandshake`（默认关）另闸，不消费入站 `handshake_accept`）。所以闸关着时，**每个（本地 relay, 对端地址）留一行，永不过期**，行数由不同对端数决定。这本身无害（小行、无消费者、`getPendingHandshakes` 有 `LIMIT 100`）——**但带来 S-H1：将来打开开关时的积压释放。**
2. **进程级常量 vs 每次读**——**建议改成"每次调用时读"**（S-H2），不必坚持常量：relay 生命周期内 env 不变，所以语义上二者等价；但常量在模块导入时定值，`processHandshake` / `catchUpHistory` 是闭包里的长驻函数，单测想在同一进程里切开关就得重新 `import` 整个 `rpc-listener.mjs`（顶层有网络订阅副作用）。设计稿 2.4 已经把判定抽成纯函数 `handshakeAutoAcceptEnabled(env = process.env)`——**四个落点每次调用它就行**（成本为零），V2 / V3 / V2c / V4 的开 / 关切换就是改一下测试里传入的 `env`，不再依赖 `--experimental-test-module-mocks` 去重载模块。启动日志那一行读一次即可。
3. **追赶路径关闭后 `catch-up done` 汇总行计数 0 会不会被误读**——**会，而且代码里已经有这个先例**：`rpc-listener.mjs:725` 的注释自己写着"19551 次 catch-up done 全是 0/0/0"，`:659-670` 对 `KANET_CATCHUP_COMM` 的做法是**关闭态另打一行 `DISABLED` 且汇总行里也写 `DISABLED`**（而不是 0）。所以（S-H3）：关闭态在汇总行里写 `handshakes: DISABLED (RELAY_HANDSHAKE_AUTO_ACCEPT!=1)`，**不要写 `0 handshakes accepted`**——沿用同一先例。我 grep 了 console / scripts / scout：**没有程序消费这行**，只有人看，所以是可读性问题不是功能问题。
4. **不做对端白名单——要不要另开票**——**要另开票，本页不做**。理由：这份设计是**总闸**（全开 / 全关），关掉之后外部对端的握手会一直停在 pending，人工路径只有 console 的管理接口（`api/admin.js:16` 的注释提到有手动触发接受的管理路由——我只读了注释、没读实现）；将来若要恢复"有条件地自动接受"，需要一个**策略**（白名单 / 速率与预算上限 / 每日上限）——这是另一份设计、另一次钱路决定（须 Owner 批），不该塞进总闸页。建议 Bettor 记一条后续票，并写明与本页的接口："策略层落在 `handshakeAutoAcceptEnabled` 之后、`acceptHandshake` 之前"。
5. **V2 的"ingestMessage 1 次"是否足以证明登记不变**——**不够**：`ingestMessage` 是 relay 对 console 的调用，"pending 行真被建出"是 console 侧（`ingest-service.js`）的行为。设计稿"保留人工处理的可能"这个论点正建立在它上面。建议（S-H4）：V2 保留调用次数断言（relay 侧），**另加 V2b 一条 console 侧的现状钉住测试**（既有行为，不受本改动影响）：用真实迁移的临时库（`DB_PATH`）调真实 `ingestMessage(inbound handshake)`，断言 `pending_actions` 里恰出现一行 `handshake_accept / pending`（并覆盖"已 active ⇒ 不入队""旧行 failed ⇒ 重置"两个分支）。这样"登记不变"由一条真的读得到 pending 行的测试守着，而不是靠一个 mock 的调用计数。

## 三、SHOULD

- **S-H1 将来打开开关时的积压释放（设计需写明）**：设计 §2.2-2 有意"不 markSeen、不 claim，保留将来打开开关后由追赶路径接手的能力"——代价是**关着期间累积的 pending 行，在开关被写成 `1` 后的下一次 relay 启动的追赶第 1 段里，最老的（至多 100 条 / relay）会被逐个自动接受**。这可能正是你想要的，也可能不是；§4 的"将来若要恢复……须 Owner 单独批"应**加一句**："打开前先决定积压如何处置——(a) 有意接受，(b) 用一次经审的一次性 SQL 把它们置 `expired`（保留审计行），或 (c) 先出策略层（M-H1 之外的另一张票）"，并把"当前 pending 的 `handshake_accept` 行数"列为打开前必读读数。
- **S-H2**：每次调用读，见二-2。
- **S-H3**：汇总行写 `DISABLED`，见二-3。
- **S-H4**：V2b，见二-5。
- **观察**：① 设计稿 §4 末尾"P2 守卫清单加一项 `RELAY_HANDSHAKE_AUTO_ACCEPT` 不得为 `1`"——同意，它属于我 N-2 的第一类（缺省即关的开关）；注意 v0.4 守卫已按"继承环境 ∪ 文件"取值，所以机器 / 用户级环境变量里的同名键也会被看到。② 设计稿 V7 的 `grep` 只核 `kanet.mainnet.env` 里没写键——权威读数是 V6，同意。③ 关闭态每次入站握手打一行日志：因为不 `markSeen`，同一笔握手若被再次处理会重复打这一行——**我没有核实 relay 启动时有没有重放窗口、窗口多大**，所以这只是提醒实现者别让这行日志无界（例如同一 txid 只打一次），不是已证事实。

## 没做 / 未证
- 没起 relay 进程、没在回落 / 索引器模式下实跑（我不该动生产 relay；M-H1 是**读码 + 调用图**结论）。`poll()` 回落是否会在主网某次启动里真的发生，我没有历史数据——所以定为"设计缺口"而非"已发生的事故"。
- `lib/indexer.mjs` 在主网具体指向哪个索引器 / 是否可达我没核；这决定的是 M-H1 路径"能否成功接受"，不影响"开关应当覆盖它"的结论。
- 设计稿没有实现，V1–V8 的变异我未审（等实现 diff）。
