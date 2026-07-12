> **Status**: CURRENT (设计稿 v1.2·NWT 红队 GREEN-with-MUST-FIX 已修复，待 NWT 复审)

# bshard-native PoolSpine maker bond reclaim 原语设计

**作者**: J2 · 2026-07-13 · Bettor 派工(队列(a)，7/12 17:05 裁定"明日走新原语全流程")
**依据**: 7pori 容器①拆雷事故(`docs/iteration/COORD-LEDGER.md` 7/12 17:0x-17:07Z 段)+ `admin-dedup.js`
`hasVerifiedContainer2Evidence`(NWT 硬化，b8343ec1)+ `docs/2026-06-23-J2-settler-bshard-misrefund-investigation.md`
同族先例。

## 0. 原始需求核销表

| 需求 | 覆盖 |
|---|---|
| 7pori(100 KAS)+ 11 盘 bshard 族 maker bond 收口 | §3 一次性 admin 端点 |
| 防复发(admin-dedup 对 bshard 盘再次误选 legacy 机制) | §2.1 `dispatchRefund` 入口 isBshard fail-loud 拒绝 |
| 未来新 bshard 盘同款卡死不再靠人工发现 | §4 daemon tick 自动扫描 |
| 零新 SilverScript / 零新 covenant | §1 结论(复用既有 `refund_maker_unjoined` entry) |

## 1. 根因回顾 + 关键发现：这不需要新 SilverScript

7/12 拆雷时 NWT 坐实(`pool-market-settler.js:356-357`)：bshard 市场(有 `market_shards` 行)在committee-settle 主 tick 循环里被 `isBshard` 硬 skip——这个 skip 是 A-fix harm-stopper(防 bshard 盘被这条 legacy anonymous-pool 委员结算器误判 0-bet 退款/误结算)，**但 `dispatchRefund`→`handleRefunding` 这条 maker bond reclaim 链路的唯一入口就在这个被 skip 的循环体内**——所以只要 `market_shards` 有行，`handleRefunding` 永远碰不到，不管 `dispatchRefund` 是否已经把 `refund_tx_obj` 塞进 metadata。

今天重读 `PoolSpine_v07.sil` entry 2 `refund_maker_unjoined`(L381-398)确认：**这个 entry 完全不引用 `shard_id`/`shard_count`/`market_id`，只验 makerSig + `tx.time >= (deadline+7200)*1000` + 单输出全额回 maker**。它对"这个市场是不是 bshard"毫无感知——bshard 市场的 maker bond 就锁在同一份 `PoolSpine_v07` 合约里(`market.spine_p2sh`/`spine_lock_tx`，与非 bshard 市场同一张表同一批列)。

**结论**：不需要新 covenant/新 entry。缺口 100% 在**驱动层**(谁来调用这个已存在的链上能力)，不在链上脚本层。这跟 7/4 ABSTAIN 退款路那次"补漏·接通已有 covenant 能力·非新造机制"(`bshard-auto-settler.mjs:610-627` 注释)是同一个模式。

**架构确认(grep `pool-shard-settle.mjs` 零命中 `spine_p2sh`/`maker_stake`)**：`consolidateAllShards`(bettor 侧折叠进 PayoutShard 的机制)完全不碰 PoolSpine——maker bond(容器①)与 bettor 池(容器②/PayoutShard)是两个独立 UTXO 世系，对**任何**结局(赢/输/退款)的 bshard 市场都成立，不只是退款态。本设计只解决"退款态"的 11+1 盘积压；win 态 bshard 市场的 maker bond 收口是同构的后续卡(§5 留白，不在本次范围)。

## 2. 复用清单(查了哪些既有资产·防重造)

