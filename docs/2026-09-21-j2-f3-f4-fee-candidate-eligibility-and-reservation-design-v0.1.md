> **Status**: DRAFT v0.1 (2026-09-21 · J2 · 待 NWT 设计审 · 只读码写稿,未改任何代码;设计第一条=复用,见 §1)

# F3 / F4 设计稿:fee 候选资格函数(F3)+ fee 输入预留(F4)

- 依据:账本 1614(F3/F4 裁)、1615(采 Codex df07b0ec 口径)、1616(c:F3 = 把资格维度收进一个函数,**不是新造**;A 臂 net_loss_exceeded 只作活性死锁旁证)。
- Codex df07b0ec 口径:**F3(MUST)**= 创世/下注/结算/split 共用**一个** fee 候选资格函数;unknown facts / covenant 状态 fail-closed;各签名路径 parity 测试。**F4(扩域)**= tick-local 预留集在选中 / prepared 即更新、后续选择必查,域覆盖创世/下注;测试 = 两操作争同一最佳候选,第二个另选或 HOLD,绝不双花。毒化 fee 活体实验只作 corroboration,须先有确定性 parity 测试。
- 坐标全部是 `origin/bshard-m3-deploy` @ eacc1541 的读数(行号会漂,每条配 grep 词)。

---

## 1. 已有什么(设计第一条:这东西是不是已经有了?)

| # | 已有件 | 现在管什么 | 谁调它 | 坐标 |
|---|---|---|---|---|
| E1 | `filterFeeCandidates` | **唯一的**资格函数:跳过 `covenantId !== null` / spk `version !== 0` / spk ≠ relay P2PK(毒化);复核面值区间 `[feeMinAmount, SIGNED_INPUT_CEILING]`(不信 relay 的过滤);排除 `inflightOutpoints`;产出 `ok / saturated / none` + 事件(`fee_candidate_poisoned_skipped` 等) | **只有结算路径**:`verifyStepInputsOnChain`(`proto-settlement-c1.mjs:367`)← `driver-core.mjs:167` ← `proto-settlement-driver.mjs:101` | 定义 `proto-settlement-c1.mjs:196-225`(grep `export function filterFeeCandidates`) |
| E2 | facts 形态 L(fee 取数) | relay `get_address_utxos` 带 `facts:true, minAmount, maxAmount` ⇒ 每条含 `covenantId`、`scriptPublicKey{version,scriptHex}`,面值区间在 relay 侧先过滤,≤200 条;`assertFactsResponse` 对响应形状 fail-closed(缺 `facts===true` 等即抛) | 结算路径:`c1.mjs:325`(payload)、`services/proto-settlement-driver.mjs:94`(`requestFacts` 端口) | relay `lib/utxo-facts.mjs`(`handleGetAddressUtxos`、`buildFactsResponse`);relay.mjs:1242 case |
| E3 | `selectFeeUtxoByConstruction` | 三路径**共用**的选取骨架:滤 `value ≤ SIGNED_INPUT_CEILING`(:135)→ 面值升序 → 逐个**真实构造**(`tryBuild`)→ 第一个成功者即所选;全败 ⇒ `no_suitable_fee_utxo` | 创世 `proto-broadcast-ops.mjs:83`、下注 `:231`、结算 `proto-settlement-ops.mjs:130`(`tryEach`) | `proto-tx-assembly.mjs:134-151`;`SIGNED_INPUT_CEILING_SOMPI` :117;`dynamicNetLossCeiling` :163(`selectChangeShape` 内用) |
| E4 | `toFeeUtxoCandidates` | 创世/下注的取数适配器:**把 RPC 原始项直接映射成候选**,`scriptPublicKeyHex` 被强写成 relay spk(不是 UTXO 自己的)。**无任何过滤**:无 covenant 判断、无 spk 复核、无区间、无在途排除 | 创世 `proto-broadcast-ops.mjs:79`、下注 `:226`(数据来自**旧路径** `get_address_utxos{address}`,`:77` / `:224`) | `proto-broadcast-ops.mjs:48-51` |
| E5 | `inflightOutpoints`(参数) | `filterFeeCandidates` 已有的"按 outpoint 排除"入口(Set<opKey>),一路从 `prepare` 透传到 `verifyStepInputsOnChain` | 在册语义 = "我方在途(未 landed)意图**产出**的输出"(S91-4:别在浅确认的父输出上构造);**生产恒 `[]`** | `proto-settlement-ops.mjs:70`(硬写空);`driver-core.mjs:167` 透传;`c1.mjs:253/276/367` |
| E6 | 三张意图表里已存**字节** | 每个已 prepared 的意图都把签名后交易整包存库(`prepared_tx_json`),其中含**所花的输入 outpoint**——即"哪些 fee UTXO 已被在途交易占了"的完整事实,**无需新状态** | 重播路径读它 | `proto_settlement_intents.prepared_tx_json`(migrate v210,`db/migrate.js` ~6324-6334);`proto_bet_intents.prepared_tx_json`(~6008-6016);`proto_markets.genesis_prepared_tx_json`(v207,~6085) |
| E7 | relay 侧 pending-spent 表 | 进程内 `Map<"txid:idx", expiry>`(TTL 60s),`filterPendingUtxos` 过滤、`markUtxoSpent*` 记账——**普通 send / split / consolidate 在用** | `transaction.mjs:169/259/376`、`utxo-split.mjs:66/144/187/283`、`relay.mjs:432-446`(mempool 拒绝时记账) | `kasia-relay/src/lib/transaction.mjs:53-80` |
| E8 | driver 调度形状 | 创世/下注:`proto-driver` 单飞 tick,**顺序** await(`proto-driver.mjs:81-160`,单飞 :193);结算:`proto-settlement-driver` 另一个单飞 tick(`:59`)。**两个 driver 各有自己的 setInterval,共用同一个 relay 地址的 UTXO 池**,同一 console 进程内 await 点交错 | — | 同上 |
| E9 | relay fee 拒绝码 | `net_loss_exceeded` / `implied_fee_exceeded` 被 core 识别并报警,但**无后续动作**(只记 last_error、下 tick 重试) | `driver-core.mjs:23、:192` | 同 |

