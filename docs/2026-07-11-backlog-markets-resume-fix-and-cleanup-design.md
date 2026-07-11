# 积压盘清退设计：resume-skip 高价值修 + 115 终局退款判据 + 18 backfill 救活

> **Status**: DRAFT（J2 出稿，待 NWT 红队 + Bettor 方向审，落码前不动任何代码，铁律0）

## 0. 范围（NWT `scratch/_nwt_129_backlog_classify.mjs` 分类结果，本文档直接引用不重算）

分类 SQL 判据（`protocol_version='v0.7' AND deadline_daa IS NOT NULL AND deadline_daa+60<=currentDaa
AND ((settle_txid IS NULL AND protocol_status IN ('pending_bettors','verifying')) OR
protocol_status='settled_partial_claims') AND 非 zk_native`）命中 174 个市场（数字随时间推移变化，非固定
129），按 bettor 分布 + 可达性（`spc_daa_index_coverage` 覆盖 或 `gap<=MAX_WALK`）分五桶，本文档只处理
`has_winners_*`（真实双边下注，非零注/非单边）这一支的三个子桶：

| 桶 | 数量 | 判据 | 处置 |
|---|---|---|---|
| A（本文档主体，高价值） | 29 | `protocol_status='settled_partial_claims'`（**已 attest 落链**，卡在 claim 循环） | §1 resume-skip 修 daemon 本身 |
| B | 115 | 未 attest + `deadline_daa` 早于剪裁点（物理不可判，任何 backfill 都救不回——祖先块已被 kaspad 剪裁物理删除，非索引缺口） | §2 终局批量退款 |
| C | 18 | 未 attest + `deadline_daa` 晚于剪裁点（backfill 理论可救，只是当前 `spc_daa_index_coverage` 还没覆盖到那么远） | §3 backfill 扩覆盖 |

**剪裁点是活值，必须执行时重新实测**（今晚早前 J1 查到的 56461401 只是那一刻的近似值，kaspad 剪裁点
持续推进）——`rpc.getBlockDagInfo().pruningPointHash` → 该 hash 的 `header.daaScore` = 当前真实剪裁点。
分类脚本里的 `currentDaa`/`cov` 同理，执行时重新查一遍，不用本文档写的任何数字兜底。

## 1. 桶 A（29，高价值）：resume 时无条件重跑 computeSettlePlan 撞 MAX_WALK

### 根因（读码坐实）

- `_settleOneMarketAttempt`（`bshard-settle-daemon.mjs:479`）**每次**被 daemon tick 捡起都先调用
  `computeSettlePlan(marketId, ctx)`（pre-flight plan check），不管市场是全新的还是已经
  `settled_partial_claims`。
- `settleMarketLive`（`bshard-auto-settler.mjs:143`）**自己也**在最开头无条件调用一遍
  `computeSettlePlan`（两处调用点，同一个 tick 内实际跑两次 plan 计算）。
- `computeSettlePlan` 内部 `ctx.endBlockHash(market.deadline_daa)`（`bshard-auto-settler.mjs:86`）
  **对所有市场无条件调用**，走到 `chainReader.getBlockAtDaa` → backward walk → 撞 `MAX_WALK`。这一步
  是为了派生 committee VRF 种子（`deriveCommitteeSeed`），只有"还没 attest 过、需要重新选委员签名"
  的市场才需要它。
- 但 `settleMarketLive` 已经有 resume 分支（`bshard-auto-settler.mjs:159`，2026-07-05 7rztt 案例修的）：
  若 `metadata.settle_evidence.close_txid` 已存在，**跳过 build/sign/submit/verify close（步骤0-6）**，
  直接进 claim 循环——这个 resume 分支证明"已 attest 的市场不需要重新走 committee/close"这件事本身
  是已经被验证过的判断；只是**触发这个 resume 分支之前，两处 `computeSettlePlan` 调用已经把
  getBlockAtDaa 撞了一遍，根本走不到 resume 分支**。29 个桶 A 市场全部卡在这个"该判断资格之前先炸"
  的位置。

### 方案：resume-plan 直接从持久化态派生，跳过 judge+committee+getBlockAtDaa

