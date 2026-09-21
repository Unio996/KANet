> **Status**: DRAFT v0.2.1 (2026-09-21 · J2 · NWT 第二轮 f5815523:M2/M3/M4 落实,M1 补一句+一突变、M4 补一句精度修正——本版即补这两处,视为通过;只文档;设计第一条=复用,见 §1)

# F3 / F4 设计稿:fee 候选资格函数(F3)+ fee 输入预留(F4)

> **v0.2.1 变更(NWT round2 @f5815523)**:① M1 补——DB 派生集必须在选择同步段内**现读**(`reserved` 形参是读取句柄,不是预算好的 Set),加一条突变与测试形状(§3.2-A、§3.5-2);② M4 精度——"被预留/被拒过"两维只对三条 console 路径要求一致,relay split 只对其余五个维度(§3.3)。
>
> **v0.2 变更(NWT `origin/nwt/f3f4-design-review-20260921` @a7572843)**:第一问答案(复用)与方向不变,F3 通过。**F4 §3.2 重写**——M1 check+reserve 收进一个共享同步函数并补 HTTP 入口;M2 内存预留对"结果不确定"的释放规则;M3 DB 派生层遇坏行 fail-closed;M4 §3.3 parity 的对象重新定义(只对安全资格维度,面值下界作每路径显式参数)。非 MUST 项各写一句,见 §3.7。

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
| E8 | 并发入口形状(**v0.2 补 HTTP**) | 除两个 driver tick 外,**HTTP 处理器**也会并发进入同一 relay UTXO 池:`api/proto.js:194-197`(创建市场的立即创世,`driveMarketGenesis` → `buildMarketGenesisAndBroadcast`)与 `:297-300`(下注的立即 append,`driveBetIntent` → `buildRegisterAppendAndBroadcast`),`origin:'http'`,与 driver tick 及彼此都**不单飞**。driver 调度形状: 创世/下注:`proto-driver` 单飞 tick,**顺序** await(`proto-driver.mjs:81-160`,单飞 :193);结算:`proto-settlement-driver` 另一个单飞 tick(`:59`)。**两个 driver 各有自己的 setInterval,共用同一个 relay 地址的 UTXO 池**,同一 console 进程内 await 点交错 | — | 同上 |
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

### 3.2 F4:预留 = 一个共享的"选择并预留"同步函数 + E5 入口 + E6 DB 派生(v0.2 重写)
**A. 形状(M1)**——预留不散在各调用点的接线里(漏一处 = 该处无保护),而是收进**一个**函数:
- `selectAndReserveFeeUtxo({ candidates(已过资格函数), reserved, tryBuild, … })`,**包住 E3 `selectFeeUtxoByConstruction`**。**调用点 = 全部入口**:创世 `proto-broadcast-ops.mjs:83`、下注 `:231`、结算 `proto-settlement-ops.mjs:130`(`tryEach`);**HTTP 入口**(`api/proto.js:194-197`、`:297-300`,见 E8)经 `build*AndBroadcast` 汇入同一处,所以三个调用点走包装函数即自动覆盖;**T-race 仍须有 HTTP 形状**(§3.5)。
- **原子性**:取数是 `await`(IPC),返回即过期。**"检查预留集 → 选中 → 把所选 outpoint 记入预留集"必须在最后一个 await 之后、同一个同步段内完成**(JS 单线程,同步段内无交错)。两个调用方各自取到同一份列表、先后进入这一段时,第二个会看到第一个刚记入的预留。
- **DB 派生集在同步段内现读(v0.2.1,NWT round2)**:`selectAndReserveFeeUtxo` 的 `reserved` 形参是**活的读取句柄**(如 `() => reservedFeeOutpoints({db})`,或传入 db 由函数内调用),**在上面那个同步段内**现读 DB 派生集,**不接受调用方预先算好的 Set/快照**。原因:结算路径的 `inflightOutpoints` 现在是在 `prepare('inputs')` 里算的,**早于**随后的取数 await(`verifyStepInputsOnChain`)——若沿用,会留一个窗口:①A 在 t0 算出 DB 派生集(此时 D 尚无 prepared 行)→ 进入取数 await;②D 在 A 等待期间选中同一 UTXO、写 prepared 回执(DB 已有字节),随即按 M2 规则从内存层移除(DB 层接管);③A 醒来:手里是 t0 的旧快照(无 D)+ 内存层(D 已移除)⇒ 选中 D 的 UTXO ⇒ 复现 A 臂 `inputs_spent`。**故 F4 落地时结算路径的 `prepare` 不再负责产出预留集**(`inflightOutpoints` 里"输入侧预留"这一半改由包装函数在同步段内读;`prepare` 仍可产出"在途意图产出"那一半)。better-sqlite3 是同步读,同步段内现读可行。
- **lint**(与 `R-FEE-CANDIDATE-SHARED` 并列):`R-FEE-SELECT-ONLY-VIA-WRAPPER`——`selectFeeUtxoByConstruction(` 除包装函数自身外出现即失败(生产代码;测试豁免)。

