# NWT diff verdict — commit d521fea8(recapture 移植落码)(2026-07-17)

> **Status**: CURRENT
> **对象**: `d521fea8`(bshard-settle-daemon.mjs / trade-protocol-filter.js / pool-market-settler-v06.mjs / bshard-recapture-shard-loop.test.mjs)
> **verdict**: **🟢 GREEN, 可装载 — 1 处非阻塞发现(重复常量, 立卡追, 不卡今天结果)**

## 独立跑测(不信"全绿"自我陈述)

```
node kasia-console/src/services/bshard-recapture-shard-loop.test.mjs   → ALL PASS(3 组: 双 shard 枚举/幂等零覆盖短路/无 shard 边界回退)
node kasia-console/scripts/test.mjs --domain=predictions               → ALL PASS(0 failures), 无连坐
```

## 逻辑核实(读实际 diff, 三重点)

**①finality 门实现**: `if (tipDaaScore !== null && (tipDaaScore - daa) < CAPTURE_FINALITY_DEPTH) return {daa:null, reason:'not-yet-finality-safe...'}` — 比较方向跟我设计审阶段核过的 `pool-market-settler-v06.mjs` 既有 F-S1 门(`actualDepth < finalityDepth`)逐字一致。`tipDaaScore` 在 `rpc.disconnect()` 之前、连接仍开着时取(注释显式说明), 取到的是一个纯 Number 值, 后续比较不依赖连接是否还活着, 时序正确。

**②v0.6 行为影响**: `daa === null` 提前 return 挡在 finality 判断之前(`if (daa === null) return {daa:null, reason:'daa-unresolved'}`), 顺序上先处理"根本没解出块"这个既有失败态, finality 判断只发生在**已经成功解出块**这个分支——不会对"本来就该返回 daa-unresolved"的既有场景引入行为变化, 改动范围精确。设计审阶段验证过的调用方(`recaptureSideLockDaaForMarket` 只判断 `daa!==null`, 不查 `reason` 字符串)不受影响, 这次落码没有改变调用方代码, 结论依然成立。

**③shard 解析 + 幂等**: 独立跑的 `bshard-recapture-shard-loop.test.mjs` 三组断言直接验证了这三件事(双 shard 枚举命中两个真实分片而非逻辑 id 本身 / 已有值的行原样不动 / 无 shard 边界正确回退到逻辑 id), 不是我口头推断, 是测试真跑出来的结果。

## 🟡 发现①(非阻塞, 但必须留卡追踪——手工配对常量同族坑)

设计稿(f7cdfe37 §2b)和我的设计审 verdict 都明确要求"`DEFAULT_FINALITY_DEPTH` 从 `pool-market-settler-v06.mjs` 补 export 后 **import**, 不新拍数字"。**实际落码没有这样做**: `trade-protocol-filter.js` 新增的是**独立的本地常量** `const CAPTURE_FINALITY_DEPTH = 50`, 不是 `import { DEFAULT_FINALITY_DEPTH } from './pool-market-settler-v06.mjs'`。commit 里留了注释解释原因: "本文件不静态 import 那个模块(它反过来动态 import 本文件, 避免制造循环依赖的静态方向), 本地声明同值"。

**这个理由部分成立但不是唯一解法**: `pool-market-settler-v06.mjs` 确实是**动态** `await import('./trade-protocol-filter.js')`(line 425), 如果 `trade-protocol-filter.js` 顶部加**静态** `import` 回指对方, 会形成一个静态-动态混合的循环引用, 理论上 ESM 能处理(动态导入延迟解析能打破循环), 但这类混合循环历来是脆弱源头, 避开它本身是合理直觉。**但避开的正确做法应该是"同样用动态 import 取那个常量"**(这个函数体内本来就已经在用好几处 `await import(...)`, 比如 `getWorkingRpc`/`RpcClient`, 多加一处 `const { DEFAULT_FINALITY_DEPTH } = await import('./pool-market-settler-v06.mjs')` 是同一个模式, 零新增复杂度), **而不是复制一份数值独立维护**。

**为什么这值得较真, 不是吹毛求疵**: 本项目自己吃过不止一次这个亏(D-009 gate-tmplhash 手工配对常量漏同步事故 / ANTI-PATTERNS 规则 55), 今天现在两处值恰好都是 50, 但**没有任何机制保证以后改一处的时候另一处会跟着改**——下次有人往 `DEFAULT_FINALITY_DEPTH` 调参数(比如提高到 100 应对更深的 reorg 风险), 大概率只会改 `pool-market-settler-v06.mjs` 那个"看起来是权威源"的地方, 不会想起 `trade-protocol-filter.js` 里还藏着一份复制品, 两个 finality 深度从此悄悄不一致, 且没有任何测试/lint 会报警(两个常量各自测试各自通过, 谁也不知道对方存在)。

**不阻塞今天**(两个值当前确实相等, 逻辑没有现实错误, 测试全绿), 但**必须立卡今天之后尽快修**(改成动态 import 复用同一个 binding, 或者至少加一条 lint/测试断言两个值相等防止未来漂移)。

## Verdict

**GREEN, 可装载, Owner 结果链路不受阻。** 三个红队重点全部独立验证通过, 唯一发现是维护性/未来漂移风险(重复常量), 不是当前行为缺陷, 不卡今天的结算结果。请 Bettor/J2 收卡追踪, 排进"复制分叉不同步"那类治本卡的关联项(讽刺的是, 这个具体实例本身就是"改一边忘了让另一边跟上"这个母题的一个小型翻版, 值得记一笔)。

— NWT 2026-07-17
