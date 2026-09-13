# T3 前置 · 主网集 7 合约 ctor 参数只读盘点（供 NWT Q8 对照）v0.1

> **Status**: DRAFT-FOR-REVIEW **v0.1**（2026-09-13 · J2 · Bettor 派工 SendMessage「主网集 7 文件逐个列 ctor 参数：按市场变的 / 结构常量（循环界、切片长度）/ 可搬进状态只做等值比较的，附 file:line；供 NWT Q8 对照；只读、不写 .sil」· 数据 = 本机 `kasia-console/src/lib/{ShardLeaf,ShardLeaf_direct,PayoutShard,PayoutShardV2,RootClose,RootClaim,CloseZkV2}.sil` 逐行 grep（HEAD 127c3aee 之前的检出；行号随之）· 判据 = T1 v0.5 §4.0 A″ 三 MUST（① per-instance 值只等值比较/作运行期参数；② Q4/P10/P11/P12 实证：状态值不进 template_hash、非状态 ctor 常量进；③ provenance）· 交 NWT 答 Q8 → 定 T3 各文件"哪些搬进状态"。

## 0. 一句话

7 文件 ctor 共 **112 个参数**，其中 **90 个是 `init_*` 状态初值**（本来就在状态，A″ 无需动）；**22 个非状态 ctor 常量**逐个读了使用位点：**0 个被用作循环界或切片长度**（全部循环界都是字面量 63 / 1 / 2，切片无）；**22 个全部只做等值比较、hash 比较或 `tx.time` 比较、或作 `validateOutputStateWithTemplate`/`readInputStateWithTemplate` 的 hash 参数** ⇒ 机械上**全部可搬进状态**（P12 已证这两个原语接受运行期状态值）。真正要 NWT 拍的只有一件：**这 22 个里哪些"按市场变"（必须搬）、哪些"全网固定"（可留 ctor，留了也不成环）**——§2 表给出我的读法与理由，§3 给出三点顺手发现（`market_id` 零使用位点；`deadline` 与 `attestedAtMs` 的 `tx.time` 语义；家族内部模板锚全部是 hash 不是字节，本来就不成环）。

## 1. 计数（按文件）

| 文件 | ctor 参数 | `init_*` 状态初值 | 非状态 ctor 常量 | 循环界/切片来源 |
|---|---|---|---|---|
| `ShardLeaf.sil:22-34` | 11 | 4（`init_local_yes/no/count/pool_value`） | 7 | 无循环无切片 |
| `ShardLeaf_direct.sil:25-37` | 11 | 4 | 7 | 无 |
| `PayoutShard.sil:35-43` | 22 | 20（`init_consolidated_pool/closed/payoutRoot` + `init_w0..16`） | 2 | `for (b, 0, bit_in, 63)` :195/:359 界 = 字面量 63 |
| `PayoutShardV2.sil:35-48` | 27 | 24（+ `init_attestedWinner/attestedAtMs/betsRootBaked/refundRootBaked`） | 3 | `for` :311 界 63 |
| `RootClose.sil:29-41` | 11 | 7 | 4 | 无 |
| `RootClaim.sil:15-26` | 10 | 8 | 2 | `for (k, 0, tree_depth, 1)` :73 界 1、`for (b, 0, merkle_index, 2)` :88 界 2（字面量；`tree_depth` 是**入口参数** :51，非 ctor） |
| `CloseZkV2.sil:16-27` | 24 | 20（`init_attestedWinner/closed/payoutRootField/consolidated_pool` + `init_w0..16`） | 4 | `for` :104/:169 界 63 |
| **合计** | **112** | **90** | **22** | **0 个 ctor 参数作循环界/切片长度** |

`init_*` 与状态字段的一一对应已逐文件核（`int local_yes = init_local_yes;` 形，ShardLeaf:36-39 · ShardLeaf_direct:39-42 · PayoutShard:45-50 · PayoutShardV2:51-60 · RootClose:43-49 · RootClaim:28-35 · CloseZkV2:28-34）；无一处把非 `init_*` 参数复制进状态。

