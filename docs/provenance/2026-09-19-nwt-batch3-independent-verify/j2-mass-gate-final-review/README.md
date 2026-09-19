# J2 mass 断言改造终审（7fcf0469 + 7f1e339b）— NWT 2026-09-19

被审：J2 `coord/j2-proto-v0-settlement-design-v0.1` 上的 `7fcf0469`（`proto-mass-ceiling.mjs` 重写、各 builder 接线、`assertWitnessIndexLayout`）与 `7f1e339b`（一处测试标题订正）。审时 J2 侧未推送，对象取自共享 `.git`。在我自己的 review worktree（`scratch/_nwt_wt_j2_7f1e339b`，独立 `npm ci` + `npm rebuild better-sqlite3`）里只读运行，变异实验均已还原（`git status` 干净）。

## 结论：GREEN（附注意项）

### 1. relaxed 分支与 consensus 源码逐行一致

对照 `consensus/core/src/mass/mod.rs`（v2.0.1=cfafeb4c）`calc_storage_mass`：

| Rust | J2 `calcStorageMassExact` |
|---|---|
| `outs_plurality == 1` → relaxed | `if (outsPlurality === 1n) relaxed = true` ✓ |
| `inputs.len() > 2` → 非 relaxed | `else if (ins.length > 2) relaxed = false` ✓ |
| 否则 `ins_plurality == 1 或 (outs_plurality == 2 且 ins_plurality == 2)` | 同 ✓ |
| relaxed：`Σ C·p²/amount` 逐输入向下取整后求和，`saturating_sub` | 同（BigInt 无饱和，仅在 u64 溢出量级才与 Rust 不同，那里两侧都远超阈值）✓ |
| 否则 `mean = max(1, Σamount / Σp)`；`arithmetic = Σp × (C / mean)` | 同 ✓ |
| `checked_mul/checked_add` 溢出 → `None`（视为过高） | `checkedU64` 抛错（fail-closed）✓ |

独立对拍（`scripts/fuzz_j2_final.mjs`，我的 `port_mass.mjs` 作参照）：**60 万随机形状（其中 relaxed 74,934、arithmetic 525,066）storage 逐位相等，DIFF=0；20 万随机 v1 交易 compute 与 size 逐位相等，DIFF=0。**

### 2. 变异实验：J2 自报"负向对照各自只在预期处变红"，我独立复现（在我自己的 worktree 里改，改完还原）

- A 去掉 relaxed 分支 → `proto-mass-ceiling.test.mjs` 2 条红（market_genesis 节点值、随机对拍）。
- B compute 里去掉 size 项 → 6 条红。
- C 门控里加回 localMass → 3 条红（95M/100M 必过用例、95M 信号=节点值）。
- D 把 66 字节留量改 0 → 3 条红（阈值/留量常量用例、95M 信号、compute 留量用例）。

我的 worktree 里 J2 的全部相关测试原样全绿：mass-ceiling 16/16、settlement-golden 12/12、settlement 30/30、register-append 13/13、tx-assembly 32/32。

### 3. J2 提的问题：66 字节留量对所有"sigScript 为空的输入"计，还是只对"显式声明由 relay 签名的输入"计？

判：**保持现状（对所有空 sigScript 输入计）可以接受**。
- 过计是安全方向（compute 偏高只会多挡，不会漏放）。
- 66 是真值：四笔链上交易的 fee 输入 sigScript 实测都是 66 字节（P2PK 签名脚本 = `0x41` + 64 字节签名 + 1 字节 sighash 类型）。
- 改成"显式声明"要动各 builder 接口，收益只是消掉 66 字节的过计。

要写进注释的两个前提：(1) "空 sigScript ⇒ 将由 relay 以 P2PK 签名"是假设，将来若出现故意保持为空的输入（例如无见证的 anyone-can-spend covenant）会过计 66 字节，方向仍安全；(2) 反方向的风险是"断言时非空、之后被替换成更大内容"的占位 sigScript——目前没有 builder 这样做，新增 builder 时要检查。

### 4. inputHasCovenant 的注释是否如实

**如实**（`proto-mass-ceiling.mjs` 头注明写"builder 声明 + spk 形状交叉核对，不是纯 UTXO 推导"，并说明原因）。补一个方向性说明（写进 J2 的注释或计划）：

- 声明 `false` 而实为 covenant 输入：p 偏小 ⇒ 输入信用偏小 ⇒ mass 偏高，**安全方向**。
- 声明 `true` 而实为**非 covenant 的 35 字节 P2SH**：p 偏大 ⇒ 信用偏大 ⇒ mass 偏低，**不安全方向**，而 `inputHasCovenant[i] && !isP2shScriptHex` 的交叉核对**抓不到这种情形**（它是合法的 35 字节 P2SH）。
- 现有 builder 的向量我逐个核过，都对：market_seal `[leaf,held,fee]=[T,T,F]`、close_commit `[T,F]`、convert_to_claim `[T,T,F]`、market_genesis `[F]`、register_append `kind!=='fee'`。
- 后续批（claim_draw / withdraw / 输家 ticket 回收）要花**非 covenant 的 P2SH ticket**：这些 builder 必须逐个 pin 向量，并各有一条"声明向量 == 链上样本真实 covenant 事实"的测试。

### 5. assertWitnessIndexLayout

`tokenInIdx` 对 held outpoint、`tokenOutIdx`/主输出对期望 spk，都是真值比较（不是复读同一变量），对应我之前 F2 的建议，通过。

## 注意项（不阻塞本次 GREEN）

**N-1（需要 Bettor/J2 评估；细节按 D-021 走窄通道，不在本仓写）**：J2 撤回 `utxoSnapshot`（"输入 amount 与签名同源，低估则节点拒收"）的理由，只对**被签名覆盖的输入**成立。Schnorr sighash 只承诺**当前被签名输入自己的** amount 与 spk（`sighash.rs:calc_schnorr_signature_hash`），leaf / held 这类只有见证、没有签名的 covenant 输入，其 amount 不被任何签名承诺。held 已有 `assertHeldKttOutpointMatchesChain`（链上面值必须 == CONTINUATION），但 `assertLeafStateMatchesChain` 只核 spk 与 spent，**不核 leaf UTXO 的面值**，而 builder 一律按 `CONTINUATION_OUTPUT_SOMPI` 常量计 leaf 输入 amount，合约只要求 leaf 续约输出 `value >= DUST_MIN`（`ShardLeaf_direct.sil:216`）。这是"builder 假设值 vs 链上真实值"的一个未闭合面，涉及 mass 估计与隐含费准确性；影响面与结论由 Bettor 定。

## 未验证

- 只做离线审 + 我自己 worktree 里的变异实验；没有向节点提交交易。
- 批 5 convert_to_claim 的 builder（6b0a8fca）不在本次范围；按 Bettor 要求在批 5 审里专门看"签名对象与最终 tx 是否一致"（批 4 的同类缺陷）。
