# §6-3 gate (d) · `k_max` 绝对成本表 · 方法稿 v0.5（脚本入库 durable · 法 3 + gate_input 语义 · 设备算力 A/B/C 档 · 现网算力栏等同步 · 零落码）

> **v0.5（NWT 三注，非阻塞）**：① 加**法 3 瞬时估**（墙钟窗 `[t−W,t]` 按块时间戳计块数/W × work_per_block，W ≫ 132 s 默认 600 s，对齐 (23) v0.6）作 fallback，决策 = `min(可用法)`；**只有法 1 ⇒ `PROVISIONAL_OVERESTIMATE`**——法 1 = 陈难度，算力跌后过估 `H_net`（攻击成本看着更贵、地板入场太易 = 危险向），**不许独用作 (23) firm 输入**；② 可用法相差 >2× ⇒ 成本表内仍 min + 注，**但喂 (23) 入场闸 = 环境违约（测量不可靠）⇒ `gate_input=FAIL_CLOSED` 不入场，不是取 min 硬用**；③ 单位：`H1/H2/H3` 与设备档同为 kHeavyHash H/s（4090 2.0 GH/s → 2.0e9 ✓），折算只用 kHeavyHash 专属 A/B 档，**5090 C 档估值只列不折**。向量 19/19（法 3 计数 / 六例 decide / C 档不折）。(17) ③c 闸同步为 `gate_input === 'OK'`。

> **v0.4（Bettor (31)：脚本入库，闭 (17) ③c "未入库 ⇒ 输出不作证据"缺口）**：`scratch/_j2_kmax_cost.mjs` → **`docs/provenance/2026-08-27-kmax/kmax-cost.mjs`**（纯函数 `targetFromBits`（镜像 `math/src/lib.rs:64-80`，含 `mant > 0x7FFFFF ⇒ 0` 分支）/ `compactTargetBits`（`:83-97` 往返）/ `workPerBlock` / `hNetFromBits`（法 1）/ `difficultyRatio` / `decideHNet`（`min(法1,法2)`，>2× 加注，法 2 缺只法 1 并标）/ `clampWindow`（`MIN_WINDOW_SIZE=1000` · `MAX_SAFE_WINDOW_SIZE=10,000`）/ `hAdvImplied` / `foldToDevices` / `costTable` + 链读 `main`，SYNC-GATE 保留，输出带 `schema_version=kmax-cost/4`、`target_commit`、`rpc.live_binary_commit=7b1e18cc`、`cli_args`、`bits_roundtrip_ok`）+ 离线确定性向量 15 条（**genesis bits 504155340** → target/work/H1/ratio + 往返；exp 分支；符号位 ⇒ 0；两法取 min 四例；window 边界三例；`H_adv_implied` 反读 k=1000 @2e9 ≈ 1/3 台 KS3M；折卡表）+ `expected-output.json` + `MANIFEST.sha256` + README（坐标 @7b1e18cc、cli、schema）。15/15 PASS。scratch 版 SUPERSEDED；(17) ③c 改入库路径并去掉"不作证据"标。

