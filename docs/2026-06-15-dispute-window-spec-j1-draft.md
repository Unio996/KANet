# Dispute window + dispute_reveal slash demo — spec 草案 (gate B ② / DoD #4)

> **日期**: 2026-06-15
> **性质**: DoD #4(经济范式演示)的 dispute_reveal slash 机制 — 草案 seed 对抗讨论 (非 decree)。J1 起草 (找零+退出域)。
> **红线 (DoD §0 + #4)**: testnet 范式演示【功能性可见、可审计】, **非 mainnet 级硬化**。stake 当前 NOT chain-locked → slash 是 **SS-attest + social-forfeit** (off-chain), 非链上扣 UTXO。
> **不引入新目标**: SS hook 已存在 (PoolSpine_v07 `dispute_reveal` entry 1, L338-359, 实读确认)。本 spec 只定 window + trigger + flow + social-forfeit 落地。

---

## 0. 一句话
settle 落链后开一个 **dispute window**, 期内任何参与方可质疑 outcome → coordinator 收齐 5 委员 individual sig over disputeOutcomeHash → 广播 `dispute_reveal` TX 链上 attest (SS 验 blake2b(committee)==committeePkHash + 5×checkSig) → settler 社交层从作恶委员 pool standing stake forfeit。**SS 证个体签字, social 执行 slash**。

## 1. SS hook (已存在, 实读 PoolSpine_v07.sil L338-359)
- `dispute_reveal(committeePkHash, disputeOutcomeHash, c0..c4 Pk, c0..c4 Sig)`:
  - `require(blake2b(c0Pk‖c1Pk‖c2Pk‖c3Pk‖c4Pk) == committeePkHash)` — 绑定 revealed committee 到 settle 时承诺的 committeePkHash (= 我 #27 那个跨节点 byte-equal 的 pk_hash, settle_aggregate L92 已带)。
  - `require(checkSig(ciSig, pubkey(ciPk)))` ×5 — 每个委员 individual 签 disputeOutcomeHash = unanimous t=5 (个体问责, 非 4-of-5 阈值)。
  - inputs>=1, outputs>=1 (找零核弹: fee 走 §gate B① mass-aware, 非焊死)。
- **零 SS 改** — entry 已编译在 spine ctor。

## 2. dispute window (待拍参数)
- **DISPUTE_WINDOW_SEC**: settle 落链 (settle_txid landed) 后的质疑窗。**提案 = 7200s (2h)**, 对齐 `refund_maker_unjoined` 的 REFUND_GRACE_SEC=7200 (L372) + NWT 委员结算 SLA。窗内 market 状态 `completed` 但标 `dispute_open`; 窗后 finalize 不可再 dispute。
- **锚**: window 从 settle_txid 的 accepting-block daa 起算 (链锚, 跨节点 byte-equal — 同 side_lock_daa 教训, 非本地 wall-clock)。
- 待拍: 2h 够不够 testnet 演示 (短=好演示快; 长=真给质疑时间)。@Bettor/@NWT 定。

## 3. trigger — `pool_dispute_v1` envelope (新协议消息)
- 任何参与方 (maker/bettor, 持钥匙) 广播 `{t:'pool_dispute_v1', market_id, disputed_winner, disputeOutcomeHash, challenger_pk, sig}` on kanet-prediction。
- `disputeOutcomeHash = blake2b(market_id ‖ byte[](disputed_winner,1) ‖ settle_txid)` — 链锚 (跨节点同值, 委员签的就是它)。
- settler 消费 → 验 market 在 dispute window 内 + challenger sig → 置 `dispute_open`, 触发 §4。

## 4. dispute_reveal 流 (coordinator 收签 + 广播)
1. coordinator (= 触发节点, by-root 确定性可任意节点) 拿 market 的 cached committee (5 pk, committeePkHash from pool_committee = 我 #27 域)。
2. 向 5 委员 relay 发 IPC `dispute_sign_req`(disputeOutcomeHash) → 各委员自家钥匙 checkSig 签 → 回 ciSig。
3. coordinator 构 `dispute_reveal` TX (5 sig + 5 pk + committeePkHash + disputeOutcomeHash), 找零核弹 mass-aware fee (§gate B①), 广播 + 等 landed (NO TX NO STATE: 没 landed 不推进)。
4. **链上 attest 成 = 5 委员 individual 签字公开上链** = 个体问责锚定 (谁签了哪个 outcome 永久可审计)。

## 5. social forfeit (settler 侧, off-chain slash)
- dispute_reveal landed 后, settler 比对【revealed 个体签的 disputeOutcomeHash】vs【原 settle 的 winner】:
  - 若 dispute 成立 (revealed outcome ≠ 原 settle, 经 ESPN 真源复核) → 原 settle 投错方向的委员 = 作恶 → settler 从其 **pool standing stake** (oracle_stake_enrollments) social-forfeit (active=0 + 记 forfeit chain_event, Brain 可见, reputation.js classification 降级)。
  - testnet 演示 = **forfeit 功能可见 + 全链可审计** (dispute_reveal TX + chain_event), 非真扣 UTXO (stake 未 chain-locked, mainnet Phase 2 才链上扣)。
- 守红线: forfeit 决策跨节点确定 (输入=链锚 disputeOutcomeHash + cached committee + ESPN 真源, 非本地态)。

## 6. 演示路 (DoD #4 验收, 串 A 的真 settle)
基准: 9bsox (A signature run, settled c1d3a216, committee 76f90f0d 两节点 byte-equal)。演示:
① settled 市场 (9bsox 或 J2 fresh) 在 dispute window 内 → 广播 `pool_dispute_v1` ②coordinator 收 5 委员签 → dispute_reveal TX landed ③settler 比对 + social-forfeit 落 chain_event ④UI/查 TX 可见 dispute_reveal + forfeit。= **stake 锁 + dispute_reveal slash 机制功能性可见、可审计** (DoD #4 验收线)。

## 7. 分工 + 序
- **J1 (我)**: dispute window 锚 + `pool_dispute_v1` trigger 消费 + coordinator dispute_reveal TX 构造 (找零核弹 fee) + settler social-forfeit 接入 + 跨节点 determinism。
- **KANet-UI**: dispute trigger UI (参与方一键质疑) + forfeit/dispute_reveal 可视化证据链。
- **NWT**: 攻击审 (假 dispute / 抢 window / forfeit 错杀好委员)。
- **序**: 等 §2 window 参数 + §5 forfeit 跨节点判据 @Bettor/@NWT 拍 → 我落 trigger+reveal+forfeit → 串 settled 市场演示。**不依赖 restart** (新协议消息 + settler 逻辑, 随 batch 部署)。

---
*J1 草案 seed。SS hook 实读 PoolSpine_v07 L338-359 确认。slash=SS-attest+social-forfeit (DoD #4 有界, 非 mainnet 硬化)。待对抗讨论 + Owner 终裁。*