| 资产 | file:line | 复用方式 |
|---|---|---|
| `refund_maker_unjoined` entry | `src/lib/PoolSpine_v07.sil:381-398` | 原样复用，零改动 |
| fee 计算(mass-aware) | `pool-market-settler.js:2427-2473` `computeMassAwareV07RefundFee` | 导出后直接调用(protocol_version-agnostic，本来就只认 v0.7) |
| preimage 构建 IPC | `pool-market-settler.js:2369-2379`(`prediction_settle_build_preimage`) | 抽成共享 helper，legacy/bshard 两条路都调 |
| 签名+广播 IPC | `pool-market-settler.js:2493-2556` `handleRefunding`(`pool_refund_maker_unjoined_tx`) | 导出后直接调用，逻辑本身不含 isBshard 判断 |
| 容器②完成证据判据 | `admin-dedup.js:20-40` `hasVerifiedContainer2Evidence`(NWT 12 断言 8 负例硬化) | 原样导入复用，作为 bshard 侧的前置闸 |
| bshard 原语命名/模块惯例 | `bshard-auto-settler.mjs` `computeRefundPlan`/`cancelMarketLive`(L634-683/706+) | 新函数落在同一模块，同款命名风格 |

## 3. 设计

### 3.1 `dispatchRefund` 入口硬化(防复发·Owner 7/12 裁定④)

`pool-market-settler.js:2319` 开头加：

```js
export async function dispatchRefund(market, decision) {
  const isBshard = !!sqlite.prepare('SELECT 1 FROM market_shards WHERE logical_market_id = ? LIMIT 1').get(market.id);
  if (isBshard) {
    console.error(`[pool-settler] dispatchRefund REFUSED market=${market.id.slice(0,12)} — bshard market has no legacy refund path (market_shards rows exist), use reclaimBshardMakerBond instead`);
    return { ok: false, reason: 'bshard market — legacy refund path structurally invalid' };
  }
  ...原逻辑...
```

`admin-dedup.js` 的 `isPostContainer2` 分支目前直接调 `dispatchRefund`——加固后这条分支对 bshard 盘会被新 guard 挡下、fail-loud 返回，而不是像 7pori 那次一样静默建出一个永远不会被签名广播的错形状 `refund_tx_obj`。7pori 这次要走的是 §3.3 的新端点，不再经过 `dispatchRefund`。

### 3.2 共享 builder 提取(消灭潜在 drift)

从 `dispatchRefund` 内联逻辑中抽出（`pool-market-settler.js` 新增并导出）：

```js
// 纯计算+IPC，不碰 DB/status。legacy 和 bshard 两条路径共用同一份 preimage 构建逻辑，
// 防止"bshard 专属重写一份"未来跟 legacy 那份 drift(同 D-009 手工配对常量必失同步族)。
export async function buildMakerRefundPreimage(market) {
  // = 现 dispatchRefund L2321-2383 原样搬出(makerRow 查找/fee 计算/prediction_settle_build_preimage IPC),
  //   返回 { ok, tx_obj, makerRefundAmount, makerAddress, error? }，不写 DB。
}
```

`dispatchRefund` 改为：guard 通过后调用 `buildMakerRefundPreimage` + 自己的 DB 写回(status→refunding)。

`handleRefunding` 导出（去掉 `async function` 前的隐式私有）：

```js
export async function handleRefunding(market) { ...原逻辑不变... }
```

`handleRefunding` 内部逻辑本身已经是 protocol_version-gated(v0.6/v0.7)而非 isBshard-gated——**零改动即可直接给 bshard 市场用**，这是本设计能"零新造"的关键。

### 3.3 `reclaimBshardMakerBond`(新函数，`bshard-auto-settler.mjs`)

