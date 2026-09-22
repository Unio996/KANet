# F3/F4 批说明 + 交件证据:fee 候选资格函数(F3)+ fee 输入预留(F4)(J2 · 2026-09-22)

> 设计:`docs/2026-09-21-j2-f3-f4-fee-candidate-eligibility-and-reservation-design-v0.2.1.md`(NWT 两轮 PASS)。
> 范围(Bettor 裁定,账本1621/1622 追问后精简/确认):**F3 = 共用资格函数 + 创世/下注接 facts 候选**;**F4 = selectAndReserveFeeUtxo 同步段现读 DB 派生预留集,三路径(结算/创世/下注)真接**;**refund_flip 不叠本批**(见 `docs/2026-09-22-j2-f3-f4-refund-flip-migration-checklist.md`——已核实自动继承,只差一笔测试 PR);F3 的"拒后跳选"、relay split(F3-c)不在本批。
> 分支 `coord/j2-f3-f4-impl-20260922`,基线 `bshard-m3-deploy@3691b19b`(不叠 R-a)。只合不部署。

## 1. 改了什么

| 层 | 文件 | 改动 |
|---|---|---|
| F3-a 资格函数 | `proto-tx-assembly.mjs` | `filterFeeCandidates` 从 `proto-settlement-c1.mjs` 挪来(三路径共用同一文件,无新依赖边);新增 `skippedUnknown` 分类(条目缺 `covenantId`/`scriptPublicKey.version`/`scriptHex` 或类型非法 ⇒ fail-closed 跳过,与 `skippedPoisoned` 分开计数) |
| | `proto-settlement-c1.mjs` | 改 `import + export`(不是纯 `export...from`,`verifyCore` 内部仍要用本地绑定)保持既有 45 项测试/import 路径不变 |
| F3-b 创世/下注接 facts | `proto-broadcast-ops.mjs` | 新 `fetchFeeCandidates`(facts 形态 L,`minAmount=0`——账本1462 取舍 A,+ `assertFactsResponse` fail-closed 校验 + `filterFeeCandidates`)取代旧 `toFeeUtxoCandidates`(**已删除**,无任何过滤的裸映射) |
| 出口静态闸 | `scripts/lint-kanet.mjs` | `R-FEE-CANDIDATE-SHARED`[ERROR]:`toFeeUtxoCandidates` 禁复发 + `filterFeeCandidates` 禁分叉实现;`R-FEE-SELECT-ONLY-VIA-WRAPPER`[ERROR]:`selectFeeUtxoByConstruction(` 只准被 F4 的包装函数调用 |
| F4 预留 | `proto-fee-reservation.mjs`(新文件) | DB 派生层 `reservedFeeOutpoints({db})`(M3 fail-closed:非终态行缺字节/JSON 损坏 ⇒ 整体抛,不跳过)+ 进程内"已选未落库"层(`selectAndReserveFeeUtxo` 原子选择并预留 + `releaseReservationOnPrepared/Failure` + `reconcileUncertainReservation` + `reservationLeakTelemetry`) |
| | `proto-settlement-ops.mjs` | `build()` 唯一的选择点(全部 step 共用一个 `tryEach`)换 `selectAndReserveFeeUtxo`;`intentKey` 由调用方传入(不在此重算 driver-step→intent-step 映射——曾经的一个真实 bug,见 §3) |
| | `proto-settlement-driver-core.mjs` | `advanceStep` 里 `build()`→`covenant_broadcast` 包一层 `try/finally`,广播尝试结束(成功/失败都算)后释放 `deps.releaseFeeReservation` |
| | `proto-settlement-driver.mjs` | 装配 `releaseFeeReservation: releaseReservationOnPrepared` |
| | `proto-broadcast-ops.mjs` | 创世/下注两个 call site 同样换 `selectAndReserveFeeUtxo` + `try/finally` 释放(这两个函数自己做广播,窗口比结算路径简单:选中→广播完成即释放) |