## 2. 22 个非状态 ctor 常量 · 逐个

列说明：**用法** = 全部使用位点（file:line，无遗漏）；**性质** = 等值 / hash 比较 / 时间比较 / 模板 hash 参数；**按市场变?** = 我的读法（**是**=必搬进状态；**否**=全网固定可留 ctor；**?**=请 NWT 定）；**A″ 处置**。

### ShardLeaf.sil
| 参数 | 行 | 用法（位点） | 性质 | 按市场变? | A″ 处置 |
|---|---|---|---|---|---|
| `market_id` | :23 | **零使用位点**（全文 grep 只有声明）。作用 = 烤进字节码让每市场 P2SH 唯一 | 无 | **是** | 搬进状态（状态值不进 template_hash，但进 redeem 字节 ⇒ P2SH 仍唯一，效果不变）；或删除——**§3.1** |
| `ps_tmpl_hash` | :24 | :69 `validateOutputStateWithTemplate(…, ps_prefix, ps_suffix, ps_tmpl_hash)` | 模板 hash 参数 | **否**（PoolSide ticket 模板全网一份） | 可留 ctor（hash 不是字节，不成环）；若搬状态也行（P12 证运行期值可用） |
| `shard_pool_id` | :25 | :68 写进 ticket 状态 `shardPoolId: shard_pool_id` | 等值（写入） | **是** | 搬进状态 |
| `seal_count` | :26 | :59 `count < seal_count` · :95 `count != seal_count` | 等值/比较 | **?**（现 DoD=1；若分片数按市场定则变） | 搬进状态（int 等值比较，零成本） |
| `min_bet` | :27 | :61 `stake >= min_bet` | 比较 | **?**（按市场定最小注则变） | 搬进状态 |
| `payout_cov_id` | :28 | :100 `ps_cov == payout_cov_id` · :104 `out_cov == payout_cov_id` | 等值 | **是**（每市场一个 PayoutShard 实例 id） | 搬进状态。注：这是 **provenance-bind 的既有形**（leaf 烤下游实例 cov id，创世时已知）——A″ 下改为状态初值由 console 填 + T4 对照检查 |
| `deadline` | :29 | :96 `tx.time >= deadline * 1000` | 时间比较 | **是** | 搬进状态（**§3.2**：批 B `tx.time` 只收 temporal 的迁移与本项同处） |

### ShardLeaf_direct.sil
| 参数 | 行 | 用法 | 性质 | 按市场变? | A″ 处置 |
|---|---|---|---|---|---|
| `market_id` | :26 | **零使用位点** | 无 | **是** | 同 ShardLeaf |
| `ps_tmpl_hash` | :27 | :82 模板 hash 参数 | hash 参数 | **否** | 可留 |
| `shard_pool_id` | :28 | :81 写进 ticket | 写入 | **是** | 搬 |
| `seal_count` | :29 | :72 `count < seal_count` · :101 `count == seal_count` | 比较 | **?** | 搬 |
| `min_bet` | :30 | :74 `stake >= min_bet` | 比较 | **?** | 搬 |
| `rootclose_tmpl_hash` | :31 | :112 `validateOutputStateWithTemplate(…, rc_prefix, rc_suffix, rootclose_tmpl_hash)`（:98 注释写 witness 供前后缀，hash 焊） | hash 参数 | **否**（RootClose 模板全网一份——**前提**：RootClose 自己的 per-instance 值也都搬进状态，否则它每市场一个模板） | 可留；**Q8 连锁**：下游模板是否稳定决定上游能不能留 ctor |
| `rootclose_init_payoutRoot` | :32 | :111 写进 RootClose 创世状态 `payoutRoot: rootclose_init_payoutRoot`（canonical ZERO） | 写入常量 | **否**（恒 0） | 可留；或直接写字面量 |

