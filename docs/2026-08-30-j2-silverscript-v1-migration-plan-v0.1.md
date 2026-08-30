# J2 · silverscript v1-rc1 迁移计划 v0.1

> **Status**: DRAFT v0.1（(a)(b) 实核已闭合；(c)(d)(e) 首稿，明日补全）· 给 NWT 审 · docs only · Bettor 派工 2026-08-30（Owner 直报）· 铁律 0：本稿不改 live 树任何 `.sil`、不动 pinned silverc 分支（`j2-oppick-fix-2026-07-06` / `versioned-builds/*`）
> **隔离环境**：`/d/silverscript-v1rc1` = `git worktree add … v1-rc1`（tag `c7d17a1`，2026-08-30），`cargo build --release -p silverscript-lang` + `-p cli-debugger` 自带 `target/`；试编产物只在会话 scratch（`scratchpad/v1mig/`），未入库。
> **上游**：https://github.com/kaspanet/silverscript/releases/tag/v1-rc1（发布页正文只有"SemVer + 邀测"两句，破坏性变更要从 `2c46231..v1-rc1` 的 63 个 commit 与 `docs/TUTORIAL.md` / `UNDEFINED-BEHAVIOUR.md` 读）；正式版 ≈ 9/6。

## 0. 一句话
rc1 **不带 OP_PICK off-by-one**（行为验证，§1）⇒ 迁移**不需要**重港 `8065184`；但 rc1 的破坏面比派工列的 4 条多：**codegen 本身变了**（dispatch tag、越界检查、alt-stack 序言）⇒ **42 个合约字节码全变、P2SH 地址全换**，不只 `byte[36]` 那 24 个；`byte[](x, n)` 两参 cast 被移除、`checkSigFromStack` 改名、产物 JSON 从 `{contract_name, script, abi, state_layout}` 变成 `SilAbiArtifact{contracts.{Name}.compiled.{bytecode,template_hash,state_span}, entries.{name}.dispatch_tag}` ⇒ **工具链（`prediction-escrow-ss.mjs` / `pool-bshard-artifacts.mjs` / harness / 解码器）同批必改**。批 A 机械改动后的"零差异"验收不成立，改为归一化 opcode 序列比对 + debugger 行为向量。

## 1. (a) OP_PICK `pick_from_depth` off-by-one 在 rc1 是否仍在 —— **不在（行为验证 + 结构原因）**
- **我们的修复**（`/d/silverscript` 本地分支 `8065184`，从未推上游，CLAUDE.md 铁律 0.5 注记）= `compile.rs:3754 compile_byte_sequence_cast_call` 删一行 `*ctx.stack_depth += 1;`（两参 `byte[](v, size)` 在 `OpNum2Bin` 前多记一次深度 ⇒ 之后 `pick_from_depth` 算的 OP_PICK 索引深一格）。
- **rc1 代码**：该函数已不存在（`bfc5a45 compile.rs refactor #178` 拆成 `compiler/compile/expression.rs` 等）；两参 call 形被 `81aecf5 Add x as byte[N] syntax #188` + `6f9e078 explicit scalar conversions #206` 取代；新 codegen 统一用 `ctx.emit_op(op, stack_delta)`（`compile/emitter.rs:38`：`add_op` + `stack_depth += delta`），`OpNum2Bin` 处逐字 `ctx.emit_op(OpNum2Bin, -1)`（`expression.rs:186/193`, `builtin.rs:128`）⇒ 深度记账结构性正确，旧 bug 的形（先 +1 再 −1 = 净 0 而 OpNum2Bin 实为净 −1）不可能复现。`git log 2c46231..v1-rc1 -- compile.rs` 无"pick/off-by-one"字样的提交 —— 是被重构消灭，不是被修复。
- **行为验证**（J1 8/28 见证合约 `scratch/j1-oppick-abtest/OpPickWitness.sil`，机械迁移 `entrypoint function→entry`、`byte[](n, 8)→n as byte[8]`、ctor JSON 新形 `[{"kind":"int","value":7},…]`）：rc1 `silverc` 编译 exit 0；rc1 `cli-debugger --function witness --ctor-arg 7 --ctor-arg 7 --arg 7` ⇒ `enc = 0x07…, enc_a = 0x07…, Done`（**状态变量 `a` 读到正确栈位**）；`--arg 8` ⇒ `require(enc == enc_a)` verification failed（`enc=0x08…, enc_a=0x07…`）；`--ctor-arg 7 9 --arg 7` ⇒ `require(a == b)` failed ⇒ 三臂非 vacuous。对照：legacy `2c46231` 产物在同一位置 `53 79`（OP_3 PICK）vs fixed `52 79`（OP_2 PICK）——rc1 字节码形已完全不同（§2），不能按字节比对，只能行为比对。
- ⚠ 作用域：debugger 是 rc1 自带的解释器（`debugger/session`），不是 kaspad 共识 VM；链上等价性在批 D 用真 TN12 广播验（同 gate (a) 探针法）。
- ⇒ **迁移不需要重港 8065184**；`versioned-builds/silverc-zk-8065184.exe` 与 `silverc-legacy-2c46231.exe` 保留为旧合约（已部署 P2SH）的复现编译器（§3）。

