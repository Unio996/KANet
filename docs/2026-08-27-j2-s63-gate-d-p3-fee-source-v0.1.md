# §6-3 gate (d) · P3 fee-source 模型 v0.1（结构稿 · 零数 · 零落码 · 不改 v0.15 正文）

> **Status**: DRAFT v0.1 · J2 2026-08-27 · Bettor 派工 (18) · 为 (d) 稿（`docs/2026-08-27-j2-s63-gate-d-conservative-bounds-v0.1.md` v0.5 = 289af371）剩余三件之一 "P3 fee-source" 出**结构**：每条支路费由哪个输入出、输入拓扑是否被 covenant 限、费不足谁先死、费率/拥塞是否已在 `N_margin` 具名项里。**不拍任何数，占位全标 PLACEHOLDER**；不依赖节点/Owner。
> 坐标纪律：rusty-kaspa 全部 `git show 7b1e18cc:<path>`；v0.15 = `docs/2026-08-21-j1-s6-3-A-covenant-construction-v0.15.md` §行。

---

## §0 结论先行（三句）
1. **费从哪来是"谁的本金被花"决定的，不是 covenant 决定的**：v0.15 十支里**没有一条**限制输入个数（全部只限 `OpCovOutputCount` / 特定 co-input 存在 / 特定输出值），⇒ 任何一笔都可以加普通费输入。唯一"值被焊死、付不了费"的输出是 **claim 的 payout（`== OAUTH_value`）** 与 **reveal 的 O_AUTHORIZED（`== LOCKED_F_value`）**；所以只有 **claim（T5）** 存在"费只能从 O 或额外输入出"的问题——这就是 (d) v0.2 §7 二选一的全部范围。
2. **费不足先死的是 claim（T5）**：它是十支里唯一同时满足【有 DAA 截止】∧【payout 值焊死不能让费】的支路；recovery/refund/giveup 都无截止且 payout 值不焊死（费从本金里扣即可）。⇒ 费面上的失败方向与 first-mover-with-mining 威胁模型**同向**：claim 落不了 ⇒ recovery 得利。
3. **费率/拥塞不是时间量**：TN12 无费市场，mempool 只有一个绝对下限（`minimum_relay_transaction_fee`）与 mass 上限；费不够 = **永不落链（二值）**，不是"落得慢"。⇒ 它不该塞进 `N_margin` 任何 DAA 项，(d) 稿 `M_congest` 也**没有**覆盖它。本稿单列 **sompi 域**具名项 `F_claim_reserve`（§3），不许被 DAA 项吸收；**对抗性拥塞（矿工首动方填块）= 审查 = bounded-inclusion 假设之外**，本稿不假装用费解它。

---

## §1 交易清单：Shape B 五对象十支会广播的 9 类 tx（v0.15 §3 表 @L160-168 + §4）

记号：`P_F` 首动方、`P_R` 反应方、`WT` watchtower（任何人，§1.5 假设 5 @L135）。"焊死"= covenant `require` 定值；"自由"= covenant 不管。