## 2. 离线验证(`green/*.txt`,9 个相关套件全 exit=0,合计 185 项断言)
- 既有套件回归:`proto-broadcast-ops`(20,含 F3b-1/2/3/4 四条**安全回归**——旧路径对毒化 covenant UTXO / 缺字段 unknown 条目零过滤,新路径在真实构造前就排除,创世侧 F3b-1、下注侧 F3b-4 各自验证)、`proto-tx-assembly`(40,含 F3-unknown-1~7 七条 + 一条说明性突变对照)、`proto-settlement-c1`(45,零改动,证明 F3-a 的挪动不改变行为)、`proto-settlement-ops`(6)、`proto-settlement-driver-core`(31)、`proto-driver`(8)、`proto-settlement-driver`(11)、`proto-tx-assembly-settlement`(44,无关但受同批影响的建造器套件,确认未被波及)。
- 新增:`proto-fee-reservation.test.mjs`(24 项):
  - DB 派生层:`prepared`/`submitted`/`ambiguous` 贡献 outpoint,`pending`/`landed` 不贡献;
  - M3 fail-closed:缺字节/JSON 损坏/缺 `inputs` 数组 ⇒ **整体抛**(不是跳过该行);混合一坏一好场景验证不是"挑好的返回";
  - `selectAndReserveFeeUtxo`:T-race-sequential(同一同步段内先选中的候选,第二次调用立即被排除,不需要等 DB 写入)+ DB 层已占候选同样被排除 + 选择失败无副作用(不留预留残留);
  - `reconcileUncertainReservation`:两种结局(移交 DB 层 / 释放)都正确从内存层移除;
  - `reservationLeakTelemetry`:count / oldestAge。

## 3. 一个真实撞到的设计假设错误(如实记录,不是猜测)

写 `proto-fee-reservation.mjs` 时,`SOURCES` 最初按设计文档 E6 表(§1)包含 `proto_markets.genesis_prepared_tx_json` 与 `proto_bet_intents.prepared_tx_json`,理由是"这两列已经把在途字节存进去了"。**接上真实测试后,`proto-broadcast-ops.test.mjs` 的 F3b-4、⑫号既有测试、`proto-driver.test.mjs` 的 ⑦号测试全部真实撞上 fail-closed HOLD**:
- `proto_markets.genesis_prepared_tx_json` 这一列在当前生产代码里**从未被写入过**——唯一会写它的函数 `recordMarketIntentPhase` 全仓零生产调用点(只有一句"buildAndBroadcast 内部应当在广播前调"的头注,从未真正接线)。
- `proto_bet_intents.prepared_tx_json` 同样——`recordBetIntentPhase` 有真实调用点(`src/api/ingest.js:99`),但那是一条**独立的** HTTP 回调路径,`register_append` 的真实生产流程(`driveBetIntent`)走的是自己内部的 `markBetIntent` 调用(只带 `status`+`submitted_txid`),完全不经过 `recordBetIntentPhase`。

这不是"防止安全层失效"的正确 fail-closed,是把 DB 派生层对**三条路径**的读取全部拖死(`reservedFeeOutpoints` 一处抛错,创世/下注/结算的选择全部 HOLD——因为该函数扫描全部三张源表,一张的坏行会让整个函数抛错)。**已从 `SOURCES` 移除这两个源**,`proto-fee-reservation.mjs` 头注留了完整的实测记录 + 恢复方法(哪天有人把这两个写入路径真正接上生产调用点,把对应条目加回数组即可,不需要改其它代码)。创世/下注在本批的并发保护**只靠进程内"已选未落库"层**——这层的窗口(选中到这次广播尝试结束)恰好覆盖 A 臂原始死锁场景(同 tick 顺序两笔创世竞争同一 UTXO),DB 层缺的是"跨进程重启"这一段,留作后续(前提是先把两条写入路径接上)。

**结算路径不受此限制**——`proto_settlement_intents.prepared_tx_json` 由 F1 设计本来就要求先于广播落库(31 项 driver-core 测试 + 6 项 settlement-ops 测试实测确认可靠),DB 派生层对结算路径(含未来的 `refund_flip`,见迁移清单)是真实生效的。