## 2. (b) 隔离试编：机械变更后的错误清单（rc1 `silverc`，全部实测）
| 构造 | rc1 结果（逐字） | 迁法 |
|---|---|---|
| `entrypoint function f(...)`（104 处/42 文件） | `compile error: parse error: --> L:16` | `entry f(...)`（`0f99803 #187`） |
| `byte[34] lock = new ScriptPubKeyP2PK(pk)`（106/24） | `unsupported feature: variable 'lock' expects byte[34]` | `byte[36]`（`builtin_types.rs:119 Fixed(36)`） |
| `byte[](lock)` 一参 cast（byte[36]→byte[]） | **OK** | 保留 |
| `byte[](n, 8)` 两参 cast | `unsupported feature: byte[]() expects 1 arguments` | `n as byte[8]`（`as_cast` postfix，`silverscript.pest:115`） |
| `require(tx.time >= deadline)`（int ctor） | `compile error: type mismatch` | ctor 改 `temporal deadlineMs`（§4 批 B） |
| `require(tx.time >= deadline * 1000)` | `type mismatch` | 同上，消灭 `*1000` |
| `temporal deadlineMs` + `tx.time >= deadlineMs` / `deadlineMs + 2 hours` | **OK** | 目标写法 |
| `require(tx.daa >= lockDaa)`（int） | **OK** | `OracleStake_v1.sil:46` 改此形 |
| `require(a && tx.time >= … && tx.daa >= …)` 复合 | `parse error`（同 da9fc22 限制） | tx.time/tx.daa 仍须独立 `require` |
| 三元 `c ? x : y` | **OK** | — |
| `checkSigFromStack(s, digest, pk)`（`CheckSigFromStackProbe.sil` 1 文件 2 处） | `unsupported feature: function 'checkSigFromStack' not found` | `checkMsgSig`（`782a4d7 #202`） |
| ctor JSON 旧形 `{kind:'array', data:[{kind:'byte',data:N}…]}` / `{kind:'int',data:N}` | `failed to parse constructor args: missing field 'value'` | `{"kind":"bytes","value":[N,…]}` / `{"kind":"int","value":N}`（`silverscript-abi/src/lib.rs:330`） |
| `pragma silverscript ^0.1.0` | **OK**（rc1 `COMPILER_VERSION="0.1.0"`，`static_check.rs:294-320`） | 见 §3 |
- 4 个非关键合约试编（只改 entry / byte[36] / 两参 cast 三类）：`OpPickWitness`（3 行）✅ 69 B、`Blake2bProbe`（2 行）✅ 210 B、`WinningsPool_v1`（2 行，5 参 ctor）✅ 215 B、`CheckSigFromStackProbe` ❌ 需改名 `checkMsgSig`（改名后属批 A）。
- 两参 `byte[](x, n)` 全仓 **42 处 / 13 文件**（CloseZkV2 / FoldNode / PoolLeaf / PayoutShard* / RootClose / ShardLeaf …，含 `byte[](shard_count, 4)` 等非 8 字节尺寸 ⇒ `as byte[4]`）——批 A 第三大项。
- **codegen 差异（Blake2bProbe，同源 rc1 210 B vs fixed 178 B；witness 69 B vs 41 B）**：rc1 序言 `DUP <push4 dispatch_tag> EQUAL IF … ELSE … RETURN`（`82188f3 #164` / `d007786 #223` dispatch tag = fn 签名）替代旧的 `DUP FALSE NUMEQUAL IF`（顺序号选 entry）；状态读加 `SIZE OP_9 LESSTHAN VERIFY` 越界检查；`0x6b/0x6c` alt-stack 使用位置变；`ROT/OVER` 替代 `DUP/OP_2`。⇒ **所有合约字节码都变**，与是否用到 byte[36] 无关。
- 产物：`{schema_version:1, compiler_version:"0.1.0", structs:{}, contracts:{<Name>:{source_path, runtime_state:{fields:[{name,type}]}, entries:{<entry>:{dispatch_tag:"d28de5e0", params:[…]}}, compiled:{bytecode:[…], template_hash:[32], state_span:{offset,len}}}}}`；模板哈希改 blake3（`140bf18 #163`）。

