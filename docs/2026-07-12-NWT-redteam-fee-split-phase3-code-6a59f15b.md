# NWT 红队 — B线落3 落码 diff 审(6a59f15b)

> **Status**: CURRENT
> **对象**: commit 6a59f15b(packages/fee-split/ 独立目录+notify.mjs+sync.mjs+lint 新规则)
> **verdict**: **GREEN——G1/G2 均实落且独立验证通过,49 断言+2 demo 我亲跑全绿**

---

## G1(sync drift 哨兵)独立验证 CONFIRMED

`R-FEE-SPLIT-PKG-DRIFT`(lint-kanet.mjs:106-121)用**真实字节比较**(剥生成头后 `stripped !== src` 直接比对,非 hash 比较——更严格,commit message 说"hash 校验"是术语不准但机制本身更强)、`violate()` = ERROR 硬阻塞(非 `warn()`)。

**我独立三态复现**(亲跑非信 J2 claim):正常态 lint exit 0 → 人工 append 一行 drift → lint exit 1(阻塞)→ 恢复原文件 → lint exit 0。三态全部命中预期,机制真实工作,不是摆设。

## G2(landed 前提警示)实落 CONFIRMED

notify.mjs 文件头(12-17 行)+ `matchLandedFeeOutputs` JSDoc(22 行)均含"outputs 必须调用方已确认终审,禁止直喂 mempool-accepted"警示,语气够重(🔴标记+"garbage-in-garbage-out"直白说明+引用 KANet 自己的事故教训)。README 我读过含同款"landed 前提"章节。三处一致,非只改一处漏改另一处。

## Bettor 注1-4 独立核实

- **注3(amount 断言+output 唯一性)**:`matchLandedFeeOutputs` 逐行读过——`amountMatches` 断言产出三态(matched/mismatch/unmatched,56-63 行),`claimed` Set 防同 output 被两个 leaf 重复认领(44/51/62 行)。
- **注2(at-most-once 诚实契约)**:`emitLandedNotification` JSDoc(71-74 行)明确写"给定一次调用内的 at-most-once,跨调用恰好一次靠调用方持久化 idempotencyKey",没有 overclaim exactly-once。

## 独立跑测(不信"49 断言全绿"的自证,亲自执行)

- `node scripts/lint-kanet.mjs packages/fee-split/fee-split.mjs` → 0 errors ✅
- `node examples/prediction-demo.mjs` → 跑通,展示 prediction-v1-interim 规则+分账结果
- `node examples/ecommerce-demo.mjs` → 跑通,Σ payoutLeaves=500000000 == 订单额 500000000 精确守恒(4 角色: seller/platform/affiliate/inspector,证"行业无关"非空话——不是 prediction 的重新包装,角色名/bps 结构完全不同)
- `node notify.test.mjs` → 8/8 断言绿(mismatch 三态/output 去重/未落地角色/emit 契约/接口误用防线全覆盖)

零 KANet 路径依赖确认:两个 demo 在 `packages/fee-split/` 目录内独立跑通,未 import 任何 `kasia-console/` 路径(除 sync.mjs 本身,但那是构建脚本非运行时代码)。

## 结论

G1/G2 均从"设计承诺"变成"我亲手验证过的机制",三态测试+文档警示+demo 运行+单测全部独立复现。这轮落码质量高,DoD 分级合理(broker-fee-emit.mjs 真正切换留 non-blocking,不动 live 路径)。**GREEN,可视为落码闭合**。冷启动计时验收(Bettor 主跑+我第二位)是最后一步,不影响本 verdict。

— NWT 2026-07-12
