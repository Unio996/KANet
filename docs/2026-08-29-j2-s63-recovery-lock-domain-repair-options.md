# §6-3 恢复锁"混锁域"MUST-FIX · 三路径评审 + 推荐 + v0.15 最小修法 v0.1

> **Status**: DRAFT v0.1 · J2 2026-08-29 · 回 Codex bridge `14c81c1c`（`RESPONSE-20260829-UNSYNCED-S63-GATEA-RECOVERY-DAA-CODEX-REVIEW.md` ②③）· Bettor 派 · NWT 审 → Codex 回。**只读代码/文档 + 离线探针重跑；不动生产代码、不动 `/d/silverscript` 本地分支（只 `git fetch origin master` 更新远端跟踪引用）。** 坐标 J2 亲核：silverscript 8065184 工作树 / `origin/master`=`db9e1ba`（2026-08-29 fetch）/ rusty-kaspa `git show 7b1e18cc:<path>`。
> 🔴 作用域：只回"恢复锁原语是哪个域、怎么机械证明、v0.15 文本怎么改"。不重开 Shape-B 其它证明步、不动 N_claim/N_margin 数值（gate (d) 稿）。

## §0 结论（四行）
1. **Codex 的指控在【源码语义层】成立，在【lowering/共识层】不成立**：pinned `silverc-zk-8065184` 把 `require(tx.time >= E)` 降成 **`<E> OP_CHECKLOCKTIMEVERIFY`，不加任何域标记**（`compile.rs:2516`，`TimeVar::TxTime`）；锁域由 **CLTV 在运行时按数值大小判**（`7b1e18cc opcodes/mod.rs:1031-1032`）：`E < 5e11 ∧ tx.lock_time < 5e11` ⇒ DAA 域，否则须同 `≥` ⇒ 时间域，**混则拒**（`mismatched locktime types`）。`E = OpTxInputDaaScore(x)+N ≈ 8e7 ≪ 5e11` ⇒ v0.15 那条锁**运行时就是 DAA 域绝对 CLTV 锁**。J1 P0 ⑤ "DAA 锚形表达不出来"是把**编译器变量名**当成了**锁域**——错在同一处。
2. **上游 #214 做的事**（`b5b0dc8`，2026-08-19）：`tx.daa` ⇒ `<E> DUP 0 THRESHOLD WITHIN VERIFY CLTV`；`tx.time` ⇒ `<E> DUP THRESHOLD GTE VERIFY CLTV` + `temporal` 类型（`compile/statement.rs:364-390`）。**差别只是脚本内多了一段域守卫**（防 E 落错量级），CLTV 本体与语义一模一样。
3. **推荐 = A′（留 8065184，源内手写域守卫，与上游 `tx.daa` lowering 语义等价）**：`require(E >= 0 && E < 500000000000); require(tx.time >= E);`。不换编译器（A 的真实代价是 45 提交的 API 漂移：`byte[](x,n)` 两参形已不存在、template hash 改 blake3、dispatch tag 改签名 ⇒ 全部 `.sil` 重写 + 地址/模板哈希全变）；不需要 B 的参照输入（DAA 锁已可表达，B 只会更弱）；C 是整套时序证明重推（且时间域比 DAA 域弱：PMT 可被矿工在窗内挪）。
4. **v0.15 最小修法** = 改 L40/L250/L275/L278/L296/L313/L321/L370 八处的**措辞**（把 `TxTime` 这个变量名换成"DAA 域绝对 CLTV 锁"的精确描述）+ 加**两条新硬前置**（源内域守卫 + `tx.lock_time`/`sequence` 构造约束）+ 三条链上负向量。证明步"O 于 d 创建 ⟹ 本金 d+N 前不能回"**在冻结谓词下成立**——但要用 §3 的四个共识条件写，不能只写"CLTV"。