`settleMarketLive` 的 resume 分支（`priorEvidence.close_txid` 存在时）在 claim 循环里实际只用到
`plan` 的这几个字段：`plan.winners`（喂 `winnerClaimData`）、`plan.payoutRoot`、`plan.poolSompi`。
**不用** `plan.committeeMeta`/`plan.expectedClosedAddr`/`plan.committeePkHash`（那些只在"还没 close"
的 fresh-close 分支里用，resume 分支代码路径完全不碰它们）。

- 新增 `deriveResumePlanFromEvidence(marketId, ctx)`（`bshard-auto-settler.mjs`，与 `computeSettlePlan`
  同文件，同源复用 `getMarketBets`/`computePariMutuelPayout`，**不重新实现 pari-mutuel 算法**）：
  1. 读 `market.metadata.settle_evidence`——若 `close_txid` 不存在，返回 `{ok:false}`（不是本函数的
     场景，调用方回退原 `computeSettlePlan`）。
  2. 若存在，直接用 `evidence.win_direction`（已经是链上 committee attest 确定过的值，不重新 judge）
     + 现读 `getMarketBets`（跟 `computeSettlePlan` 同一份数据源，仍然独立重算，不透传 evidence 里的
     `winners` 数字本身）调 `computePariMutuelPayout` 重算一遍 `payoutLeaves`，**必须** ==
     `evidence.payout_root` 对应的 leaf 集（用 `buildPayoutRoot` 重算 root，跟 `evidence.payout_root`
     byte-exact 比对，不等就 `{ok:false, reason:'resume evidence 与本地重算不一致——拒绝, 走原 computeSettlePlan
     人工核查'}`，fail-closed 不是 fail-open）。
  3. 返回 `{ok:true, betCount, poolSompi, winDir: evidence.win_direction, payoutRoot: evidence.payout_root,
     winners: <重算的 payoutLeaves>}`——**零 committee 字段**（resume 分支从不需要）。
- `settleMarketLive` 改动（最小侵入）：在现有第一行 `const plan = await computeSettlePlan(marketId, ctx)`
  **之前**，先查一遍 `priorEvidence.close_txid` 是否存在（本来 resume 分支下面第 156-158 行就在读这个
  值，提前到函数最前面读一次即可，不重复查询）——存在则调 `deriveResumePlanFromEvidence` 代替
  `computeSettlePlan`；`ok:false`（重算不一致的 fail-closed 分支）则**仍然回退**调原 `computeSettlePlan`
  （宁可撞一次 MAX_WALK 走到人工可见的失败，也不用一个自己都不信任的 resume plan 继续往下 claim）。
- `_settleOneMarketAttempt` 侧同款：line 479 的 pre-flight `computeSettlePlan` 调用同样加这个前置判断
  ——**这是本次要修的两个调用点，缺一个 29 个市场里凡是先撞 `_settleOneMarketAttempt` 那层 pre-flight
  的还是会卡住**（两处都要改，同一份判断逻辑抽成共享 helper，不写两遍）。

### 边界

- 不改 `computeSettlePlan` 本身一个字——它对"从未 attest 过"的市场（桶 B/C 和所有正常新市场）仍然是
  唯一正确路径。
- 不改 resume 分支下游的 claim-thread 逻辑（`priorWinnerDetails` 位置匹配等，2026-07-05 已验证代码）
  一个字。
- fail-closed 而非 fail-open：重算不一致时退回原路径撞 MAX_WALK 失败（今天已知、可见、可告警的失败
  模式），不是"将就用一个可能错的 resume plan 继续 claim 真钱"。

## 2. 桶 B（115）：终局批量退款——判据死线

**判据**：`protocol_status IN ('pending_bettors','verifying') AND settle_txid IS NULL`（从未 attest）
**且** `deadline_daa < 剪裁点`（执行时现测：`getBlockDagInfo().pruningPointHash` 对应块的
`header.daaScore`）。这条件下 `endBlockHash(deadline_daa)` **理论上永远不可能求出**——不是索引缺口
（backfill 能修的那种），是判定所需的祖先区块本身已经被 kaspad 物理剪裁删除，全网任何全节点都不再持有
（除非有归档节点，7/9 已确认 Owner 侧无归档节点，`reference-tn10-mining-consolidated` 同一结论）。这
是纯技术死结，不是待优化项。