| # | tx | 谁发 | 输入（covenant 限了什么） | 输出（值焊死？） | **费由哪个输入出** | 输入拓扑被限？ | v0.15 |
|---|---|---|---|---|---|---|---|
| T1 | genesis-mint `C` | `P_F`（或双方各核） | 普通 funding UTXO → 造 `C`（`covenant_id(funding.outpoint,[C_out])`，dust） | `C` 值自由（dust 种子） | funding 输入（普通钱） | 否（genesis 无 covenant 输入）| §4-a @L223-226 |
| T2 | lock `LOCKED_R` | `P_R` | 普通 UTXO → P-SAFE-1 covenant 输出 | `LOCKED_R` 值 = 反应方本金（自由，链下约定） | 普通输入 | 否 | §3 表 |
| T3 | lock `LOCKED_F` | `P_F` | 同上 | `LOCKED_F` 值 = 首动方本金 | 普通输入 | 否 | §3 表 |
| **T4** | **reveal 四路焊** | `P_F` | **必含** `C`（`OpInputCovenantId(C_idx)==cid` @L263）、`LOCKED_R`（本支）、`LOCKED_F`（`==locked_f_cid` @L264）；**可加**普通输入（无 `OpTxInputCount` require）| `O_AUTHORIZED`：**焊死** `== LOCKED_F_value` @L266；`O`：**下限** `>= min_O` @L236；`P_F` 领 `LOCKED_R` 的 payout：**值自由**（transfer 支只焊四路与 A/s，不焊 payout 值）| **`LOCKED_R` 本金**（被转给 `P_F` 的那份）——O 的 `min_O`、tx 费都从它里扣，`P_F` 拿剩余；或 `P_F` 加普通费输入 | **否**——只限"必须有这三个 covenant 输入"，不限"只有这三个" | §4-d @L257-266、§4-b @L232-236 |
| **T5** | **claim** | `P_R` 或 `WT` | **必含** `O`（`OpInputCovenantId(O_in_idx)==cid` @L245）+ `O_AUTHORIZED`（本支）；**可加**普通费输入 | payout 给 `P_R`：**焊死** spk（@L246）∧ **焊死值** `== OAUTH_value`（@L247）；`OpCovOutputCount(oauth_cid)==0`（@L248）∧ `OpCovOutputCount(cid)==0`（§4-e @L291）⇒ 无续链；**普通找零输出自由** | 🔴 **只有两处可出**：(a) **`O` 的值**（`O_AUTHORIZED` 全额进 payout，出不了费）；(b) **额外普通输入**（`P_R`/`WT` 自备）| **否**（同上）——这正是 (d) v0.2 §7 二选一：**(a) 加 `require(OpTxInputCount==2)` 把"费只能由 O 出"变成机制** vs **(b) 不限、`min_O` 只锚存储地板、费由发起者自备** | §4-c @L242-248、§4-e @L288-292 |
| T6 | recovery（`O_AUTHORIZED` + `O` 各一支，可同笔） | `P_F` | `O_AUTHORIZED`（`TxTime >= OpTxInputDaaScore(O_AUTHORIZED)+N` @L250）、`O`（同锚 @L296）；可加普通输入 | 付 `P_F`，**值自由**；`OpCovOutputCount==0` | **`O_AUTHORIZED`/`O` 的值**（= 首动方自己的本金 + O 种子）| 否 | §4-c @L250、§4-e @L296 |
| T7 | `LOCKED_R` terminal-refund | `P_R` | `LOCKED_R`（`TxTime >= T_cutoff_LOCKED_R` @L269） | 退 `P_R` 明文，**值自由**；`OpCovOutputCount==0` | `LOCKED_R` 本金 | 否 | §4-d @L269 |
| T8 | `LOCKED_F` giveup | `P_F` | `LOCKED_F`（`TxTime >= T_giveup_LOCKED_F` @L273 ∧ `OpCovOutputCount(locked_f_cid)==0`）| 退 `P_F`，值自由 | `LOCKED_F` 本金 | 否 | §4-d @L273 |
| T9 | `C` terminal-refund | `P_F` | `C`（cutoff 后，`OpCovOutputCount==0`）| 明文 dust | `C` 自身（dust，可能不够费 ⇒ 须加普通输入或干脆不发）| 否 | §3 @L166/@L185 |

🔵 **T4 的费面常被忽略**：reveal 那笔同时要 (i) 付 tx 费、(ii) 给 O 注 `min_O`、(iii) 造 3 个输出（`O`、`O_AUTHORIZED`、payout）——**存储质量按非松弛公式算**（|O|=3 > 2，`mass/mod.rs:469-478` 松弛路径不适用），O 越小其 `C/value` 项越大。⇒ `min_O` 的存储地板（(d) 稿 3-A `storage_floor`）**在 T4 的 mass 里生效，不在 T5 里**——T5 里 O 是输入，输入只给 credit。