## 4. 一个真实撞到的接线 bug(如实记录)

`proto-settlement-ops.mjs` 的 `build()` 最初内部调用 `settlementIntentKeyFor(claimStep ? 'claim' : 'market', subjectId, step)` 来算 F4 的 `intentKey`,`proto-settlement-ops.test.mjs` 的 E2E-2/E2E-3 立刻真实撞错:`settlementIntentKeyFor: unknown step close_commit`。根因:driver-step 名(`close_commit`)与 intent-step 名(`resolve`)不是同一套词汇——这个映射(`STEP_INTENT`)只存在于 `proto-settlement-driver-core.mjs`,在 `ops.build()` 里重算等于维护第二份可能漂移的映射。**修法**:`intentKey` 改由调用方(`driver-core.mjs` 的 `advanceStep`,那里已经算过一次 `key = keyOf(step, subjectId)`)通过 `ctx.intentKey` 传入,`ops.build()` 不再自己算。

## 5. 已知限制 / 非本批范围
- **refund_flip 不在本批**(Bettor 裁定,R-a 在审避免互相牵连):已核实并写入迁移清单——`build()` 的选择点对全部 step(含 `refund_flip`)共用同一个 `tryEach` 闭包,F4 合入后 `refund_flip` **自动继承**两层预留,接线 PR 只剩"三路径 vs refund_flip 真实争用测试"。**更新(见 §6):rebase 到 R-a 合入后的主线,本批已实测三路径 vs refund_flip 的真实争用,迁移清单相应更新。**
- **F3 的"拒后跳选"(`rejectedOutpoints` LRU,design §3.1 item 5)未做**——Bettor 精简指令未包含,原设计文档已把它标为"治活性不治安全"的独立观察票。
- **relay 侧 split 的 covenant 排除(F3-c,design §3.4)未做**——design 本来就要求单独审(relay 是钱路)。

## 6. NWT 实现审(ab624474)2 条 MUST + rebase 后追加的争用测试(2026-09-22 同批修完)

**分支已 rebase 到 `origin/bshard-m3-deploy`(含 R-a,f2f56815)之上**,`refund_flip` 现在真实存在于这个分支——迁移清单里"接线 PR 只剩争用测试"这一步**在本批做掉**,不再留给下一笔:新增 `proto-settlement-ops.test.mjs` 的"F4 真实争用①/②"两个测试,用 `Promise.all` 真并发(`driver.advanceStep` 跑真 `ops.build`、`buildMarketGenesisAndBroadcast` 是创世的真实生产函数),验证 `refund_flip` 与 `seal`(结算内)、`refund_flip` 与创世(跨入口)争同一个"唯一最佳候选"时,该候选**最多被一笔真实广播的交易花掉**(核心不变量:全部广播互不重叠花费同一个 outpoint,不钉"哪一方赢"或"总共几笔成功"——构造成功一方若产生找零输出会给另一方腾出新候选,双方都成功是合法结局)。下注侧因为与创世共用同一段 `fetchFeeCandidates`+`selectAndReserveFeeUtxo` 代码(`proto-broadcast-ops.mjs` 两个调用点结构相同,已在 F3b-1/F3b-4 分别验证过),不重复起第四个并发臂。