### 1.1 由 §1 直接得出的结论(未加新东西之前)
1. **F3 不是新造**:资格函数 E1 已存在且已被测试覆盖(`proto-settlement-c1.test.mjs`,45 项),取数形态 E2 已存在,选取骨架 E3 三路径已共用。缺的只是**创世/下注没接进来**(E4 是裸适配器),以及 split 在 relay 侧另一套代码(E7 旁边)。
2. **F4 也不需要新状态存储**:E6 已经把"哪些输入被在途交易占了"存在三张表里;E5 是现成的排除入口(生产恒空)。缺的是**把 E6 派生成集合喂给 E5**,并覆盖创世/下注。
3. E7 是一个**已有的"在途输入"机制**,但只在 relay 的普通 send 路径生效,`covenant_broadcast`(`kasia-relay/src/lib/covenant-broadcast-relay.mjs`)与 `get_address_utxos`(旧 / facts 两种形态)**都不读不写它**(grep `filterPendingUtxos|markUtxoSpent` 在该文件与 `utxo-facts.mjs` 零命中)。这是 F4 的另一个候选落点,取舍见 §3.4。

---

## 2. 缺什么(逐条对照 Codex df07b0ec)

### F3(MUST)
| Codex 条款 | 现状 | 缺口 |
|---|---|---|
| 创世/下注/结算/split **共用一个**资格函数 | 结算 = E1;创世/下注 = E4(**无过滤**);split = relay `utxo-split.mjs` 用**全部** `entries`(`:66` 只过 pending,不看 covenant/spk),另一套代码 | ① 创世/下注 2 个调用点;② split 1 个调用点(relay 侧,console 不能 import,见 §3.3) |
| unknown facts / covenant 状态 **fail-closed** | 结算路径有 `assertFactsResponse`(形状不合法即抛);**创世/下注走旧路径**:响应里根本没有 covenant/spk 版本信息 ⇒ "未知"被静默当成"普通" | 创世/下注的取数必须换成 E2 的 facts 形态;条目缺 `covenantId` 字段 ⇒ 抛/跳过,**不得**当 null(relay 侧 `utxo-facts.mjs` 头注 F14 已明确"null 语义 = 没有 covenant,不能与'读不到'混"——同一纪律延伸到 console 消费方) |
| 各签名路径 **parity 测试** | 无。E1 只在结算路径测;创世/下注的 `toFeeUtxoCandidates` 无毒化向量;split 无 | 一份**共享向量表**,四条路径各跑一遍,决策必须逐向量一致 |
| (Bettor 1616c 追加)拒后跳选 | E9:relay 回 `net_loss_exceeded` 后,下 tick 的**确定性升序重选**再选同一个 UTXO ⇒ 每 tick 连拒的活性死锁。simnet A/D 创世实测:0.392 KAS 无找零 UTXO 被升序选择器反复选中、relay 连拒 `net_loss_exceeded`(账本 1616 计 21 条;原始行见 `docs/provenance/2026-09-21-j2-oracle-simnet-e2e-four-arms/run-logs/console-proto-lines.log` 行 19-67 与 `actions.jsonl` 的 `relay_split_utxos_force` 行),靠手工 `split-utxos` 才解开 | 资格函数增一个"被 relay 拒过的候选"排除集 |