---

## §2 费不足时哪条支路先死（接 first-mover-with-mining）

| 支路 | 有 DAA 截止？ | payout 值可让费？ | 费不足的后果 | 谁受益 |
|---|---|---|---|---|
| **T5 claim** | **有**（须在 `O_daa + N` 前落到深度 20）| **否**（`== OAUTH_value` 焊死）| 只能靠 O 值 (a) 或额外输入 (b)；两者都不够 ⇒ **进不了 mempool**（`minimum_relay_transaction_fee`）或被更高 feerate 挤出 ⇒ **永不落链** ⇒ 阈值到 ⇒ T6 recovery 落 | **`P_F`** |
| T6 recovery | 无（只有下界）| 是（值自由，从 `OAUTH`/`O` 里扣）| `P_F` 随便加费重发即可 | — |
| T4 reveal | 无上界（v0.8 删）| 是（`P_F` 的 payout 值自由）| `P_F` 加费重发；拖到 `T_cutoff_LOCKED_R` 后 `P_R` 可 T7 退本金 | `P_R`（本金退回，无损）|
| T7/T8/T9 | 无 | 是 | 本金持有者加费重发 | — |

⇒ **十支里只有 claim 是"费不足 = 本金损失"**；其余全是"费不足 = 晚一点"。这与 (d) 稿 v0.5 的威胁模型**同向叠加**：首动方若是矿工，既能拉 DAA（缩短 claim 墙钟窗）又能不打包 claim（审查）——后者是 bounded-inclusion 假设之外（Codex 267 (d) "cannot prove censorship resistance absolutely"），**费模型解不了它，本稿不假装能**。费模型只解"非对抗环境下反应方自己付不起"这一种死法。

🔴 **(a)/(b) 在"先死"上的差别**：
- **(a) `OpTxInputCount==2`，费只能由 O 出**：claim 的费上限 = `O.value − 0`（找零可为 0）。**`P_F` 造 O 时决定了 `P_R` 的最大可付费**——`min_O` 就是 `P_R` 的费保底，`P_F` 只能给多不能给少；但若日后 mass 规则变（KIP 调 `mass_per_*`）或 claim 脚本比预估重，**`P_R` 无法自救**（不能加输入）⇒ 结构性死。
- **(b) 不限输入**：`P_R`/`WT` 永远可以自备费输入 ⇒ **不存在结构性付不起**；代价 = 零本钱 `P_R` 不能 claim、`WT` 代广播须自带钱。
- ⇒ 从"先死"角度 **(b) 更安全（无结构性死法）**，(a) 更便利；(d) 稿 3-A 已把此二选一列 §7，**本稿只补"(a) 有一条 (b) 没有的死法"这一点**。

---

## §3 费率波动 / mempool 拥塞 —— 在不在 `N_margin` 里？

**在不在**：(d) 稿 `N_margin` 三具名项 = `M_observe`（失能窗）/ `M_reorg`（重选退回）/ `M_congest`（**落链时延的方差**，DAA 域）。**费不够导致的"不落链"是二值事件，不是时延方差** ⇒ `M_congest` **没有**覆盖它，也**不该**覆盖它（把二值失败折成时间余量 = 用 DAA 兜 sompi = 错域，同 CFG-UNIT-DOMAIN 族）。