### PayoutShard.sil
| 参数 | 行 | 用法 | 性质 | 按市场变? | A″ 处置 |
|---|---|---|---|---|---|
| `poolMerkleRoot` | :36 | :115/:126/:137/:148/:159/:274 `cXCur == poolMerkleRoot`（委员 ∈ oracle pool） | 等值 | **?**（chain-derived oracle pool root：按 epoch/按市场？若每市场创世时取当时 root ⇒ 变） | 搬进状态（byte[32] 等值） |
| `predicate_commit` | :37 | :84 · :246 `blake2b(byte[](predicate_commit)) != predicate_commit`（"baked-use" 占位，只为让常量进字节码） | 自比较 | **是**（市场规则 canonical hash） | 搬进状态；那两行"baked-use"可删（状态字段天然进 redeem 字节） |

### PayoutShardV2.sil
| 参数 | 行 | 用法 | 性质 | 按市场变? | A″ 处置 |
|---|---|---|---|---|---|
| `poolMerkleRoot` | :36 | :125/:136/:147/:158/:169/:228 | 等值 | **?** | 搬 |
| `predicate_commit` | :37 | :98 · :201 baked-use | 自比较 | **是** | 搬 |
| `closeZkTmplAnchor` | :38 | :378 `blake2b(templateA+B+C+D) == closeZkTmplAnchor`（CloseZk 模板锚） | hash 比较 | **否**（CloseZkV2 模板全网一份——同 rootclose 前提） | 可留 |

### RootClose.sil
| 参数 | 行 | 用法 | 性质 | 按市场变? | A″ 处置 |
|---|---|---|---|---|---|
| `committee_hash` | :30 | :75 `blake2b(c0Pk‖…‖c4Pk) == committee_hash`（witness 供 5 pk） | hash 比较 | **?**（委员会按市场选 ⇒ 变；全网固定 ⇒ 否） | 搬进状态（byte[32]；这是 T2 骨架 §3.1 "委员公钥 ×N" 行的现有答案：**不存 N 个 pk，存一个 hash**，N 个 byte[32] 状态字段不需要） |
| `deadline_ms` | :31 | :72 `tx.time >= deadline_ms` · :96 `tx.time >= deadline_ms + 7200000` | 时间比较 | **是** | 搬（§3.2） |
| `claim_tmpl_hash` | :32 | :113 模板 hash 参数 | hash 参数 | **否**（RootClaim 模板全网一份，前提同上） | 可留 |
| `refundclaim_tmpl_hash` | :33 | :123 模板 hash 参数 | hash 参数 | **否**（RefundClaim 若在集内） | 可留 |

### RootClaim.sil
| 参数 | 行 | 用法 | 性质 | 按市场变? | A″ 处置 |
|---|---|---|---|---|---|
| `ps_tmpl_hash` | :16 | :66 `readInputStateWithTemplate(ticketInIdx, ticket_prefix_len, ticket_suffix_len, ps_tmpl_hash)`（两个长度是**入口参数** :54-55） | hash 参数 | **否** | 可留 |
| `shard_pool_id` | :17 | :67 `tk.shardPoolId == shard_pool_id` | 等值 | **是** | 搬 |

### CloseZkV2.sil
| 参数 | 行 | 用法 | 性质 | 按市场变? | A″ 处置 |
|---|---|---|---|---|---|
| `gateTmplHash` | :17 | :48 `blake2b(gatePrefix + gateSuffix) == gateTmplHash` | hash 比较 | **否**（ZK gate 模板 = guest image_id 定；改 guest = 新模板） | 可留（注释 :17 原话"烤死"；留 ctor 与"改 guest = 新 covenant"语义一致） |
| `betsRootBaked` | :18 | :45 `sha256(betsRootBaked + …)` 进 journalHash | hash 输入 | **是**（本市场 bets 链根） | 搬进状态（等值/作 hash 输入都是"值"用法，非结构） |
| `refundRootBaked` | :19 | :100 `cur == refundRootBaked` | 等值 | **是** | 搬 |
| `attestedAtMs` | :20 | :67 `tx.time >= attestedAtMs + 21600000` | 时间比较 | **是** | 搬（§3.2）。注：PayoutShardV2 已把同名值放**状态** `init_attestedAtMs` :45——同一值两文件两种归类，A″ 下统一为状态 |