> **v0.3（NWT a66d9247 GREEN-WITH-NOTES 三须改）**：**A** §3 来源加可信度档（A 厂商官方 / B 聚合站·计算器 / C 社区·估值），并写明结论对分级**鲁棒**（GPU↔ASIC 差 3–4 个数量级，任何一档的误差远小于此）；**B** 5090 不删、标 C 档估值；明写**地板靠 §4 链上实测，不靠 §3 卡表加和**——卡表只用于攻击者侧成本与 sanity，我们自己的卡（含 5090）可直接实测填；**C** §5 成本基从"租赁/天"改为 **二手 ASIC CAPEX vs 头寸 value-at-risk**（NiceHash kHeavyHash 已停 + ASIC 可复用故按 CAPEX 而非日租），并接 NWT (23) 的 `H_floor_min = H_adv/(k_baked−1)`；边界值等 §4 实测。
> **v0.2（NWT ac680df3 两须改 + Bettor 两补注）**：① 法 1/法 2 一致性判据改为**决策值取 `min(法1, 法2)`**（保守 = 不高估 `H_net` ⇒ 不高估攻击成本）；② "首动方 = 我们自己 + 开放 PoW 网 ⇒ 现网 GPU 级算力即 Tier-2 fail-closed" 从脚注升为 **§1 决策枢轴**，与 (d) v0.8 §6 算力地板政策互引；③ ASIC 厂商标称偏乐观 ⇒ 用作**攻击者**算力即保守方向（高估对手 = 安全方向）；④ §3 设备算力**已用 WebSearch 填**（2026-08-27，标来源与日期，PLACEHOLDER → UNVERIFIED-SOURCED），与 §4 现网算力（等同步）分开。
> **Status**: METHOD v0.2 · J2 2026-08-27 · Bettor 派工 (21) · 用途 = Owner/Codex 具名 `k_max` 的决策输入（MSG-274 问的："`k_max ≲ 1000` 于近零算力测试网可否作过渡假设"——答案取决于 **1000× 在 TN12 到底值几张卡**）。
> 脚本 `scratch/_j2_kmax_cost.mjs`（gitignored；**现在不跑，节点 IBD**；自带 SYNC-GATE，`daa ≤ 80,095,687 ∨ !isSynced` ⇒ 退出码 3 不出数）。已加进 (17) 同步后清单为 **③c**（与 ③a/③b 并行只读）。
> 本稿只有方法与公式；§4 数字栏全空，§3 参考算力全标【未实测·PLACEHOLDER】。

---

## §1 要回答的问题 · 决策枢轴
`k` = 注入后 / 注入前的网络算力比（(d) 稿 3-C）。`B_win(k)` 曲线已有（NWT sim v0.2：k=10→25,279 / 100→41,236 / 1000→53,070 DAA），占位 55,200 ⟺ `k_max ≲ 1000`。**但 k 是相对量**：TN12 现网算力 `H_net` 若只有一两张卡的量级，k=1000 的绝对成本可能只是"几百张卡"或"一台 ASIC"——这决定 `k_max ≲ 1000` 是不是一条可信的过渡假设。本稿给 **`(k−1) × H_net` 折成卡数/ASIC 台数** 的算法。

🔴 **决策枢轴（v0.2 升为正文，Bettor/NWT）**：TN12 是**开放 PoW 网**，且现网算力基线 = **我们自己的矿机**（首动方 = 我们自己的场景下分母就是我们的卡数）。⇒ **只要 §4 测得的 `H_net` 是 GPU 级（~1e9–1e10 H/s），一台市售 ASIC（§3：6–21 TH/s）就是 k ≈ 1e3–1e4** ⇒ 按 (d) v0.8 §6 算力地板政策，**现网 = 跌破任何可信地板 = Tier-2 fail-closed**，`k_max ≲ 1000` 只可能是 Codex 说的 "experimental weak trust assumption"。本稿其余部分只是把这条枢轴量化成表；**枢轴本身不等同步就能写死**，因为 GPU 级与 ASIC 级差 3–4 个数量级，同步后的数只会落在这个结论的一边（GPU 级 ⇒ 成立）或另一边（我们自己已是 ASIC 级 ⇒ 再算）。

