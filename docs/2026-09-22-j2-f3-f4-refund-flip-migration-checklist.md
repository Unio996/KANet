> **Status**: CURRENT(2026-09-22 · J2)

# F3/F4 → refund_flip 接线清单(账本1621/1622 追问,Bettor 裁定三条)

> 本批(F3/F4 实现,分支 `coord/j2-f3-f4-impl-20260922`)基线 = `bshard-m3-deploy` @ `3691b19b`(R-a **未**叠加,Bettor 裁定:"R-a 在审,可能有 MUST 改动,叠上去会互相牵连")。R-a(`refund_flip`)已于账本1622 合入主线(`97939a6f`→之后的 merge)。本文档钉住:F3/F4 合入后,`refund_flip` 的 fee 输入是否自动继承 F4 的两层预留,还是需要一笔额外接线 PR;以及接线 PR 的验收线是什么。

## 结论(已核实,不是推断)

**是,自动继承。** 结算路径(`proto-settlement-ops.mjs` 的 `build(step, ctx)`)对**全部** step——`seal`、`close_commit`、`convert_to_claim`、`claim_draw`,以及 R-a 加入的 `refund_flip`——共用**同一个** `tryEach` 闭包来做 fee 选择,不是每个 step 各自调一次 `selectFeeUtxoByConstruction`。

```js
// proto-settlement-ops.mjs, build(step, ctx) 内部, 全部 step 共用:
const tryEach = (make) => selectFeeUtxoByConstruction(feeCandidates, (u) => make(u, withFeeParent(chainParents, u)));
...
} else if (step === 'refund_flip') {
  const s = sealedStateOf(db, marketId, m);
  const rc = rootCloseArtifact(m, marketId, OPEN_ROOTCLOSE(s));
  built = tryEach((feeUtxo, parents) => buildRefundFlipTxJson({ ... })).built;
}
```

**核实坐标**(两处都读过,行号一致,证明 F4 落地前后这个共用结构没变):
- 主线(F4 前,无 refund_flip):`kasia-console/src/lib/proto-settlement-ops.mjs:130`(`coord/j2-f3-f4-impl-20260922` 分支起点 `3691b19b`)
- R-a 合入后(有 refund_flip,`scratch/_j2_wt_ra_must1` 工作树,基线 `97939a6f`):`kasia-console/src/lib/proto-settlement-ops.mjs:136`(`const tryEach = (make) => selectFeeUtxoByConstruction(feeCandidates, (u) => make(u, withFeeParent(chainParents, u)));`,`refund_flip` 分支在其后用同一个 `tryEach`)

F4 本批把这唯一的 `tryEach` 换成 `selectAndReserveFeeUtxo`(见 §1),`intentKey` 由调用方(`driver-core.mjs` 的 `advanceStep`)传入而不是在 `ops.build()` 内重算(driver-step 名如 `close_commit` 与 intent-step 名如 `resolve` 不是同一套词汇,`refund_flip` 两边同名不受影响)。

**⇒ R-a 合入 F4 之后的这条主线,`refund_flip` 的 fee 选择自动走 `selectAndReserveFeeUtxo`,不需要在 `refund_flip` 分支里加任何一行代码。**

## 接线 PR 到底剩什么

代码接线是自动的(两个分支合并 = 直接生效,git merge 层面通常零冲突,因为 F4 改的是 `tryEach` 定义和 `build()` 的开头/结尾,R-a 改的是中间加一个 `else if` 分支——除非合并顺序导致 R-a 分支恰好在 F4 改动的那几行附近产生文本冲突,人工合一次即可,不是逻辑重新设计)。

**真正要做的是 §3.5 T-race 系列测试里唯一一条本批没能跑的**(因为本批基线不含 `refund_flip` 代码,测不了一个不存在的 step):

> **接线 PR 的验收线(Bettor 裁定原话)= refund_flip 与创世/下注/结算跨入口争同一最佳 fee UTXO 的真实争用测试。**

具体清单(合并后跑,`kasia-console/src/lib/proto-fee-reservation.test.mjs` 或新增一个 `proto-fee-reservation-refund-flip.test.mjs`):