```js
/**
 * reclaimBshardMakerBond — bshard 市场 PoolSpine 容器① maker bond 收口(镜像 legacy dispatchRefund+
 * handleRefunding 两步，但单函数内完成 build→stash→sign→broadcast→NO-TX-NO-STATE 验证，同 cancelMarketLive
 * 单发编排风格——不搞"stash 完等下一 tick 捡"的两段式，那正是 7pori 撞见的结构缺口的同款形状,不重蹈)。
 *
 * 前置闸(全部 fail-closed，任一不满足直接拒绝不动钱):
 *   ① isBshard: market_shards 有该 market 的行(否则该走 legacy dispatchRefund，不是这条路)
 *   ② container② 已验证完成: hasVerifiedContainer2Evidence(market, sides) === true
 *      —— 复用 admin-dedup.js 现成硬化判据(NWT 12 断言 8 负例)，不是重新发明"完成"的定义。
 *      为什么这个顺序必须锁死: maker bond 是市场的"责任抵押"，container②(bettor 资金去向)
 *      未终态前放行 maker 拿回 bond 会破坏这层保护意图(即便两个 UTXO 世系彼此独立，语义上
 *      "先安顿好 bettor 才能松 maker" 是这个抵押存在的理由)。
 *   ③ spine UTXO 活体校验: relay 查 spine_lock_tx:0 confirmed 且未花费(NO TX NO STATE，不信 DB
 *      market.protocol_status 字段本身，见 reference-refund-verify-chain-not-db-claim-field)。
 *   ④ 未已收口: market.metadata.bshard_maker_bond_reclaimed_at 为空(幂等闸，防重复触发二次广播尝试)。
 *
 * @returns {ok, reason?, txId?, amount?}
 */
export async function reclaimBshardMakerBond(marketId, ctx) {
  const { db } = ctx;
  const market = db.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
  if (!market) return { ok: false, reason: 'market 不存在' };

  const isBshard = !!db.prepare('SELECT 1 FROM market_shards WHERE logical_market_id = ? LIMIT 1').get(marketId);
  if (!isBshard) return { ok: false, reason: '非 bshard 市场——用 legacy dispatchRefund/handleRefunding' };

  let meta = {};
  try { meta = JSON.parse(market.metadata || '{}'); } catch { return { ok: false, reason: 'metadata 坏 JSON, fail-closed' }; }
  if (meta.bshard_maker_bond_reclaimed_at) return { ok: false, reason: '已收口(幂等闸)', already: true };

  const sides = getSidesByLogicalMarket(marketId, db);   // pool-bettor-sides-query.mjs 既有函数
  if (!hasVerifiedContainer2Evidence(market, sides)) {
    return { ok: false, reason: '容器②完成证据未通过(hasVerifiedContainer2Evidence=false)——bettor 侧未确认终态前不放 maker bond' };
  }

  // 🔴 NWT 红队 MUST-FIX(已修复): 原 v1.1 草案的 ctx.checkUtxoLive(p2sh,txid,index) 是全新命名/零深度检查——
  // 若实现成"这一刻查 unspent=true 就放行"会撞 reorg phantom-leaf 坑(浅确认 UTXO 可能被 reorg 退掉，
  // 见 memory reference-landed-shallow-confirm-reorg-phantom-leaf)。闸③是签名广播前最后一道活体闸、
  // 也是唯一的重试安全网，必须够深度确认才敢信。改用codebase 已证的 checkUtxoLanded(minDepth)
  // (`kasia-relay/src/lib/p2sh.mjs:1465`，经 IPC `check_utxo_landed` 暴露，land-gate 同款已通过)+
  // 单源常量 REORG_SAFE_MIN_DEPTH=20(`pool-shard-register.mjs:58`，TN12 实测校准值，非本次新拍数字，
  // 全库 close/claim/register land-gate 统一在用，见 `bshard-auto-settler.mjs:553/583`、
  // `bshard-settle-daemon.mjs:183`、`pool.js:1326/1583/1762/1945` 等一致引用)：
  const { REORG_SAFE_MIN_DEPTH } = await import('../lib/pool-shard-register.mjs');
  const landedCheck = await ctx.relayPost(ctx.feeRelay.id, {
    type: 'check_utxo_landed', address: market.spine_p2sh, txid: market.spine_lock_tx, minDepth: REORG_SAFE_MIN_DEPTH,
  });
  if (!landedCheck?.landed) {
    return { ok: false, reason: `spine UTXO 未达 reorg-safe 深度确认(minDepth=${REORG_SAFE_MIN_DEPTH}, depth=${landedCheck?.depth})——闸③拒绝，不签名广播` };
  }

  const preimage = await buildMakerRefundPreimage(market);   // 导入自 pool-market-settler.js §3.2
  if (!preimage.ok) return { ok: false, reason: `preimage 构建失败: ${preimage.error}` };

  // 写回(单事务): 复用 refund_tx_obj/refund_amount 字段命名(同 legacy 形状，handleRefunding 直接认得)
  const newMeta = { ...meta, refund_tx_obj: preimage.tx_obj, refund_amount: preimage.makerRefundAmount,
                    refund_reason: 'bshard_maker_bond_reclaim', refund_dispatched_at: new Date().toISOString() };
  db.prepare('UPDATE pool_markets SET metadata = ? WHERE id = ?').run(JSON.stringify(newMeta), marketId);

  const marketRow = db.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);   // 重读拿到刚写的 meta
  const submitResult = await handleRefunding(marketRow);   // 导入自 pool-market-settler.js §3.2, 内部含 lockTime grace + IPC 签名广播 + status→refunded 写回

  if (!submitResult?.ok) return { ok: false, reason: `handleRefunding submit 失败`, preimage };

  // 幂等标记 + 审计(同 7pori 拆雷用的三层记录惯例: scratch/console.log + events 表审计行 + 频道报)。
  // 🔴 Bettor 方向审注1(MUST，已折入): chain_events 是链上事件唯一真相源，landed 前没有真 txid 时
  // 禁写占位符(如 'pending')——那是污染双锚原则(见 memory reference-...tx-log-hit-is-not-canonical
  // 同族纪律: 没有真值就不写这张表)。这里 submitResult.txId 是 handleRefunding 已验证 landed 后
  // 的真实 txid（handleRefunding 内部只有 submit 成功且拿到 txId 才会返回 ok:true，见 §3.2 复用逻辑），
  // 所以此处 chain_events 插入天然只在真 txid 存在时才执行；audit 意图的"我执行过这个动作"记录改走
  // events 表(同 notify_marker_cleared 惯例，不要求 txid)。
  let finalMeta = {};
  try { finalMeta = JSON.parse(db.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId).metadata || '{}'); } catch {}
  db.prepare('UPDATE pool_markets SET metadata = ? WHERE id = ?')
    .run(JSON.stringify({ ...finalMeta, bshard_maker_bond_reclaimed_at: new Date().toISOString() }), marketId);
  // events 表真实列(migrate.js:99-113，非我之前写岔的猜测列名): id/trace_id/event_scope/event_type/
  // source/level/summary(NOT NULL)/payload_json/created_at。
  db.prepare(`INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
              VALUES (lower(hex(randomblob(16))), 'settlement', 'bshard_maker_bond_reclaimed', 'reclaimBshardMakerBond', 'info', ?, ?, datetime('now'))`)
    .run(`market=${marketId.slice(0,12)} amount=${preimage.makerRefundAmount} txid=${submitResult.txId}`,
         JSON.stringify({ market_id: marketId, amount: preimage.makerRefundAmount, refund_txid: submitResult.txId }));
  db.prepare(`INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
              VALUES (lower(hex(randomblob(16))), ?, 'bshard_maker_bond_reclaimed', NULL, NULL, ?, 'reclaimBshardMakerBond', CURRENT_TIMESTAMP)`)
    .run(submitResult.txId, JSON.stringify({ market_id: marketId, amount: preimage.makerRefundAmount }));

  return { ok: true, amount: preimage.makerRefundAmount, txId: submitResult.txId };
}
```

