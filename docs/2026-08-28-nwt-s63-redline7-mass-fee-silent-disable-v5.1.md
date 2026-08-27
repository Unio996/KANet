# §6-3 门现状 v5.1 附录 — 红线 7（mass-aware fee floor）relay 层静默关闭·从未生效【记账】· 2026-08-28

> **Status**: CURRENT（gate-status v5 `docs/2026-08-28-nwt-s63-gate-status-refresh-v5.md` 的生产发现附录）
> 作者 NWT · 派工 Bettor · 起因 = J2 harness 逮到、Bettor 坐实、NWT 审计。**本页是"红线 7 静默关闭"的权威记录**——凡称红线 7"生效"的文档一律加状态注记**指向本页**（防漂移·通则）。

## 0. 一句话
`p2sh.mjs:57` `kaspa.calculateTransactionMass(networkId, signedTx)` 在 vendored wasm 上对 **testnet-12 一律 panic**（`unreachable`），catch 只 `console.warn('mass calc skipped')` + `return` ⇒ **红线 7（mass-aware fee floor `fee ≥ mass × MIN_SOMPI_PER_MASS`）在全部 covenant 提交路径静默关闭、从未一次生效**；只剩 mempool 兜底。**尚无实证损失（运气非机制）。**

## 1. 根因（J2 定位·Bettor 坐实）
- vendored `shared/vendor/kaspa-wasm` 的 `Params::from(NetworkId)` **无 TN12 分支** ⇒ `params.rs:644 "Testnet suffix 12 is not supported"` panic。
- ⇒ **任何 tx 形（v0/v1、有无 covenant）任何入口（`calculateTransactionMass`/`calculateStorageMass`/`updateTransactionMass`）传 testnet-12 全 panic**——**不是 covenant 特有**（我 ③ 早先"同 trap 类"按此改写：症因 = 缺 TN12 参数分支，非 covenant tx 特殊）。
- **自 vendored 构建启用起从未生效**（非某日回退）。

## 2. 审计证据（NWT，日志实核）
| # | Codex/Bettor 审点 | 结论 |
|---|---|---|
| ① | 100% 命中 / 有无一次算过 mass | 🔴 **0 个 `minFee=… ✓`（:67 成功路径）across ALL logs**；`skipped` 177,415（Bettor 计）。**红线 7 从未一次生效**。 |
| siteLabels | 涉及哪些路径 | **全部 covenant 提交**：`unlockPoolSpineP2SH` / `unlockPoolSpineRefundMakerUnjoined` / `unlockBshardCloseAttest` / `unlockBshardConsolidate` / `unlockBshardGenesisMintPayout` / **`unlockBshardPayoutClaim`** / `unlockBshardRegister` / `unlockP2SH_SingleEntry`（含 Payout/Consolidate/Refund **钱路**）。首现 ≥ 2026-08-01（最旧留存日志）。 |
| ② | 后果实证 | 🟢 **logs/broadcast_tx 零 mempool `insufficient fee`/`mass` 拒绝** ⇒ 尚无实证损失。**= 运气**：SS-焊死 fee 碰巧都 ≥ mempool floor（qlfpv 那次是例外、正触发加红线 7）。**守卫 OFF，只剩 mempool 兜底。** |
| ③ | 同 8/05 rpc-degradation 根 | **同 wasm 构建、根因同族（缺 TN12 参数/trap）**，症状不同（mass calc vs RpcClient）。🟡 **"C 重编 wasm 能否一并修 8/05 rpc-degradation" = OPEN 待核**（并入下面审计条）。 |
| ④ | 何处称"生效" | ~10 文档引用；承重三份（gate-d fee-source 论证）见 §4。全部加状态注记指向本页。 |

## 3. 🔴 审计加条（Bettor 派）：其它 `NetworkId(TN12)` wasm 调用有无同病（未 catch = 500）
**结论：无未 catch 的 500 站点。** relay 里 Params-消费的 wasm 调用：
- `calculateTransactionMass`（p2sh.mjs:57）= **唯一传【真 testnet-12】** ⇒ panic ⇒ **已 catch**（红线 7 skip）。
- **Generator（tx-building，p2sh.mjs:202 / transaction.mjs:219 / utxo-split.mjs:54/181）= 已用 testnet-10 兜底**：`wallet.getGeneratorNetworkId()`（wallet.mjs:128）`if testnet-12 return 'testnet-10'` ⇒ 传 testnet-10、有 Params 分支、**不 panic**（tx-building 一直能工作正是靠这个 A′ 兜底）。
- `RpcClient`（p2sh.mjs:97）用真 testnet-12 但**不经 `Params::from`**、正常连（wallet.mjs:125 注："RpcClient handles testnet-12 fine"）。
- `estimateFeeReserve`（transaction.mjs:30）= **本地公式**（payloadBytes×1000+floor），无 wasm。
- ⇒ **只有 mass calc 一处把真 TN12 喂给 Params::from，且已 catch**；其余要么走 testnet-10 兜底、要么不用 Params ⇒ **无裸 500 风险**。🟡 但 Generator 的 testnet-10 兜底 = **KIP-9 存储质量近似、对 sigop/budget 不敏感** ⇒ 不能替红线 7（这也是修法否掉 A′ 作主路的理由）。

## 4. 状态注记目标（各 doc 指向本页）
- **承重三份（gate-d fee-source 论证若拿"relay 强制 fee≥mass×100"当前提）**：`docs/2026-08-27-j2-s63-gate-d-p3-fee-source-v0.1.md`、`docs/2026-08-27-j2-s63-gate-d-conservative-bounds-v0.1.md`（**J2 同一小 commit 补，措辞统一**）；`docs/2026-08-27-NWT-redteam-s63-gate-d-bounds.md`（**NWT 补 line 33 轻注**）。
- **统一措辞**：「红线 7 relay 层自 ≥8-01 因 wasm mass-calc trap（缺 TN12 参数）静默关闭，只 mempool 兜底（`p2sh.mjs:57-60`）；见 v5.1」。
- 引用级（ANTI-PATTERNS / testnet-DoD / precond3 等）：轻注即可。

## 5. 修法（J2 报备 → NWT 审 → Owner 批 → 维护窗 relay 重启）
- J2 选 **B（本地按 `git show 7b1e18cc` 公式算 `mass_ub = max(compute,storage,transient)`，宁高勿低）**，两段 observe→enforce。**NWT 审中**（GO/条件另发）。
- 修 = **钱路** ⇒ Owner 批 + 维护窗 relay 重启（可并进 §10 D-005 那次窗）。
- **enforce 前红线 7 保持"静默关"现状记录有效**——本页不撤，直到 enforce 段落地且 NWT 复核 `minFee=… ✓` 真出现。

**一句给 Owner**：`bshard/pool` 结算的 mass-aware fee 地板（红线 7）**因 vendored wasm 缺 TN12 参数分支、自 ≥8-01 从未生效**，只靠 mempool 兜底；**至今无卡单/拒绝（运气）**；J2 修法（本地算 mass 上界）在审，修需你批 + 维护窗 relay 重启（可并 §10 那次）。**无 build/deploy 授权发生。**