## §2 公式与坐标（全 `git show 7b1e18cc:<path>`，非工作树）
| 步 | 公式 | 坐标 @7b1e18cc |
|---|---|---|
| ① tip 的 `bits`（compact target）| `getBlock(tipHash).header.bits`（u32）| `consensus/core/src/header.rs` 字段；RPC `getBlock` |
| ② `bits → target` | `target = mantissa(23 bit) × 256^(exp−3)`（exp = 高 8 位）| `math/src/lib.rs:64 from_compact_target_bits`（反向 `:83 compact_target_bits`）|
| ③ 期望每块 hash 数 | `work_per_block = 2^256 / (target + 1)` | `consensus/src/processes/difficulty.rs:261-267 calc_work`（注释给出 `~target/(target+1)+1` 等价式）|
| ④ 现网算力（法 1）| `H_net = work_per_block × BPS`，TN12 `BPS = 10` | `config/params.rs:689-691 TESTNET12_PARAMS TenBps`；`config/bps.rs:49-53 target_time_per_block = 1000/BPS` |
| ④' 现网算力（法 2，节点自算）| `H_net = Δblue_work / Δt` over window（默认 1000 块）| `consensus/src/processes/difficulty.rs:46-67 internal_estimate_network_hashes_per_second`（`MIN_WINDOW_SIZE = 1000` @:48）；RPC `estimateNetworkHashesPerSecond`（`rpc/service/src/service.rs:954-972`，`window_size ≤ MAX_SAFE_WINDOW_SIZE` 且 ≤ pruning depth）|
| ⑤ 交叉核 | `difficulty_ratio = MAX_DIFFICULTY_TARGET_AS_F64 / target` 须 ≈ `getBlockDagInfo().difficulty` | `rpc/service/src/converter/consensus.rs:49-56 get_difficulty_ratio`；`consensus/core/src/config/constants.rs:44 MAX_DIFFICULTY_TARGET_AS_F64 = 5.78960446186581e76`（= 2^255 − 1，`:40`；🔴 全路径——同仓另有无 `config/` 的 `consensus/core/src/constants.rs`，其 `:44` 是注释行）|
| ⑥ 需注入算力 | `H_need(k) = (k − 1) × H_net`（k 倍是"总/原"，注入量减去原有）| — |
| ⑦ 折卡 / 租赁 | `cards = H_need / H_card`；`rent = H_need × 单价(H/s·天)` | §3 参考值 |

**两法不一致的处理（v0.2 改）**：法 1 用 tip 的 bits（反映**最近一次难度调整**），法 2 用窗内实际 blue_work 增速（反映**实际产出**，含停滞）。**决策值 = `min(法1, 法2)`**（NWT：保守方向 = 不高估 `H_net` ⇒ 不高估攻击者需注入的绝对算力 ⇒ 不高估攻击成本）；两者都写进表，相差 > 2× 时加注原因（tip bits 陈 / 窗内停滞）。

**IBD 陷阱**：IBD 期 `tip bits` 是历史块的、`estimateNetworkHashesPerSecond` 窗跨越追块期 ⇒ 全是假象；SYNC-GATE 同 `_j2_postibd_chaincheck_20260826/_common.cjs`（`daa > 80,095,687 ∧ isSynced`）。

## §3 参考算力（kHeavyHash）——UNVERIFIED-SOURCED，分 A/B/C 可信度档（WebSearch 2026-08-27，未实测）
**档位定义（v0.3）**：**A** = 厂商官方产品页/规格书；**B** = 聚合站·计算器（WhatToMine / minerstat / hashrate.no / ASIC Miner Value 等，转抄厂商或矿池统计）；**C** = 社区报告或本稿估值。
🔴 **用途界定（v0.3，NWT B）**：**本表只用于两件事——(i) 攻击者侧成本折算（§4 表的分母）、(ii) §4 链上实测值的 sanity（"我们几张卡 ⇒ 期望 `H_net` 量级"）。地板 `H_floor` 一律靠 §4 链上实测（(23) 规格两法 `min`），不靠本表加和。** 我们自己的卡（含 5090）可以直接实测（矿工软件报的 H/s 或链上 `H_net` 变化）填进来并升为 A' 档（自测）。
**结论对分级鲁棒**：§1 枢轴只用到 GPU（~1e9）与 ASIC（~1e12–1e13）之间 **3–4 个数量级**的差；任一档位来源的误差（超频 ±30%、标称 ±10%）远小于此 ⇒ A/B/C 哪一档都改不了枢轴方向，只影响 §4 折算的小数位。

