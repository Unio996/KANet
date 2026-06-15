# bshard M3 fold-carries-KAS — 端到端资金流 trace（SS rework gating，v2 收敛版）

**作者**: J1（SS owner）。**目的**: funding gap 根教训 = piece-wise 单件审看不出"钱从哪来"的全局不变量。M3 re-architecture → 写 SS 前整条资金流逐 hop 对抗，零洞才动 SS。
**v2**: 收 4-way 对抗审全部裁决（NWT F1-F4 + Bettor F2/refund 裁 + J2 fee-leaf + 我 register/fold SS-feasibility）。
**状态**: 待 @NWT 汇总成 whole-flow 安全声明 → 解锁 J1 写 SS。

---

## 0. 全局不变量（end-state 锁，whole-flow 单件看不出）

- **A 守恒**: 每环 `Σ cov-in == Σ cov-out`，零 mint 零 leak。miner-fee 仅从 **non-pool input**（不入 == 守恒式）。
- **B solvency**: `root_at_close == totalPool == Σstake`；`Σ(payoutRoot 全 leaves) == totalPool` → 全 leaf 取完 root 抽干**恰 0**（F4 闭：dust 不悬空，余尘并入 leaf 集合穷尽 totalPool）。
- **C 不双花**: dust-ticket spent-once + leaf bump once（每注一新 dust-ticket output）。
- **D custody**: 全程 covenant 控（leaf-pool=PoolShard_fold cov / root=fold-out cov），无 EOA 持池金，bettor 只能经 claim/refund 本人份额取，无旁路抽。
- **E refund 一致**: cancel 时 `Σrefund == totalPool`，每人退本金，pool 排空。**claim XOR refund 互斥**（F2）。
- **F3 value==account 同步**: pool_value 与 local_yes/no 同在一个 State，同步 bump，绑死真 UTXO value → 不可账虚高无钱 / 有钱无账。

## 0b. 核心机制：State-镜像 pool_value（使 value 守恒 SS-feasible + 焊死 F3）

朴素 `require(parent.value == Σ tx.inputs[child].value)` **未必可写**（fold 是 covenant，暴露 prev_states[] State，不保证暴露 per-cov-input 原始 UTXO value）。
✅ **解**: pool State 加字段 **pool_value**（= 本 UTXO 持的 KAS）：
- fold 守恒 sum **State 字段**：`require(parent.pool_value == Σ prev_states[i].pool_value)`（与现 fold sum local_yes 同构 = covenant-native 必可写）。
- 每输出 **bind 真值**：`require(tx.outputs[i].value == newState.pool_value)`（output value introspect == State 字段，已用过）。
- 归纳：每 child.pool_value == 创建时 bind 的真值 → Σ 正确，无需 covenant 暴露 per-input value。
- **F3 自然焊死**：pool_value 和 local_yes/no 同一 State transition 同步 bump + pool_value 绑真值 → 一条不满足整 TX fail。

### ⚓ 承重锚（Bettor 钉死）：所有产 pool-UTXO 的 entry **必绑 value==pool_value，零豁免**
State-镜像只跟它的边界绑同样牢 → **每个产 pool-UTXO 的 output 路径都必含 `require(tx.outputs[i].value == newState.pool_value)`**。穷举 5 条产 pool-UTXO 路径，逐个确认绑：
1. **register** → 产新 leaf-pool：bind ✓
2. **fold** → 产父-pool：bind ✓
3. **claim** → 重建 root(pool_value -= payout)：bind ✓
4. **refund_from_leaf** → 重建 leaf-pool(pool_value -= stake)：bind ✓
5. **close_commit** → 重建 root(value/pool_value 不变，只写 outcome)：bind ✓（值不变也必绑，防 close 顺手改值）

**零豁免**：任一 entry 漏 bind → State.pool_value 可脱离真值 → 全链守恒崩。SS review 必逐 entry 核 bind 存在。NWT e2e 抽验每个中间 pool UTXO 链上 value==State 账（非只首尾）。

### 耗 pool-UTXO 路径（每条 input-bind 真值==State）
- **fold** 逐 k child：`require(tx.inputs[i].value == prev_states[i].pool_value)`（loop 内，**compile-probe 实证可写**：covenant fold 内 `tx.inputs[i].value` 索引访问 silverc COMPILE OK）。
- **claim/refund/close** 绑各自 root/leaf input 真值==读到的 State.pool_value。

### ⚠ 未实证的对齐点（verify-primitive 诚实标，SS-write 必解）
fold per-child bind 正确性 = `tx.inputs[i]` ↔ `prev_states[i]` **同序**。compile 证语法可写，但 **cov 枚举序 == tx.inputs 序 我本地无法实证**（silverscript 无源码/无 VM）。若枚举序≠input 序 → 绑错 input = **假安全（比不绑更糟）**。
- **缓解 A**：builder 约束 cov-children 占 `inputs[0..k-1]` + fee 末位（J2 co-verify）。
- **缓解 B（若对齐无法本地证）**：退回归纳路（每 child.pool_value 由创建时 bind 保证，alignment-independent；零豁免 list 已可枚举验）——比"对齐没证的 per-child bind"更稳。
- **终验**：e2e 喂已知 input value 的 fold TX，验 bind 实捕 value-mismatch（NWT e2e bar）。
- 决策待 @NWT 判：gate 在 SS-write 内 probe / 接受归纳 / e2e 兜底。

## 0c. 两种 fee 别混（NWT 澄清）