**单列具名项（sompi 域，不吸收）**：
| 项 | 域 | 定义 | 谁承担 | 来源坐标 |
|---|---|---|---|---|
| **`F_claim_reserve`** | sompi | claim tx 在**声明的 mass 规则版本**下的最坏费 = `compute_mass(T5) × 费率地板 + storage_mass(T5)` 换算 | (a)：全部由 `P_F` 经 `min_O` 预付；(b)：由 claim 发起者自备 | compute mass 组成 `consensus/core/src/mass/mod.rs:334-360`（size×`mass_per_tx_byte` + spk 字节×`mass_per_script_pub_key_byte` + v1 输入 `compute_budget`）；存储 `mass/mod.rs:430-478` |
| `F_reveal_reserve` | sompi | T4 的费 + `min_O` + 3 输出存储质量 | `P_F`（从 `LOCKED_R` 转来的份里扣）| 同上 |
| 费率地板 | sompi/gram | mempool 绝对下限 | 链参数，非我们可调 | `mining/src/mempool/config.rs:19 DEFAULT_MINIMUM_RELAY_TRANSACTION_FEE = 1000`；`:129 minimum_feerate()` |

**为什么不能被吸收**：`N_margin` 各项是 DAA；`F_*` 是 sompi。任何"费不够就把 N 调大"= 错域 + Codex 禁的 silently widening。**对抗性拥塞**（矿工首动方用自己的块塞满 `block_mass_limits`：TN12 `compute: 500_000, storage: 500_000, transient: 1_000_000` @`config/params.rs:687`）= 审查，归 bounded-inclusion 假设，**既不在 `N_margin` 也不在 `F_*`**，本稿明标为不覆盖。

---

## §4 断言坐标表（@7b1e18cc）

| 断言 | 坐标 | 原文/要点 |
|---|---|---|
| 存储质量公式（非松弛 / 松弛两路）| `consensus/core/src/mass/mod.rs:430-478 calc_storage_mass` | `:441-442 max(0, C * (|O|/H(O) - |I|/A(I)))`；`:460-467` 松弛条件 `|O| = 1 or |I| = 1 or |O| = |I| = 2`；`:469-478` 路径选择 |
| `C`（storage mass 参数）| `consensus/core/src/constants.rs:25`（🔴 **无 `config/` 前缀的那个** constants.rs，此处正确）| `pub const STORAGE_MASS_PARAMETER: u64 = SOMPI_PER_KASPA * 10_000;`（= 1e12；本仓 `kip9-mass.mjs:21 STORAGE_MASS_C = 1_000_000_000_000` 同值）|
| 计算质量组成 | `consensus/core/src/mass/mod.rs:334-360` | `compute_mass = size × mass_per_tx_byte + Σ(2 + spk.len) × mass_per_script_pub_key_byte + Σ compute_budget(v1)`；`transient = size × TRANSIENT_BYTE_TO_MASS_FACTOR` |
| mass 单价（TN12 继承 TESTNET_PARAMS）| `consensus/core/src/config/params.rs:639-641`（`mass_per_tx_byte: 1` / `mass_per_script_pub_key_byte: 10` / `mass_per_sig_op: 1000`）；`:645 storage_mass_parameter` | TN12 块 `:687 block_mass_limits { compute: 500_000, storage: 500_000, transient: 1_000_000 }`；`:684 max_signature_script_len: 300_000` |
| mempool 费下限 | `mining/src/mempool/config.rs:19`、`:129` | `DEFAULT_MINIMUM_RELAY_TRANSACTION_FEE = 1000`；`minimum_feerate()` |
| 输入数原语（(a) 选项可用）| `crypto/txscript/src/opcodes/mod.rs:1119 OpTxInputCount<0xb3>`；silverscript `tx.inputs.length`（`/d/silverscript/docs/TUTORIAL.md:923`）| 本仓 `PoolSide.sil` 已用 |
| v0.15 各支无输入数 require | v0.15 @L232-236 / @L242-248 / @L257-266 / @L269 / @L273 / @L288-296 | 逐支只见 `OpInputCovenantId(特定 idx)`、`OpCovOutputCount`、输出 spk/value；**零处** `OpTxInputCount` |
| 本仓既有费口径（只引用）| `kasia-relay/src/lib/p2sh.mjs:1737 _BSHARD_FEE_PER_INPUT = 1_000_000n`；`kasia-console/src/lib/kip9-mass.mjs:90 computeSingleOutputFee(minFee 2e6, maxFee 1e8)`；`pool.js:55 BETTOR_MIN_STAKE_PHYS_FLOOR = 100_000`（实测）| 供 P3 真形状出来后现算，**不是本稿依据** |

