# claim+payout 轴门 —— 转预言机前的硬前置(Owner 裁决)

**触发**: Owner 审 NWT "三维真无限 1000 收官" 报告, 裁定 inject+aggregate 轴=chain-confirmed ✓, 但 **claim+payout 轴=n=1, F1/F4 拒绝路径在 1024-leaf payoutRoot 上未行使**。不收官、不转预言机, 先过此门。

## 为何这门必须过
- 这轮 1000-ramp: payoutRoot 含 **496 register winner**, 链上只落 **1 笔 claim**(b8b75e3e, 2.0649 KAS)。
- **F1**(double-claim via P2SH recompute)+ **F4**(index-aliasing 低位 bit)都活在 claim 路径。
- **1024 = 2^10, depth-10 树 = F4 低位 bit aliasing 最强压力点**。
- 495 笔 winner claim 未行使, claimed-bitmap 拒绝路径**一次都没在这轮链上触发**。
- ∴ "真无限" 目前只对 inject+aggregate 成立; claim+payout 只 code-read 不 chain-confirmed。

## code-read 结论(NWT, PayoutShard.sil HEAD claim entry)
防护逻辑**存在**(但仅 code-read):
- F4 aliasing: L7 `require(merkle_index >= 0); require(merkle_index < 1024)`。
- claimed-bitmap 拒双领: L36+ `require((w[word_idx]/mask)%2==0)` + `nw=w+mask` 置位。
- store-payout merkle: L15-27 10-step climb `require(cur==payoutRoot)`。
- 多-word nullifier: w0..w16(17×63=1071≥1024)。

## 门 = 在【同一棵 1024-leaf payoutRoot】上链上行使(chain-confirmed)
1. **≥k 笔独立 winner claim LANDED**(k 待定, ≥3; 必含【高 index 近 1024】的 winner = F4 低位 bit 压力点, 例如 index 495/991/1023 类)。证 happy 路对多 winner + 高 index depth-10 climb 真 work。
2. **1 笔 double-claim 被 claimed-bitmap 链上拒**(同一已领 index 再 claim → `require((w/mask)%2==0)` 置位 BUST)= 拒绝路径行使。
3. **1 笔 F4 aliasing 尝试被拒**(claim 一个 aliased index, 如 已领index + 偏移, 或 index≥1024 → `require(merkle_index<1024)` 或 climb mismatch BUST)= F4 防护行使。
4. **判别有牙**(配 recreatable-UTXO-nullifier DoD): happy claim LAND 且 double/aliasing 修后 BUST(单变量 diff)。

## orphan auto-select(次要门, Owner 🟡)
本轮 orphan 双 UTXO 是 NWT 提前抓 + 手钉 canonical txid。consolidate 在 orphan 双 UTXO 下**自动选 canonical 的能力未证**(无人值守无限的一环)。可选: 造 orphan 双 UTXO + consolidate 不手钉 → 验自动选 canonical(或明确标"需人手护栏")。

## FINAL_PS 语义点名(Owner ⚪)
post-claim PS 1022.14 KAS: 若 ≈ 495×2.06 = **未领 winner 池**, 则守恒闭合部分因 495 笔未领 = 【待领】非【已结算】。请 J2 点名 FINAL_PS 语义(residual vs 待领池), 报告口径必标"待领"。

## 分级表纪律(Owner 🔵)
claim 轴每件必标 **code-read**(读码逻辑在) vs **chain-confirmed**(链上行使过)。余额守恒=输出余额核 ≠ 证 32 步 fan-in 每步不双计(两错可相消)→ fan-in 逻辑要 **contract-read** 单独确认(consolidate handler + ShardLeaf consolidate_to_payout 的 weld)。

## 分工
- **J2**: 在 1024-leaf payoutRoot 上落 ≥k winner claim(含高 index)+ 1 double-claim + 1 aliasing(后两个期望 BUST)。
- **NWT**: 每笔独立 chain-confirm(check_utxo_landed happy LAND / BUST reason 核); fan-in contract-read; 出分级表(每格 code-read/chain-confirmed)。
- 过门后才转预言机(Owner 裁: 不转)。

**配**: [[feedback-recreatable-utxo-nullifier-defeatable]] DoD 闸(happy LAND+attack BUST 单变量) + [[reference-silverc-byte32-no-ordering-comparison]] + Owner verify-not-echo 教训(NWT 自审报告超额承诺)。