## 3. (c) pragma / 版本并存 / 目录
- rc1 仍自报 `0.1.0` ⇒ 现有 `pragma silverscript ^0.1.0` 在 rc1 下**通过**；正式 `1.0.0` 后 `^0.1.0`（= `>=0.1.0 <0.2.0`）**不匹配** ⇒ 报 `compiler version 1.0.0 does not satisfy pragma ^0.1.0`；且 `c61e7d5 #190`：pragma 若覆盖未来主版本（如 `>=0.1.0`）直接拒。⇒ 策略：**迁移后的文件写 `pragma silverscript ^1.0.0`**（rc1 期间临时用 `>=0.1.0, <2.0.0`？——被 #190 拒；rc1 期只能 `^0.1.0`，正式版切 `^1.0.0`，即"pragma 跟编译器换一次"，写进批 A 的收尾步）。
- 并存：**允许双版本并存到正式版 + 批 D 完成**——旧文件（已部署 P2SH 的合约源）原样留 `^0.1.0` + pinned 编译器（复现/取证用）；新文件用 `*_v1.sil` 后缀或同名新目录 `kasia-console/src/lib/sil-v1/`（倾向后者：路径即版本，lint 可按目录选编译器）。
- `versioned-builds/`：加 `silverc-v1rc1-c7d17a1.exe` + `cli-debugger-v1rc1-c7d17a1.exe` + MANIFEST 行（sha256）；`SILVERC_V1_PATH` env；`prediction-escrow-ss.mjs:32 SILVERC` / `pool-bshard-artifacts.mjs` 按目录选。

