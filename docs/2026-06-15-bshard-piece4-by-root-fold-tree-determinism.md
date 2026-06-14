# #26 bshard 件4 — by-root 多级 fold 树 cross-node determinism (J1 spec)

> **日期**: 2026-06-15
> **作者**: J1 (pool 内核 / SS / cross-node determinism own)
> **性质**: 设计 spec。件4 = 多级 hierarchical fold 树的【跨节点 byte-equal 派生】。实施 gated post-demo (§4)。
> **分工** (J2 r-msg 对齐): NWT own #2 PoC (攻击 determinism); J2 co-verify 两节点 fold-root byte-equal
>   (复用 committee byte-equal 验法: 双 vantage 跨节点 DB root 对照); **J1 (本 spec) = auto-form 多级 fold
>   实现 + by-root 树派生算法 + 两轴扫**。
> **前置**: 件1 (PoolSpine_v07_shard 叶 register_bet) + 件2 (fold auto-form #[covenant], fccaea6c) 定稿。
> **铁律先验**: 真读 DECL.md (OpInputCovenantId/OpCovInputCount/readInputState/validateOutputState 已 fold
>   用); 记忆 [[cross-node-determinism-review-two-axes]] 两轴 + [[live-e2e-catches-what-synthetic-misses]]。

---

## 0. 命门 (为何 determinism = 死活)

K=23 (J2 tx-mass 实测, per-fold 用 K=16 留 headroom) → 任何 pool >16 片**必多级 fold 树**。
**若树结构 node-local 派生 (谁提交 fold / UTXO 收到顺序) → 两节点不同分组 → 不同 fold-root → settle fork**
(= 跨节点 committee_pk_hash 命门同类 [[cross-node-determinism-review-two-axes]] ②地址派生轴, #22 zombie 同病)。
∴ 树结构 (shard 序 + k 叉分组 + 层级 + 每 fold 输出地址) **必 100% chain-anchored 派生**, 任意节点算出**byte-equal
fold TX 序列**, 零 node-local 输入。

---

## 1. 树派生算法 (deterministic, 每节点同算)

### 1.0 shard-SET completeness determinism (NWT #2 残留子面修, J2 finality-snapshot 法)

⚠ **树 byte-equal 的前置**: 两节点必先 agree【WHICH shard UTXOs 在集】。若取 node-indexed tip → node B ingestion-lag
没 index 某已上链 shard → A 集 {0,1,2,3} vs B {0,1,2} → 异树 → fork (= committee 池 chain-derived 非 node-local
同课 / #22 zombie 同病, NWT 抓)。
**修 (J2: 复用既有 committee 池 snapshot-by-finality 机制)**: shard 集 = **chain-derived snapshot @ `deadline_daa
+ FINALITY_N`** (= committee `snapshot_daa = currentDaa − FINALITY_N` 同锚法) → 两节点 **post-finality 取相同
confirmed 集** (非 node-indexed tip → 消除 ingestion-lag fork)。
- 集 = **所有匹配 `market_id`/cov_id 的 confirmed shard UTXO @ snapshot** (rolling on-demand 创, **非固定 ctor
  shard_count** — 06-02 Q1 witness 无限)。
- **empty/unfunded shard** (rolled 但 0 bet, genesis localYes/No=0) **一致在树** (占 shard_id slot, 0 tally 不影响
  Σ) → 两节点同集同树。

输入 (全 chain-anchored, 非 node-local):
- shard 集 = §1.0 finality-snapshot 集 (`market_id`/cov_id @ deadline_daa+FINALITY_N confirmed)。
- 每片 `shard_id` (create 时 distinct P2SH w/ distinct shard_id, ctor 锚 + genesis localYes/No=0 焊 = 唯一+0起,
  NWT/J2 双验) = 树排序 key。outpoint 仅作 fold TX 输入引用 (不作排序 key — outpoint txid 提交时序歧义, J2 已撤
  outpoint-tiebreak)。

**FOLD_K = 16** (per-fold 叉数, J2 实测 K=23 留 headroom; 编译期 `max_fold_ins`)。

```
派生 fold 树 (pure fn of shard set, 零 node-local):
  L0 = shards 按 shard_id 升序排列 [s_0, s_1, ..., s_{shard_count-1}]   # shard_id 是 ctor 锚 = 确定序, 非收到序
  level = 0
  while len(L_level) > 1:
    L_{level+1} = []
    for g in chunk(L_level, FOLD_K):           # K-at-a-time 确定分组 (前 K 个一组, 顺次)
      root_g = fold(g)                          # auto-form fold: Σ localYes/localNo, conserve EXACT
      L_{level+1}.append(root_g)
    level += 1
  ROOT = L_level[0]                             # 单 root UTXO 携 globalYes/globalNo
```

**确定性来源** (每条都非 node-local):
1. **序**: shard 按 `shard_id` 升序 (ctor 锚, 非 UTXO 收到顺序 / 提交者)。⚠ 不用 outpoint 排序 —— outpoint 含
   txid 受提交时序影响; shard_id 是 create-v07 ctor 焊死的逻辑序, 两节点 byte-equal。(若用 outpoint 必证其
   deadline 后唯一确定; shard_id 更稳。)
2. **分组**: `chunk(L, 16)` = 前 16 个一组顺次 (确定), 最后一组可 <16 (fold 接受 prev_states.length ∈ [1,16])。
3. **层级**: while-loop k→1 收敛, 层数 = ceil(log_16(shard_count)) 确定。
4. **每 fold 输出地址**: fold 中间/root UTXO 的 P2SH = **本 cov 模板派生** (同 PoolSpine_v07_shard 脚本 cov_id,
   ①合并 → 中间复用本模板) = 链上 cov 模板确定, **非 relay_nodes node-local 查** (②地址派生轴铁律)。

---

## 2. byte-equal fold TX 序列

每 fold step = 1 TX (K 输入 shard/中间 → 1 输出中间/root)。整树 = `Σ_level ceil(len(L_level)/16)` 笔 fold TX。
**任意节点从 §1 算法派生出【同序、同分组、同输入 outpoint、同输出地址】的 fold TX 序列** → byte-equal。
- 输入选择: 每组的 K 个 shard/中间 UTXO outpoint 由 §1 序 + 上层 fold 输出确定 (上层 fold TX 的 output outpoint
  = 下层 fold 的 input, 链式确定)。
- 谁广播无关: fold permissionless (件2 零 committee-sig, conserve 精确无法偷值) → 任意节点/任意人广播同一 fold
  TX, 先上链者胜, 重复广播被 mempool 去重 (同 outpoint 双花拦)。**广播者 ≠ 树结构输入** (命门守住)。

---

## 3. self-heal by-root recompute (缺中间 UTXO 的节点)

复用今天 committee `ensurePoolSnapshotByRoot` self-heal 思路 (impl plan §1 件4):
- 节点缺某中间 fold UTXO (没收到该 fold TX 广播) → **by-root 重算**: 从链上 shard L0 + §1 算法重新派生该子树 →
  重建/重广播缺失 fold TX (idempotent, 同 outpoint 已上链则 no-op)。
- quorum-timeout 兜底 (impl plan §2 Q4): 某 fold TX 卡 → 子树 retry (任意节点可完成); root 永不成 → 超时全片退
  (各叶 localYes/localNo 退本注, refund 边界)。

---

## 4. 两轴扫 (determinism 铁律 [[cross-node-determinism-review-two-axes]])

- **①算术轴**: fold 求和全 **BigInt sompi 零 float** (localYes/localNo 已 int sompi); conserve 逐 sompi assert
  (件2 `require(out==Σin)` EXACT, 非 >=); NWT③ overflow 上界 (<2.1e15) 防 wrap。迭代序 (L0 shard_id 升序) 固定。
- **②地址派生轴**: fold 每输出 (中间+root) P2SH **从本 cov 模板派生** (cov_id 链锚, validateOutputState 续延本
  模板) — **非 node-local relay_nodes 查**。⚠ NWT #293 抓过的 makerFee node-local 查同病 → 件4 必全输出 pk/cov
  派生自链锚。shard L0 输入 outpoint 由 deadline 后链态唯一确定 (非 P2SH-scan, impl plan §4 防 NWT ★#1(a))。

---

## 5. 分工 + 验收 (J2 r-msg 对齐)

| 角色 | 职责 |
|---|---|
| **J1 (我)** | 本 spec + auto-form 多级 fold SS (件2 fccaea6c 定稿) + by-root 树派生算法 (§1) + 两轴自扫 (§4) |
| **NWT** | #2 by-root determinism PoC (攻击: 喂 node-local 序/分组 / 伪中间 UTXO / 跨节点不同树 → 验 settle fork 不可达) |
| **J2** | fold 调度 (谁广播何序, permissionless) + co-verify 两节点 fold-root byte-equal (双 vantage 跨节点 DB root 对照, 复用 committee byte-equal 验法). pot 模型已定 (§6, 既有设计 06-02, tally-only) |

> **NWT #2 PoC review (5b64a730)**: §1 树派生 + §4 ②轴 **defended NWT 3 vectors ✓** — ①node-local 序→shard_id
> ctor 锚 (非 outpoint/提交序) ②伪中间→cov_id grouping (①merge) + outpoint 由 §1 链式定 ③②地址轴→cov 模板派生。
> J2 ratify shard_id 排序 (撤 outpoint-tiebreak). 决策三方收敛, NWT 续 full PoC。

**验收** (post-demo, §4 gated): 真多片 e2e (28+注多片 fold→root→settle), 两节点 fold-root **byte-equal**
(双 vantage DB 对照) + settle 三方分账跨节点落链 + NWT PoC 全不可达。基准: 单片 46f8a/xfu62 19/19 仍 PASS。

---

## 6. pot 模型 (J2 r-msg 已定·既有设计 docs/2026-06-02-bshard-rolling-design-consensus, 不重造) + 余项

**pot 模型 = 已定 (关闭原开放项, 简化 件4)**: shard UTXO = **tally state (localYes/localNo) + dust (KIP-9 floor),
**非 pot 本金**。bet 本金 (真钱) 在 **per-bet side_locks** (现 v07 资金锁机制不变)。
∴ **fold 只折 tally, 无 pot/value 守恒维度** (§1 fold step 不多 fold pot 标量; §2 fold TX 无 value 守恒 —— shard
是 dust 非钱 → fold TX storage-mass 低, 印证 J2 K=23 = size-mass 主导)。**conserve 只 tally 一维** (§4 ①轴不变)。
**settle (Q4 既定, 各片独立并行)**: 关池锁全局比率 (fold-root globalYes/globalNo 定 YES/NO 赢方比), 各片
**独立结**, 各从**自己 side_locks** 付本片 winners (非全有全无; 某片失败走 PoolSide refund)。fold-root 只供
【全局比率】, 不经手钱 → 件4 fold 树纯 tally 派生, 真钱不进 fold TX。

**shard SET @ close (rolling reconcile, 06-02 Q1=B witness 无限)**: shards 滚动生长 (顺序填, shard_id 0,1,2..
按开片序 = 链上 genesis 事件序 = 确定)。**fold 树的 shard 集 = deadline 前所有已开 shard** (链上 genesis 截至
deadline, 非 node-local)。shard_count @ close = 该集大小 (witness 背书, 非 ctor 固定 — 与 06-02 Q1 一致)。§1
"按 shard_id 升序" 即此开片序, 两节点同 (链上 genesis 序确定, J2 已 ratify 撤 outpoint-tiebreak)。

**余项**:
- **FOLD_K 终值**: 本 spec 用 16 (J2 K=23 留 headroom); J2 final compile auto-form @ K 确认后定。
- **件3 commit 接入**: ROOT.localYes/localNo → settle_aggregate introspect 读 (替 committee-sig 背书) +
  `require(blake2b(globalYes‖globalNo‖market_id‖shard_count)==commit_v2)`。**这正是 06-02 doc 顶 ⚠ 推翻"链下
  绕路"后的 trustless 链上升级** (Owner catch: silverc 实有 introspection/covenant/int-to-byte → commit 链上
  硬校验激活, 非 committee-sig fallback)。件3 spec 另出。

---
*J1 件4 spec。设计 by 5-agent §4 收敛 + 本会话 J2/NWT 三方裁 (auto-form K=23 → 多级树 by-root)。impl gated post-demo。*