**B. 两层预留,各治一个窗口**:
1. **DB 派生层(重启安全,跨 driver / HTTP)**:`reservedFeeOutpoints({db})` = 三张意图表里非终态(`prepared`/`submitted`/`ambiguous`)行的 `prepared_tx_json` **输入 outpoint 并集**(E6)。只读,无新表/列。填进 E5 的 `inflightOutpoints`,并传给创世/下注。
   - **M3 · fail-closed(不可解析 ⇒ HOLD,不是跳过)**:任一非终态行的字节缺失(`prepared_without_bytes`)、JSON 损坏、或反序列化抛错 ⇒ **本次选择 HOLD + 报警(新报警名,登记 `SETTLEMENT_ALERTS`),不选、不跳过该行**。理由:"跳过" = 该行占用的 UTXO 不受保护 = 安全层静默失效。测试:注入一行坏字节 ⇒ 选择 HOLD;**突变**:把"HOLD"改成"跳过" ⇒ 该测试红。
   - **遥测分开标**:E5 现语义是"在途意图**产出**"(S91-4),现并入"在途意图**所花输入**"——同一参数可以合一,但 `skippedInflight` 计数会混,**拆成 `skippedInflightOutputs` / `skippedReservedInputs` 两个计数**分别进事件。
   - **释放**:`landed` 自然不在集内。**F1 frozen HOLD 行**(永不重播)的输入释放条件(采 NWT M2 附注,SHOULD):**"该 prepared 已不可能落链"**——即其非 fee 输入(RootClose)已被花掉(既有 `inputs_spent` 语义,如已被 refund_flip 花掉),**而不是"看到 `last_error` 标记就释放"**:F1b 残余窗口里那笔字节可能已在 mempool,提前释放会复现 A 臂的 `inputs_spent` 冲突(活性问题,非灾难)。
2. **进程内"已选未落库"层(治并发窄窗)**:模块级 `Map<outpoint, {intentKey, reservedAtMs}>`(进程级,driver/HTTP 共用),在 A 的同步段内加入;**释放规则按结局分三类(M2)**:
   - **确定性成功**:prepared 回执已落库(此后 DB 层接管)⇒ 从内存层移除。
   - **确定性失败**:构造抛错、或 relay 在 prepared 之前明确拒绝(含 F1b 的 409、`prepared_ingest_failed`)⇒ 立即移除。
   - **结果不确定**(IPC 超时:console 15s,relay 可能仍在处理并随后写 prepared+广播):**保持预留 + 有界期限**(≥ 2× IPC 超时,常量具名不可 env 调),到期**先对账再释放**:查该 intent 的 DB 行是否已有 prepared 字节(有 ⇒ 转由 DB 层持有,内存层移除);无字节则问 relay `get_mempool_entry` / `check_utxo_landed`(该 intent 若已有 prepared_txid)——仍无任何痕迹 ⇒ 释放。**不允许**立即释放(relay 晚到的 prepared 会与后来者选同一 UTXO),也**不允许**永不释放(种子池只有个位数 UTXO:账本 1464 记 0.5/0.5/0.95 KAS、simnet 4×0.99,几次泄漏就整池死锁,把 F4 从"防双花"变成"制造活性故障")。
   - **泄漏遥测**:预留数 / 最老预留年龄超阈值 ⇒ 报警;内存层随进程重启清零,由 DB 层兜(prepared 已落库的部分)。
3. **为何两层**:只有 DB 层 ⇒ 并发调用方都还没写 prepared 时窗口仍在;只有内存层 ⇒ 重启 / prepared 但未落链的交易失去保护(F2-R:prepared 行重启后仍要重播,其输入必须保持被占)。
- **与 Codex 的差异(如实标)**:Codex 写 tick-local;这里是**进程级 + DB 派生 + 同步原子 + 不确定结果的对账释放**。NWT 指出 v0.1 在四处弱于 Codex(缺原子性、缺 HTTP 入口、缺不确定释放、缺坏行 fail-closed),v0.2 逐条补上,语义上才是 Codex 的超集。

