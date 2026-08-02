# r402 修复设计 — producer 侧 dispatchRefund 前重查本地 betCount

**Status: DESIGN — 待 NWT 红队,未落码。** 归 J2(settler/pipeline 域),Bettor 08-02T20:09 派工(#c8hcgy.3),范围口径:缺陷修复例外(不占「只做模块化+外部接入」范围直令),D-011 内部双审走完即可上线,不等 Owner 逐项点头。

## 0. 缺陷回顾(已在 COORD-LEDGER (116) + 频道坐实,本次只重核代码未变)

- **触发点**(`pool-market-settler.js:580-629`,cross-node maker 分支):某节点持有一个 maker 在别处的市场(`maker_relay_id = 'cross-node:<pk>'` sentinel),它用**自己本地** `pool_bettor_sides` 的 betCount 判断"是不是 0-bet";betCount==0 就广播 `pool_refund_request_v1`。
- **已证的失败模式**(J1 08-01 报告):某节点整张 `pool_bettor_sides` 为 **0 行**(不是"这些市场 0 行",是**整张表**空)⇒ 该判据在这节点上**结构上恒真**,与市场是否真的 0-bet 无关。已发出 **705 条**这样的请求(`docs/2026-08-01-j1tn-705-xnode-refund-request-list.md`)。
- **producer 侧零复核**(逐字读,本次重新核对未变):
  - `trade-protocol-filter.js:133-181` `handlePoolRefundRequest` 只查四件:市场在不在本地 / 自己是不是也是 cross-node consumer(是则 drop)/ 幂等(`refund_dispatched_at` 已设则 skip)/ `msg.maker_pk` 与本地 `market.maker_relay_id` 派生出的 pubkey 是否一致。
  - 最后一项是**身份/授权检查**("这个请求者有没有资格代表这个 market 的 maker"),**不是前提检查**("0-bet 这件事是真的吗")。四项全过后直接 `dispatchRefund(market, {...})`。
  - `dispatchRefund` 本体(`pool-market-settler.js:2427-2464`)只检查 `isBshard`(是则拒),不查 betCount。
- ⇒ **从请求方一句可能恒真的断言,到链上真实广播退款 tx,中间没有一跳会问"这个市场真的没人下注吗"。**
- **现状止血**:Bettor 08-01T08:14Z 拍 ②'(COORD-LEDGER (116) / 频道 `#a3i1b0`),J1 停掉本机全部 11 个 relay 阻断继续广播。**判据本身一字未改**,止血闸靠"没人碰它"撑着,直到本次修复落地验证前不撤。

## 1. 可信 betCount 来源在哪一层(设计的核心问题,已读代码确认)

`pool_bettor_sides` 有两条写入路径:

| 路径 | 位置 | 可信度 |
|---|---|---|
| a) 本地 bettor 直接下注 | `kasia-console/src/api/pool.js` INSERT | 本节点亲自处理,即时、不依赖广播 |
| b) 跨节点 bettor 下注,靠广播 ingest | `trade-protocol-filter.js:1284` `INSERT OR IGNORE`(UNIQUE `side_lock_tx` 去重) | 依赖对方广播送达 + 本节点在线 ingest,**可能 lag 或整体丢失**(J1 案例) |

同一张表、同一条查询语句在**同节点**场景下已有三处先例,判据完全一致:
```
pool-market-settler.js:566   (同节点 v0.6/v0.7 0-bet pre-sample shortcut)
pool-market-settler.js:1362  (另一处 0-bet 判定)
pool-market-settler.js:1706  ('0-bet market (sides=0)' 直接 dispatchRefund)
```
这三处从未被质疑过(它们是**本节点自己的市场**,本节点若是唯一权威 producer,自己的表就是权威)。

**cross-node 场景的区别**:请求方(consumer 节点)查的是**自己**的 `pool_bettor_sides`,而它对这个市场既不是 maker 也未必是任何一个 bettor 的落地节点 —— 它的本地副本完全靠广播 ingest 撑起,天然是最脆弱的一环(J1 整表 0 行就是铁证)。而 **producer 节点**(真正的 `maker_relay_id` 所在机器)对同一个市场,至少捕获**路径 a)**(如果有本地 bettor 直接在它上面下的注 100% 不丢),**路径 b)** 仍然依赖 ingest 但产品自己作为市场的"主场"通常 ingest 更完整(不是保证,是概率上更好)。

**⇒ 结论:producer 自己的本地 `pool_bettor_sides` betCount,不是绝对真相,但严格强于"完全不查"和"信请求方的本地副本"(请求方那一侧已经被证明可以整表为空)。** 复用同一条已在三处验证过的查询语句,不新造判据。

### 残余风险(必须显式披露,本次不解决)

即使 producer 也可能有 ingest lag/丢失,产生同样形状的假 0-bet。彻底堵死需要**链上正向枚举**(扫描该市场所有可能的 bettor `side_p2sh` 地址,证明链上确实没有对应的锁仓 UTXO),但当前架构下每个 bettor 的 `side_p2sh` 由其自己的 pubkey 派生 —— producer 在收到对应的广播之前根本不知道要去查哪个地址,这是负向存在性证明的结构性难题,不是本次范围能解决的。**本次修复缩小暴露窗(从"零复核"到"至少一层独立复核"),不宣称彻底消除。**

## 2. 提议改动(未落码,等 NWT 红队 PASS 才动手)

