> **Status**: SUPERSEDED(2026-09-22 · J2)——见文末"状态更新"。本文档原描述"refund_flip 不叠本批,留一笔接线 PR"的方案;账本1623/1624(NWT 实现审 ab624474)裁定"rebase 到含 R-a 的主线,争用测试在本批做掉",**已照办**——下面的坐标核实与"自动继承"结论依然成立(未改),但"接线 PR 只剩测试"这一步已经不是待办,是本批已交付的内容。

# F3/F4 → refund_flip 接线清单(账本1621/1622 追问,Bettor 裁定三条;账本1623/1624 更新)

> 本批(F3/F4 实现,分支 `coord/j2-f3-f4-impl-20260922`)**基线更新**:最初从 `bshard-m3-deploy` @ `3691b19b` 起(R-a **未**叠加,Bettor 早先裁定"R-a 在审,可能有 MUST 改动,叠上去会互相牵连")。R-a(`refund_flip`)于账本1622 合入主线(`97939a6f`);NWT 实现审(ab624474,账本1623/1624)裁定改为 **rebase 到含 R-a 的主线**,理由:R-a 已经过 NWT 增量核三点全过、批已闭合,不再是"可能变"的状态,继续隔离反而让"接线 PR 只剩测试"这句话一直是空头支票。本批已 rebase 到 `origin/bshard-m3-deploy`(含 R-a),`refund_flip` 现在真实存在于这个分支上。

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

## 接线 PR 到底剩什么(已在本批完成,不再是"待办")

代码接线是自动的:rebase 到含 R-a 的主线后,`git rebase` 只在 `proto-settlement-ops.mjs`(import 段)和 `proto-settlement-driver.mjs`(deps 装配段)产生两处文本冲突,人工合并即可,不是逻辑重新设计——冲突详情见批提交 `87f1a467`(rebase 前)→本批最终 hash(rebase 后)的过程记录。

**§3.5 T-race 系列里"refund_flip 跨入口真实争用"这一条已在本批真实跑通**(`proto-settlement-ops.test.mjs` 新增"F4 真实争用①/②"两个测试,`Promise.all` 真并发):

1. **争用①(结算内)**:`refund_flip`(Y 市场,冻结+过 grace)与 `seal`(X 市场)用 `driver.advanceStep` 真并发,候选池只留一枚"唯一最佳"候选 ⇒ 核心不变量(全部真实广播的交易互不重叠花费同一个 outpoint)成立;不钉"哪一方赢"(构造成功一方的找零输出会给另一方腾出新候选,双方都成功是合法结局)。
2. **争用②(创世跨入口)**:`refund_flip`(Y2)与创世(`buildMarketGenesisAndBroadcast`,Z 市场,真实生产函数)真并发,同一不变量成立。下注侧因为与创世共用同一段 `fetchFeeCandidates`+`selectAndReserveFeeUtxo` 代码(已在 `proto-broadcast-ops.test.mjs` F3b-1/F3b-4 分别验证过安全属性),不重复起第四个并发臂——这是范围裁剪,不是遗漏。
3. **回归**:M3 fail-closed 对 `refund_flip` 产生的 `prepared_tx_json`(同一张 `proto_settlement_intents` 表)同样成立,不需要新代码(已由既有 `proto-fee-reservation.test.mjs` 的通用 M3 测试覆盖,`refund_flip` 与其它 step 在这条路径上没有特殊性)。

**本批范围声明**:除了两处 rebase 冲突合并(纯文本合并,无新逻辑)+ MUST-1/MUST-2 修复(见 provenance README §6),`refund_flip` 侧**零新增生产代码**——它确实是"自动继承"。

## 依赖前提(如果不成立,以上结论要重新核)

- `proto-settlement-ops.mjs` 的 `build()` 继续保持"全部 step 共用一个 `tryEach`"这个结构不被拆分成每 step 各自选择——这是本清单结论成立的唯一前提。若日后有人把某个 step(含 `refund_flip`)的 fee 选择挪出这个共用闭包(比如给 `refund_flip` 单独加一条"不走预留、直接选"的快捷路径),必须同步更新本清单并给该 step 补 F4 接线。
- `driver-core.mjs` 的 `advanceStep` 继续在 `build()` 返回后、`covenant_broadcast` 尝试结束时调用释放端口(MUST-2 修复后按结果分两支:确定回执 ⇒ `deps.releaseFeeReservation`;`sendCmd` 本身抛错 ⇒ `deps.deferReservationReconciliation`,见 `proto-settlement-driver-core.mjs`)——这段没有按 step 区分,`refund_flip` 自动适用。

## 本批(F3/F4)已知限制,供接线 PR 参照

- ~~创世/下注的 DB 派生层本批留空~~ ——**撤回(账本1623/1624,NWT 用真实探针复核后判定原结论错误)**:`proto_markets.genesis_prepared_tx_json` / `proto_bet_intents.prepared_tx_json` 在生产路径下**确实会被写入**(真实调用方在 `kasia-relay` 包,不在 `kasia-console/src`,此前 grep 范围本身就错了——细节见 provenance README §6 MUST-1)。三张表(含 `refund_flip` 所在的 `proto_settlement_intents`)现在**统一**在 `reservedFeeOutpoints` 的 DB 派生层里生效,不再区分"结算受保护/创世下注不受保护"。
- **F3 的"拒后跳选"(`rejectedOutpoints` LRU)本批未做**——design v0.2.1 §3.1 item 5,Bettor 精简指令未包含,列后续观察票。
- **relay 侧 split 的 covenant 排除(F3-c)本批未做**——design v0.2.1 §3.4 已注明单独审,不在本批范围。
