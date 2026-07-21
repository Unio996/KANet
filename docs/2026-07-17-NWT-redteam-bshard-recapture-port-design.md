# NWT 红队 — recapture 机制移植到 bshard-settle-daemon 设计 v0.1(2026-07-17)

> **Status**: CURRENT
> **对象**: `docs/2026-07-17-bshard-recapture-side-lock-daa-port-design.md`(f7cdfe37, J2)
> **verdict**: **✅ GREEN — Bettor 三重点全部代码级验证, 无洞, 落码即可**

> 时间敏感(Owner 在等结果), 本次审查全程直接读实际代码核实, 不是推理设计稿文字。

## Bettor 三重点逐条验证(读代码坐实, 非信设计稿描述)

**①finality 门实现(过 depth 才回填的判断+reorg 边界)——验证通过, 且跟既有惯例完全一致**: 读了 `pool-market-settler-v06.mjs:93-123` 现有的 `fetchEndBlockHashCanonical`(同文件里既有的 F-S1 finality 门), 边界判断是 `const actualDepth = currentDaa - first.daaScore; if (actualDepth < finalityDepth) throw`。设计稿新加进 `captureSideLockDaa()` 的判断 `if (tipDaa - daa < DEFAULT_FINALITY_DEPTH) return {daa:null,...}` 用的是**逐字一致的比较方向和运算**(`当前-目标 < 阈值 → 拒绝`), 没有引入 `<`/`<=` 这类容易在移植时犯的偏移不一致。`DEFAULT_FINALITY_DEPTH=50` 在 `pool-market-settler-v06.mjs:43` 逐字核实真是模块内 const, 不是编的数字。

**②v0.6 行为变化影响(共享函数改动波及 v0.6 现有盘)——验证通过, 不会崩**: 读了 `captureSideLockDaa` 的现有函数签名文档(`trade-protocol-filter.js:1074` `@returns {daa:number|null, reason:'ok'|'daa-unresolved'|'no-block-hash'|'rpc-fail: ...'}`)——`daa:null` 配不同 `reason` 字符串**本来就是这个函数的既有正常契约**(no-rpc/daa-unresolved/no-block-hash 都已经在返回 null), 新加一个 `not-yet-finality-safe` reason 是往**已有的失败态集合**里加一种, 不是发明新返回形状。进一步读了调用方 `recaptureSideLockDaaForMarket`(`pool-market-settler-v06.mjs:433-438`): `if (cap && cap.daa !== null && cap.daa !== undefined) { upd.run(...); recaptured++; }`——**只判断 `daa` 是否非空, 完全不检查 `reason` 具体是哪个字符串**, 新增的 finality 拒绝值天然落进既有的"这轮没拿到, 留 NULL, 下 tick 再试"路径, 不会因为多了一种 `reason` 而崩溃或走错分支。v0.6 现有盘的行为变化仅限于"极少数刚落链、还没过 50 深度的块这一轮会额外多返回一次 NULL"——不是新风险, 是把 v0.6 自己早就该有但没有的保护补齐, 方向严格收紧不放松。

**③bshard shard 解析正确性 + 幂等(只补 NULL 不覆盖)——验证通过**: `recaptureSideLockDaaForMarket` 内部的 UPDATE 语句(`pool-market-settler-v06.mjs:431`)是 `UPDATE pool_bettor_sides SET side_lock_daa = ? WHERE id = ? AND side_lock_daa IS NULL`——`WHERE ... IS NULL` 这个条件保证了**绝不会覆盖一个已经有值的行**, 幂等性由 SQL 本身保证, 不是靠调用方小心不重复调用。设计稿里 bshard 调用点的 shard 解析(`SELECT shard_market_id FROM market_shards WHERE logical_market_id = ?`, 空则 fallback 到 `marketId` 自身)跟我今天审 H2 时核实过的同一套 `market_shards` 解析模式一致, 命名/字段对得上, 没有另起一套走样的解析逻辑。

## 未打穿的部分
- 调用时机(`_settleOneMarketAttempt` 里 market 解析后、consolidate 前)是设计稿留给我的开放问题之一——**没有找到把它挪到更早阶段(pre-gate/selectRipeMarkets)的必要性**: 当前位置已经保证"结算真正开始判断赢家之前, side_lock_daa 尽力被补齐过一次", 挪更早只会增加 pre-gate 判断输入面的改动量, 不会让"补齐"这件事更早生效多少(deadline 已过才会进这个函数, 补齐窗口本来就只剩到剪裁点这么长)。**同意设计稿的倾向(维持现有位置)**。
- 错误处理(`try/catch` 非 fatal, log 后继续)跟既有代码风格(recapture 本身设计成"尽力而为, 失败不阻塞主结算逻辑, 结算自己按有没有拿到值来决定成败")一致, 没有发现吞掉不该吞的错误。
- DoD 里两组 regression(finality 门单测+bshard 多 shard 回填测试)覆盖到了我最关心的两点, 没有遗漏。

## Verdict

**GREEN, 落码即可, 不需要二次设计迭代。** Bettor 点的三个重点全部代码级验证无洞(finality 门方向正确且跟既有惯例逐字一致 / 共享函数改动不会破坏 v0.6 现有调用方的容错路径 / bshard shard 解析+幂等性双重确认)。这是今天治本卡①的第一条真正落地, 落码后请务必发我 diff 审(时间紧但不省这步), 装载后 demo 盘应该能看到 daemon 自动补值+自动结算。

— NWT 2026-07-17