在 `handlePoolRefundRequest`(`trade-protocol-filter.js`),`maker_pk` 验证通过之后、调用 `dispatchRefund` 之前,插入 producer 本地 betCount 复核:

```js
// Producer auth verified — 但授权 ≠ 前提。r402: 再核一次本地 betCount,
// 不能只信请求方的 0-bet 断言(它的本地副本可能整表为空,见 J1 08-01 案例)。
const localBetCount = sqlite.prepare(
  'SELECT COUNT(*) as c FROM pool_bettor_sides WHERE market_id = ?'
).get(market.id)?.c || 0;
if (localBetCount > 0) {
  console.error(`[trade-filter:pool-refund-req] REFUSED market=${market.id.slice(0,12)} — producer local betCount=${localBetCount} > 0, 与请求方 0-bet 断言矛盾, 不 dispatch, 需人工核`);
  // 写审计标记,不静默丢弃 —— 两节点读数不一致本身是信号(可能是更大范围的 ingest 问题)
  let meta = {};
  try { meta = JSON.parse(market.metadata || '{}'); } catch {}
  meta.refund_request_conflict_at = new Date().toISOString();
  meta.refund_request_conflict_local_bet_count = localBetCount;
  sqlite.prepare('UPDATE pool_markets SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(meta), market.id);
  return;
}
// Producer auth verified + local betCount==0 — dispatchRefund using real local maker_relay_id.
```

**冲突时不静默丢弃**:写 `metadata.refund_request_conflict_at` + 读数快照,留痕供人工/下一轮排查。不写审计行等于把这个矛盾信号吞掉,而这个矛盾本身可能指向别的问题(比如 ingest 管道更大范围坏掉)。

### 2.1 请求方反馈回路(NWT 08-02T20:11 ③ 指出的缺口,本版补上)

发起方(consumer 节点)广播 `pool_refund_request_v1` 后,若 1 小时内没等到"已 dispatch"的信号(即 `refund_dispatched_at` 一直不变),会按 `REQUEST_REBROADCAST_MS`(`pool-market-settler.js:594`)**每小时重试一次**。若 producer 只是本地静默标记冲突、不回任何东西,发起方会**永远重试、永远撞同一个假阳性**,每次都是一笔真实广播(烧手续费,且持续占用带宽/日额度——就是这次 705 条积压的同一种烧钱形状)。

⇒ 冲突分支必须给出**某种回执信号**,而不是只在 producer 本地留痕。两个候选,列出但不替 NWT/Bettor 选:

- **候选 A(消息回执)**:producer 广播一条新协议消息 `pool_refund_request_rejected_v1 { market_id, reason: 'local_bet_count_nonzero', bet_count }`,发起方的 handler 收到后清空/冻结自己的 0-bet 重试状态(至少标记"已被 producer 明确否决,不再自动重试,需人工核")。代价:新协议消息类型,consumer 侧需要新 handler,改动面变大。
- **候选 B(被动限速,不新增协议)**:发起方那侧的重试判据本身要补(不在本次改动范围内,需要 consumer 侧配合,可能是另一条 DRI)—— 比如重试次数上限 + 达到上限后转人工。代价:不解决"1 小时内还会再撞一次"的窗口,只限制长期烧钱,治标不治本。

**本设计倾向候选 A**(闭环、对称,消费方停止重试不需要靠超时/次数上限去猜),但协议消息新增涉及 wire format(记忆:`reference-comm-wire-format-requires-alias-segment`——载荷格式有既定约定,不能随手加字段),这部分需要 NWT/Bettor 一起定,不是 J2 单方面拍。

## 3. 不在本次范围

- **不处理已发出的 705 条历史存量。** KANet-UI 在做 191∩705 交集调查(独立轨道,Bettor 08-02 已催办),那是"已发生的伤害有多大"的问题;本设计只管"从现在起,不再无脑退一个可能有人下注的市场"。
- **不做链上枚举式彻底根治**(见 §1 残余风险),只做"防止已知形状的矛盾被无视"这一层。
- **不撤 ②' 止血闸** —— Bettor 已拍:本设计落地 + 验证前不撤(11 个 relay 继续停)。

## 4. 请 NWT 打的点

1. **TOCTOU**:`localBetCount` 检查与 `dispatchRefund` 内部建 tx/签/广播之间存在时间窗口 —— 若同一时刻有个新 bet 落地(检查时 0、执行时非 0),这层检查是否被绕过?是否需要把检查挪进 `dispatchRefund` 内部、贴着建 tx 那一刻做,而不是留在 caller 侧?
2. **假阳性代价**:这条 check 会不会误伤"producer 自己 ingest 出了脏行"的场景 —— 一个真正 0-bet 的市场,因为 producer 本地有条幽灵下注记录(比如未清理的测试数据/重复行未去重)而永久卡死不退款?去重索引(`UNIQUE(market_id, bettor_pk)` v62)是否已经堵住了"同一 bettor 计两次"这类假阳性?
3. **审计字段竞态**:`refund_request_conflict_at` 这次 `UPDATE ... metadata` 是 read-modify-write,是否会被同一 market 的其他并发 tick(settler 别的分支同时在改 `metadata`)覆盖丢失 —— 类似 CLAUDE.md 记录的 xzztw 案例那种 racy 写入?
4. **范围边界**:是否同意"不做链上枚举式根治"这个范围切法,还是认为残余风险大到必须本轮一并堵?
