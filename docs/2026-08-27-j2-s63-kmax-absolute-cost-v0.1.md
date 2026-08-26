# §6-3 gate (d) · `k_max` 绝对成本表 · 方法稿 v0.1（数字栏留空 · 同步后填 · 零落码）

> **Status**: METHOD v0.1 · J2 2026-08-27 · Bettor 派工 (21) · 用途 = Owner/Codex 具名 `k_max` 的决策输入（MSG-274 问的："`k_max ≲ 1000` 于近零算力测试网可否作过渡假设"——答案取决于 **1000× 在 TN12 到底值几张卡**）。
> 脚本 `scratch/_j2_kmax_cost.mjs`（gitignored；**现在不跑，节点 IBD**；自带 SYNC-GATE，`daa ≤ 80,095,687 ∨ !isSynced` ⇒ 退出码 3 不出数）。已加进 (17) 同步后清单为 **③c**（与 ③a/③b 并行只读）。
> 本稿只有方法与公式；§4 数字栏全空，§3 参考算力全标【未实测·PLACEHOLDER】。

---

## §1 要回答的问题
`k` = 注入后 / 注入前的网络算力比（(d) 稿 3-C）。`B_win(k)` 曲线已有（NWT sim v0.2：k=10→25,279 / 100→41,236 / 1000→53,070 DAA），占位 55,200 ⟺ `k_max ≲ 1000`。**但 k 是相对量**：TN12 现网算力 `H_net` 若只有一两张卡的量级，k=1000 的绝对成本可能只是"几百张卡"或"租几 TH/s 一天"——这决定 `k_max ≲ 1000` 是不是一条可信的过渡假设。本稿给 **`(k−1) × H_net` 折成卡数/租赁量级** 的算法。

## §2 公式与坐标（全 `git show 7b1e18cc:<path>`，非工作树）
| 步 | 公式 | 坐标 @7b1e18cc |
|---|---|---|
| ① tip 的 `bits`（compact target）| `getBlock(tipHash).header.bits`（u32）| `consensus/core/src/header.rs` 字段；RPC `getBlock` |
| ② `bits → target` | `target = mantissa(23 bit) × 256^(exp−3)`（exp = 高 8 位）| `math/src/lib.rs:64 from_compact_target_bits`（反向 `:83 compact_target_bits`）|
| ③ 期望每块 hash 数 | `work_per_block = 2^256 / (target + 1)` | `consensus/src/processes/difficulty.rs:261-267 calc_work`（注释给出 `~target/(target+1)+1` 等价式）|
| ④ 现网算力（法 1）| `H_net = work_per_block × BPS`，TN12 `BPS = 10` | `config/params.rs:689-691 TESTNET12_PARAMS TenBps`；`config/bps.rs:49-53 target_time_per_block = 1000/BPS` |
| ④' 现网算力（法 2，节点自算）| `H_net = Δblue_work / Δt` over window（默认 1000 块）| `consensus/src/processes/difficulty.rs:46-67 internal_estimate_network_hashes_per_second`（`MIN_WINDOW_SIZE = 1000` @:48）；RPC `estimateNetworkHashesPerSecond`（`rpc/service/src/service.rs:954-972`，`window_size ≤ MAX_SAFE_WINDOW_SIZE` 且 ≤ pruning depth）|
| ⑤ 交叉核 | `difficulty_ratio = MAX_DIFFICULTY_TARGET_AS_F64 / target` 须 ≈ `getBlockDagInfo().difficulty` | `rpc/service/src/converter/consensus.rs:49-56 get_difficulty_ratio`；`config/constants.rs:44 MAX_DIFFICULTY_TARGET_AS_F64 = 5.78960446186581e76`（= 2^255 − 1，`:40`）|
| ⑥ 需注入算力 | `H_need(k) = (k − 1) × H_net`（k 倍是"总/原"，注入量减去原有）| — |
| ⑦ 折卡 / 租赁 | `cards = H_need / H_card`；`rent = H_need × 单价(H/s·天)` | §3 参考值 |

