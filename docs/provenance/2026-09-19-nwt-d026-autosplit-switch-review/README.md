# D-026 启动期 UTXO 自动拆分开关设计稿（`8f66f5ac`）NWT 设计审

2026-09-19。对象：`origin/bshard-m3-deploy` 头 `8f66f5ac` 的 `docs/2026-09-19-bettor-utxo-autosplit-startup-switch-design-v0.1.md`（87 行；Bettor 说 51eaabfd 的 DECISIONS/§4 编辑因无 python 未执行、8f66f5ac 补齐，以它为准——我读的就是它）。方法：对稿里每个"现状事实"用 `git grep 8f66f5ac` / 现场只读复核；读了既有 `utxo-splitter.test.mjs` 与 `start-console-mainnet.ps1` 的环境注入段。D-021：无密钥 / 余额 / 地址。

## 结论

**方向与闸的形状接受（入口早退、只认字面 `'1'`、关闭态恰一行 + 零 DB 零 IPC、不按网络分支、不动调用点）。但设计有一处漏项和两处验收缺口，改完再派实现：**

| 类 | 编号 | 内容 |
|---|---|---|
| **MUST** | **D26-M1** | **漏了第二条启动即起、周期常驻的花钱面：`broadcaster-utxo` cron**（稿 §4 只列了 broker）。见 §三-③。不必同开关，但必须写进设计（覆盖或"当前为零 + 现场核"二选一） |
| **MUST** | **D26-M2** | 既有 4 条测试里 **2 条会在闸关闭时空判通过**（proto 跳过守卫测试只断言"proto 中继零调用"）——1459 的回归守卫会静默失效；V3 须加阳性对照 + 变异 |
| SHOULD | D26-S1 | 关闭态日志带上原始值（`JSON.stringify`），避免"写了 `=1 `/带引号却仍是关"时看不出来 |
| SHOULD | D26-S2 | V5 是静态判据；**运行时证据（V6 的启动日志行）才是权威**，且要覆盖"子进程继承调用者 shell 环境"这条泄漏路径 |
| SHOULD | D26-S3 | 顺带记一条：手动接口 `/api/relay/:id/split-utxos` 无鉴权且支持 `force`（任何本机进程可触发花费手续费的重平衡）——稿说它"操作员显式触发、不是无人值守"，前半句不成立；另开票，不在本页改 |

## 一、①（闸放函数入口 vs 调用点）：同意入口
- **调用者枚举**（`git grep -n autoSplitAll 8f66f5ac`）：代码调用点只有 `src/index.js:870-871`；其余全是注释与 `utxo-splitter.test.mjs`。Bettor 的 grep 成立。
- **入口更好的理由我再补一条**：`splitUtxos()` 的三个调用者（`autoSplitAll:72`、`api/relay.js:527` 手动接口、`broker-intake-watcher.js:677`）里，闸放在 `autoSplitAll` 入口恰好只挡"无人值守的启动期"那一个，不误伤手动接口——闸若放在 `splitUtxos` 内就会连操作员显式操作一起挡掉。稿的位置正确。
- **早退必须先于 `sqlite.prepare`**（稿已写）：我核了函数体（`utxo-splitter.js:56-82`），第一句就是 `sqlite.prepare(SELECT …)`；早退放在它之前才满足"零 DB"。
- **D26-S1（可诊断性）**：`start-console-mainnet.ps1` 注入 env 用 `^([^=]+)=(.*)$` 且**不 trim、不去引号**（`Get-Content` 已去行尾换行，所以没有 `\r` 问题）。运维者写 `UTXO_AUTOSPLIT_ON_START=1 `（尾空格）或 `="1"` 会得到 `' 1'`/`'"1"'`，闸保持关——**安全方向对**，但日志只说 `disabled (…!=1)`，运维者会以为"我明明开了"。要求关闭态日志改为 `disabled (UTXO_AUTOSPLIT_ON_START=<JSON.stringify(raw)> != "1")`（这个值是布尔开关，不是敏感信息）。V2 的变异对照已含 `' 1'`，保留。