### F4(扩域)
| Codex 条款 | 现状 | 缺口 |
|---|---|---|
| 预留集在**选中 / prepared 即更新**、后续选择必查 | E5 生产恒空;`getUtxosByAddresses` 读的是**虚拟 UTXO 集,不含 mempool 花费** ⇒ 一个 UTXO 被在途交易花掉后,在它落链前仍会出现在下一次取数里 | 预留集(输入侧) |
| 域覆盖**创世 / 下注**(不只结算) | A 臂即证:D 与 A **同 tick 顺序**创世(不是并发),A 取数时 D 的 prepared 交易还没落链 ⇒ 选中同一 UTXO `96cd7d79…:3`,A 的已备交易永不能落(`inputs_spent`)⇒ `genesis_ambiguous` HOLD(`run-logs/console-proto-lines.log` 行 125-134) | 三条路径都要查同一个预留集 |
| 测试:两操作争同一最佳候选,第二个另选或 HOLD,绝不双花 | 无 | 见 §3.5 |
| (代码事实,Bettor 1614 已核)`inflightOutpoints` 语义是"在途意图**产出**",不是"兄弟意图**已选输入**" | 两者是**不同的集合**;但 E1 的排除入口只认 outpoint,与语义无关 | 入口复用,填入的集合要**并**上"在途意图所花的输入" |

---

## 3. 改法与测试清单