**两法不一致的处理**：法 1 用 tip 的 bits（反映**最近一次难度调整**），法 2 用窗内实际 blue_work 增速（反映**实际产出**，含停滞）。若相差 > 2× ⇒ tip bits 陈（长时间无块难度不变）或窗内停滞，**以法 2 为准并标注**；两者都写进表。

**IBD 陷阱**：IBD 期 `tip bits` 是历史块的、`estimateNetworkHashesPerSecond` 窗跨越追块期 ⇒ 全是假象；SYNC-GATE 同 `_j2_postibd_chaincheck_20260826/_common.cjs`（`daa > 80,095,687 ∧ isSynced`）。

## §3 参考算力（kHeavyHash）——🔴 全部【未实测】，来源类型具名，数值 PLACEHOLDER
| 设备 / 渠道 | `H_card`（H/s）| 来源类型 | 状态 |
|---|---|---|---|
| RTX 4090（GPU）| PLACEHOLDER（量级 ~1e9 H/s 级）| 社区矿工报告 / 矿池统计页 | 未核（需 WebFetch 或 Owner 给实测）|
| RTX 5090（GPU）| PLACEHOLDER | 无可信公开数 | 未核 |
| IceRiver KS0 / KS3M（ASIC）| PLACEHOLDER（量级 ~1e11–1e13 H/s 级）| 厂商标称 | 未核 |
| Bitmain KS5 Pro（ASIC）| PLACEHOLDER | 厂商标称 | 未核 |
| 租赁（NiceHash kHeavyHash 等）| PLACEHOLDER（单价 /TH/s·天）| 市场报价 | 未核 |

**为什么要两类**：GPU 决定"随手一张卡"的 k；ASIC/租赁决定"想认真攻"的 k——TN12 若 `H_net` 只是 GPU 级，**一台 ASIC 就是 k ≫ 1000**，那 `k_max ≲ 1000` 对"认真攻"不成立，只对"随手攻"成立；表要把这两档分开给 Owner/Codex。

## §4 输出表（同步后由脚本填；现全空）
| | 值 |
|---|---|
| 采样时刻 / `daa` / tip | — |
| `bits` / `target` / `difficulty`(rpc) / ratio(calc) | — |
| `H_net` 法 1（bits × 10 BPS）| — H/s |
| `H_net` 法 2（node estimate, window=1000）| — H/s |

| k | `H_need = (k−1)·H_net` | 折 GPU（张）| 折 ASIC（台）| 租赁量级（/天）|
|---|---|---|---|---|
| 10 | — | PLACEHOLDER | PLACEHOLDER | PLACEHOLDER |
| 100 | — | PLACEHOLDER | PLACEHOLDER | PLACEHOLDER |
| 1000 | — | PLACEHOLDER | PLACEHOLDER | PLACEHOLDER |

## §5 读表规则（预注册，防事后解释）
- **判据**：若 k=1000 的折算 ≤ "一台入门 ASIC" 或 租赁 ≤ 几十美元/天 ⇒ `k_max ≲ 1000` **不可作过渡假设**（攻击成本低于一次 Tier-2 头寸），(d) 稿 §7 1-bis 只能走 "现网不开 Tier-2 / 换网络" 那支；若 k=1000 需数百 GPU 且无 ASIC 可租 ⇒ 可作**有限期**过渡假设，且 `k_max` 取表里 "成本 > 头寸上限" 的最小 k。
- 数字一律带采样时刻与两法 `H_net`；参考算力一律带来源；不许用"量级 ~1e9"那类占位填表。
- 表是**决策输入**，本稿不拍 `k_max`。

## §6 未覆盖
- 未算首动方**自身已有算力**的情形（k 的分母若本来就是首动方 = 我们自己，则"注入"= 加卡，成本表同样适用，但基线 = 我们自己的卡数）。
- 未算 pump 之外的审查成本（out-of-model）。
- 参考算力全未核；`estimateNetworkHashesPerSecond` 在 `unsafe_rpc=false` 下 window 上限 `MAX_SAFE_WINDOW_SIZE`（值未抄，脚本用 1000，超限会报错并回落只用法 1）。
