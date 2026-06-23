# bshard 接进生产 — block ① 编排接 create-v07 lifecycle 设计

**作者**: KANet-UI-tn (2026-06-20) | **block**: ① (Owner "bshard 接生产=新主线" B 轨)
**scope**: 单片 (shardCount=1) 端到端 API wire 先落，复用 DoD 已验的 skip-fold 路；多片 (②) 叠加。

## 1. 现状 (ground，非记忆)

两条**独立**路，从未在 API lifecycle 里连起来：

| 阶段 | v07 老路 (生产在跑) | bshard cascade (DoD 验过，手动 driver) |
|------|------|------|
| 建市 | `create-v07` (pool.js:789) → spine P2SH + pool_markets row。**已有 `shard_id/shard_count` 参 (默认 0/1)**，但多片"批3后开放"未开 | `computeConvertSplitGenesis` (pool-bshard-market-setup.mjs) → ShardLeaf_direct genesis |
| 押注 | `bettor/register` (pool.js:1154) → PoolSide P2SH | register_append → ShardLeaf state (count++/pool_value+=stake) |
| 结算 | `poolSettlerTick` (pool-market-settler.js:276, 5min cron, status=verifying & deadline 过) → `pool_settle_tx` **单 TX**(51-input→170-chunk = **880 天花板**) | cascade: convert_to_rootclose→seal→committee close_commit→convert_to_claim→claim_draw (分片，无 880 墙) |

**∴ ① 的本质**: 把手动 driver (`_j2_full_stitch`) + v07 单 settle 换成 **API 触发的分片 lifecycle**，让 create-v07 建的市场走 bshard 分片无限路而非 v07 880-limited 单 settle。

## 2. 三个 hook 点

### (a) 建市 — create-v07 加 bshard-mode
- 入参加 `settle_mode: 'bshard' | 'v07'`(默认 v07 保现有生产不破，additive)。
- bshard-mode: 调 `computeConvertSplitGenesis(shardCount=1 → directSeal 分支)` 产 ShardLeaf_direct genesis；market row 记 `settle_mode='bshard'` + genesis artifact (rootClose/rootClaim tmpl_hash、committee_hash baked)。
- 单源纪律: genesis 口径必走 pool-bshard-market-setup.mjs 单源 (同 ② route-split)。

### (b) 押注 — bettor/register 分流
- bshard market: bet → register_append (ShardLeaf state) 经 relay `bshard_register_bet` handler (已 merge)，锁 stake 到 ShardLeaf 而非 PoolSide。
- merkle/nullifier: R7 claimed-bitmap 已在 RootClaim.sil (③ 确认)，register 累积 winner-tree leaf。

### (c) 结算 — poolSettlerTick 分支
- `poolSettlerTick` 加分支: `if market.settle_mode==='bshard'` → 编排 cascade (convert_to_rootclose→seal→**committee close_commit**[复用 oracle 委员 quorum 投票产 winningSide+payoutRoot]→convert_to_claim→claim_draw) 替 `pool_settle_tx`。
- 委员投票: 复用现有 oracle voter (judgeLine 确定性判 → winningSide)，close_commit 用 4-of-5 committee_hash 门 (DoD 验过)。
- 状态机: pending_bettors → (deadline) verifying → **sealing → closing → claiming** → completed (新增 3 态，对应 cascade phase)。

## 3. 单片先行 (shardCount=1, skip-fold)
DoD 已链上验 skip-fold 路 (ShardLeaf_direct convert→RootClose 跳 FoldNode)。① 先 wire **单片**端到端 (create→register→cascade settle)，不等多片 ②。多片 = ② route-split LAND 后，create-v07 shardCount>1 → 多 ShardLeaf + FoldNode 聚合，settle 编排多片 fold。

## 4. 依赖 & 顺序
- **③ R7**: 已闭 (claimed-bitmap in RootClaim.sil)。✅ 单片 wire 可用。
- **② route-split 多片**: 单片不依赖；多片 wire 等 ② LAND。
- **④ refund-merkle**: gate-off interim (closed==2 不触发)，单片 happy-path wire 不碰；真上线"市场可取消"前等 ④ Design A。
- **命门③ settle-enforce** (NWT 生产前置): settle 编排 cascade 时 predicate 必对链上承诺 (marketMetadataHash) 核，非只信 DB。wire 时一并。

## 4b. Bettor attack-review 补 4 承重 gap (都 bettor 面，非只内部 settle)