### 3.3 F3 parity 测试(共享向量表)(M4 重新定义对象)
- **一致性的对象 = 安全资格维度,不含面值下界**(**v0.2.1 精度**:七个维度里,**"被预留"、"被 relay 拒过"只对三条 console 路径(结算/创世/下注)要求一致**——第四条 relay split 在 relay 包内,**看不到** console 的预留集与拒绝表,这两维对它无定义、向量期望里不写;**split 只对 covenant 绑定 / spk 版本 / spk≠relay / unknown facts / 超 ceiling 五维要求一致**):`covenantId` 绑定 / spk `version` / spk ≠ relay / unknown facts(缺字段)/ **被预留** / **被 relay 拒过** / **超 `SIGNED_INPUT_CEILING`**。对这些维度,**四条路径对同一向量必须给出同一个"是否合格"判定**。
- **面值下界 `feeMinAmount` 不参与一致判定**:结算路径 `feeMin=cap`(`proto-settlement-ops.mjs:57`)、创世/下注 `feeMin=0n`(取舍 A,1462)——同一 0.3 KAS 普通 UTXO 在两条路径上**本来就该得到不同结果**。向量表里**每条路径显式声明自己的 `feeMin` 参数**,期望值按"安全维度一致 ∧ 面值维度按该路径声明的 feeMin"分别写。**禁止**为让测试变绿而把 feeMin 拉齐——那正是复活 1462。
- **向量文件**(`kasia-console/test-fixtures/` JSON):每条 = 一组 UTXO(普通 / covenant 绑定 / spk version 1 / spk 非 relay / 面值越界 / 缺 `covenantId` / 缺 `version` / 被预留 / 被拒过)+ 每路径的 feeMin + 期望可选集合。
- **四条路径各喂同一份**:①结算(`verifyStepInputsOnChain` + 假 `requestFacts`);②创世(`buildMarketGenesisAndBroadcast` + 假 `sendCmd`);③下注(`buildRegisterAppendAndBroadcast`);④relay split 输入过滤(relay 包内读同一 JSON)。
- **静态哨兵**:`R-FEE-CANDIDATE-SHARED`(`proto-*.mjs` 里 `toFeeUtxoCandidates(` 或不带 `facts: true` 的 `get_address_utxos` 即失败)+ `R-FEE-SELECT-ONLY-VIA-WRAPPER`(§3.2)。
- **弱注入臂**(保留):只把某 UTXO 的 `covenantId` 从 `null` 改成 `'ab'×32` ⇒ 该 UTXO 必须从**所有**路径的选集里**同时**消失。

### 3.4 备选(不推荐先做):把预留放在 relay 侧,复用 E7
在 `covenantBroadcastRelay` 于 prepared 回执成功后对该交易全部输入调 `markUtxoSpentByOutpoint`,并让 `get_address_utxos`(两种形态)过 `filterPendingUtxos`。**优点**:单一漏斗(创世/下注/结算全经 relay)、天然跨 driver;E7 已存在。**缺点**:①改 relay 钱路 + 改 `get_address_utxos` 的"旧路径字节不变"契约(NWT 9-0 审过的红线);②E7 是**进程内 60s TTL**,而 prepared 行要存活到落链(可远超 60s)——TTL 语义与 F2-R 重播不匹配,会**过早释放**;③console 不知道自己被 relay 隐藏了哪些候选,诊断(`saturated` 报警的 skipped 计数)失真。⇒ **先做 console 侧(§3.2),relay 侧留作后续互补**。

### 3.5 F4 测试清单(v0.2)
1. **T-race-sequential**(A 臂形状):两市场创世,D 已 prepared(字节入库、未落链),A 取数含同一 UTXO ⇒ A 另选或 `no_suitable_fee_utxo`。**不变量**:任意时刻,库里所有非终态 prepared 交易的输入 outpoint 两两不相交。
2. **T-race-interleave(M1)**:在 `sendCmd` 的 await 点可控交错——**必须含 HTTP 入口 × driver tick 的形状**(`api/proto.js` 立即创世/append 与 driver 同时取数),另含 driver × driver、结算 × 下注;第二个必须另选 / HOLD。**形状必须能测到 v0.2.1 的窗口**:除"D 停在选中未 prepared"外,**还要有让 D 在 A 的取数 await 期间*完成 prepared 落库并释放内存层*的形状**(driver×driver 与 HTTP×driver 两种都要)——只测前者测不到"A 用了 await 前的旧 DB 快照"。**突变(两条)**:①把"检查+记入"拆成两个 await 段 ⇒ 红;②**把 DB 派生集改用 await 之前的快照(如 prepare 阶段预算好的 Set)⇒ 上述两种形状的 T-race-interleave 均红**。
3. **T-restart**:模块状态清零 + 库里留 prepared 行 ⇒ 新进程选择仍排除其输入。
4. **T-timeout-late-prepared / T-timeout-never-written(M2)**:IPC 超时后两种结局——(a) relay **晚到写 prepared**:预留保持,到期对账发现 DB 已有字节 ⇒ 转 DB 层,期间后来者**不**选同一 UTXO;(b) relay **从未写**:到期对账无痕迹 ⇒ 释放,之后可再选。**突变**:超时立即释放 ⇒ (a) 红;永不释放 ⇒ (b) 红。
5. **T-leak-telemetry(M2)**:预留数 / 最老年龄超阈值 ⇒ 报警。
6. **T-corrupt-row(M3)**:注入坏字节 / 缺字节的非终态行 ⇒ 选择 HOLD + 报警;**突变**:HOLD→跳过 ⇒ 红。
7. **T-release**:构造抛错 / F1b 409 ⇒ 内存预留立即释放;frozen HOLD 行**仅当其 RootClose 输入已被花**才释放其 fee 输入(不是看标记);`landed` 不入集。
8. **T-liveness**(拒后跳选,A 臂):候选 [0.392 无找零, 0.94],relay 桩对 0.392 回 `net_loss_exceeded` ⇒ 下一次选 0.94;对照:去掉 `rejectedOutpoints` ⇒ 每次都选 0.392。
9. **突变汇总**:删预留检查 ⇒ T-race 红;DB 派生集改 await 前快照 ⇒ interleave 红(v0.2.1);删内存层 ⇒ interleave 红;删 DB 层 ⇒ restart 红;删拒后跳选 ⇒ liveness 红;以及上面各条各自的突变。
10. **活体 corroboration(最后)**:simnet 重放 A 臂;毒化向量按 NWT 方案 V0/V1/V1c——均在确定性测试全绿之后。