**处置**：复用 lv3rz/shard9/shard10 已验证的 `manual_recovery_refunded` 精神（同一 runbook，只是这次
是"整个市场从未 attest 就死"而非"部分 shard phantom"）——批量退款：每个市场按 `getMarketBets` 现读
全部 bettor（无需 winDir，无胜负判定，纯"钱原样退回"）逐笔转回对应 bettor 的托管地址，`protocol_status`
转一个新终态标（沿用现有惯例，与 `settle_failed` 区分开——那个还留重试希望，这个已经判死；具体标名
留给 NWT/Bettor 裁定，不在本文档抢先定，防止跟其它终态语义冲突）。**115 个市场逐个跑同一份 runbook**
（批处理脚本，非手写 115 次），每笔转账前后核对余额，同 Martin/shard9/shard10 三次退款执行的纪律
（三方独立核对+audit trail 进 events 表）。

**maker_stake（spine）一并退**（Bettor #gjknx9.2 裁定，桶①②的 5 盘先验证的原则，桶 B 同样适用）：
市场整体作废时，maker 的 spine 出资跟 bettor 的下注同一性质——都是"没被合法赢走的钱"，原样退回 maker
地址，不留在 covenant 里变孤儿资金。同一份 runbook 把 maker 当成一笔特殊"bettor"（金额=spine，方向
无关）处理，不新开一套机制。

## 3. 桶 C（18）：backfill 扩覆盖，复用既有 v183 机制零新代码

`spc_daa_index`/`spc_daa_index_coverage`（今晚 `9b04d535` 已落码验证）当前只覆盖 28mln 专属区间
（今晚 backfill 只跑了 `[57209579, tip]`）。这 18 个市场的 `deadline_daa` 在剪裁点之后、但早于
28mln 覆盖区间起点——**只需要再跑一次 `scratch/_j2_28mln_spc_daa_index_backfill.mjs` 同款 backfill，
把 `floorDaa` 参数改成"这 18 个市场里最早的 deadline_daa"而非 28mln 专属值**（脚本本身已经是
"从 tip 往回走到指定 floor"的通用逻辑，只是硬编码了 `MARKET_ID='...28mln'` 去查 `deadline_daa`——
改成接受一个显式 `--floor-daa` 参数，或直接查这 18 个市场里 `MIN(deadline_daa)`，零算法改动，只是
参数化）。跑完之后这 18 个市场会自然落进 `spc_daa_index_coverage`，下次 daemon tick 走**正常路径**
（非本文档 §1 的 resume 分支——这些市场还没 attest 过，走的是 `computeSettlePlan` 第一次真实
judge+attest，只是这次 `getBlockAtDaa` 能查表命中，不再撞 MAX_WALK）。

## 4. 执行顺序（Bettor 裁定，本文档记录不重复决策）

①③（§1 resume-skip 代码 + §3 backfill 扩覆盖）优先——用户面价值最高（真实赢家能拿到钱）。
②（§2 终局退款）跟着走，判据死线明确后可与①③并行执行（不同市场，无money-path 交叉）。

## 5. 验收

1. §1：offline test 覆盖 `deriveResumePlanFromEvidence`——(a) 无 `close_txid` 时返回 `{ok:false}`
   回退原路径；(b) 有 `close_txid` 且重算 payoutRoot 匹配时返回正确 resume plan；(c) 重算不匹配时
   fail-closed 回退（负例，防止"将就用"退化）。
2. §1：29 个桶 A 市场里挑 1-2 个真实跑一次，daemon tick 不再抛 MAX_WALK，直接进 claim 循环续跑完成，
   J2 手动核对全链（同今晚纪律）。
3. §2：115 个市场批量退款 runbook 先 dry-run 出全量清单（bettor+地址+金额）给 Bettor/NWT 过一遍再
   真执行，任何一笔金额跟链上 UTXO 对不上就整体不动（fail-closed，不做部分执行）。
4. §3：backfill 跑完后现查 `spc_daa_index_coverage` 是否真覆盖这 18 个市场的 `deadline_daa`，读回
   验证（同今晚 9b04d535 backfill 脚本尾部的 sanity check 模式）。
