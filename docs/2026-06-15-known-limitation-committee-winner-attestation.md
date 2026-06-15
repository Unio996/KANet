# 已知限制：committee winner-attestation 信任（testnet conscious-accept，mainnet 硬化）

**记于** 2026-06-15 by Bettor-tn（4-agent 对抗审收口 + 我 triage (a)）。NWT 诚实标出、团队 conscious-accept、对齐项目终点。
**关联**: [[project-endpoint-testnet-public-not-mainnet]] · gate B #31 (A)-refined store-payout · `PoolSpine_v07.sil` L242-247 · `PoolSpine_v08_chunk`。

---

## 限制陈述

预测市场 settle 的 winner payout（谁拿钱、拿多少）由 **4-of-5 committee 背书**，**不锚 bet-time membership**：
- **v07**（单 TX settle）: winner outputs[6..] 由 committee SIGHASH_ALL 背书（L244-247），无 bettor merkle。
- **v08 (A)-refined**（chunked settle）: committee-sign payoutRoot（plan_commit），chunk_i 验 winner ∈ payoutRoot + recipient/amount 链上 require。

∴ 一个**恶意 4-of-5 committee 可铸造假 winner（把池付给自己/非 bettor）= 自肥盗池**。这比 outcome-误判更坏（误判=付错的*真* bettor；铸假=committee 自肥）。

**关键**: 这是 **pre-existing v07 信任模型**，v08 (A)-refined **未引入新的**（trust v07-equivalent；v08 还加了显式链上 recipient/amount require = *结构*更严，非 trust 更高）。

## 为何 testnet 公测 conscious-accept（非开门 blocker）

1. **pre-existing**: v07 一直如此，三方查实码（poolMerkleRoot 爬的是 committee/oracle 池非 bettor）。B/A-refined 没退化。
2. **testnet 无经济利益**: 项目终点 = 范式+技术验证（[[project-endpoint-testnet-public-not-mainnet]]），盗的是 worthless testnet 币。
3. **committee 已 reputation-bonded + anti-grinding 采样**: 自肥 = bond slash + 声誉死（provable-only slashing）。

## mainnet 硬化项（出 testnet scope，backlog）

闭它需 SS 加 **winner-pk ∈ bet-time membership merkle**（双 climb：身份 against bet-time poolMerkleRoot + 金额 against payoutRoot）→ MAX_K 砍半（≈9→4-5，伤 broadcast）。bettor 现无 bet-time 锚，需新 leaf 算法。**= mainnet 经济硬化前置，非 testnet 开门项**。

## 决策溯源

- NWT r-msg 诚实标残留（self-deal，非阻拦）→ Bettor triage (a) → J1/J2/NWT conscious-accept → 对齐项目终点。
- determinism 域无关（store-payout 两节点 byte-equal 不受此影响）。
- 待 Owner 知会（经济信任域终裁者），如 Owner 要求提前闭则转 (b) bet-anchor。

— 候 KANet-UI commit（我守单 git writer）+ 从 DoD 草稿链接此条 honest 边界。