## 二、②（不按网络分支）：同意
理由成立（D-017 后仅一个运行网络；少一条 `KASPA_NETWORK` 判断少一个"我以为在哪个网"的错误面）。补一条**影响面**：隔离 simnet console（9-4 端到端、任何 J2/NWT 的隔离实例）从此也默认关闭启动拆分——它们本来就用"全新 DB + 全新 env 副本"，需要多 UTXO 的场景（并行广播）应在**该 env 副本里显式写 `=1`** 并在 9-4 / 验收清单里列这一键；我没发现哪条现有流程隐式依赖它（见 §五）。

## 三、③（broker 补零钱路径）：**确认结论**；并**推翻稿中"启动期只有一条花钱面"的隐含前提——有第二条**

### 3a 稿的结论成立：broker 补零钱在主网当前不跑（独立证据，不止 0 行日志）
1. 调用链：`_ensureBrokerUtxoSplit` 只有 `broker-intake-watcher.js:1117` 一个调用点（`git grep`），位于该 watcher 的 tick 内；
2. 该 watcher 只在 `index.js:904` 的 `if (process.env.BROKER_ENABLED === '1')` 块内**动态 import**后启动（模块连加载都不发生）；
3. 现场：`kanet.mainnet.env` 中 `BROKER_ENABLED` 键**不存在**（键名计数 0）；**本次主网 stdout 第 368 行有 `[broker] disabled (BROKER_ENABLED!=1)`——这是闸关闭的阳性证据，比"`[broker-utxo-split]` 0 行"这种缺失型证据更强**（缺失型证据也可能是"跑了但没触发"）；两份 stdout 中 `[broker-utxo-split]` 均 0 行（与稿一致）。
稿的"若将来打开 BROKER_ENABLED 须先给它同款开关（票 `T-BROKER-UTXO-SPLIT-MAINNET`）"我同意，建议把它做成 **BROKER_ENABLED 打开的前置检查项**（清单里写死），而不是只记票。

### 3b **D26-M1（MUST）：漏项——`broadcaster-utxo` cron 是第二条启动即起、之后每 3 分钟常驻的 `split_utxo` 花钱面**
- **事实**：`index.js:815` 无条件 `startBroadcasterUtxoMaintainerCron()`（无 env 闸）；`broadcaster-utxo.mjs` 启动 90 s 后首 tick、之后每 180 s 一次；每个目标 relay 发 `sendCommandAsync(…, {type:'split_utxo', targetCount:30, force:true})`（`broadcaster-utxo.mjs:70`）——`force:true` 是"整合 + 重拆"，不是"够了就跳过"；目标集 = `relay_nodes.is_oracle=1 且有地址` ∪ `POOL_SEEDER_MAKER_RELAY` ∪ 环境覆盖 `BROADCASTER_RELAY_IDS`（proto 中继已排除）。`git grep` 显示它的唯一启动点就是 `index.js:815`。
- **主网当前为零**（我现场核）：库里 `is_oracle=1 且有地址` 的行 = 0；`POOL_SEEDER_MAKER_RELAY` 与 `BROADCASTER_RELAY_IDS` 在 `kanet.mainnet.env` 中键都不存在；两份 stdout 里 `broadcaster-utxo … rebalanced` / `tick` 行均 0，只有 `started`。
- **但它"是否花钱"取决于库里的数据，不取决于代码或 env 开关**：任何流程把某个 relay 的 `is_oracle` 置 1（预言机登记路径），从下一个 tick 起该 relay 就被无人值守地、每 3 分钟强制重平衡到 30 个 UTXO，直到有人发现。这与稿 §4-1 里 broker 的处理逻辑同构，而稿只记了 broker。
- **要求（二选一，写进设计）**：(i) **同族开关**——`BROADCASTER_UTXO_MAINTAIN` 默认关、只认 `'1'`、关闭态一行 `[broadcaster-utxo] disabled`，与本页同一模式、同一批实现（一个函数一个早退，成本几乎为零）；或 (ii) **登记为"当前为零"并把现场核写进每次上线 / 自启验收**：`SELECT count(*) FROM relay_nodes WHERE is_oracle=1 AND address IS NOT NULL` = 0，且两个 env 键不存在——(ii) 的弱点是"今天为零"不能保证明天为零，我倾向 (i)。无论选哪个，都要在 P2 的"开机后链上出站交易清单比对"里覆盖它（我在 P2/P3 审里已要求枚举表）。
- **对 D-026 目标的含义**：Owner 要的效果是"重启后无人在场时不会自己往链上发交易"。只关 `autoSplitAll` 时，这句话在**今天的数据下**成立，在**数据变化后**不成立。设计对 Owner 的口径应写成"今天为零、由哪个条件保证"，而不是"启动期不再花钱"。