- **协议 fee**（broker/oracle ~3%）= **从池出** → payoutRoot 的 **fee-leaf**（off-chain BigInt 算额，merkle-bound；禁链上 totalPool×pct = i64 溢出 + 无 merkle）。与 winner leaf 同机制 claim。
- **miner fee**（Kaspa 每 TX 网络费）= **non-pool input**（v07 纪律，G4），不入 value 守恒式。value-conserve 只数 **cov-inputs**（covenant 只计同 cov_id → fee UTXO 自动排除）。

---

## 逐环资金流（链 = register → leaf-as-pool → fold → root → close → claim/refund）

### HOP 1 register（bettor → shard-leaf-pool）
- **TX**: inputs=[leaf-pool(cov) + bettor 资金 UTXO + miner-fee UTXO]，outputs=[新 leaf-pool(cov) + dust-ticket + change]。
- **Σin==Σout**: `leaf_new.pool_value == leaf_in.pool_value + stake` ∧ bind 输出/输入真值 ∧ `stake == leaf_new.value - leaf_in.value`（实存，非 witness 声明）∧ account `local_yes/no += stake*(1-side)/side`、`count += 1`（同 State 同步=F3）。
- **dust-ticket**: 记 {pk, direction, stake, **spineP2shHash(leaf/market 身份)**}（Bettor 子问：refund 需凭它定位自己 pool）。spent-once 票，~dust value 非 funds。
- **griefing**: value-skim→`==` 挡；抢 outpoint→重试(自费,≤32 有界)；跨市场→leaf cov 烤 market_id + ps_tmpl_hash per-market(fix-a 同理)。

### HOP 2 shard-seal（leaf-pool 封口 ≤32）
- `count >= seal_count(32)` 拒新注。纯状态闸无 KAS 流。新 bettor 去新 shard。

### HOP 3 fold（k 子池 → 1 父池，带 KAS 上行）
- **TX**: inputs=[k child-pool(cov) + miner-fee UTXO]，outputs=[1 父-pool(cov) + change]。
- **Σin==Σout**: `parent.pool_value == Σ prev_states[i].pool_value`（State 字段 sum，covenant-native）∧ bind `tx.outputs[parentIdx].value == parent.pool_value` ∧ account 同守。miner-fee 走 non-cov input/change 旁路（不破 ==）。
- **griefing**: value-steal/burn→`==` 焊死；cross-market→market_id 绑；premature close→`root.count==shard_count` 才允 close。
- **终点**: root pool == market-pool 持全池。

### HOP 4 close（committee 写 outcome 进 root）
- **tri-state `closed` {0=open, 1=settled, 2=cancelled}**，write-once（!=0 即 immutable，committee attest 一次定）。
- close_commit(closed:1) 写 {winningSide, payoutRoot(含 winner+fee leaves), shard_count}，committee 4-of-5；`require(root.value 不变)`（只写 state 不动钱）。
- cancel(closed:2) 由 committee/deadline 触发（市场作废）。

### HOP 5 claim（winner 串行从 root draw-down）— gate `closed==1`
- **TX**: inputs=[root(cov) + winner dust-ticket + miner-fee UTXO]，outputs=[payout→winner P2PK + 重建 root(pool_value -= payout) + change]。
- **Σin==Σout**: `require(closed==1)` ∧ `root.pool_value_new == root.pool_value_old - payout` ∧ payout merkle-proven ∈ payoutRoot(climb 已验) ∧ `direction == winningSide` ∧ bind 真值。
- fee-leaf 同路 claim（fee-recipient 当 special winner）。Σ全 leaves==totalPool → 取完 root=0（B）。
- **griefing**: over-draw→守恒+merkle 挡；double-claim→dust-ticket spent-once；drain-to-zero→每 claim 守恒，root 不低于 Σ剩余 leaves。

### HOP 6 refund（市场取消 → bettor 退本金）— gate `closed==2`（F1+F2 解）
- **裁（Bettor）**: refund = **复用 claim draw-down 机器**，amount=**本人 stake**（取消 1:1 退本金，parimutuel 不适用），两 side 都可，ticket spent-once。**非新机制**。
- **F2 互斥**: claim gate `closed==1` / refund gate `closed==2`，tri-state write-once → 同 root 绝不双开 → 防 winner 取 payout + bettor 又退 stake 的双抽 insolvency。
- **fold-前/后两态（Bettor 子问）**: cancel 可发生在 fold 前(funds 在 leaf-pool)/后(在 root)。refund 凭 dust-ticket 记的 **spineP2shHash** 定位自己的 pool：
  - 未 fold → `refund_from_leaf` entry（leaf-pool draw-down，对称 fold value-conserve：`leaf.pool_value -= stake`）。
  - 已 fold → 从 root draw-down（同 claim 结构，amount=stake）。
- **Σin==Σout**: `pool.pool_value_new == pool.pool_value_old - stake` ∧ stake==dust-ticket 记录值。

---

## 待 @NWT 汇总确认的开放点
1. cancel 时机若 funds 散在多 leaf：是否强制"先 fold 到 root 再统一 refund" vs 各 leaf 各 refund（dust-ticket spineP2shHash 已支持后者）。
2. root pool ≡ spine 合并（一个 UTXO 持全池 KAS + outcome state）确认 — 简且 claim 一次读全。
3. fold/claim/refund 的 miner-fee change 归属（relay 自费记账）。
4. dust-ticket 原子绑定（register 同 TX 必同时出 ticket + bump leaf-pool，防只押钱不出票 / 只出票不押钱）。

---

*零洞 → J1 写 SS：PoolShard_fold(leaf-as-pool + value-fold via pool_value State-mirror) / PoolSide→dust-ticket(记 spineP2shHash) / root claim draw-down(gate closed==1) / refund_from_leaf+from_root(gate closed==2, 复用 draw-down) / fee-leaf 入 payoutRoot。NWT standby 对抗审 SS。*