| 设备 / 渠道 | `H_card`（H/s）| 档 | 来源（2026-08-27 检索）| 状态 |
|---|---|---|---|---|
| RTX 4090（GPU）| **2.0e9**（WhatToMine 2.00 GH/s @240 W）～ **2.43e9**（cryptoage 2430 MH/s）| B（聚合站）/ C（cryptoage 社区）| [WhatToMine KAS/4090](https://whattomine.com/coins/352-kas-kheavyhash/gpus/79-nvidia-geforce-rtx-4090) · [cryptoage](https://cryptoage.com/en/2950-nvidia-geforce-rtx-4090-hashrate-based-on-ethash,-et%D1%81hash,-kawpow,-autolykos2,-equihash,-octopus,-kaspa-algorithms.html) · [hashrate.no](https://hashrate.no/gpus/4090/KAS/analysis) | UNVERIFIED-SOURCED（随超频变）|
| RTX 5090（GPU）| **~3e9–5e9（估值）**：无 kHeavyHash 公开数（检索到的只有 PearlHash 376 TH/s 等其它算法），按 4090 的 1.5–2× 估 | **C（本稿估值）** | [Kryptex 5090](https://www.kryptex.com/en/hardware/nvidia-rtx-5090) · [hashrate.no 5090](https://www.hashrate.no/gpus/5090) · [Kaspa wiki hashrate tables](https://wiki.kaspa.org/en/hashrate-tables) | UNVERIFIED-SOURCED（估值非来源；**我们自己有 5090 ⇒ 同步后直接实测填，升 A'**）|
| IceRiver KS3M（ASIC）| **6.0e12**（6 TH/s @3400 W）；KS3 **8.0e12**（8 TH/s @3200 W）| **A**（IceRiver 官方页）/ B | [IceRiver 官方 KS3M](https://iceriver.app/products/iceriver-kas-ks3m) · [minerstat KS3M](https://minerstat.com/hardware/iceriver-kas-ks3m) · [Mining Now KS3](https://miningnow.com/asic-miner/iceriver-ks3-8th-s/) | UNVERIFIED-SOURCED（厂商标称，偏乐观 = 作攻击者算力保守）|
| Bitmain Antminer KS5 Pro（ASIC）| **2.1e13**（21 TH/s ±3% @3150 W ±10%，150 J/T）| B（ASIC Miner Value / Zeus / Amazon 转抄厂商规格；Bitmain 官方页未检索到 ⇒ 不给 A）| [ASIC Miner Value KS5 Pro](https://www.asicminervalue.com/miners/bitmain/antminer-ks5-pro-21th) · [Zeus Mining](https://www.zeusbtc.com/Asic-Miner/Asic-Miner-Details.asp?ID=3435) · [Amazon 商品页](https://www.amazon.com/Antminer-kHeavyHash-Hashrate-Efficiency-Air-Cooling/dp/B0CY3GJDNJ) | UNVERIFIED-SOURCED（厂商标称转抄）|
| 租赁（NiceHash kHeavyHash）| **不可用**：hashrate.no 标 NH-KHeavyHash "currently disabled and not receiving updates"；检索到的 "$117,874 per TH/s / $0.468 per TH/s·day" 语义不明（疑为硬件价与收益，非租价）| B | [hashrate.no NH-KHeavyHash](https://www.hashrate.no/coins/NH-KHeavyHash) · [minerstat NH-KHeavyHash](https://minerstat.com/coin/NH-KHeavyHash) · [NiceHash buying guide](https://www.nicehash.com/guide/nicehash-buying-guide) | **UNAVAILABLE** ⇒ 成本基改 **二手 ASIC CAPEX**（§5）|

🔵 **ASIC 标称偏乐观 ⇒ 保守方向**（Bettor 补注）：厂商标称是理想工况上限；本表把它当**攻击者**能拿到的算力 ⇒ 高估对手 = 安全方向，**不需要下修**。反之 GPU 的矿池统计偏实际，用作"随手攻"的下限也合适。

**为什么要两档**：GPU 决定"随手一张卡"的 k；ASIC 决定"想认真攻"的 k。**量级对比（已可算，不等同步）**：KS5 Pro / 4090 ≈ 2.1e13 / 2.0e9 ≈ **1.0e4**；KS3M / 4090 ≈ **3e3**。⇒ 若 `H_net` = 一张 4090 级，**一台 KS3M 就是 k ≈ 3,000、一台 KS5 Pro 就是 k ≈ 10,000**，都在 `k_max ≲ 1000` 之外——这就是 §1 枢轴的数值形态。

## §4 输出表（同步后由脚本填；现全空）
| | 值 |
|---|---|
| 采样时刻 / `daa` / tip | — |
| `bits` / `target` / `difficulty`(rpc) / ratio(calc) | — |
| `H_net` 法 1（bits × 10 BPS）| — H/s |
| `H_net` 法 2（node estimate, window=1000）| — H/s |
| **`H_net` 决策值 = min(法1, 法2)** | — H/s |

| k | `H_need = (k−1)·H_net(min)` | 折 RTX 4090（张，÷2.0e9）| 折 KS3M（台，÷6.0e12）| 折 KS5 Pro（台，÷2.1e13）|
|---|---|---|---|---|
| 10 | — | — | — | — |
| 100 | — | — | — | — |
| 1000 | — | — | — | — |

（租赁列删：NiceHash kHeavyHash 已停，见 §3；"认真攻"的成本口径改为二手 ASIC 购置，价格另核。）

## §5 读表规则（预注册，防事后解释）
- **成本基（v0.3 改，NWT C）**：不再用"租赁/天"（NiceHash kHeavyHash 已停）；改用 **二手 ASIC CAPEX**（一次性购置、且 ASIC 可复用/转售 ⇒ 真实沉没成本 ≤ CAPEX）**vs 头寸 value-at-risk**（反应方本金 `LOCKED_R`/`O_AUTHORIZED` 量级）。判据：`CAPEX(H_need) ≤ VaR` ⇒ 攻击划算 ⇒ 该 k 不可作假设。
- **接 (23) 规格**：`H_floor_min = H_adv / (k_baked − 1)`（NWT c1d05ec0 §4）。本表给的是反向读法：给定 `k_baked`（占位 ≈1000）与 §4 实测 `H_floor`，**推出隐含的对抗预算 `H_adv_implied = (k_baked − 1) × H_floor`**，再用本表把它折成"几台 KS3M / KS5 Pro 的 CAPEX"——这就是 Owner 要判断"对手买不买得起"的那个数。
- **判据**：若 `H_adv_implied` 的 CAPEX ≤ 一台入门 ASIC（KS3M 6 TH/s）二手价、或 ≤ 头寸 VaR ⇒ `k_max ≲ 1000` **不可作过渡假设**，(d) 稿 §7 1-bis 只能走 "Tier-2 禁用 / 实验-only"（Codex）；若 `H_adv_implied` 需数百 GPU **且** `H_net` 本身已是 ASIC 级 ⇒ 可作**有限期**过渡假设，且 `k_max` 取表里 "CAPEX > VaR" 的最小 k。**按 §3 量级，只要 `H_net` 是 GPU 级，前一支必然命中**（§1 枢轴）：k=1000 ⇒ `H_adv_implied ≈ 999 × 2e9 ≈ 2e12 ≈ 1/3 台 KS3M`。
- 二手 ASIC 价格、头寸 VaR 边界值 = PLACEHOLDER，等 §4 实测 `H_floor` 与 Owner 给的头寸规模后填。
- 决策值一律 `min(法1, 法2)`（§2）。
- 数字一律带采样时刻与两法 `H_net`；参考算力一律带来源；不许用"量级 ~1e9"那类占位填表。
- 表是**决策输入**，本稿不拍 `k_max`。

## §6 未覆盖
- 首动方 = 我们自己的情形已升为 §1 枢轴（分母 = 我们的卡数），本节不再重复。
- 未算 pump 之外的审查成本（out-of-model）。
- 参考算力全未核；`estimateNetworkHashesPerSecond` 在 `unsafe_rpc=false` 下 window 上限 `MAX_SAFE_WINDOW_SIZE`（值未抄，脚本用 1000，超限会报错并回落只用法 1）。
