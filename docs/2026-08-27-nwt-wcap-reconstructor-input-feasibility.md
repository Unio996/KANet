# NWT — `w_cap_window` 重建器输入可行性核（@7b1e18cc）

> 作者 NWT · 2026-08-27 · 派工 Bettor（等 Codex 281 时）· 目标 = 核 (23) v0.13 / (d) v0.14 层1 `w_cap_window` 重建器所需输入在 live 二进制 `7b1e18cc` 的 RPC 面上**是否可得**。全部 `git show 7b1e18cc:`。
> **结论：重建器可行，无需换算法。** 所有字段经 `getBlocks(includeBlocks=true, includeTransactions=false)` 即得（block verboseData **无条件填充**）；分页 249/call（~251 轮补 62,440 蓝分）；剪裁保留 1.7 h 窗有巨大余量。三处实现注记见 §4。

## §1 字段表（重建器输入 × RPC 暴露 × 出处行号）
| 重建器需要 | 来源 | RPC 字段 | 出处 @7b1e18cc | 有? |
|---|---|---|---|---|
| `bits`（每块难度）| header | `RpcHeader.bits: u32` | `rpc/core/src/model/header.rs:45` | ✅ |
| `timestamp`（measured）| header | `RpcHeader.timestamp: u64` | `header.rs:44` | ✅ |
| `daaScore`（采样键/DAA 进位）| header | `RpcHeader.daa_score: u64` | `header.rs:47` | ✅ |
| `blueWork`（堆序 = 淘汰键）| header | `RpcHeader.blue_work: BlueWorkType` | `header.rs:48` | ✅ |
| `blueScore`（窗阈值/深度）| header **且** verboseData | `RpcHeader.blue_score` / `RpcBlockVerboseData.blue_score` | `header.rs:49` / `model/block.rs:73` | ✅ |
| `parents`（DAG 结构）| header | `RpcHeader.parents_by_level` | `header.rs:39` | ✅ |
| `selectedParentHash`（父窗继承）| verboseData | `RpcBlockVerboseData.selected_parent_hash` | `block.rs:70` | ✅ |
| `mergeSetBluesHashes`（采样 index/DAA 计数）| verboseData | `merge_set_blues_hashes: Vec<RpcHash>` | `block.rs:75` | ✅ |
| `mergeSetRedsHashes`（红块 non-DAA 判定）| verboseData | `merge_set_reds_hashes: Vec<RpcHash>` | `block.rs:76` | ✅ |
| `isChainBlock`（诊断）| verboseData | `is_chain_block: bool` | `block.rs:77` | ✅ |

**无缺字段 ⇒ 不需换算法**（Bettor 问①：无"mergeset 缺 ⇒ 从 parents 反推"的情形）。

## §2 承重发现：`getBlocks` 的 block verboseData 无条件填充
`get_blocks_call`（`rpc/service/src/service.rs:426`）在 `include_blocks=true` 时对每块调 `consensus_converter.get_block(session, block, include_transactions, include_transactions)`（:471-475）。核 converter（`rpc/service/src/converter/consensus.rs:61-99`）：
- 签名 `get_block(_, _, include_transactions, include_transaction_verbose_data)`（:65-66）；
- 🔴 **`verbose_data = Some(RpcBlockVerboseData{…})` 在 :73 【无条件】构造**（selected_parent 取 `ghostdag_data`（:69 server 端算）、mergeset、blue_score 全在），**不受任何 include 旗标门控**；
- 第 4 参 `include_transaction_verbose_data` 只管**交易** verbose（:91），第 3 参 `include_transactions` 只管 `transactions`（:86）。
⇒ **`getBlocks(includeBlocks=true, includeTransactions=false)` 就拿到 header + block verboseData（mergeset/selectedParent/blueScore），无 tx 载荷 = 轻量。** 不必 getBlock 逐块。

## §3 分页与剪裁（Bettor 问②③）
- **② 每 call 上限 = 249 块**：`max_blocks = mergeset_size_limit()+1 = 249`（`service.rs:452-453`，`get_hashes_between(low, sink, 249)`）。补 62,440 蓝分（≈62k 块）⇒ **~251 轮**顺序调用。**`MAX_SAFE_WINDOW_SIZE=10,000`（`rpc/core/src/api/rpc.rs:16`）是 `estimateNetworkHashesPerSecond`（:390）的窗限，与 getBlocks 无关**（Bettor 疑点澄清：两限分离）。
- **③ 剪裁不构成约束**：`pruning_depth = max(lower_bound, BPS×PRUNING_DURATION)`（`bps.rs:96-107`），`lower_bound = finality_depth + 2×merge_depth(36,000) + 4×mergeset_size_limit(248)×ghostdag_k(124) + 2×124 + 2 ≈ finality_depth + 195,258` 块。⇒ **`pruning_depth ≫ 62,440`**（仅 lower_bound 常数项就 ~195k 块 ≈5.4 h @10BPS，远超 1.7 h 窗）。⇒ 需要的近 62,440 蓝分历史**恒在保留区内、永不被剪**（memory `reference-tn12-pruning-wall-and-archival-semantics`：剪裁墙远深于本窗）。

## §4 实现注记（非阻塞）
1. **分页方向**：`getBlocks` 前向（low→sink）。取"近 62,440"须起于 `low_hash ≈ sink 蓝分 − 62,440`；实做 = 扩 (24) 现有 W=3600 s 窗遍历的 low 锚 ~1.7×（(24) 已按 getBlocks 拉 W 窗，本重建器同管线加深 ~1 h）。非阻塞。
2. **增量缓存**：pre-entry 非实时，`window(SP)` 增量 O(1)（父窗+采样≤7+淘汰），可跨入场缓存、只补新块。
3. **本地 store 更快**：若重建器与节点同机，直读 consensus store 可 O(1)/块免 251 轮 RPC；但 RpcClient 路径（251 轮 getBlocks，轻量无 tx）对 pre-entry 一次性计算已够。

## §5 交付结论
**重建器可行（无需替代算法）**：全部输入字段在 `7b1e18cc` RPC 面可得，经 `getBlocks(includeBlocks=true, includeTransactions=false)` 一次拉齐 header+verboseData；分页 249/call·~251 轮补 62,440 蓝分（顺序、可增量缓存）；剪裁保留远超 1.7 h。J2 scratch 重建器可照 (23) v0.13 层1 不等式直接落，输入无阻。（Codex 281 回后并入 (21) 工具 `hVisUb` 的 `wCapWindow` 实参。）