1. **T-race `refund_flip` × 结算(`close_commit`/`seal`)**:两个不同市场,一个走 `refund_flip`(冻结市场自然出口),一个走 `close_commit`,DB 里各自造一行 `prepared` 的 `proto_settlement_intents`(同 `reservedFeeOutpoints` 的 DB 派生层),两者的 `feeCandidates` 里含同一个 outpoint ⇒ 后到者必须另选或 `no_suitable_fee_utxo`,不得双花候选。
2. **T-race `refund_flip` × 创世/下注**:`refund_flip` 走结算路径的进程内层(在 `driver-core.mjs` 的 `advanceStep` 里,`build()` 返回后到 `covenant_broadcast` 完成才释放,见本批 §2);创世/下注各自在 `proto-broadcast-ops.mjs` 里有自己的进程内预留(`buildMarketGenesisAndBroadcast`/`buildRegisterAppendAndBroadcast` 的 `selectAndReserveFeeUtxo` + `finally` 释放)。三者共用**同一个模块级 `_inMemoryReserved` Map**(`proto-fee-reservation.mjs` 是单例模块,进程内只有一份),所以这条测试要证的是:三条路径的 `intentKey` 不同、但选中同一个 outpoint 时互斥生效——用一个真实 Node 进程内、三个"伪装成不同调用方"的 `selectAndReserveFeeUtxo` 调用序列即可复现,不需要额外接线。
3. **回归**:本批 §2(`proto-fee-reservation.test.mjs`)的 M3 fail-closed(非终态行缺字节/损坏 tx_json ⇒ 抛)在合入后对 `refund_flip` 产生的 `prepared_tx_json` 同样成立(它走同一张 `proto_settlement_intents` 表,同一个 DB 派生层查询,不需要新代码,但值得补一条真实 vector:一行 `step='refund_flip'` 的 `prepared` 记录,`prepared_tx_json` 损坏 ⇒ `reservedFeeOutpoints` 整体抛)。

**接线 PR 范围声明**:只加上面几条测试(全部是真实集成测试,喂真实 `refund_flip` 意图行/真实 `tryBuild`),**不改生产代码**(除非测试跑出新问题——按 R-a/F3/F4 一路的纪律,撞到就如实记录,不是本清单能提前断言"零改动"的保证)。

## 依赖前提(如果不成立,以上结论要重新核)

- `proto-settlement-ops.mjs` 的 `build()` 继续保持"全部 step 共用一个 `tryEach`"这个结构不被拆分成每 step 各自选择——这是本清单结论成立的唯一前提。若日后有人把某个 step(含 `refund_flip`)的 fee 选择挪出这个共用闭包(比如给 `refund_flip` 单独加一条"不走预留、直接选"的快捷路径),必须同步更新本清单并给该 step 补 F4 接线。
- `driver-core.mjs` 的 `advanceStep` 继续在 `build()` 返回后、`covenant_broadcast` 尝试结束的同一个 `try/finally` 里调 `deps.releaseFeeReservation(built.feeUtxo)`(本批新加,见 `proto-settlement-driver-core.mjs`)——这段没有按 step 区分,`refund_flip` 自动适用。

## 本批(F3/F4)已知限制,供接线 PR 参照

- **创世 / 下注的 DB 派生层本批留空**(见 `proto-fee-reservation.mjs` `SOURCES` 头注的实测更正):`proto_markets.genesis_prepared_tx_json` / `proto_bet_intents.prepared_tx_json` 在当前生产路径下从未真正写入(`recordMarketIntentPhase`/`recordBetIntentPhase` 只在一条独立的 `ingest.js` 回调路径里被调,`driveMarketGenesis`/`driveBetIntent` 的真实生产流程不经过它们)。创世/下注的并发保护本批**只靠进程内层**(选中到广播尝试结束的窗口,已覆盖 A 臂原始死锁场景)。**结算路径(含 `refund_flip`)不受此限制**——`proto_settlement_intents` 的 `prepared_tx_json` 由 F1 设计本来就要求先于广播落库,DB 派生层对结算路径是真实生效的。
- **F3 的"拒后跳选"(`rejectedOutpoints` LRU)本批未做**——design v0.2.1 §3.1 item 5,Bettor 精简指令未包含,列后续观察票。
- **relay 侧 split 的 covenant 排除(F3-c)本批未做**——design v0.2.1 §3.4 已注明单独审,不在本批范围。
