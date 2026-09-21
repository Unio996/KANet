# NWT 设计审:F3/F4 fee 候选资格函数 + fee 输入预留(J2 设计稿 v0.1 @1231376a)—— verdict:**F3 通过;F4 §3.2 push-back(4 条 MUST 补稿),补齐后通过**

- 被审:`docs/2026-09-21-j2-f3-f4-fee-candidate-eligibility-and-reservation-design-v0.1.md`(origin/coord/j2-f1-f2-freeze-hold-20260921 @1231376a,只读码写稿)。坐标全部对着 `origin/bshard-m3-deploy` @cef953c1 我自己核过。
- 审的人:NWT。方式:读码(`git show`/`git grep`,不改任何仓库文件);零运行、零主网触碰。一轮只报 MUST。
- 设计过了也不立即实现:排在驱动退款路设计稿之后(Owner 聚焦令,Bettor 1617 转述)。

## 第一问:"这东西是不是已经有了?"——J2 的答案**对**,并已被我逐条核实

| J2 断言 | 我核到的 |
|---|---|
| E1 `filterFeeCandidates` 是唯一资格函数,只结算路径用 | `proto-settlement-c1.mjs:196` 定义;全仓生产调用只有 `c1.mjs:367`(← driver-core ← proto-settlement-driver)。✓ |
| E4 `toFeeUtxoCandidates` 创世/下注无任何过滤,spk 被强写成 relay 的 | `proto-broadcast-ops.mjs:48-52`:只 `.filter((u)=>u.outpoint)` 后映射,`scriptPublicKeyHex: feeSpkHex`(不是 UTXO 自己的)。数据来自旧路径 `get_address_utxos{address}`(:77/:224)。✓ |
| E3 `selectFeeUtxoByConstruction` 三路径共用 | `proto-tx-assembly.mjs:134`;调用点 `proto-broadcast-ops.mjs:83/:231`、`proto-settlement-ops.mjs:130`。✓ |
| E5 `inflightOutpoints` 生产恒空 | `proto-settlement-ops.mjs` `prepare()` 内 `const out = { inflightOutpoints: [], … }` 硬写空。✓ |
| E6 三张意图表已存字节 | `prepared_tx_json`(settlement v210)、`proto_bet_intents.prepared_tx_json`、`proto_markets.genesis_prepared_tx_json`(v207)。✓ |
| E7 relay pending-spent 表不涉 covenant_broadcast/facts | `kasia-relay` `covenant-broadcast-relay.mjs` 与 `utxo-facts.mjs` 里无 `filterPendingUtxos/markUtxoSpent`。✓ |
| KB 无相关条目 | `D:\KANet-Knowledge-Base` 关键词(fee utxo / inflightOutpoints / filterFeeCandidates / 预留 / change shape)零命中;仓库内也只在 9-1 C1 provenance 与账本。**KB 没有可指给 J2 的 durable 条目。** |

结论:F3 = 把资格维度收进 E1 并接到创世/下注,不是新造;F4 = 用 E6 派生占用集喂 E5,不加新状态表。方向对,通过。

## J2 自标三处要我挑战的

**① 创世/下注接资格函数 `feeMinAmount=0n` —— 正确,且我多验了一层。** 读了账本 1462:闸 3 金丝雀 `market_genesis` 每 tick `no_suitable_fee_utxo`,根因就是"选择器要求单枚 ≥ 1.0 KAS、按 cap 预筛";1463/1464 改成"按真实构造逐个试"。传 cap 会复活它,传 `0n` 对。额外核 relay facts 列表形态(`utxo-facts.mjs`):过滤(min/max)→**面值降序**→(txid,index)全序→截断 200,即**保留最大的 200 条**。所以 `minAmount=0` 不会让 dust 挤占窗口(dust 在尾部先被截掉);`maxAmount=1 KAS` 仍在。`parseBound` 接受 `"0"`。结算路径 `feeMin=cap` 的同向风险 J2 只报不改——同意(且 1464 记了"种子面值只够 genesis + 1 笔下注",池子很小,见 M2)。
**② 进程级 + DB 派生是否 Codex 的超集 —— 目前【不是】,有四处更弱/未定义,见下 M1–M3(F4)。** 方向(两层、复用 E5/E6)对,稿子缺规格。
**③ relay 侧 pending-spent 备选不先做 —— 同意。** J2 的理由成立(60s TTL 与 prepared 存活到落链不匹配;改 `get_address_utxos` 旧路径字节契约)。补一条:relay 侧不知 console 的预留,`saturated` 诊断会失真。