---

## §5 一处 (d) 稿 3-A 没写到的 T5 细节（影响 (a) 的 `min_O` 形式）
在 (a) 下，claim 若把 O 的剩余作**找零输出**：T5 变成 |I|=2、|O|=2 ⇒ 松弛公式 `C·(1/payout + 1/change − 1/O − 1/OAUTH)`；**找零太小 ⇒ `C/change` 独自就能超 `storage: 500_000`**（`1e12 / 5e5 = 2e6` sompi 是单个小输出的地板）⇒ tx 无效。⇒ (a) 下 `min_O` 只有两种合法形态：**恰等于费（零找零）** 或 **≥ 费 + 存储地板（有找零）**；"多给一点当找零"在 `[费, 费+2e6)` 区间是**死区**。(d) 稿 3-A 的"多出部分反应方可作找零拿回、过大无害"须补这条：**过大无害成立，"略大"有害**。(b) 下无此问题（找零来自发起者自己的费输入，可任意合并）。PLACEHOLDER：具体死区边界按 P3 真形状用 `mass/mod.rs:430` 现算。

---

## §6 P3 对 (d) 总界的影响表

| (d) 稿项 | P3 fee-source 之后 | 变/不变 | 谁定 |
|---|---|---|---|
| `min_O`（sompi）| (a)：`SF × (F_claim_reserve + storage_floor)`，且须避开 §5 死区；(b)：`SF × storage_floor` only | **变形式**，数 PLACEHOLDER | **Owner/Codex 定 (a)/(b)**（改 v0.15 正文 = 设计层）|
| `N_claim`（DAA）| 不变（费不影响落链时延，只影响落不落）| 不变 | §5① 实测 |
| `M_observe` / `M_reorg` | 不变 | 不变 | — |
| `M_congest` | **明确其范围 = 落链时延方差，不含费**；不加不减 | 不变（范围钉死）| — |
| `S_unalloc` | 不变 | 不变 | §5① 散度 |
| **新增 `F_claim_reserve`（sompi）** | 单列，不进 `N_margin` | **新增具名项** | P3 真形状现算 |
| **新增 `F_reveal_reserve`（sompi）** | 单列；决定 `P_F` 在 T4 要从 `LOCKED_R` 份里扣多少 | 新增 | P3 真形状现算 |
| 总界 `N_claim + N_margin`（DAA）| **不变**（费模型零 DAA 影响）| 不变 | — |
| 威胁模型 | 补一句：矿工首动方的**审查**与**费面**是两条不同的 claim 死法，前者在 bounded-inclusion 之外、后者由 (a)/(b) + `F_claim_reserve` 解 | 措辞 | 下版 (d) 顺手 |
| (d) 稿 3-A "过大无害" | 补 §5 死区 | 措辞 | 下版 (d) 顺手 |

**待 Owner 定的只有一件**：(a) `OpTxInputCount==2` 还是 (b) 只锚存储地板。本稿的推荐倾向（不是拍板）：**(b)**——它没有结构性死法（§2），代价只是便利；(a) 的唯一好处"零本钱可 claim"在 watchtower 多重方案下反而是负担（`WT` 无法自带费）。

---

## §7 不裁 / 未覆盖
- 不算任何 mass 数（P3 真 `.sil` 出来前算了也是 guess）。
- 不覆盖审查（矿工首动方不打包）——bounded-inclusion 假设。
- 未读 `mining/src/mempool` 的 RBF/驱逐策略细节；若 TN12 mempool 有按 feerate 驱逐，则 (a) 下 `P_R` 无法 RBF（不能加输入抬费）是又一条 (a) 独有死法，标 PLACEHOLDER 待读。
