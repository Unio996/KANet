# NWT 红队 — H2 /mybets 多笔赢单拆分设计 v1.1(2026-07-17)

> **Status**: CURRENT
> **对象**: `docs/2026-07-17-h2-mybets-multiwin-split-design.md`(v1.1, 3511e778, J2)
> **verdict**: **🟠 GREEN-with-1-MUST-FIX(largest-remainder 求和精度) — 对冲场景那道门验证无洞**

> 交付说明: 本卡排我队首(#oppzkw)已超 1.5h 无进展, 是我自己的疏漏(等"正式交接"等成了空等, 没有主动去找已经落库的最新版本文件), 已在频道认账。现在补上。

## Bettor 点名重点①: 对冲场景(hedge bettor) — 没打穿, 设计安全

§3 步骤 2 的方向门(`myDirection === ev.win_direction`, 命中 `winner_details[pk]` 之后才判断)明确"镜像已有的 line 3288 那道门"。我去读了 `pool.js:3283-3292` 现有实际代码, 确认那道门的**完整**形态是:

```js
} else if (ev.win_direction === 0 || ev.win_direction === 1) {   // 先确认 win_direction 是合法值
  ...
  if (myDirection === ev.win_direction) { ... }
```

**关键点**: 现有门在做 `myDirection === ev.win_direction` 比较**之前**, 先用 `ev.win_direction === 0 || ev.win_direction === 1` 排除了 `win_direction` 是 `null`/`undefined`/其它脏值的情况——这堵死了一个我主动去想的攻击面(如果 `myDirection` 和 `win_direction` **都**是 `undefined`, `undefined === undefined` 在 JS 里是 `true`, 会让一个方向缺失的脏行被误判"方向匹配"进而误吃份额)。H2 设计稿的 §3 步骤 2 文字描述只写了"判断 `myDirection === ev.win_direction`", 没有把这个前置合法性检查也复述一遍(虽然说了"镜像"这道门, 但落码在**新的分组/拆分函数**里, 不是同一段代码块, 存在"复述规则时漏掉前置条件"的风险)。**这不算设计缺陷**(设计明确要求镜像既有、已验证的门), 但落码 DoD 里应该显式写一句"方向比较前必须先确认 `win_direction` 是 `0`/`1` 合法值, 不是只比较相等", 避免实现时只抄了"比较"这一步、漏了"先验证合法"这一步。**排非阻塞建议, 不影响本次 verdict。**

## Bettor 点名重点②: largest-remainder 求和精度 — 🔴 MUST-FIX, 找到真实精度风险

§3 步骤 3 的公式:

> `exactShare = myWin.amount * stakeSompi / groupStakeTotal`(浮点/BigInt 都算一次精确值)

这句话本身有歧义("浮点/BigInt 都算一次精确值"读起来像是"两种实现方式都行"), **这个歧义会导致一个真实的精度漏洞**: 如果实现时用普通 JS `Number` 做 `myWin.amount * stakeSompi` 这个**乘法**(先乘后除), 当两个操作数都是较大的 sompi 值时, 乘积会超出 `Number.MAX_SAFE_INTEGER`(2^53 ≈ 9.007×10^15), **乘法本身在除法发生之前就已经静默丢失精度**——不会抛错、不会有任何提示, 算出来的 `exactShare` 就是错的。

**量化这个风险不是空对空**: `myWin.amount` 是这个 bettor 在整个逻辑市场的中奖总额, `stakeSompi` 是其中一笔的下注额, 两者都是 sompi 单位(1 KAS = 1e8 sompi)。本项目历史盘子出现过"28mln 史上最大盘 17,613.9 KAS 完整结算"级别的规模(memory 记录在案), 单个大额 bettor 中奖上千 KAS 完全在合理范围——**1000 KAS = 1e11 sompi, 两个这个量级的数相乘 = 1e22, 远超 2^53 安全整数范围**。一旦有大额中奖 bettor 撞上这条路径, `Math.floor(exactShare)` 算出来的每行份额可能是**错的**(不一定报错, 可能只是最后一两位精度飘了), 这正好是这次修法本身要解决的"钱路显示精确"问题的反面——**用一个新的精度 bug 去修一个旧的重复计数 bug**。

**MUST-FIX**: `exactShare` 的计算必须显式用 `BigInt` 做乘法和除法(`(BigInt(myWin.amount) * BigInt(stakeSompi)) / BigInt(groupStakeTotal)`, `Math.floor` 等价于 BigInt 除法本身自带的向下取整语义), 不能留"浮点/BigInt 都行"这种模糊表述——这是钱路精确性铁律(K-05 Value Conservation), 落码 DoD 里必须把这条钉死为唯一允许的实现方式, 不是两种选一种。

**算法本身(largest-remainder 分配逻辑)没有洞**: 验证过数学性质——`remainder = myWin.amount - floorSum` **必然** `< N`(组内行数), 因为每行 `floor()` 相对精确值最多损失"不到 1"个单位, N 行最多损失"不到 N"个单位, 所以 remainder 严格小于 N, "把 remainder 个 1-sompi 分给前 remainder 行"不会越界。用 `id ASC` 而非真正的"按小数部分大小排序"分配零头, 不是经典 largest-remainder method 的严格实现(设计稿自己 §6 也承认这点), 但**不影响守恒**(求和依然精确等于 `myWin.amount`), 只影响"谁多拿 1 sompi 这种边角"——sompi 级别的量(1e-8 KAS)不构成任何值得博弈的经济动机, 不需要改。

## 其余核实
- **groupKey 用 `COALESCE(ms.logical_market_id, s.market_id)`**: 对 v0.6/非 bshard 盘(没有 `market_shards` 行, `logical_market_id` 为 NULL)会退化成 `market_id`, 单笔场景下 group size=1, `exactShare === myWin.amount`, 跟 §5 声明的"绝大多数场景行为不变"一致, 没有找到会改变现有行为的路径。
- **`count===1` 门槛放宽**(§3 步骤 4): 在 ①②③(方向门+精确拆分)落地后, "金额-交易不可消歧"这个放门槛的原始顾虑确实解除了(每行金额已是真实拆分值, 求和精确, txid 也确实是同一笔真实 tx)——推理链条成立, 没有找到反例。
- **DoD regression case A/B**: case B(对冲 bettor)覆盖了 YES 方向精确拆分+NO 方向零份额+NO 方向正确显示"你输了"三个断言, 直接对应重点①要验的场景, 覆盖到位。
- **影响面(§5)**: 只改 `pool.js` 一个 handler + `prediction-menu.mjs` 一处门槛, 不碰写入侧/daemon/committee, 核对没有发现范围外的隐含改动。

## Verdict

**GREEN-with-1-MUST-FIX(largest-remainder 求和必须用 BigInt, 不能"浮点/BigInt 都行")**。对冲 bettor 场景(Bettor 重点①)验证安全, 镜像的既有门本身就已经防住了我主动去想的边缘情况。落码时把 MUST-FIX 这条钉死 + 顺手把重点①那条"方向比较前先验证合法值"的非阻塞建议一并写进 DoD, 回来我复核。

— NWT 2026-07-17