### 3.1 F3:一个资格函数 + 三个调用点接入(**复用,不另起**)
1. **函数**:沿用 `filterFeeCandidates` 的规则与返回形状(E1),**不重写**。放置:纯函数留在 `proto-tx-assembly.mjs`(E3 的同一文件,创世/下注/结算都已 import 它,无新依赖边;`c1.mjs` 改为 re-export 以保持既有 import 与 45 项测试不动)。*(放哪个文件待 NWT 设计审定;约束只有一条:纯函数、不 import DB 客户端——M0a 门。)*
2. **创世/下注接入**:`proto-broadcast-ops.mjs:77 / :224` 由旧 `get_address_utxos{address}` 换成 facts 形态 L(`{facts:true, minAmount, maxAmount}`,与 `services/proto-settlement-driver.mjs:94` 的 `requestFacts` 同 IPC 形状),取数结果过 `assertFactsResponse` → `filterFeeCandidates` → 再交 `selectFeeUtxoByConstruction`(E3 原样)。**`toFeeUtxoCandidates`(E4)删除**——留着就是第二个入口。
3. **⚠ 取舍 A(超出 Codex 文字,须 NWT 看)——`feeMinAmount` 的取值**:结算路径传 `feeMin(step) = loadFeeProfileCap(kind)`(`proto-settlement-ops.mjs:57`,注释"保守:覆盖最坏 fee")。而账本 1462 的结论恰恰是"**cap 是异常上限不是预期值,拿它预筛会把真正够用的 0.5/0.5/0.95 KAS 种子面值错误滤掉**"(`proto-tx-assembly.mjs` 头注)——创世/下注**因此**改成了"按真实构造逐个尝试"。所以创世/下注接入 E1 时 **必须传 `feeMinAmount = 0n`**(区间下界只作 `≥0` 校验,可行性交给 E3 的真实构造),否则会**复活 1462 的 bug**。这也顺带指出:结算路径的 `feeMin=cap` 与 1462 的教训**同向风险**(simnet H 臂在 0.7–0.9 KAS 的 fee UTXO 上跑通,未撞,**但没有证据证明主网种子面值不撞**)——**列观察项,本稿不改结算路径**。
4. **unknown ⇒ fail-closed**:E1 增一个跳过类别 `skippedUnknown`(条目缺 `covenantId` / `scriptPublicKey.version` 字段,或类型非法)——**计入 `saturated` 判定并发事件**,与 `skippedPoisoned` 分开计数(便于区分"被攻击"与"relay 版本不带 facts")。
5. **拒后跳选**:资格函数再吃一个 `rejectedOutpoints`(Set)。由三处调用方在收到 relay `net_loss_exceeded` / `implied_fee_exceeded` / `signed_input_ceiling_exceeded`(**候选特有**的拒绝码,`RELAY_FEE_REJECT_CODES` 已有前两个,E9)时,把**本次所选 fee 输入**记入进程内**有界**表(LRU,如 256 条;键 = outpoint;outpoint 一变即自然失效;UTXO 面值不可变 ⇒ 无需 TTL,但设上限防泄漏)。
   - ⚠ **取舍 B**:这是**进程内**的,console 重启即丢——代价 = 重启后多撞一次同一拒绝再学会,可接受;不落库(落库要新列/新表,不值)。
   - **范围诚实**:拒后跳选只治**活性**(A 臂死锁),**不是**安全项。更根本的问题是"console 的 `selectChangeShape` 为何会构造出 relay 动态净损上限不认的形状"——console 已内置同款 `dynamicNetLossCeiling`(E3 旁,`proto-tx-assembly.mjs:163/188-215`),但 A/D 创世仍撞了。**原因未证(UNVERIFIED)**:需要一次单变量实验(0.392 KAS 无找零候选 + 创世 builder + 两侧 ceiling 打印),不在本稿范围,列为 F3 的后续观察票。
6. **split(relay 侧)**:`utxo-split.mjs:66`(及 consolidate :187)的输入集在 `filterPendingUtxos` 之后再滤掉 `covenantId != null` 的条目——`utxo-facts.mjs` 已能读出每条的 `covenantId`(同一个 `readKey/toFactsItem`),**复用其读取代码**。console 与 relay **不能互相 import**(角色分工;先例:`SIGNED_INPUT_CEILING_SOMPI` 两侧各持一份 + 漂移测试 `proto-tx-assembly.test.mjs:245-255`)⇒ 规则**镜像**,由 §3.3 的共享向量表 + 漂移测试钉住。
   - ⚠ **取舍 C / UNVERIFIED**:毒化 UTXO(covenant 绑定 + relay P2PK spk)被一笔**普通 split 交易**当输入花时,共识行为**未测**(NWT V1c 的目的)。本稿只给"输入侧排除"的改法;是否真需要,由 simnet 探针定(NWT 毒化方案 V1c,排在 parity 测试之后,Bettor 1615 已排)。**split 改动排在 F3 三条 console 路径之后、单独一笔、单独 NWT 审**(relay 是钱路,且 split 是恢复工具——改坏它比毒化更糟)。

### 3.2 F4:预留 = 复用 E5 入口 + 由 E6 派生 + 一个进程内"已选未落库"集
- **两层,各治一个窗口**:
  1. **DB 派生层(重启安全,跨 driver)**:`reservedFeeOutpoints({db})` = 三张意图表里 `status IN ('prepared','submitted')`(及 `ambiguous`,保守)的意图,解析其 `prepared_tx_json` 的**输入 outpoint**(kaspa-wasm `Transaction.deserializeFromSafeJSON`,与既有重播代码同法)的并集。**只读,无新表 / 新列**(E6)。填进 E5 的 `inflightOutpoints`(结算)并传给创世/下注的资格函数。
     - **释放**:`landed` 的意图自然不进集(UTXO 已花,取数里没有它);**F1 的 frozen HOLD 行**(`last_error='settlement_frozen_prepared_hold'`,永不重播)其输入**应释放**,否则每个冻结市场永久锁死一个 fee UTXO——派生查询须排除该标记。
  2. **进程内"已选未落库"层(治两个 driver 交错的窄窗)**:模块级 `Set`(不是 per-driver:两个 driver 同进程共用),在**选中之后、`covenant_broadcast` 发出之前**加入所选 fee outpoint;**prepared 回执落库后**(此后 DB 派生层接管)或该次尝试**确定性失败**(构造抛错 / relay 在 prepared 之前拒绝,含 F1b 的 409)时移除。