**汇总**：22 个里 **"是"9 + "?"6 + "否"7**。"否"的 7 个全是**模板 hash / 模板锚**（`ps_tmpl_hash`×3、`rootclose_tmpl_hash`、`closeZkTmplAnchor`、`claim_tmpl_hash`、`refundclaim_tmpl_hash`、`gateTmplHash`）+ 1 个恒零常量——它们**是 hash 不是字节** ⇒ 留在 ctor **不成环**（成环只发生在"A 烤 B 的 hash 且 B 烤 A 的 hash"；家族链 Leaf→PS→Root→Claim 是单向）；但**留 ctor 的代价** = 下游模板一变上游全家重编重部署，搬状态的代价 = 一个 byte[32] 字段。**倾向：全部 22 个都搬进状态**（统一纪律"ctor 只剩 `init_*`"，T4 对照检查一套逻辑覆盖全部锚，重编面最小），除非 NWT 认为 `gateTmplHash` 那种"改 guest 即新 covenant"的语义要靠 ctor 烤死来表达。

## 3. 顺手发现（不改任何东西，只记）

1. **`market_id` 零使用位点**（ShardLeaf:23 / ShardLeaf_direct:26）：它的全部作用是把市场身份烤进字节码使每市场 P2SH 唯一。A″ 下搬进状态效果相同（状态字节也在 redeem 里）；但要注意**它现在不是 provenance**——没有任何 require 读它，任何人都能用别的 `market_id` 创世一个同模板 leaf。这与 T1 v0.5 §4.0 "可再造面 = 固有语义"一致，记档不算发现。
2. **`tx.time` 三处**（ShardLeaf:96 `deadline*1000`、RootClose:72/:96 `deadline_ms`、CloseZkV2:67 `attestedAtMs+…`）：v1.0.0 `tx.time` 只收 temporal（批 B，重编清单 3 文件 CloseZkV2/ShardLeaf/RootClose 恰是这三个）——把 `deadline` 搬进状态时，批 B 的语义迁移在同一处改，别分两次打开。
3. **委员公钥不是 N 个字段是一个 hash**（RootClose:30 `committee_hash`，PayoutShard* 用 `poolMerkleRoot` 判委员 ∈ pool）——T2 骨架 §3.1 "委员/oracle 公钥 ×N（固定 N，不能 byte[]）"那行按此**收窄为一个 byte[32]**，N 的限制消失。
4. **`predicate_commit` 的 "baked-use" 行**（PayoutShard:84/:246、PayoutShardV2:98/:201）：`require(blake2b(x) != x)` 只为让常量进字节码；搬进状态后这两行失去用途，T3 稿删除（向量：删前删后 template_hash 变——这是重编面的一部分，不是回归）。
5. **RootClaim 的 `ticket_prefix_len/suffix_len` 是入口参数**（:54-55，witness 供），`tree_depth` 也是入口参数（:51，`require(tree_depth <= 1)` :58 卡死）——已经是 A″ 想要的"长度作运行期参数"形；不动。

## 4. 请 NWT 答（= Q8 的具体形）

1. §2 里 6 个 "?"：`seal_count`、`min_bet`（×2 文件）、`poolMerkleRoot`（×2）、`committee_hash`——按市场变还是全网固定。
2. 7 个模板 hash/锚是否统一搬状态（我倾向搬；成环与否与此无关）。
3. `market_id` 留状态还是删（零使用位点）。

## 5. 没核到的
- 行号取自本机检出（127c3aee 前），若 T3 稿基于别的 HEAD 需重取。
- 每个 `init_*` 是否在入口里被"结构性"使用（如状态里的 int 作循环界）——本盘点只查了 ctor 非状态参数；状态字段作循环界的情况我扫了 `for (` 全部 7 处，界都是字面量或入口参数，**未见状态字段作界**，但只扫了 `for`，`.slice(` 零命中。
- `RefundClaim.sil` 是否在主网集（v0.7 表未列而 RootClose 烤其模板 hash）——影响 `refundclaim_tmpl_hash` 那行。