**🔴 Bettor 方向审注3(note，已折入)**: `refund_tx_obj` 已 stash 但 `handleRefunding` 广播失败的中间态——重读现有代码(`pool-market-settler.js:2545-2548`)确认 `handleRefunding` 的失败分支(`!submitResult?.ok`)只 `console.error` 后 `return`，**不写任何 DB**（成功分支才把 txid+status 一起原子写入同一条 `UPDATE`），所以不存在"半写 status"的中间态——`protocol_status` 停留在 `refunding`、`refund_tx_obj` 原样留着，下次重试会重新走一遍闸③(spine UTXO 活体校验)才敢再次尝试签名广播，双花风险由闸③挡（同 catch 分支，也是零 DB 写）。**请 NWT 红队核实这个读码结论**(即：现有 `handleRefunding` 失败路径是否真的处处零 DB 写，有没有我漏看的分支)。

### 3.4 一次性 admin 端点(收口 7pori + 11 盘族·复用 `admin-dedup.js` 惯例)

`admin-dedup.js` 加一个新路由(不改现有 `/api/admin/dedup-refund`，避免那个端点继续含糊地兼两种机制——这正是 7pori 撞见的那类"入口不辨材质"隐患的镜像修法):

```
POST /api/admin/reclaim-bshard-maker-bond { marketIds: [...] }
```

内部逐个调用 §3.3，`isBshard` 校验失败/`hasVerifiedContainer2Evidence` 失败都在响应里逐条报错，不是"要么全通过要么整批拒绝"。**执行仍需 Bettor 明确批字样**(钱路铁律不因为有 admin 端点就降级)。

