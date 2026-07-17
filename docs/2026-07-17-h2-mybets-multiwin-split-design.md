# H2 — /mybets 同市场同方向多笔赢单 amount 重复/txid 消失 — 设计稿 v0.1

> 派工:Bettor #omlqo0(J2 班①主线首件)。方向:读取侧拆分(Bettor 倾向,本稿采纳,证据见下)。
> 状态:DESIGN — 待 Bettor 方向审 + NWT 红队,GREEN 后落码。

## 1. 症状

`/mybets`(`prediction-menu.mjs`)对 bshard(v0.7)盘,若同一 bettor 在**同一逻辑市场**、**同一方向**下有**多笔**独立下注(常见成因见 §2),会出现:
- 赢单金额显示成真实金额的整数倍(2 笔 → ×2,3 笔 → ×3……)
- 赢单 txid 完全不显示(`prediction-menu.mjs:351` `count===1` 门槛把它挡住)

## 2. 根因(读码 + 落库结构逐行核实,非猜测)

**写入侧(权威,已核实,现状正确不动)**:
- `bshard-settle-daemon.mjs:_settleOneMarketAttempt(marketId)` 的 `marketId` 是**逻辑市场 id**(`payout_shards.logical_market_id`),一次调用结算**该逻辑市场下所有分片**。
- 结算产出 `landedClaims`(一个 bettor_pk 一笔链上 claim,已聚合该 bettor 在这个逻辑市场的全部中奖仓位),写入 `winner_details: landedClaims.map(c => ({pk, amount, txId}))`(`bshard-settle-daemon.mjs:681`),存在**逻辑市场**的 `pool_markets.metadata.settle_evidence`。
- 结论:`winner_details` **按 bettor_pk 去重,一个 pk 一条,amount = 该 pk 在整个逻辑市场的总赢得金额**。这个形状本身没有问题。

**读取侧(bug 所在)**:
- `pool.js:/api/pool/my-positions` 的 `positions` 查询按 `pool_bettor_sides` **逐行**(每笔下注一行,`market_id` 是**分片**的 id,`UNIQUE(market_id, bettor_pk)` 只挡同一分片内重复,挡不住同一 bettor 在**同逻辑市场的不同分片**各下一笔)。
- 每行独立 `LEFT JOIN market_shards` 解析出同一个逻辑 `pool_markets` 行,读到**同一份** `settle_evidence`。
- `pool.js:3276` `ev.winner_details.find(w => w.pk === bettorPk)` 对每一行都命中**同一个** myWin 条目 → 每行都把**整个** `myWin.amount`(和同一个 `txId`)当作"这一行的赢得金额"。
- `prediction-menu.mjs:300-313` 按 direction 分组时把每行的 `actual_payout_kas` 直接 `+=` 累加(line 307)→ N 笔 → 求和成 N 倍。

**复现路径确认**:同 bettor 在逻辑市场 M 的分片 A、分片 B 各下一笔 NO,分片 A 和分片 B 是两个不同 `pool_markets.id`(shard),`UNIQUE(market_id,bettor_pk)` 分别在各自分片内满足、不冲突;两行 join 到同一逻辑市场 M 的 metadata,读到同一 `winner_details[pk=X]`。

## 3. 修法(读取侧,不动写入侧/不动 `winner_details` 形状)

**为什么读取侧、不改写入侧**(与 Bettor 倾向一致的论据):
- 改 `winner_details` 形状(比如按分片/按行拆分)会让**老市场的历史行**(已经是"一个 pk 一条聚合"形状)和**新市场的新行**产生两种并存格式,`/mybets` 读取代码要同时兼容两种形状——这正是 H2 这条 bug 本身"多套形状并存"的病根,不应该再制造一个双轨。
- 读取侧修一次,对**全部历史已结算 bshard 盘**立即生效,不需要数据回填/迁移。

**具体改动(`pool.js`,`/api/pool/my-positions` handler)**:

1. 在 `positions` 主循环**之前**,加一个预扫描,按 `groupKey = COALESCE(ms.logical_market_id, s.market_id) + '|' + direction` 分组,计算每组的 `stakeTotal = SUM(stake_amount)`(只在这个 handler 内存里算,不需要改 SQL,`positions` 已经带够字段;`ms.logical_market_id` 需要在原 SELECT 里补一列,目前 SQL 只 COALESCE 用掉、没有单独选出——需要加 `ms.logical_market_id AS _logical_market_id`)。
2. 在原有 line 3276 `ev.winner_details.find(...)` 命中 `myWin` 之后,不再直接把整份 `myWin.amount` 赋给这一行,而是:
   - 按**largest-remainder(最大余数法)**做整数安全拆分,保证 N 行拆分求和**精确**等于 `myWin.amount`(不允许浮点/四舍五入导致求和漂移,钱路铁律):
     - `exactShare = myWin.amount * stakeSompi / groupStakeTotal`(浮点/BigInt 都算一次精确值)
     - 每行先取 `Math.floor(exactShare)`,组内所有行 floor 之和 = `floorSum`
     - 余数 `remainder = myWin.amount - floorSum`(必为非负整数,` < N`)
     - 按**确定性顺序**(建议 `id ASC`,即 `pool_bettor_sides.id` 自增主键,同一份数据任何时候重算顺序都一样)把 `remainder` 个 1-sompi 依次分给前 `remainder` 行
   - `actualPayoutKas = 该行分到的 share / 1e8`
   - `bshardClaimTxid` 维持不变(所有分到份额的行都指向同一笔真实 claim tx——这本来就是对的,一笔 tx 付了这个 bettor 在该逻辑市场的全部中奖金额,不是这行独有一笔 tx)。
3. `prediction-menu.mjs:351` 的 `a.count === 1` 门槛**放宽为 `onlyWon && a.wonTxid`**(去掉 count===1 限制)——放这道门槛的原因(讲清楚"金额-交易不可消歧")在修法①②落地后不再成立:每行金额已经是真实拆分值,求和会精确等于链上总额,txid 也确实是同一笔真实 tx,不再有"哪笔钱对应哪个 tx"的歧义,可以放心显示。

## 4. DoD(交付前必须满足)

1. **regression case**(新增,建议放 `kasia-console/src/api/pool.test.mjs` 或就近现有 pool.js 测试文件——若无,新起):bettor 在同一逻辑市场(2 分片)、同一方向下 2 笔不同金额的赢单,断言:
   - `sum(actual_payout_kas across rows) === myWin.amount / 1e8`(精确,非约等于)
   - 每行 `actual_payout_kas` 与其 `stake_amount` 成正比(允许 largest-remainder 的 ≤1 sompi 舍入差)
   - `prediction-menu.mjs` 渲染输出里 txid 正常显示(不因 count>1 消失)
2. **DATABASE.md 补文档缺口**(Bettor 派工里一起要的):`pool_bettor_sides` + `pool_markets` 目前完全没有条目。借这次改动顺手补上:用途/字段/写入方(create-v07/settle-daemon/claim 回填)/读取方(my-positions/settler/voter)/陷阱(重点记这次 H2 的根因:**同一 bettor 在同一逻辑市场的不同分片各有一行,`UNIQUE(market_id,bettor_pk)` 只挡分片内,不挡跨分片**,以及 `winner_details` 是"按 pk 聚合、不按行"的形状)。
3. 不改 `bshard-settle-daemon.mjs` / `winner_details` 写入形状,不改 `settle_evidence` schema,不碰 committee/enforce 路径——纯读取侧 + 展示侧改动,零链上/结算逻辑触碰。

## 5. 影响面确认(零溢出)

- 只改 `pool.js` 的 `/api/pool/my-positions` handler 内部计算 + `prediction-menu.mjs` 一处展示门槛。
- 不改任何 SQL 写操作、不改任何 daemon/settler/voter 代码。
- 对**只有 1 笔中奖行**的 bettor(绝大多数情况,含所有 v0.6/非 bshard 盘)行为完全不变(`stakeSompi/groupStakeTotal === 1`,`exactShare === myWin.amount`)。

## 6. 待 Bettor 方向审的点

- largest-remainder 排序基准用 `pool_bettor_sides.id ASC`(稳定、确定性、任何时候重算一致)——若有更好的口径(比如按 `created_at`)可以换,不影响正确性只影响"谁多拿 1 sompi"这种边角。
- `prediction-menu.mjs` 放宽 `count===1` 门槛是否需要单独走一次用户面文案铁律 0 审批——本稿认为这不是新增文案/新增交互,只是让已有的 txid 行在多笔场景也显示,判定为同一文案的适用范围扩大,不算"新文案"；但请 Bettor/NWT 确认是否需要单独走用户面审批通道。
