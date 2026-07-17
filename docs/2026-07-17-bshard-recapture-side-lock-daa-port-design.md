# 治本卡①第一条 — recapture 机制移植到 bshard-settle-daemon.mjs 设计稿 v0.1

> Owner 直令(2026-07-17 12:xx,#oy5fsc):今天最高优先 = 把 recapture 机制真正复制到 bshard 路径(治本),而非手动一次性补 demo 盘数据(治表)。走设计→NWT 审→落码→装载。装载后新盘自动 recapture 补 side_lock_daa,demo 盘到期后 daemon 自动结算出结果。
> 背景: `docs/2026-07-17-h2-mybets-multiwin-split-design.md`(H2,已装载)+ 治本卡①(6d4fd1d4,系统性核对 v0.6 恢复机制 vs bshard 差集)第一项。

## 1. 现状(读码坐实)

- `recaptureSideLockDaaForMarket(marketId)`(`pool-market-settler-v06.mjs:420`)是已实现、已测试(`capture-side-lock-daa.test.mjs`)的函数:查 `marketId` 下 `side_lock_daa IS NULL` 的行,逐个调 `captureSideLockDaa()` 从链上读 accepting-block 的 daaScore 回填。
- 仅被 `pool-market-settler.js:770` 调用,且该调用点在 `isBshard` skip 判断(`pool-market-settler.js:389`)**之后**——bshard 市场在循环第一行就 `continue` 了,永远走不到这段。
- `bshard-settle-daemon.mjs`(923 行,所有真实 v0.7 bshard 市场唯一走的结算路径)grep `recaptureSideLockDaaForMarket`/`captureSideLockDaa` **零命中**。
- 结果:bshard 市场的 `pool_bettor_sides.side_lock_daa` 一旦在下注确认时因 UTXO 还在 mempool 而写成 NULL,**永远没有第二次机会被补上**——即使几分钟后链已确认、数据触手可及。`bshard-close-voter.js:63` 注释明确 "NULL → fail-loud in lib"(C1 per-bettor guard),这是今天 21 个 verifying 盘 consensus=0 的直接机制(Bettor 数据层实证 + 本设计稿代码层实证,双证据)。

## 2. 修法

### 2a. 调用点(`bshard-settle-daemon.mjs`)

在 `_settleOneMarketAttempt(marketId)`(923 行文件里的主处理函数,`const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId)` 之后、`consolidateAndBuildPsState`/`settleMarketLive` 之前)插入:

```js
// bshard recapture 移植(2026-07-17,治本卡①第一条): bshard 市场的 pool_bettor_sides 分散在各
// shard(market_shards.shard_market_id),不像 v0.6 单表单 market_id——每个 shard 各调一次。
// 镜像 pool-market-settler.js:770 的调用点+日志形状,复用同一份 recaptureSideLockDaaForMarket
// (零重复实现,只是让已存在的机制在 bshard 这条路也被触发)。
try {
  const shardIds = sqlite.prepare('SELECT shard_market_id FROM market_shards WHERE logical_market_id = ?').all(marketId).map(r => r.shard_market_id);
  const targets = shardIds.length ? shardIds : [marketId];   // no-shard bshard edge case falls back to logical id itself
  let totalRecaptured = 0, totalRemaining = 0;
  for (const sid of targets) {
    const rc = await recaptureSideLockDaaForMarket(sid);
    totalRecaptured += rc.recaptured; totalRemaining += rc.remaining;
  }
  if (totalRecaptured > 0) log(`[bshard-recapture] market=${marketId.slice(-8)} filled ${totalRecaptured} mempool-NULL-daa bets from chain (remaining NULL ${totalRemaining})`);
} catch (rcErr) { log(`[bshard-recapture] market=${marketId.slice(-8)} fail (non-fatal, settlement proceeds/fails on its own merits): ${rcErr.message}`); }
```

`recaptureSideLockDaaForMarket` 需从 `pool-market-settler-v06.mjs` import 到 `bshard-settle-daemon.mjs`(现有 export,零改动那一侧)。

### 2b. 🔴 finality 门(Bettor 承重①,K-17 发现 A 同一个洞,补在共享函数里让两条调用路径一起受益)

`captureSideLockDaa()`(`trade-protocol-filter.js:1077`)现状**没有 finality 检查**——解出 block 后直接读 `daaScore` 返回,不管这个 block 有没有过 reorg-safe 深度。这本来就是 v0.6 那条路的既有缺口(非本次新增),但既然要把这个函数的调用面扩大到 bshard(更高频/更多市场),**必须顺手补上**,否则会把"抢在 finality 前写入可能被 reorg 的错值"这个风险也一起复制过去——写错值比留 NULL 更危险(带假自信进 C1 guard)。

修法:在 `captureSideLockDaa()` 解出 `blk` 之后、返回 `daa` 之前,加:

```js
// 🔴 finality 门(2026-07-17,治本卡①+K-17 发现 A 同一个洞): 只有 accepting-block 已过
// DEFAULT_FINALITY_DEPTH(50, 复用 pool-market-settler-v06.mjs:43 同一个 F-S1 anti-reorg 场景,
// 不新拍数字)才写值——finality 前的值可能被 reorg 换成别的规范链,写进去比留 NULL 更危险
// (NULL 至少诚实"不知道",错值带假自信直接过 C1 guard)。
const tipInfo = await rpc.getBlockDagInfo();
const tipDaa = Number(BigInt(tipInfo.virtualDaaScore));
if (tipDaa - daa < DEFAULT_FINALITY_DEPTH) {
  return { daa: null, reason: `not-yet-finality-safe (tip=${tipDaa}, block=${daa}, depth=${tipDaa - daa} < ${DEFAULT_FINALITY_DEPTH})` };
}
```

`DEFAULT_FINALITY_DEPTH` 从 `pool-market-settler-v06.mjs` 补 `export`(现状是模块内 const,零行为变化,只加可见性)后 import,不新拍数字。

## 3. DoD

1. 单测扩展 `capture-side-lock-daa.test.mjs`:补一个 finality-门 case(mock 一个 tip-daa 差距 < 50 的 block,断言返回 `{daa: null, reason: 'not-yet-finality-safe...'}` 而非把值写进去)。
2. `bshard-settle-daemon.mjs` 新增 regression case:seed 一个带 2 shard、side_lock_daa NULL 的 bshard 市场,mock `captureSideLockDaa` 返回一个过 finality 的值,断言 `_settleOneMarketAttempt` 调用后两个 shard 的 `pool_bettor_sides.side_lock_daa` 都被正确回填(不是只填一个)。
3. `--domain=predictions` 跑过确认无连坐。
4. 不改 `recaptureSideLockDaaForMarket`/`captureSideLockDaa` 已有的行为契约(finality 门是新增的更严格条件,不放松任何既有检查)。

## 4. 影响面

- 只加代码,不删/改任何既有分支;bshard 结算主流程(consolidate/settle/writeback)零改动。
- finality 门让 `captureSideLockDaa` 在极少数"block 太新"的边缘场景多返回一次 NULL(比之前更保守,不会更激进),v0.6 那条既有调用路径行为收紧但方向正确(修的是同一个洞,不是新增负担)。
- 每 tick 每市场多 1~N 次(shard 数)DB 查询 + 可能的 RPC backward-walk——量级与既有 v0.6 路径相同,非新增开销类型。

## 5. 待 Bettor/NWT 审的点

- 调用时机:放在 `_settleOneMarketAttempt` 里(`market` 解析后,`consolidateAndBuildPsState` 之前)是否合适,还是应该放在更早的 `selectRipeMarkets`/pre-gate 阶段(更早触发但需要额外改 pre-gate 的判断输入)?本稿倾向前者(改动面最小,直接对齐 v0.6 的调用位置)。
- finality 门加在共享函数 `captureSideLockDaa()` 里(两条调用路径都受益,但也意味着 v0.6 路径行为跟着变严格)vs 只加在 bshard 新调用点(改动面更小但制造第三份不一致)——本稿倾向前者(不制造新的路径分叉,呼应本卡"堵住复制分叉不同步"的宗旨)。