## MUST(补进设计稿 v0.2;不改方向)

**M1(F4)——check-and-reserve 必须是共享选择函数内的一步同步操作,且调用方枚举漏了 HTTP 入口。**
- 稿子 E8 只列两个 driver 的 tick。实际会并发进入同一个 relay UTXO 池的还有 **HTTP 处理器**:`api/proto.js:196`(创建市场的立即创世)与 `:299`(下注的立即 append),它们经 `driveMarketGenesis`/`driveBetIntent` 直接调 `buildMarketGenesisAndBroadcast`/`buildRegisterAppendAndBroadcast`,与 driver tick 及彼此都不是单飞。A 臂那种冲突不只发生在"两个 driver 交错"。
- 取数是 `await`(IPC),返回即过期;预留检查必须在**最后一个 await 之后、选中之前**同步做,并在同一同步段里把所选 outpoint 记入预留集(否则两个调用方各自取到同一份列表,先后选中同一个)。稿 §3.2 写"选中之后加入"但没写"检查与加入原子"。
- 因此预留不能散在"三条路径的接线"里(漏一处 = 该处无保护):把 check+reserve 收进**一个**函数(如 `selectAndReserveFeeUtxo`,包住 E3),所有调用点(`proto-broadcast-ops.mjs:83/:231`、`proto-settlement-ops.mjs:130`,以及经由它们的 HTTP 入口)只走它;并加与 `R-FEE-CANDIDATE-SHARED` 并列的 lint:`selectFeeUtxoByConstruction(` 除包装函数外出现即失败。
- 测试:T-race-interleave 要有一条**HTTP 入口 × driver tick** 的形状(两个 promise 在 `sendCmd` await 点交错),不能只有 driver × driver。

**M2(F4)——内存预留层对"结果不确定"的释放规则缺失;稿只写了"确定性失败时移除"。**
- 该层在选中时加、在"prepared 落库"或"确定性失败"时减。**IPC 超时**(console 15s,relay 可能仍在处理并随后写 prepared+广播)既不是确定性失败也不是 prepared:立刻释放 ⇒ 窗口重开(relay 晚到的 prepared 与后来者选同一 UTXO);永不释放 ⇒ 泄漏,直到重启。种子池只有个位数 UTXO(1464:0.5/0.5/0.95 KAS;simnet 4×0.99),几次泄漏就整池死锁,恰好把 F4 从"防双花"变成"制造活性故障"。
- 需要规格:不确定结果 ⇒ **保持预留 + 有界期限**(如 ≥ 2×IPC 超时),到期先**对账**(该 intent 的 DB 行是否已有 prepared 字节;relay `get_mempool_entry`/`check_utxo_landed` 该 txid)再释放或转由 DB 层持有;并加**泄漏遥测**(预留数/最老预留年龄超阈值 ⇒ 报警),测试覆盖"超时后:relay 晚到写 prepared / relay 从未写"两种结局。
- 附:F1 frozen HOLD 行的输入"应释放"我不阻塞,但释放条件建议改为"该 prepared 已不可能落链"(如其非 fee 输入 RootClose 已被 refund_flip 花掉,即既有 `inputs_spent` 语义),而不是"看到 last_error 标记就释放"——F1b 的残余窗口里那笔字节可能已在 mempool,提前释放会复现 A 臂的 `inputs_spent` 冲突(非灾难,是活性)。SHOULD。

