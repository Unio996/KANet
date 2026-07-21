# NWT diff verdict — commit 3b7000f8(H2 落码: /mybets 多笔赢单拆分)(2026-07-17)

> **Status**: CURRENT
> **对象**: `3b7000f8`(pool.js `splitWinnerAmountByStake` + 方向门 / prediction-menu.mjs 门槛放宽 / pool-mybets-h2-split.test.mjs)
> **verdict**: **✅ GREEN — MUST-FIX 落对, 独立跑测全过, 可装载**

## 独立复核(自己跑代码/自己验 SQL, 不是信 commit message)

**MUST-FIX(BigInt 精度)落对**: `splitWinnerAmountByStake` 全程 `BigInt`(`const total = BigInt(totalAmount)`/`reduce(...0n)`/`(total * BigInt(r.stake_amount)) / groupTotalStake`), 没有任何一步退回 `Number` 做乘除, 我要求的"必须钉死唯一实现方式"这条落对了。BigInt 除法对非负整数天然等价 floor, 数学验证过 `remainder = total - floorSum` 严格 `< groupRows.length`(每行 floor 相对精确值最多损失"不到 1", N 行最多损失"不到 N"), 分配零头的循环不会越界。

**一处我起初怀疑、深挖后确认是我看错、非 bug 的地方**(记录下来防止自己/别人以后重犯同样的疑虑): 新 SELECT 里 `m.id AS logical_market_id` 乍看像是"只拿了分片自己的 id, 没真正解析到逻辑市场"——去读了完整 FROM/JOIN(`FROM pool_bettor_sides s LEFT JOIN market_shards ms ON ms.shard_market_id=s.market_id LEFT JOIN pool_markets m ON m.id=COALESCE(ms.logical_market_id, s.market_id)`)才确认 `m` 本来就是**按 COALESCE 解析后的逻辑市场**跟 `pool_markets` join 出来的行, `m.id` 因为 join 条件本身就等于 `COALESCE(ms.logical_market_id, s.market_id)`, 是正确值, 不是分片自己的裸 id。这个坑值得记一句: **SQL 里同一个字母(`m`)在没看完整 FROM 子句之前不能假设它指向哪张表的哪个粒度**, 差点在这次红队里产出一个假阳性 finding。

**对冲 bettor 方向门**: `if (myWin && (ev.win_direction === 0 || ev.win_direction === 1) && myDirection === ev.win_direction)` — 把我在设计审阶段提的"非阻塞建议"(方向比较前先验证 `win_direction` 合法值)也一起落进同一个条件表达式里了, 比设计稿文字描述的更严谨, 不是刚好够用而已。

**groupRows 子查询**跟主查询用同一套 `LEFT JOIN market_shards ms ON ms.shard_market_id=s.market_id` + `COALESCE(...)` 解析逻辑, 两处一致, 没有出现"两条查询各自实现一遍容易走样"的风险。

## 独立实测(不信"5 组全绿"的自我陈述, 亲自跑)

```
cd kasia-console && node src/api/pool-mybets-h2-split.test.mjs
```
**ALL PASS**(5 组, 逐条断言我自己看着输出核对: case A 跨分片 5:3 比例拆分精确到 10/6 KAS; case A2 100 sompi 三等分不可整除, 求和仍精确 100; case A3 **BigInt 精度实测**——17,613,900 KAS 量级, 独立在测试里用同一 BigInt 公式手算出 `expected0=1056834000000000`/`expected1=704556000000000`, 跟接口真实返回逐 sompi 比对相等, 不是宽松断言; case B 对冲 bettor 输方向行 `did_win:false`+`actual_payout_kas:null`, 赢方向求和不被稀释; backward-compat 单行场景金额不变)。

```
cd kasia-console && node scripts/test.mjs --domain=predictions
```
**ALL PASS(0 failures)**——独立验证过没有连坐既有 predictions 域测试。

## 未打穿的部分
- `prediction-menu.mjs` 门槛放宽(`count===1` → `onlyWon && a.wonTxid`)逻辑上依赖①②③已经把每行金额变精确+txid 确实指向同一笔真实 claim tx 这两个前提, 前提在 pool.js 侧已验证成立, 放宽本身没找到新歧义。
- `DATABASE.md` 补充条目对上落码内容, `pool_bettor_sides`/`pool_markets` 两张核心表首次有文档条目, 符合硬规矩。
- 未发现范围外改动, 没有碰 `bshard-settle-daemon.mjs`/committee/enforce/`settle_evidence` 写入形状, 跟设计承诺的"纯读取侧"一致。

## Verdict

**GREEN, 可装载。** 我在设计审阶段的 MUST-FIX(BigInt)和非阻塞建议(方向门前置合法性检查)都被落码吸收, 独立跑了两轮测试(H2 专项 regression + predictions 全域)全部真实通过, 没有发现新的问题。H2 这条从设计→方向审→红队→v1.1→红队复核→落码→diff 审全部走完, 排下个重启窗装载。

— NWT 2026-07-17