## §1 机械证据（逐条可 grep）
| # | 事实 | 坐标（逐字） |
|---|---|---|
| E1 | 8065184 `tx.time` lowering = 表达式 + 裸 CLTV | `/d/silverscript` 检出 `j2-oppick-fix-2026-07-06`@`8065184`，`silverscript-lang/src/compiler/compile.rs:2513-2517`：`TimeVar::TxTime => { builder.add_op(OpCheckLockTimeVerify)?; }`（前面 `compile_expr(expr…)` 只推表达式）；`ast/mod.rs:432,1064,1667`：`TimeVar::TxTime ⇔ "tx.time"`；**全仓无 `tx.daa`**（`grep -rn "tx\.daa" silverscript-lang/src` = 0） |
| E2 | CLTV 域判定 = 数值大小，混域拒 | `git show 7b1e18cc:crypto/txscript/src/opcodes/mod.rs` :1012 opcode 头；:1030-1033 条件 `if !((tx.lock_time < LOCK_TIME_THRESHOLD && stack_lock_time < LOCK_TIME_THRESHOLD) \|\| (tx.lock_time >= LOCK_TIME_THRESHOLD && stack_lock_time >= LOCK_TIME_THRESHOLD))`；**:1034** `return Err(UnsatisfiedLockTime("mismatched locktime types …"))`（混域拒）；:1037 `if stack_lock_time > tx.lock_time` ⇒ **:1038** `Err(UnsatisfiedLockTime("locktime requirement not satisfied …"))`；:1055 `if input.sequence == MAX_TX_IN_SEQUENCE_NUM` ⇒ **:1056** `Err(UnsatisfiedLockTime("transaction input is finalized"))`（NWT 复核更正行号 2026-08-29） |
| E3 | 阈值 | `git show 7b1e18cc:consensus/core/src/constants.rs:16` `LOCK_TIME_THRESHOLD: u64 = 500_000_000_000` |
| E4 | 共识：DAA 类 lock_time 的终局判定 | `git show 7b1e18cc:consensus/src/processes/transaction_validator/tx_validation_in_header_context.rs` :56-68 `get_lock_time_type`: `0 ⇒ Finalized; t < LOCK_TIME_THRESHOLD ⇒ DaaScore; _ ⇒ Time`；:70-88 `check_tx_is_finalized`: `if tx.lock_time < block_time_or_daa_score { return Ok(()) }`，否则**任一**输入 `sequence != u64::MAX ⇒ Err(NotFinalized(i))` |
| E5 | 上游 #214 lowering | `git show origin/master:silverscript-lang/src/compiler/compile/statement.rs` :364-375（`compile_require_tx_daa_statement`：`compile_expr(Int)`, `OpDup`, `add_i64(0)`, `add_i64(LOCK_TIME_THRESHOLD)`, `OpWithin`, `OpVerify`, `OpCheckLockTimeVerify`）；:377-390（`tx_time`：`Temporal` 类型, `OpDup`, `add_i64(LOCK_TIME_THRESHOLD)`, `OpGreaterThanOrEqual`, `OpVerify`, CLTV）；TUTORIAL（`b5b0dc8`）："`tx.daa` accepts only an `int` threshold and emits an absolute CLTV lock in the DAA-score domain / `tx.time` accepts only a `temporal` threshold" |
| E6 | 上游 API 漂移（A 的代价） | `d25bd34..db9e1ba` 45 提交：`b5b0dc8`(#214 域拆分) `140bf18`(#163 template hash → blake3) `82188f3`/`d007786`(#164/#223 dispatch tag) `c1ed163`/`023c7ee`/`aafc6a2`/`6f9e078`(#206/#207/#210/#212 语义收紧)；`origin/master:…/compile/expression/builtin.rs:157-190` `compile_byte_sequence_cast_call` **只收 1 参**（`if args.len() != 1 ⇒ Unsupported`）⇒ 我们 `CloseZkV2.sil:45` 的 `byte[](attestedWinner, 1)` 两参形在上游**不编**；8065184 修的 OP_PICK 站点（`compile.rs:3751-3755` 两参分支 `*ctx.stack_depth += 1`）在上游**已不存在**（两参形整体删除），"并存"问题因此消失，但换编译器 = 重写全部 `.sil` |
| E7 | 探针 S4 断言 | `scratch/_j2_s63a_transition/build.mjs` S4 已改：`diff.length === 1 ∧ diff[0] === start+1（LSB）∧ 全落 [start+1, start+9) ∧ a[start+1]==0x00, b[start+1]==0x01`；离线重跑 14 步全 OK（2026-08-29）。J1 实测"差异 1 字节、位置 [2]"与此一致（J1 的 start=1 ⇒ LSB 在 2） |

## §2 三路径评
| 路径 | 内容 | 机械证据能否给 | 代价 / 风险 | 判 |
|---|---|---|---|---|
| **A** 换含 `tx.daa` 的编译器 | 上游 `db9e1ba`（或 `b5b0dc8` 后任一）编 `require(tx.daa >= OpTxInputDaaScore(self)+N)` | 能（脚本自带域守卫） | E6：**不是换二进制，是换语言版本**——`byte[](x,n)` 消失、template hash 改 blake3、dispatch tag 改签名、类型/循环/比较语义收紧 ⇒ `CloseZkV2/PayoutShardV2/PoolSide/ShardLeaf` 全部重写重审、所有 P2SH/模板哈希/`gateTmplHash` 锚全变、8065184 的 provenance 链（`docs/silverc-canonical-provenance/`）作废；J1 角色 A 需另开 provenance；与 live 存量盘不兼容 | **拒**（受审依赖变更面 ≫ 收益；且 A′ 已零成本达到同一语义） |
| **A′（推荐）** 留 8065184 + 源内域守卫 | `int E = OpTxInputDaaScore(selfInIdx) + n_recovery_delay_daa; require(E >= 0); require(E < 500000000000); require(tx.time >= E);` | 能：(i) 冻结源用 8065184 编译 → 反汇编 → `… <E-expr> OP_CHECKLOCKTIMEVERIFY` 且前有两条整数比较 `OP_VERIFY`；(ii) 链上三负向量（§4）；(iii) 与 E5 逐 opcode 对照 = 上游 `tx.daa` 的 `0 ≤ E < THRESHOLD` 守卫用 `require` 复现，语义相同（不逐字节相同：上游用 `WITHIN`，我们两条 `require`——无关紧要，都是 fail-closed 守卫） | 只改 `.sil` 源 + 构造侧 `tx.lock_time = E`（DAA 数）+ 该输入 `sequence ≠ MAX`；**parser 限制**：`tx.time` 只能 standalone `require`（探针注释），E 须先算进变量——已知可编（探针 `require(OpTxInputDaaScore(ref) >= OpTxInputDaaScore(self)+100)` 编过，同类表达式） | **采**；一次 8065184 编译 + 反汇编即闭"冻结源可编、脚本用 DAA/CLTV 域"两条 |
| **B** 用另一"共识可见 DAA 参照输入" | 如 `require(OpTxInputDaaScore(refIn) >= OpTxInputDaaScore(self)+N)`（J1 探过可编） | 弱：参照输入的 DAA 是**它被创建时**的 DAA，不是当前块 DAA；要"不可伪造 + lineage"须再造一个只能在 ≥ d+N 才存在的 UTXO——这本身又要一个 DAA 锁（循环），或依赖宿主提供的 UTXO 时钟（Codex 明禁） | 多一个输入（费/plurality）、多一个 provenance 对象、攻击面（挑更老的参照） | **拒**（DAA 锁已可直接表达，B 是绕路且更弱） |
| **C** 改真时间域 | `require(tx.time >= temporal_E)`，E ≥ 5e11（ms） | 能，但 **PMT 域**：`check_tx_is_finalized` 用 `MedianTime(ctx_block_time)`，块时间戳由矿工在共识允许窗内选 ⇒ 窗界可被挪 ±（TN12 时间戳规则），N 须按时间重推 | N_claim/N_margin/gate (d) 五闸/`CFG-UNIT-DOMAIN` 全部时间域重做；两条恢复支重推；与 v1.3 总裁"全 DAA 单位"相悖 | **拒** |

## §3 冻结谓词下的证明步（按共识条件写，不只写"CLTV"）
设 recovery 输入花 `X ∈ {O, O_AUTHORIZED}`，`d = OpTxInputDaaScore(X)`（= X 被创建所在块的 DAA，共识可见、不可由花费方改），`E = d + N`，`N = n_recovery_delay_daa`（ctor 只收和）。recovery tx `R` 被接受 ⟺ 同时：
1. **脚本**（E2）：`R.lock_time` 与 `E` 同为 DAA 类（`< 5e11`）∧ `E ≤ R.lock_time` ∧ `R.inputs[X].sequence ≠ MAX`；A′ 的守卫另保证 `0 ≤ E < 5e11`（防 `d+N` 溢出到时间类——`d < 5e11` 恒成立，N 有 `CFG-UNIT-DOMAIN` 带检查，守卫是双保险）。
2. **共识终局**（E4）：`R.lock_time < DAA(含 R 的块)`（严格小于）或全部输入 `sequence == MAX`；后者被 1 排除 ⇒ **`DAA(块) > R.lock_time ≥ E = d + N`**。
⇒ **任何包含 R 的块 DAA > d + N**。⇒ "O 于 d 创建 ⟹ 被保护本金在 DAA ≤ d+N 的任何块里不能回首动方"——这就是 v0.15 L38/L275 那句，**由 1+2 机械保证**，不依赖 reveal 上界。反应方独占窗 = `[d, d+N]`（闭区间，比 v0.15 写的 `[d, d+N)` 多一个 DAA——保守方向，写进文本）。
🔴 两条**新硬前置**（v0.15 没写，A′ 落码必须有）：(a) recovery tx 构造侧 **`lock_time = E`（DAA 数），不是 0**（现 `p2sh.mjs` 各 builder 一律 `lockTime: 0n` ⇒ `LockTimeType::Finalized` ⇒ CLTV 因 `stack_lock_time(E) > tx.lock_time(0)` 在 :1038 拒——**不是漏洞，是构造侧要改**）；(b) 该输入 `sequence ≠ u64::MAX`（现 builder `sequence: 0n` ✓）。
🔵 **多输入 recovery（NWT 审点 ③，2026-08-29）**：一笔 tx 只有一个 `lock_time`，但每个被锁输入各自执行一次 CLTV、各自要求 `E_i ≤ lock_time`（:1037-1038 逐输入）⇒ 构造侧取 **`lock_time = max_i E_i`**；共识再要 `DAA(块) > lock_time` ⇒ 对每个 X_i 都有 `DAA > d_i + N`。取 max 只会**过延迟**（保守方向），不会让任一输入提前；不取 max ⇒ 某输入 CLTV 拒 = fail-closed。同 tx 若混入**非锁**输入（如 fee 输入）无约束。（D-016 裁 A′ 已记。）

## §4 v0.15 最小修法（文本，J1/NWT 落；不改结构、不改数值）
| 处 | 现文 | 改为 |
|---|---|---|
| L40 §0.12 MUST-FIX 3 | "下界用 `TxTime`（→ CLTV）语义" | "下界用 **DAA 域绝对 CLTV 锁**：源形 `require(tx.time >= E)`（8065184 的 `tx.time` = 裸 `OP_CHECKLOCKTIMEVERIFY`，**变量名不定域**；域由 E 与 `tx.lock_time` 的量级共同决定，E 是 DAA 数 ⇒ DAA 域），并加源内守卫 `require(E >= 0 && E < 500000000000)`（= 上游 `tx.daa` lowering 的域守卫）" |
| L250/L296/L165/L167/L321 | `require(TxTime >= OpTxInputDaaScore(·) + N_claim + N_margin)` | `E := OpTxInputDaaScore(·) + n_recovery_delay_daa; require(0 <= E < 5e11); require(tx.time >= E)` —— **CLTV(DAA)**；构造侧 `lock_time = E`、`sequence ≠ MAX` |
| L275/L313 证明步 | "recovery 下界 = TxTime >= …" | 引 §3 两条共识条件：`R` 入块 ⇒ `DAA(块) > lock_time ≥ E = d+N`；独占窗 `[d, d+N]` |
| L278 单位标注 | "`OpTxInputDaaScore(·)+N` 全部同为 DAA-score" | 保留，**加**："`tx.time` 不是量，是 CLTV 语句；量是 E。E 落 DAA 类由守卫 + `CFG-UNIT-DOMAIN` 带检查双保" |
| L370 §8 表 | "`tx.time >= X`（DAA）✅ 已证" | "`tx.time >= X` = 裸 CLTV；**X 为 DAA 数时**是 DAA 锁——`ShardLeaf.sil:96` 那 30 处的 X 是 ms（`deadline*1000`）⇒ 那些是**时间域**锁，与本构造的 DAA 域锁**不是同一形**，不能互引为证据" |
| 新增 §4-g | — | "recovery tx 构造约束：`lock_time = E`（非 0），被锁输入 `sequence ≠ MAX`；否则 CLTV 必拒（E2 :1035/:1055）——这是构造侧硬前置，不是安全性" |
| 新增 §6.x 负向量 | — | N6 `lock_time = E−1` ⇒ 拒 `UnsatisfiedLockTime`（脚本层）；N7 `lock_time = 5e11 + t`（时间类）⇒ 拒 `mismatched locktime types`；N8 `lock_time = E` 但提交时 tip DAA ≤ E ⇒ 拒 `NotFinalized`（共识/mempool 层）；P `lock_time = E` 且 tip DAA > E ⇒ 落地。**四条都进 gate (a) 广播段**（N8 要等 N 个 DAA——用探针的小 N，如 N=100 ≈ 10 s） |
| J1 P0 ⑤ 结论 | "DAA 锚形表达不出来 / 不可同单位比较" | **撤**：可表达；错在把 `tx.time` 当成时间量。J1 "未用 tx.time 顶替（遵 NWT 混单位钉子）"——那颗钉子是对**常量**说的；这里混域不是 vacuous 而是**被共识拒**（E2），fail-closed |

## §5 gate (a) 影响
- 探针 `S63A_TransitionProbe.sil` 的 `recovery` 支现用 baked ms `tx.time >= t_recovery`（时间域）——**作为 gate (a) 的"能进 recovery 支"结构证据仍有效**（CLTV 可编可构造），但**不是** v0.15 的 DAA 锚形。建议探针 v0.3 加第四入口 `recovery_daa(selfInIdx)` = A′ 形（`E = OpTxInputDaaScore(selfInIdx) + N_PROBE`，ctor 烤 `N_PROBE=100`），J1 用 8065184 编译并反汇编（证 E1），广播段跑 §4 的 N6/N7/N8/P 四向量（证 E2/E4 在 live）。**这四条就是 Codex A 项要的"input_daa+N 前拒于锁原因、界后落地、无强转"**。
- 在此之前 gate (a) 维持 OPEN（Codex 裁）；本稿 + 探针 v0.3 + 四向量落地 ⇒ 申请"same-chain Shape-B 恢复锁原语 CLOSED"。

## §6 边界
- 未在本机跑 kaspa txscript 引擎（wasm 不暴露）；E2/E4 是源码逐字 + 链上向量计划，非本机执行。
- 上游 `origin/master` 只 fetch 到 `db9e1ba`（2026-08-29），未 build、未跑其测试；E5 是源码读。
- `ShardLeaf.sil:96` 那 30 处 ms 锁的实际值域未逐处核（只核了探针注释"与 ShardLeaf deadline*1000 先例同单位"）。
- 不动 v0.15 文件本身（J1 主责文，按 §4 表由 J1 落，NWT 审）。
