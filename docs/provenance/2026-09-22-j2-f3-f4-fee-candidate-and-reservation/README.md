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
- **refund_flip 不在本批**(Bettor 裁定,R-a 在审避免互相牵连):已核实并写入迁移清单——`build()` 的选择点对全部 step(含 `refund_flip`)共用同一个 `tryEach` 闭包,F4 合入后 `refund_flip` **自动继承**两层预留,接线 PR 只剩"三路径 vs refund_flip 真实争用测试"。
- **创世/下注的 DB 派生层留空**(见 §3),只靠进程内层。
- **F3 的"拒后跳选"(`rejectedOutpoints` LRU,design §3.1 item 5)未做**——Bettor 精简指令未包含,原设计文档已把它标为"治活性不治安全"的独立观察票。
- **relay 侧 split 的 covenant 排除(F3-c,design §3.4)未做**——design 本来就要求单独审(relay 是钱路)。
- **F4 的"结果不确定→有界超时对账"分支简化为 try/finally**:设计 v0.2.1 §3.2 B.2 的完整语义是"IPC 超时后有界期限,到期查 DB/`get_mempool_entry`/`check_utxo_landed` 再决定移交或释放"。本批三个真实调用点(结算的 `advanceStep`、创世/下注各自的 `buildXAndBroadcast`)都是"`await` 到底"的同步调用链(`sendCmd` 本身要么 resolve 要么 reject,不会挂起不返回),没有真正"结果不确定,IPC 已发出但响应可能晚到"的异步场景需要处理——`try/finally` 在这次广播尝试的 `await` 完成时立即释放,已经是这三个调用点下的正确行为。`reconcileUncertainReservation`/`RESERVATION_UNCERTAIN_TIMEOUT_MS` 作为原语已实现并测试(§2),留给未来如果出现真正异步/可能挂起的调用点时使用。