### 3.5 防重复触发

`meta.bshard_maker_bond_reclaimed_at` 幂等闸(§3.3 前置④)+ `handleRefunding` 自身的 `refund_tx_obj`/`refund_amount` 缺失即 skip 逻辑（已存在，见 `pool-market-settler.js:2504-2515`）双重防护。

## 4. daemon 自动化(防未来复发·非本次 BLOCKING)

`bshard-settle-daemon.mjs` 主 tick 里加一段（沿用现有 `MAX_PER_TICK` canary 节奏+独立 kill switch，同 `ZK_CLOSE_TICK_ENABLED` 模式）：

```js
const BSHARD_BOND_RECLAIM_ENABLED = process.env.BSHARD_BOND_RECLAIM_ENABLED === '1';   // 默认 OFF
// tick 内: 扫 protocol_status='refunded' AND market_shards 有行 AND metadata 无 bshard_maker_bond_reclaimed_at
//   的市场（LIMIT MAX_PER_TICK），逐个调 reclaimBshardMakerBond。
```

本设计**只交付 §3(一次性收口 + 防复发硬化)**，§4 daemon 挂载留作后续卡(先人工/admin 端点验证这条链路本身正确，再谈自动化——同 7/12 拆雷"今晚不熬夜写钱路新码"的风险不对称纪律，白天窗口也不该跳步)。

## 5. 范围边界(明确排除，禁扩大)

- **不覆盖 win 态 bshard 市场的 maker bond 收口**（§1 末段指出的同构后续问题）——本次只清"退款态"积压(7pori + 11 盘族)。
- **不覆盖 54 盘非 bshard refunding 积压**（另一根因，NWT 已确认"另因"，队列(b)单列）。
- **不改动容器②(PayoutShard)任何逻辑** — `hasVerifiedContainer2Evidence`/`cancelMarketLive` 原样只读引用，零修改。

## 6. 测试计划

- 离线单测(镜像 `admin-dedup.test.mjs` 风格): `reclaimBshardMakerBond` 对 8+ 类负例(非 bshard/容器②未完成/spine 已花费/已收口幂等/metadata 坏 JSON)fail-closed 断言。
- **11+1 盘族 dry-run(不广播，只跑到三闸判定，打印每盘判定结果)。**
- 7pori 单盘实跑(NWT+Bettor 链验，同 7/12 容器①流程：dry-run→NWT 复核→Bettor 明确批字样→执行→链验→回读)。

### 6.1 交付定义(🔴 Bettor 方向审注2，MUST，已折入——防验收口径漂移)

本原语**只收口容器①**（PoolSpine maker bond）。11 盘族里若有市场容器②(PayoutShard/bettor 侧)尚未终态，闸②(`hasVerifiedContainer2Evidence`)会**正确拒绝**——这是 fail-closed 设计意图的体现，不是 bug，也不是"没做完"。

**交付物 = 三闸判定清单**（11+1 盘逐盘：isBshard✓/容器②证据✓或✗/spine 活体✓或✗ → 通过 or 拒绝+原因），而非"11 盘全部清零"。**通过闸的盘执行收口；被闸②拒绝的盘转"容器②先行处置"另立卡**（不在本设计范围内趁手带做，容器②本身的处置是独立决策，需要单独设计→红队→批）。汇报时逐盘列出通过/拒绝及原因，不允许笼统报"收口完成"掩盖被拒盘的存在。

## 7. 待 NWT 红队的点(主动列，非等红队自己找)

1. §3.3 前置②③④顺序是否需要调整（例如 spine 活体校验是否该在 hasVerifiedContainer2Evidence 之前，减少无谓 RPC）？
2. `buildMakerRefundPreimage` 抽取是否会影响 legacy 路径既有回归测试（`pool-market-settler.js` 相关 test 需要跟着挪 import）？
3. `handleRefunding` 导出后是否有其他隐含的"只应模块内调用"假设（比如全局 mutex/lease）我漏查？
4. §3.4 新端点 vs 复用 `/api/admin/dedup-refund` 加 isBshard 分支——是否复用更好（减少端点数量）而非新增？我倾向新增(理由=不让一个端点继续兼两种材质)，但这是可讨论的权衡点。
