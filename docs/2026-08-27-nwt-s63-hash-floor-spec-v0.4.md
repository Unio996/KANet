# Tier-2 算力地板量法规格 v0.4（J2 precision：coinbase 逐块归属用 payload · SUPERSEDES v0.3）

> **Status**: DESIGN v0.4 · NWT 2026-08-27 · SUPERSEDES v0.3（a383bba5，J2 GREEN）· **单一改动**：§3.5 的 `s_max` 逐块矿工归属**从"coinbase 输出地址"改为"coinbase payload 的 miner_data.script_public_key"**（J2 承重精度注，影响"第三方可复核"的正确性）。**§1/§2/§3(a-c)/§4/§5/§6/§8 一律同 v0.3（a383bba5），不重录。**

## 为什么改（J2 精度，我核 `git show 7b1e18cc:`）
🔴 **Kaspa coinbase 的【输出】付的不是本块矿工，是 mergeset 各蓝块的矿工**：
- `consensus/src/processes/coinbase.rs:109-118`：对 mergeset 每个**蓝块**建一个输出，付到**该蓝块自己报的 script**（`reward_data.script_public_key`，= 那个蓝块的矿工，来自它自己的 coinbase）。
- `:132-134`：mergeset **红块**的奖励汇成**一个**输出，付给**本块（merging block）矿工**（`miner_data.script_public_key`）。
- ⇒ **coinbase 输出是 mergeset 混合**（多个历史蓝块矿工 + 本块矿工收红块那份）⇒ **按输出地址逐块统计 = 错归属**（把一块的输出算成多个矿工、且跨 mergeset）。
- 🔴 **本块矿工身份在 coinbase 的 `payload`**（`:139` 用本块 `miner_data` 造 payload；`:151-165 serialize_coinbase_payload`）。

## §3.5 修正（替换 v0.3 §3.5 里 `s_max` 的归属那句；其余 §3.5 逻辑不变）
- **`s_max` = 窗内【最大单一矿工】出块份额**，逐块矿工 = **解析该块 coinbase tx 的 `payload` 取 `miner_data.script_public_key`**（**不是**读输出地址）。
- **payload 解析路径（`serialize_coinbase_payload` :158-165，LE，字节偏移）**：

  | 字段 | 偏移 | 宽 | 说明 |
  |---|---|---|---|
  | blue_score | `[0:8)` | u64 LE | 跳过 |
  | subsidy | `[8:16)` | u64 LE | 跳过 |
  | spk.version | `[16:18)` | u16 LE | miner spk 版本 |
  | spk.len `L` | `[18:19)` | u8 | miner spk 长度 |
  | **spk.script** | `[19:19+L)` | `L` 字节 | 🔴 **本块矿工身份**（归属键 = `version‖script`）|
  | extra_data | `[19+L: )` | 变长 | 跳过 |

  逐块：`getBlock(h) → tx[0](coinbase).payload → 按上表取 (version, script) → 归属键`；`s_max = max_over_miner(该矿工块数 / 窗内总块数)`。
- 🔵 **输出地址法 vs payload 法（J2 注）**：**输出地址法在窗口够长时份额收敛**（长窗里每个矿工的块都会通过 mergeset 被付到，聚合输出-值-份额 ≈ 挖矿份额）——**可作聚合 sanity**；但**逐块归属必用 payload**（输出跨 mergeset、单块混多矿工）。**单矿工两法皆 = 1**（全输出+全 payload 同一矿工）⇒ **§6 底线（s_max=1 ⇒ 自动 fail-closed）不变**。
- 其余 §3.5（`s_adv := max(s_owner, s_max)`、(ii) 必算 / (i) 只加严、Sybil 使 s_max 偏低须 s_owner 兜、s_max=1 自动 fail-closed = 机制输出）**全同 v0.3**。Sybil 分址在 payload 法下同样让 s_max 偏低（一个矿工多 spk）——归属键换了、Sybil 方向不变。

## §7 修正（"第三方可复核"的对象精确化）
- v0.3 §7 说"`s_max` 全是公开链数据、第三方自己重算"——**对，但重算路径是 payload 解析（上表）不是输出地址**。artifact 落 `s_max` 时**须落逐块归属键（version‖script）+ 采样窗**，第三方按 payload 解析复算。**输出地址聚合份额可作旁证但不作 `s_max` 定值。**
- 其余 §7 同 v0.3。

## 未变（同 v0.3 a383bba5）
§1 估计器 min(法1,法2,法3) + 法3 [t−W,t] 块时间戳窗/W≫132s；§2 墙钟窗；§3(a)(b)(c) 三闸 + R_vol 纳 Poisson；§4 k_max/H_floor_min 闭环；§5 fail-closed + 已开仓入场前披露 MUST；§6 底线=机制输出（现 TN12 s_max=1 自动 fail-closed）；§8 未决。