## 4. (d) 分批
- **批 A 机械（零语义）**：`entrypoint function→entry`（104/42）、`byte[34]→byte[36]`（106/24）、`byte[](x, n)→x as byte[N]`（42/13）、`checkSigFromStack→checkMsgSig`（2/1）、ctor JSON 新形 + 产物新形（工具链：`prediction-escrow-ss.mjs:142` 断言 `contract_name`、`:37 artifact.script`、`state_layout` 全失效 ⇒ 读 `contracts.<Name>.compiled.bytecode` / `state_span` / `entries.<e>.dispatch_tag`）。验收 = §5。
- **批 B `tx.time` 方案 B**（43 处/24 文件，逐处表明日补全；形只有 4 种）：① `tx.time >= deadline * 1000`（31 处）⇒ ctor `temporal deadlineMs`（发布时 `*1000` 在链下一次算好、烤进 ctor）+ `require(tx.time >= deadlineMs)`；② `tx.time >= (deadline + 7200) * 1000`（grace，12 处）⇒ `require(tx.time >= deadlineMs + 2 hours)`；③ 已是 ms 的（`RootClose.sil:72/96 deadline_ms`、`CloseZkV2.sil:67 attestedAtMs + 21600000`）⇒ ctor/字段改 `temporal` 类型 + `+ 6 hours`；④ 🔴 **域错误** `OracleStake_v1.sil:46 require(tx.time >= lockUntilDaa)`（DAA 值喂给 time 域，rc1 直接 type mismatch）⇒ `require(tx.daa >= lockUntilDaa)`（int）——这是 rc1 **帮我们抓出的真 bug**（8/30 `reference-kaspa-cltv-is-magnitude-determined…` 同族）。`S63A_TransitionProbe.sil:52`（A′ DAA 相对锚 `e = daaScore + n_probe`）⇒ `tx.daa >= e`。
- **批 C UB 审计**（`UNDEFINED-BEHAVIOUR.md` 7 节）：struct 11 文件 14 处（`items.length` 只取一个 leaf 的语义 → `FoldNode/PoolLeaf/PoolShard_fold` 的 `prev_states.length` for 循环 4 处）、for 循环 11 处（unroll 上限 63/8/16）、整数溢出（`mask = mask * 2` ×5 处、`spendable * oracleFeePct`）、除零（`/ totalStake`、`/ div`）、`int→byte[N]` 尺寸（`as byte[8]` 后全为显式）。每处写"UB 若被编译器删检查 ⇒ 后果"与加显式 `require` 的位置。
- **批 D 部署**：新 P2SH = 全部合约（§2）；旧盘（已注资 P2SH）**不迁移**——用 pinned 编译器与旧源复现、按旧 exit 路径结算/退款（同 8/30 Unanimous5 结论）；新盘自 v1 起；§6-3 ZK 轨（A′ DAA 锚、`tx.daa`）在 rc1 下是**一等语法**（`tx.daa` 域检查 `static_check.rs:807-818`），比 0.1.0 的"温感 TxTime 造 DAA 锁"干净——设计影响：D-016 A′ 改写为 `tx.daa >= e`，探针 v0.4 在 v1 上重编 + 重做 E1 字节证。

## 5. (e) 每批验收
- **不能按字节比对**（§2 codegen 变）。验收 = ① rc1 编译 exit 0 + 错误清单为空；② **归一化 opcode 序列比对**：剥离 rc1 序言（dispatch `DUP <push4> EQUAL IF`）/ 越界检查（`SIZE <n> LESSTHAN VERIFY`）/ alt-stack 后，业务段 op 序列与 pinned 修复版一致（工具 = `scratchpad/v1mig/cmpops.mjs` 直方图 + 序列，入库到 `scripts/`）；③ **行为向量**：每合约每 entry 用 rc1 `cli-debugger --run`（正向 + 每条 require 一个反向）；④ 批 D 真链：TN12 注资尘埃 + 每 exit 路广播（同 gate (a) 卡）。
- worktree 独立 `npm install`；编译器只用 `versioned-builds/silverc-v1rc1-*.exe`（禁 `target/release` 漂移，同 2026-07-08 事故硬化）。

## 6. 待 NWT 判
1. 并存方式：`sil-v1/` 目录 vs `*_v1.sil` 后缀。2. 批 B ① 的 `deadlineMs` 由谁烤（发布路径 `prediction-escrow-ss.mjs` / `pool-bshard-artifacts.mjs` 各自算一次 vs 公共 helper）。3. `OracleStake_v1.sil:46` 域错误是否单列紧急（已部署质押 UTXO 的锁是否真有效——按 magnitude：`lockUntilDaa` ≈ 8e7 < 5e11 ⇒ 链上当 DAA 锁解释，语义碰巧对；rc1 只是把它写明）。