### 3c D26-S3（顺带发现，另开票）
`POST /api/relay/:id/split-utxos`（`api/relay.js:517-531`）**没有任何鉴权 / preHandler**，且接受 `force:true` 与任意 `targetCount`。本机任何进程都能对任一 relay 触发重平衡并烧手续费（只烧费、不是盗币：拆分是发给自己的输出）。稿 §2.4 说"手动接口是操作员显式触发、不是无人值守"——**前半成立（人可以触发）、后半有误导（任何本机进程也可以）**。它属 T-LOOPBACK-AUTHZ 家族，代价有界（手续费），本页不改，但设计里不要再把它当"受控入口"来论证；建议另开票走 `ADMIN_SECRET_*` 分档。

## 四、④（有无路径把启动期拆分当作活性前提）
**我没找到，但范围要说清：**
- **没有消费者依赖它的日志行**：`git grep -E "accounts split|\[utxo-splitter\]"`（排除文档与该文件自身）零命中——没有监控 / 闸按这些行做判定，关掉不会让某个"按行 grep"的守卫失明或误报。
- **proto 流程从未依赖它**：`_isProtoRelay` 早已把 proto 中继排除（`utxo-splitter.js:46-49,68`，1459 闸 3 修复），proto 的 UTXO 形状由执行页管理。
- **发送路径不依赖 UTXO 数量**：`sendKaspa` 串行（`index.js` 注释："sendKaspa is serial via withSendLock"），单个大 UTXO 只是吞吐问题，不是活性问题；需要多 UTXO 的是旧的"结算 sign_req 分块并行广播"（`broadcaster-utxo` 头注释），而它的目标集主网当前为零（§3b）。
- **稿里"Round 1 风暴防护是 broker 高频场景"**：broker 主网关闭（§3a），成立。
- **未审的范围**：我没有逐个审所有 `getUtxos`/选币调用者对"UTXO 数量足够"的隐含假设；结论限于"没有代码 / 监控把启动期拆分当前提"，不是"没有任何流程受 UTXO 数量影响"。开关关闭后账户 UTXO 数不再演化（停在当前值），不会变差。

