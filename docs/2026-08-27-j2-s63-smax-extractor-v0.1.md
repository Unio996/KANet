# §6-3 gate (d) · `s_max` 提取器 · 方法稿 v0.1（(23) 算力地板规格 §3.5 "第三方可复核" 的可执行物 · 零落码 · 只读）

> **Status**: METHOD v0.1 · J2 2026-08-27 · Bettor 派工 (24) · 脚本 `scratch/_j2_smax_coinbase.mjs`（gitignored）· 正式输出落 `docs/provenance/2026-08-27-smax/`（同 bwin-sim 惯例）· 已加进 (17) 同步后清单 **③d**。
> **一句话**：窗 `[t−W, t]`（按块时间戳）内逐块解析 coinbase tx 的 **payload** 取本块矿工 `miner_data.script_public_key`，按 `version:script` 聚合出块份额 ⇒ `s_max`（最大单矿工份额）、前 N 名、块数、Poisson 噪声；**同时算"coinbase 输出地址法"份额作对照列并明标它不是逐块归属**。
> **dry-run 实况（2026-08-27，节点 IBD，只读）**：`--dry-run 5` 只拿到 1 块 = `TESTNET12_GENESIS`（hash `300fe020…`），payload 解析 `blueScore=0 / subsidy=1e8 / spk.version=0 / spk.len=1 / script=00 / extra="kaspa-testnetTOCCATA…"`——与 `consensus/core/src/config/genesis.rs:149-165` 的 genesis coinbase_payload 字节逐字段吻合 ⇒ 解析器布局正确；`s_max=1` 是 1 块样本的平凡值，不作证据。

---

## §1 为什么用 payload 不用输出地址（坐标 @7b1e18cc）
`consensus/src/processes/coinbase.rs:100-134 expected_coinbase_transaction`：coinbase 的**输出**是付给**被本块 merge 的每个蓝块的矿工**（`:113 mergeset_rewards.get(blue)` 每蓝块一输出），红块奖励才付本块矿工（`:134`）。本块矿工身份只在 **payload**（`:139` `CoinbaseData{blue_score, subsidy, miner_data}` → `:150-167 serialize_coinbase_payload`）。⇒ "逐块归属"必须解析 payload；输出地址法是**被 merge 集合**的份额，长窗下两者收敛，短窗/高并行时偏差可观 ⇒ 只作对照。

## §2 payload 偏移表（`coinbase.rs:158-163`，常量 `:13-19`）
| 偏移 | 长度 | 字段 | 编码 | 源行 |
|---|---|---|---|---|
| 0 | 8 | `blue_score` | u64 LE | :158 |
| 8 | 8 | `subsidy` | u64 LE | :159 |
| 16 | 2 | `script_public_key.version` | u16 LE | :160 |
| 18 | 1 | `script_public_key.script.len` | u8（≤ `coinbase_payload_script_public_key_max_len`，:151-156）| :161 |
| 19 | len | `script_public_key.script` | bytes | :162 |
| 19+len | 余 | `extra_data`（矿工自定义，如 "kaspa-testnetTOCCATA"）| bytes | :163 |
`MIN_PAYLOAD_LENGTH = 19`（`:18-19`）；反序列化对照 `:191 deserialize_coinbase_payload`。**归属键** = `version:script`（= `ScriptPublicKey` 语义，同 `kasia-relay` 地址派生的 spk）。

## §3 脚本行为
- **输入**：`--window-s W`（默认 3600）、`--max-blocks`、`--out`；**SYNC-GATE**（`daa > 80,095,687 ∧ isSynced`，同 (21)）；`--dry-run N` 绕闸只看解析形状、不落盘、输出带 `DRY-RUN` 标。
- **覆盖（承重）**：`s_max` 的严格口径要遍历窗内**全部 DAG 块**（含非选择链块，它们也是该矿工的功）。脚本正式路径 = 先沿 selected-parent 链回溯到窗起点取 `lowHash`，再 `getBlocks(lowHash, includeBlocks, includeTransactions)` **全量前向翻页**，按块时间戳过滤进窗；dry-run 只走选择链回溯（标"漏非选择链块"）。
- **输出 JSON**：`mode / t / daa / tipHash / window_s / coverage / blocks_fetched / layout / sample_payloads(前 3 块原 payload hex + 解析) / parsed / failed / s_max / top N(miner, blocks, share) / distinct_miners / control_output_addr(s_max_out, top) / poisson(blocks, rel_sd=1/√N)`；正式模式写 `docs/provenance/2026-08-27-smax/smax-<UTC>.json` 并打印 sha256。
- **Poisson**：份额估计相对标差 ≈ `1/√N`；低产窗 N 小 ⇒ `s_max` 噪声大 ⇒ (23) §3 的 `R_vol` 动态阈同理，窗内 N 随 JSON 落。

## §4 第三方复核路径
任何人用自己的节点跑同一脚本（或按 §2 偏移表自写）对同一 `[t−W, t]`（以 `tipHash` + 窗为锚）重算，比对 `s_max` 与 `top`；输入全是公开链数据（`getBlocks` / `getBlock` 的 header.timestamp + coinbase tx.payload）。`s_owner` 加严量不在本脚本内（那是 Owner 假设，(23) §3.5）。

## §5 未覆盖 / 陷阱
- **Sybil**：同一矿工多 script ⇒ `s_max` 偏低（(23) 已标：机械封的是可见集中，隐藏集中靠 `s_owner` 加严）。
- **矿池**：矿池 payload 的 script 是池地址 ⇒ 池内多矿工合并成一个键（`s_max` 偏高 = 安全方向）。
- **`getBlocks` 翻页**上限与 `MAX_SAFE_WINDOW`/pruning 无关，但窗过大会慢；`--max-blocks` 兜底并在 JSON 里标 `blocks_fetched`，**不足窗时不得当完整窗用**。
- **IBD 期**：只有 genesis 可取（dry-run 实证），任何 `s_max` 都是假象；正式跑必过 SYNC-GATE。
- 正式数据待同步（(17) ③d）。