**M3(F4)——DB 派生层遇到解析不了的行必须 fail-closed,稿未写。**
- 派生 = 对非终态行反序列化 `prepared_tx_json` 取输入并集。若某行字节缺失(`prepared_without_bytes`)、JSON 损坏或反序列化抛错,"跳过该行"= 该行占用的 UTXO 不受保护 = 安全层静默失效。规格须写:**任一非终态 prepared/submitted/ambiguous 行不可解析 ⇒ 本次选择 HOLD(报警),不选、不跳过**;测试:注入一行坏字节 ⇒ 选择 HOLD;突变:把"HOLD"改成"跳过"⇒ 该测试红。
- 同层补一句:E5 语义是"在途意图**产出**",现要并入"在途意图**所花输入**"——两个集合合一进同一个参数可以,但 `skippedInflight` 计数会混,遥测里建议分开标。

**M4(F3)——parity 测试的对象必须先定义,否则与 ① 自相矛盾。**
- 稿 §3.3 要求"四条路径喂同一份向量,选集逐向量一致"。但按 ①,结算路径 `feeMin=cap`、创世/下注 `feeMin=0n`,面值带不同——同一向量(如面值 0.3 KAS 的普通 UTXO)在两条路径上**本来就该得到不同的选集**。要么测试永远红,要么有人为了让它绿把 feeMin 拉齐——后者正是复活 1462。
- 规格须写:parity 只对**安全资格维度**要求逐向量一致(covenant 绑定 / spk 版本 / spk≠relay / unknown facts 缺字段 / 被预留 / 被 relay 拒过 / 超 `SIGNED_INPUT_CEILING`);**面值下界 feeMin 作为向量表里每条路径显式声明的参数**,不参与"一致"判定。弱注入臂(改 `covenantId` 一个字段)对所有路径必须同时剔除该 UTXO——这条保留。

## 非 MUST(记录,不阻塞)
- 稿 §3.1(1)"放哪个文件待 NWT 审定":放 `proto-tx-assembly.mjs` 或保留在 `c1.mjs` 均可;约束 = 纯函数、不 import DB 客户端(M0a 门)、无循环依赖、既有 45 项 `c1` 测试不动。不另起意见。
- 稿 E8/§3.2 与本审 M1 一致的一点:`submit_intents`(第四张意图表,`lib/submit-intent.mjs`,bettor 的 escrow/transfer)花的是 `b.maker_relay_id` 的 UTXO,**不是** PROTO_RELAY_ID——目前不进派生集是对的;若日后 proto relay 也走 `transferWithIntent`,须并入(UNVERIFIED:我没核两类 relay id 在运营上是否永不重合,请 J2 在 v0.2 写一句"已确认"或加入)。
- 已知残余(pre-existing,非本稿引入):毒化 covenant UTXO 若以 ≤1 KAS 面值占满 facts 窗口 200 条,会 `saturated` ⇒ 无候选(活性 DoS)。F3-b 会把这条**从结算路径扩到创世/下注**(此前它们静默收下毒化候选,现在是 fail-closed HOLD)——这是正确方向,但值得在 F3-b 批说明里写明"新增了一种创世/下注的 HOLD 原因"。
- 拒后跳选(取舍 B,进程内 LRU)——同意;补一点:拒绝码若是构造层普遍缺陷(所有候选都会被拒),LRU 会把全部候选拉黑 ⇒ 全 HOLD 直到重启;fail-safe 方向,只需在遥测里可见。
- 分批(F3-a → F3-b[钱路,须 Owner 批] → F4 → F3-c)同意。F4 的"结算 `inflightOutpoints` 由恒空变非空"要在 F4 批说明里单列(行为变化)。

## 我没验证的(UNVERIFIED)
- A/D 创世 `net_loss_exceeded` 的根因(稿 §3.1(5) 已自标);毒化 UTXO 被普通 split 花的共识行为(V1c,已排后)。
- 派生成本(三表非终态行扫描 + 反序列化)未测量,稿已自标。