**MUST-1(撤回更正,不是补丁——原判定错误)**:原 §3 说 `proto_markets.genesis_prepared_tx_json`/`proto_bet_intents.prepared_tx_json` 生产路径下从未写入,依据是 `grep kasia-console/src` 找不到 `recordMarketIntentPhase`/`recordBetIntentPhase` 的生产调用点——**这个 grep 范围本身就错了**:真正的调用方在 `kasia-relay` 包(另一个代码库子目录)。NWT 用真实探针复核(真 fastify + 真 ingest 路由 + 真 relay 广播代码,只 mock wasm/rpc):genesis_pending 市场走一次 relay fresh-path,genesis_prepared_tx_json 真实被写入(len=428),到 genesis_submitted 后仍非空——已直接读源码验证:`kasia-relay/src/lib/covenant-broadcast-relay.mjs:189` 对全部三种 intent_key 前缀在真实广播【之前】无条件调用 `ingestPhase({phase:'prepared',...})`,console 侧 `api/ingest.js` 按前缀分派。此前 `proto-broadcast-ops.test.mjs`/`proto-driver.test.mjs` 撞到的 fail-closed HOLD,根因是那些测试的手写 stub 没有模拟这个回调,不是生产代码有缺口。**修复**:`SOURCES` 加回 `proto_markets`(`genesis_prepared`/`genesis_submitted`/`genesis_ambiguous`)+ `proto_bet_intents`(`prepared`/`submitted`/`ambiguous`);对应测试文件补 `simulateIngestPrepared` helper 真实调用 `recordMarketIntentPhase`/`recordBetIntentPhase`,并把此前互相独立、共用固定候选 txid 的测试场景改成各自换新 txid(候选复用假设在 F4 之前无害,接上真实跨市场预留后不再成立)。**过程中额外catch 到一个真实 bug**:`extractInputOutpoints` 没处理生产实际存储格式(`JSON.stringify([txJsonString])`,顶层数组包一层字符串,不是顶层直接 `{inputs:[...]}` )——这个 bug 会让 `reservedFeeOutpoints` 对**任何**真实 prepared 行 fail-closed HOLD,已修复(兼容双格式)并补 4 条回归测试锁定(`proto-fee-reservation.test.mjs` ⑦)。

**MUST-2(生产零调用点)**:`reconcileUncertainReservation` 此前只有定义、`git grep` 命中不到任何生产调用点——三个真实调用点(`driver-core.mjs` 的 `advanceStep`、`proto-broadcast-ops.mjs` 的两个 `buildXAndBroadcast`)的 `finally` 无条件释放,不区分"relay 明确拒绝"(有回执,只是 `ok:false`)与"IPC 超时/无响应"(sendCmd 本身抛错,结果不确定)。**修复**:拆开两支——① 确定结果(`sendCmd` 正常 resolve,不论 `ok` 是 true 还是 false)⇒ 立即 `releaseReservationOnPrepared`;② 不确定结果(`sendCmd` 本身抛错)⇒ **不释放**,改调新增的 `deferReservationReconciliation(feeUtxo, checkPreparedInDb, timeoutMs, scheduler)`(默认 `setTimeout` + `RESERVATION_UNCERTAIN_TIMEOUT_MS`),到期才调 `reconcileUncertainReservation` 决定移交 DB 层或释放。创世/下注两个调用点新增 `checkIntentPreparedInDb`-等价的闭包(直接查 `getMarketRow`/`getBetIntent` 的 bytes 列);结算路径新增 `deps.checkIntentPreparedInDb` 端口(查 `SI.getSettlementIntent(key).prepared_tx_json`)。**测试**:`proto-fee-reservation.test.mjs` ⑧(6 条,原语级:defer 本身不释放、到期对账两种结局)+ `proto-broadcast-ops.test.mjs` 新增 2 条(创世/下注侧集成级,真实验证 `sendCmd` 抛错后 outpoint 仍在 `_inMemoryReserved`)+ `proto-settlement-driver-core.test.mjs` 新增 5 条(结算侧集成级,用 `mkWorld` 的 `releaseFeeReservationCalls`/`deferReservationReconciliationCalls` 记录调用,区分"成功释放"/"明确拒绝释放"/"抛错改调 defer"三条分支 + `checkIntentPreparedInDb` 端口透传 + 端口缺失不影响主流程)。

**顺手改(SHOULD,Owner D-031 追问核出,账本1624)**:`REFUND_FLIP_GRACE_MS`(`proto-close-commit-gate.mjs`)改为从 `pool-refund-grace.mjs` 的 `REFUND_GRACE_SEC` 导入(`*1000`),不留两份字面"7200秒/2小时"——老自动退款路(`services/bettor-refund-claim-auto.mjs` 等)与 R-a 的 refund_flip 数值上一致,不再各自维护。数值不变(7,200,000ms),7 项既有测试零改动通过。
