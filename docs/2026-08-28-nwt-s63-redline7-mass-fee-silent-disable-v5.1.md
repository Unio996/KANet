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
| ② | 后果实证（关闭期 ≥8-01）| 🟢 **红线 7 关闭期（≥8-01，有 boot log 起）零 mempool 拒费**——active `console.log` 0 条、含 `is not standard: transaction has N fees which is under the required amount of M for compute mass K` 的日志文件 mtime 全在 **05-27/28 + 06-10**（≥8-01 零）。⇒ 关闭期尚无实证损失（守卫 OFF，只剩 mempool 兜底，SS-焊死 fee 碰巧都 ≥ floor）。🔴 **证据形更正（8-28）**：原写"零 `insufficient fee` 拒绝"是**错 grep 文本形**（真拒绝文本是上面那句、非 "insufficient fee"）⇒ 漏了 **5–6 月 288 条**拒费史（旧 Phase 4a `ext-pred-177` 等低费 tx，与 7/20 结算停摆无关、也不在关闭期窗口）。**正确证据 = 按【日期分桶】≥8-01 零，非"零拒绝"**。（记 memory：日志 grep 判在/不在，须先钉文本形 + 日期窗，再连因果。）|
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
- **observe 阶段 = 全 GREEN**（NWT 审）：本地上界 `estimateMassUpperBound`（条件② 我独立 oracle 对拍 H1-H5 5/5，见 `docs/provenance/2026-08-28-redline7-mass/`）+ `getMempoolEntry` 权威对照（`ub_ok`/`inconclusive` 三态，inconclusive 不算过）+ Map 泄漏修（finally-delete + cap-256）+ run-all fail-open 修（缺参第一臂前 exit 2）。侧分支 `coord/redline7-observe`，**等 Owner 批 → 主分支 + 维护窗 relay 重启部署**。

### §5-bis 🔴 enforce 报备审尺（Bettor 派·enforce 前置硬阈值）
observe→enforce 只翻 `MASS_FLOOR_MODE` 常量；但 **enforce 报备前，7 天 observe 数据须全部满足**（任一不满足 ⇒ 先修再报 enforce）：
| 阈值 | 要求 | 不满足含义 |
|---|---|---|
| `ub_ok` | **100%**（每条采样 `local_mass_ub ≥ authoritative required mass`）| 上界不成立 ⇒ enforce 会误拒合法 tx |
| `inconclusive` | **0**（`getMempoolEntry.mass` 全取到）| 取不到权威 mass ⇒ 无对照证据（vendored `IMempoolEntry` 无 mass 字段则须改别的权威口再报）|
| `evicted` | **0**（Map cap-256 未逐出过）| 逐出 = 有 submit 未对照 = 采样有洞 |
| estimator-throw（`local-ub unavailable`）| **0**（估算器无边界 throw）| v1 缺 budget / spk>100B ⇒ 回 skipped fail-open，边界须先修 |
- **采样形覆盖表（每形 ≥1 条 `ub_ok=true`）**：`genesis`（unlockBshardGenesisMintPayout）/ `consolidate`（unlockBshardConsolidate）/ `claim`（unlockBshardPayoutClaim）/ `close`（unlockBshardCloseAttest）/ `spine`（unlockPoolSpineP2SH）/ `side`（unlockPoolSpineRefundMakerUnjoined）/ `escape`（unlockP2SH_SingleEntry）——任一形 7 天内零采样 ⇒ 覆盖不足、enforce 对该形无证据 ⇒ 延或补造样。
- enforce 报备到 NWT 时：附 7 天上表数据 + 覆盖表 + `observe→enforce` 仅翻常量的 diff；对 Codex 五条（durable 镜像 / 对抗向量 / 权威对照 / 全采样 ub_ok 零静默 / 单独授权）。

## 6. 附：本轮另一 silent-defect — v83 backfill DELETE GLOB 错形（migrate.js:2439）
> 与红线 7 同族（"看起来在守、实则失效"），一并记账于权威处（源码注释是副本，通则要求权威处有记录）。
- **机制（8/28 更正）**：`:2439` 原 `txid GLOB '*[!a-fA-F0-9]*'` —— SQLite GLOB **无 `!` 否定**，`[!a-fA-F0-9]` 是**字面集** `{'!',a-f,A-F,0-9}` ⇒ **对含任一 hex 字符的 txid（含合法 64-hex 审计行）都判真** ⇒ v83 的 `length≠64 OR <此>` 会删**所有** `broker_%` chain_events，不只 placeholder。程序确认 `valid-hex 被错形删 = true`。
- **🔴 NWT 认 miss**：我 8/27 评估说"`length≠64` 兜住 placeholder、弱 GLOB 冗余无害"——**推理错**（弱 GLOB 对 valid hex 也真、不冗余）；8/28 Bettor 升级、我认。
- **🔵 旁证决定性 ⇒ 4/29 无真审计行丢失**：`broker_fee_landed`（真 `broker_%` 审计事件型）2026-06-28 `d1f68dd1` 才引入 = v83（**2026-04-29 10:44** `33cda390`）后**两月** ⇒ 4/29 时 `broker_%` 只有 **1129 placeholder** ⇒ 错形 DELETE **恰删预期目标**、**无真审计行丢失（机制错、结果对）**；当时删数不可复核（日志轮转、无 4/29 前备份）。
- **现态**：`:2433` 幂等守（`if !has_v83_trigger` 不重跑）+ 持久 trigger `:2452` 用**正形 `[^]`** ⇒ ongoing 正确；`:2439` 已 **`c22af559`** 修（对齐 :2452 + 源码抽取回归 `migrate-v83-glob.test.mjs` 4/4，NWT 复审 GREEN），**只对 fresh-DB v83 replay 有意义**。非钱路（`chain_events` = 审计真相源非放钱闸）。

**一句给 Owner**：`bshard/pool` 结算的 mass-aware fee 地板（红线 7）**因 vendored wasm 缺 TN12 参数分支、自 ≥8-01 从未生效**，只靠 mempool 兜底；**至今无卡单/拒绝（运气）**；J2 修法（本地算 mass 上界）在审，修需你批 + 维护窗 relay 重启（可并 §10 那次）。**无 build/deploy 授权发生。**