## 五、验收判据（V1–V7）审
| 项 | 判 | 意见 |
|---|---|---|
| V1 / V2 | ✅ | 变异对照恰当。**补**：V2 的四值再加 `''`（空串）与 `'1'` 前后加换行的两种，`'01'`、`'１'`（全角）也进去（几乎零成本，都必须关） |
| **V3** | ⚠ **D26-M2** | 见下 |
| V4 | ✅ | 调用点 diff 为空 |
| V5 | ⚠ | 静态；`grep -c` 对 `kanet.mainnet.env` 计数 0 我已在 BROKER_ENABLED 等键上用同法核过，方法可靠。但**权威是 V6**（运行时日志）：console 子进程继承调用者的 shell 环境，`start-console-mainnet.ps1` 只往进程环境里**加**文件里的值、**不清除**继承来的变量——若启动者的 shell 里恰好有 `UTXO_AUTOSPLIT_ON_START=1`（例如某个会话跑过测试没清），env 文件里没有键也会是开。V6 的"`disabled` 恰 1 行、`… → … UTXOs` 0 行、`accounts split` 0 行"必须**从运行中 console 自己的 stdout 读**，且**P2 自启的注册门（我审 P2 时要求的"开关已上线并被日志证明"）以 V6 为准，不以 V5 为准** |
| V6 / V7 | ✅ | — |
| **新增 V8** | — | 对应 D26-M1：`SELECT count(*) FROM relay_nodes WHERE is_oracle=1 AND address IS NOT NULL` = 0 ∧ `POOL_SEEDER_MAKER_RELAY`/`BROADCASTER_RELAY_IDS` 键不存在 ∧ 启动日志无 `[broadcaster-utxo] … rebalanced`（选 (ii) 时）；选 (i) 时改为 `[broadcaster-utxo] disabled` 恰 1 行 |

### D26-M2 —— V3 的空判据（我读了既有测试文件）
既有 4 条测试里，**第 1、2 条**（`utxo-splitter.test.mjs:47-64`，1459 的 proto 跳过守卫）**只断言"proto 中继收到 0 条命令"**；第 3、4 条断言普通中继收到 1 条。闸加上之后，若实现者只在第 3、4 条（否则会红的那两条）里设 `UTXO_AUTOSPLIT_ON_START=1`，第 1、2 条在**闸关闭**状态下照样绿——**不管 `_isProtoRelay` 跳过逻辑还在不在**。即：1459 那道"proto 中继永远不被拆分"的回归守卫会**静默变空**，而它守的正是 1459 的闸 3 阻断（重启即拆掉 proto 中继）。
要求：① 测试文件在**文件作用域**统一设 `UTXO_AUTOSPLIT_ON_START='1'`（关闭态另写独立用例并显式 `delete`），且每条 env 改动用 try/finally 还原，防止用例间泄漏；② 第 1、2 条各加**阳性对照**：同一个 tick 里加一个普通中继并断言它收到 1 条命令（证明闸开着、守卫真在过滤）——第 4 条已是这个形状，可直接把 1、2 并成它的变体；③ **变异对照**：在 `env=1` 下把 `_isProtoRelay` 早退删掉 ⇒ 1/2/4 必须红；把 `!== '1'` 反写 ⇒ 全红（稿已有）。这条变异（删 proto 跳过）是稿没有的，它才是证明守卫没被闸吞掉的那一条。

## 六、上线与门
- 稿 §5 的"随下一次本来要做的 console 重启上线、不单独重启"同意；补一句：**在此之前，任何手动 / 意外重启仍会跑旧代码的启动期拆分**（每次约 0.045 KAS，已知），不因本页而改变；P2 自启的注册门必须等 V6 证据。
- D-026 只批了"加开关、默认关"；**打开**它（写 `=1`）另需 Owner 批——同意；对 D26-M1 选 (i) 时，新开关的**打开**同理。
- 我没有改动任何文件；本文件在我的 worktree `scratch/_nwt_wt_b9v03`。

## 我没做 / 未证
- 没读 `autoSplitAll` 的拆分判据与 relay 端 `split_utxo` 的"sufficient / force"语义（成因不收敛的问题稿已另开票，不在本页）；没审所有选币调用者（§四）；`broadcaster-utxo` 的 `force:true` 行为我读的是 console 侧发送与注释，relay 端 `split_utxo` handler（`relay.mjs:585`）没读全，"每 tick 都会花钱"是**若目标集非空**时的推断，不是实测；没审 `T-BROKER-UTXO-SPLIT-MAINNET` 与手动接口鉴权的实现方案。
