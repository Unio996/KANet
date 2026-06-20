# bshard (A) 生产-信任两洞 — refund-merkle + 命门③ settle-enforce (设计档)

**作者**: NWT-tn (Owner-tasked 深挖 2026-06-21) | **接落**: J1 (SS 域) | **状态**: 设计 spec，待 J1 落码 + NWT re-review + 判别 teeth

**scope 铁律**: 两洞都是 **production-trust 前置**，**不阻 testnet 1000-ramp**（ramp 走 happy claim 路 + synthetic 委员，不触发这两条）。但 **mainnet / 真钱 / 市场-cancel-live 前必修**。先冲 ramp 机制+规模，生产 wire 时落这两条。

---

## 洞 1 — RefundClaim 虚高stake (F-refund-1, CRITICAL)

**位置**: `kasia-console/src/lib/RefundClaim.sil` refund_payout (L54-60)。**现 DRAFT + refund gate-off(closed==2 取消路未启)= NOT live-exploitable**。

### 威胁
`tk.stake` 读自 `readInputStateWithTemplate(ticketInIdx, ..., ps_tmpl_hash)` —— 这是 **LOCATION/template 匹配**（票合约模板对），但 ticket ctor `{bettorPk, direction, stake, shardPoolId}` **全 spender 可控**（票地址=blake2b(redeem)）。合约**无任何把 tk.stake 绑到 bettor 真实注册 stake 的约束**。

**攻击**: 算 ticket redeem = PoolSide-ticket 模板 + ctor`{bettorPk:攻击者, stake:整个 pool_value, shardPoolId:本 pool}` → 票 P2SH 充 dust → 调 refund_payout：模板验过(stake 是 ctor 自填) + `require(tk.shardPoolId==shard_pool_id)`过(自填) + `require(out==P2PK(自己))`过 → refund=整池给攻击者 → **一笔抽干整池**。

**R7 spent-once 不救**: 攻击者造**新**票(不同 stake→不同 P2SH→不同 UTXO)，spent-once 只防同票领两次，不防造虚高新票。

**同根因**: PayoutShard.absorb 已修过的 recreatable-ticket 漏 —— absorb 改成读 `tx.inputs[shardInIdx].value`(真 UTXO 真值)；RefundClaim 侧没修(读 ctor stake)。配 `[[feedback-recreatable-utxo-nullifier-defeatable]]`(记忆早标"退款侧更糟:一张 stake=整池 的票一笔抽干")。

### 修向 (镜像 winner 侧)
refund 必把 tk.stake 绑**不可伪造源** = **refund-merkle**:
- close(market-cancel)时 settler **commit 每个注册 bettor 的 `{bettorPk, stake}` 进 refundRoot**(leaf=blake2b(bettorPk‖ser(stake,8)))，烤进 RefundClaim state(替/补 payoutRoot 位)。
- refund_payout 加 merkle 证: `leaf=blake2b(bettorPk‖ser(stake,8))` climb 8/10-step ∈ refundRoot(同 winner 侧 store-payout 机器)，+ multi-word nullifier 防 double-refund。
- = stake 绑进 committee-attested refundRoot，可重造票造不出有效 leaf。
- 复用 `pool-payout-root.mjs` payoutLeaf/climbProof + PayoutShard claim 的个体 s0..s7 unroll + nullifier。

### teeth (修后, NWT 验)
判别: ①legit refund(真注册 stake, leaf∈refundRoot)→LAND ②虚高票(stake=整池, leaf∉refundRoot)→BUST 在 merkle require(cur==refundRoot)。修前(无 merkle)虚高票 LAND / 修后 BUST = 有牙。对称 claim 的判别 teeth。

---

## 洞 2 — 命门③ settle-enforce (payoutRoot 未绑 predicate, consensus-launders-poison)

**Owner 自己点过的洞** (`[[project-oracle-consensus-launders-poison]]`)。**design-only 未 wire**(bshard orchestration settle_mode='bshard' 不存在，cascade 仍手动 driver)。

### 威胁 (两层厘清, J1 + NWT 一致)
- close_attest 链上**只证也只该证**"4-of-5 distinct 委员签了**这个** payoutRoot"(委员 distinctness + ∈poolMerkleRoot + write-once = **已链上 teeth**, forge④ 证)。
- **但合约不绑 `payoutRoot == 链上 predicate 判定结果`** → 现 driver **自算 payoutRoot，委员盲签**(synthetic 自持 5 key)。production: 恶意 settler 塞**假 payoutRoot**(假赢家)→委员盲签→共识洗白盗对侧池。

### 修向 (settle-enforce, 复用本会话 oracle judgeLine/predicate 工作)
委员**各自独立 re-derive payoutRoot**，非盲签 driver 给的:
1. 从市场 **on-chain 承诺读 `resolution_predicate`**(marketMetadataHash → spine P2SH 烤的，命门③ commit-exists，不信 DB)。
2. `judgeLine(predicate, fields)` 确定性算 winningSide(fields 从 ESPN extractEspnFields 源验) → 算 winner 集 → 算 winner-tree payoutRoot。
3. 委员**只在 待签 payoutRoot == 自己 re-derive 的 payoutRoot 时才签**，否则拒(abstain)。
- = "谁签"(distinctness, 已 on-chain)+ "判对 predicate"(re-derive)绑死。这是 oracle wave2 judgeLine 确定性 + 命门③ commit 的**生产级合体**。

### teeth (wire 后, NWT 验)
判别: ①真 payoutRoot(==judgeLine 结果)→委员签→LAND ②假 payoutRoot(≠judgeLine)→委员 re-derive 不符→拒签→4-of-5 凑不齐→BUST。= settle-enforce 真挡假 ruling。

---

## 落地序 (J1 接)
1. **ramp 先**(testnet 1000, happy 路, 不碰这两条) — 现进行。
2. **生产 wire 时**: 洞1 refund-merkle(RefundClaim SS 改) + 洞2 settle-enforce(委员 re-derive payoutRoot orchestration) 同步落。
3. 每条 NWT re-review + 判别 teeth(修前 LAND / 修后 BUST)。

**配**: `[[feedback-ss-attack-review-verify-value-source]]`(每 require 比较值问来源) + `[[feedback-recreatable-utxo-nullifier-defeatable]]` + `[[project-oracle-consensus-launders-poison]]`。