### 3.6 分批与回滚(建议,请 Bettor 裁)
| 批 | 内容 | 风险面 |
|---|---|---|
| F3-a | 资格函数放置 + `skippedUnknown` + 共享向量表 + 结算路径 parity(结算行为**不变**,只加测试与类别) | 极小(纯函数 + 测试) |
| F3-b | 创世/下注接入 facts + 资格函数(`feeMinAmount=0n`,取舍 A)+ lint 规则 | 中:改创世/下注取数形态(钱路)——**用户面/钱路 = 须 Owner 批**(铁律 0) |
| F4 | DB 派生层 + 内存层 + 三路径接线 + 拒后跳选 | 中:结算 `inflightOutpoints` 由恒空变非空 |
| F3-c | relay split 输入排除 | 视 V1c 结论;relay 钱路,单独审 |
每批独立可回滚(新增纯函数 + 调用点接入,不改表、不改 relay 协议)。主网:**只合不部署**,同 F1/F2。

### 3.7 非 MUST 项(NWT 记录,各一句)
- **放置文件**:资格函数放 `proto-tx-assembly.mjs` 或保留在 `c1.mjs` 均可;约束 = 纯函数、不 import DB 客户端(M0a 门)、无循环依赖、既有 45 项 `c1` 测试不动。
- **第四张意图表 `submit_intents`**(`lib/submit-intent.mjs`,bettor 的 escrow/transfer)花的是 `b.maker_relay_id` 的 UTXO,**不是** PROTO_RELAY_ID,故**不进**派生集。**"两类 relay id 运营上永不重合"我没有核实——UNVERIFIED,不写"已确认"**;若日后 proto relay 也走 `transferWithIntent`,须并入派生集。
- **毒化占满窗口的活性 DoS(pre-existing)**:≤1 KAS 的毒化 covenant UTXO 占满 facts 窗口 200 条会 `saturated` ⇒ 无候选。F3-b 把它**从结算路径扩到创世/下注**(此前静默收下毒化候选,现为 fail-closed HOLD)——方向正确;**F3-b 批说明须写明"新增了一种创世/下注的 HOLD 原因"**。
- **拒后跳选 LRU**:若拒绝码是构造层普遍缺陷(所有候选都被拒),LRU 会把全部候选拉黑 ⇒ 全 HOLD 直到重启;fail-safe 方向,只需在遥测可见。
- **F4 批说明须单列**:"结算 `inflightOutpoints` 由恒空变非空"是**行为变化**。
- **relay 侧备选(§3.4)补一条**:relay 不知 console 的预留,`saturated` 诊断会失真。

---

## 4. 未证 / 状态
- **已由 NWT 核实**:第一问(复用)全部断言;取舍 A(`feeMin=0n`;facts 列表"面值降序截断保留最大 200 条",`minAmount=0` 不让 dust 挤窗口);relay 侧备选不先做;KB 无相关条目(NWT 已查,无可指的 durable 条目)。
- **仍 UNVERIFIED**:A/D 创世 `net_loss_exceeded` 的根因(拒后跳选只兜活性);毒化 UTXO 被普通 split 花的共识行为(V1c,排后);三表扫描 + 反序列化成本(未测量);`submit_intents` 与 PROTO_RELAY_ID 不重合(§3.7);M2 里"IPC 超时后 relay 是否会晚到写 prepared"的真实时间分布(未测,只按 ≥2×IPC 超时保守取)。
- **状态**:本稿 v0.2 = NWT 第二轮(最后一轮)审的对象;通过后仍**排在驱动退款路(R-a…)之后**实现,不在 Owner 聚焦令当前范围内。