- **为何不只用一层**:只有 DB 层 ⇒ 结算 driver 与创世 driver 在 await 点交错时,两者都还没写 prepared,窗口仍在;只有内存层 ⇒ 重启 / 已 prepared 但未落链的交易失去保护(prepared 行在 F2-R 里正是"重启后仍要重播"的对象,其输入必须保持被占)。
- **与 Codex 的差异(如实标)**:Codex 写"tick-local 预留集"。我改成"进程级 + DB 派生":因为(a)两个 driver 是**两个 tick**,tick-local 挡不住跨 driver;(b)A 臂的冲突发生在**同一 tick 内顺序两个市场**——tick-local 能挡,但 prepared 存活跨 tick,下一 tick 需要 DB 派生才不失效。**语义上是 Codex 的超集**,请 NWT 审时确认没有比 Codex 更弱的地方。
- **释放与活性**:预留只会让"最佳候选"被让出,不会造成永久占用(prepared 行要么落链、要么 HOLD/ambiguous 由人处理);候选不足时走既有 `no_suitable_fee_utxo` / `HOLD` 语义(driver 的 `settlement_no_suitable_fee_utxo` 报警已在册)。

### 3.3 F3 parity 测试(共享向量表)
- **一份向量文件**(`kasia-console/test-fixtures/` 下,JSON):每条 = 一组 UTXO(普通 / covenant 绑定 / spk version 1 / spk 不是 relay 的 / 面值越界 / 缺 `covenantId` 字段 / 缺 `version` 字段 / 被预留 / 被 relay 拒过)+ 期望的"可选集合"。
- **四条路径各喂同一份向量**,断言**选集逐向量一致**:①结算(`verifyStepInputsOnChain` + 假 `requestFacts`);②创世(`buildMarketGenesisAndBroadcast` + 假 `sendCmd`);③下注(`buildRegisterAppendAndBroadcast` + 假 `sendCmd`);④relay split 输入过滤(relay 包内,读**同一份向量**;console 与 relay 不互 import,但可读同一个 JSON 文件)。任一路径对任一向量与其他路径不一致 ⇒ 红。
- **反向哨兵(静态)**:lint 规则 `R-FEE-CANDIDATE-SHARED`——`proto-*.mjs` 里出现 `toFeeUtxoCandidates(` 或不带 `facts: true` 的 `get_address_utxos` 调用即失败(仓库既有"撞新坑 → 写 lint 堵死"文化,ANTI-PATTERNS)。
- **弱注入臂**(验证纪律 d):对同一向量集只破坏一个字段(如把 `covenantId` 从 `null` 改成 `'ab'*32`)⇒ 该 UTXO 必须从**所有**路径的选集里同时消失;而不是"注入了还是绿"。

### 3.4 备选(不推荐先做):把预留放在 relay 侧,复用 E7
在 `covenantBroadcastRelay` 于 prepared 回执成功后对该交易全部输入调 `markUtxoSpentByOutpoint`,并让 `get_address_utxos`(两种形态)过 `filterPendingUtxos`。**优点**:单一漏斗(创世/下注/结算全经 relay)、天然跨 driver;E7 已存在。**缺点**:①改 relay 钱路 + 改 `get_address_utxos` 的"旧路径字节不变"契约(NWT 9-0 审过的红线);②E7 是**进程内 60s TTL**,而 prepared 行要存活到落链(可远超 60s)——TTL 语义与 F2-R 重播不匹配,会**过早释放**;③console 不知道自己被 relay 隐藏了哪些候选,诊断(`saturated` 报警的 skipped 计数)失真。⇒ **先做 console 侧(§3.2),relay 侧留作后续互补**。