### 🔴1 claim_draw=pull vs v07 自动付 — **必补，否则 DM 闭环断**
- 问题: bshard claim_draw 是 **pull 模型**(winner 主动 claim 才拿 payout)；v07 是 settle 一笔**自动付所有赢家**。dtzt0 demo "🎉赢 126KAS" 靠的就是 v07 自动付。bshard 不 auto-claim → 赢家 payout 不自动到账 → 可见兑付闭环断。
- **解**: hook (c) cascade 编排里 settler **代 winner auto-claim**: ...→convert_to_claim→RootClaim→**settler 对每个 winner 自动跑 `claim_draw`(relay `bshard_claim_winner` handler，已 merge)→ 自动付 payout 到 winner P2PK** → completed。= 保留 v07 auto-pay UX(winner 零操作)。winner 集从 register 累积的 winner-tree + judgeLine winningSide 取。
- 牙: settler auto-claim 必付**全部** winner(漏一个=该 winner 钱卡)；claim_draw 用 R7 claimed-bitmap 防双领(③ 已闭)。

### 🟠2 新 3 态 user-facing 同步
- sealing/closing/claiming 3 新态 → bot prediction-menu + my-positions status 映射只认 won/lost/settled_pending/open → 新态 fall-through unknown/显示破。
- **解**: status 映射加 3 态 → 显 "结算中"(settling)。改 bot prediction-menu + my-positions + /api/pool/markets 派生侧单源映射(同 [[lib/spec-validation]] 单源纪律)。

### 🟡3 register 分流覆盖全押注面
- bot / dm-bet-e2e / api `bettor/register` 都必 branch `settle_mode` → bshard market 付 ShardLeaf(register_append)非 PoolSide，非只内部一处。

### 🟡4 genesis 在 create bake committee_hash
- create 时 genesis bake `committee_hash`(blake2b(c0..c4))→ **委员 liveness 建市时就锁**(确定性，非 settle 采样)= NWT 委员-liveness 前置在 create 满足，比 oracle 那边 settle-时采样更强(委员集 create 即固定上链)。

## 4c. NWT attack-review 2 承重硬化 (Bettor 裁定 load-bearing，落码前必有 spec+牙)

### 🔴A 命门③ settle-enforce — 硬 binding，不是一行带过 (生产最关键安全闸)
- **威胁 (NWT 点准)**: close_commit 的 4-of-5 committee_hash 门只绑【谁签】，**不绑【判的是哪个谓词】**。`winningSide` 是 close_commit 的**输入**，SS 合约不强制它 == 链上承诺谓词的判定结果 → 恶意 settler/委员可塞任意 winningSide 盗对侧池。
- **enforce 解 (settle 编排里硬做)**: settler 跑 close_commit 前，**必 re-derive winningSide**：
  1. 从市场 on-chain 承诺读 `resolution_predicate` (marketMetadataHash → spine P2SH 里烤的，命门③ commit-exists)，**不信 DB**(DB 可被改)。
  2. `judgeLine(predicate, fields)` 确定性算 winningSide (fields 从 ESPN extractEspnFields，源验)。
  3. close_commit 的 `new_winningSide` **必 == re-derive 值**，否则 settler **拒发**(abstain，不结)。
- = settle 把"谁签"门 + "判对谓词"绑死。这是 oracle 那边 wave2 已验的 judgeLine 确定性 + 命门③ commit 的**生产级合体**。
- **牙**: settler 喂错 winningSide (不等 re-derive) → 必拒发 (修后 BUST)；撤 re-derive 校验 → 错 winningSide LAND (盗池，修前 LAND)。单变量 diff。

### 🟡B create-bake 委员反向 liveness 风险 → fallback 绑 ④
- **风险 (NWT 新发现)**: create 时 bake committee_hash 锁委员集 = 确定性强 ✓，但 create→settle 隔时，**baked 委员 settle 时离线 → 4-of-5 凑不齐 → 市场卡死无法结**。v07 settle-采样能挑活委员，create-锁定牺牲了这个。
- **解 (fallback，绑 J1 ④ refund 路)**: baked 委员 settle 时不足额 (quorum-timeout) → **timeout-refund** 走 J1 ④ RefundClaim (committee-liveness fallback consumer，J1 已扩 ④ scope 纳这条)。= 委员离线不锁死钱，退款兜底。
- **单片 wire**: 先标这条为【生产硬前置】，happy-path 单片 demo 委员在线可控；真上线前 ④ refund 路 + quorum-timeout 触发必齐。

## 5. 牙 (每步攻击/边界，修前 LAND 修后 BUST)
- (a) bshard-mode market 不可被 v07 pool_settle 误结 (settle_mode 分支硬隔离)。
- (c) cascade settle 中委员 close_commit 必 4-of-5 真 quorum (DoD 委员门 teeth 复用)。
- 单片 e2e: create-v07(bshard)→register→cascade settle→claim 落链，四方 co-verify (复用 DoD 验法)。

## 6. ETA / 交付
- 设计 doc (本文件) = 第一轮，报 Bettor 审。
- 落码: (a) create-v07 settle_mode 分支 + genesis 调用 / (b) register 分流 / (c) poolSettlerTick cascade 编排 + 状态机。单片端到端 wire 后跑真市场 e2e 验。
- 多片 (②) + refund (④) 叠加按 J1 LAND 节奏。