### 3.5 F4 测试清单
1. **T-race-sequential**(A 臂形状):两个市场创世,D 已 prepared(字节入库、未落链),A 取数含同一 UTXO ⇒ A **另选**或 `no_suitable_fee_utxo`,**绝不**选 D 的输入。**不变量断言**:任意时刻,库里所有非终态 prepared 交易的输入 outpoint **两两不相交**。
2. **T-race-interleave**(跨 driver):结算 step 与下注 append 在 await 点交错(可控 promise),两者都在"选中之后、prepared 之前"⇒ 第二个必须另选 / HOLD。
3. **T-restart**:模块状态清零(模拟 console 重启)+ 库里留一个 prepared 行 ⇒ 新进程的选择仍排除其输入。
4. **T-release**:构造抛错 / F1b 的 409 ⇒ 内存预留被释放(下一次可再选);frozen HOLD 的 prepared 行 ⇒ DB 派生排除其输入;`landed` ⇒ 不入集。
5. **T-liveness**(拒后跳选,A 臂):候选 [0.392 无找零, 0.94];relay 桩对 0.392 回 `net_loss_exceeded` ⇒ **下一次**尝试选 0.94 并成功;对照:去掉 `rejectedOutpoints` ⇒ 每次都选 0.392(证明测试测得到死锁)。
6. **突变**:删预留检查 ⇒ T-race 红;删内存层 ⇒ T-race-interleave 红;删 DB 层 ⇒ T-restart 红;删拒后跳选 ⇒ T-liveness 红。
7. **活体 corroboration(最后)**:simnet 上重放 A 臂(两市场同 tick 创世),期望两笔都落地(第二个换 UTXO);毒化向量按 NWT 方案 V0/V1/V1c——**均在确定性测试全绿之后**(Codex 口径)。

### 3.6 分批与回滚(建议,请 Bettor 裁)
| 批 | 内容 | 风险面 |
|---|---|---|
| F3-a | 资格函数放置 + `skippedUnknown` + 共享向量表 + 结算路径 parity(结算行为**不变**,只加测试与类别) | 极小(纯函数 + 测试) |
| F3-b | 创世/下注接入 facts + 资格函数(`feeMinAmount=0n`,取舍 A)+ lint 规则 | 中:改创世/下注取数形态(钱路)——**用户面/钱路 = 须 Owner 批**(铁律 0) |
| F4 | DB 派生层 + 内存层 + 三路径接线 + 拒后跳选 | 中:结算 `inflightOutpoints` 由恒空变非空 |
| F3-c | relay split 输入排除 | 视 V1c 结论;relay 钱路,单独审 |
每批独立可回滚(新增纯函数 + 调用点接入,不改表、不改 relay 协议)。主网:**只合不部署**,同 F1/F2。

---

## 4. 未证 / 需要 NWT 设计审重点看的
1. **§3.2 是否弱于 Codex**(进程级 + DB 派生 vs tick-local):我认为是超集,请挑战。
2. **取舍 A**(创世/下注 `feeMinAmount=0n`)是否正确读了 1462;以及结算路径 `feeMin=cap` 是否同向风险(本稿不改,只报)。
3. **A/D 创世 net_loss_exceeded 的根因**(console `selectChangeShape` 已带 `dynamicNetLossCeiling` 却仍构造出 relay 拒的形状)——UNVERIFIED,拒后跳选只兜活性。
4. 毒化 UTXO 被普通 split 花的共识行为——UNVERIFIED(V1c)。
5. 三张表的输入解析成本:每次选择扫三表的非终态行 + 反序列化——行数量级 = 在途意图数(个位数到几十),可接受;若日后成规模,可加内存缓存(按 `intent_key + updated_at` 失效)。**未测量**。
6. 本稿未查 KB `D:\KANet-Knowledge-Base` 中是否另有 fee 选取相关设计(已 grep 仓库 `docs/` 与 provenance:`filterFeeCandidates` / `inflightOutpoints` 仅在 9-1 C1 模块的 provenance 与账本出现,无独立设计稿)——**KB 未读,如 NWT 知道有,请指**。
