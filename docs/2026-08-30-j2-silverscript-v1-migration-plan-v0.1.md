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
- 🔴 **并存的硬边界（NWT ③）**：旧 P2SH 上是**真人钱、rolling live 公测不停**（CLAUDE.md 铁律 0.5「只维持 live 公测过渡·零追加投入」）⇒ **绝不重部署 live escrow / 绝不把旧盘迁到新地址**；迁移期 redeem / settle / refund / claim 路径**必须认两套**（按 `pool_markets.metadata` / `exchange_offers.metadata.redeem_script_hex` 里烤的旧字节码 + pinned 编译器复现 vs 新盘 `sil-v1/` + rc1），判据 = 存的 redeem 哈希 == 地址（8/30 保密件同法），不按"当前编译器"猜。
- `versioned-builds/`：加 `silverc-v1rc1-c7d17a1.exe` + `cli-debugger-v1rc1-c7d17a1.exe` + MANIFEST 行（sha256）；`SILVERC_V1_PATH` env；`prediction-escrow-ss.mjs:32 SILVERC` / `pool-bshard-artifacts.mjs` 按目录选。

## 4. (d) 分批
- **批 A 机械（零语义）**：`entrypoint function→entry`（104/42）、`byte[34]→byte[36]`（106/24）、`byte[](x, n)→x as byte[N]`（42/13）、`checkSigFromStack→checkMsgSig`（2/1）、ctor JSON 新形 + 产物新形（工具链：`prediction-escrow-ss.mjs:142` 断言 `contract_name`、`:37 artifact.script`、`state_layout` 全失效 ⇒ 读 `contracts.<Name>.compiled.bytecode` / `state_span` / `entries.<e>.dispatch_tag`）。验收 = §5。
- **批 B `tx.time` 方案 B**（43 处/24 文件，逐处表明日补全；形只有 4 种）：① `tx.time >= deadline * 1000`（31 处）⇒ ctor `temporal deadlineMs`（发布时 `*1000` 在链下一次算好、烤进 ctor）+ `require(tx.time >= deadlineMs)`；② `tx.time >= (deadline + 7200) * 1000`（grace，12 处）⇒ `require(tx.time >= deadlineMs + 2 hours)`；③ 已是 ms 的（`RootClose.sil:72/96 deadline_ms`、`CloseZkV2.sil:67 attestedAtMs + 21600000`）⇒ ctor/字段改 `temporal` 类型 + `+ 6 hours`；④ 🔴 **域错误** `OracleStake_v1.sil:46 require(tx.time >= lockUntilDaa)`（DAA 值喂给 time 域，rc1 直接 type mismatch）⇒ `require(tx.daa >= lockUntilDaa)`（int）——这是 rc1 **帮我们抓出的真 bug**（8/30 `reference-kaspa-cltv-is-magnitude-determined…` 同族）。`S63A_TransitionProbe.sil:52`（A′ DAA 相对锚 `e = daaScore + n_probe`）⇒ `tx.daa >= e`。
- **批 C UB / 潜伏 bug 审计**（NWT ④：范围 = **rc1 拒而 0.1.0 接受的全部** = 旧合约里的潜伏 bug，迁移是修不是纯 port，每处写**真实影响**）：(i) 两参 `byte[](x, n)` ×42——0.1.0 下它就是 OP_PICK off-by-one 的触发形（8065184 修的正是这条），已部署字节码里每一处都要回答"当时用的是 legacy 还是 fixed 编译器、栈位对不对"（`docs/provenance/README-silverc-oppick-provenance.md` 已核过的沿用，未核的补）；(ii) `OracleStake_v1.sil:46` 域错误（真实影响：`lockUntilDaa≈8e7 < 5e11` ⇒ 链上按 DAA 锁解释，语义碰巧对，但任何人把它当"时间锁"读就错；已部署质押 UTXO 不动）；(iii) `UNDEFINED-BEHAVIOUR.md` 7 节逐条：struct 11 文件 14 处（`items.length` 只取一个 leaf → `FoldNode/PoolLeaf/PoolShard_fold` 的 `prev_states.length` for 循环 4 处）、for 循环 11 处（unroll 上限 63/8/16）、整数溢出（`mask = mask * 2` ×5、`spendable * oracleFeePct`）、除零（`/ totalStake`、`/ div`）、`int→byte[N]` 尺寸。每处写"UB 若被编译器删检查 ⇒ 后果（返回 true 花掉 / 假拒）"与加显式 `require` 的位置；**已部署盘**只记账不改（同批 D 旧盘不迁）。
- **批 D 部署**：新 P2SH = 全部合约（§2）；旧盘（已注资 P2SH）**不迁移**——用 pinned 编译器与旧源复现、按旧 exit 路径结算/退款（同 8/30 Unanimous5 结论）；新盘自 v1 起。
- 🔴 **§6-3 编译器绑定（NWT ②，与 D-016 注记一致）**：§6-3 / gate (a) / A′ 探针 **继续用 pinned `silverc-zk-8065184`**，已部署与待广播的探针字节码不受本计划影响；**42 合约迁 rc1 不顺手拖走 §6-3**。§6-3 迁 rc1 = **另一独立决策**（Owner/Bettor 另批）：届时 A′ 改 `tx.daa >= e`（rc1 一等语法，`static_check.rs:807-818`）、探针在 rc1 重编、E1 字节证与 gate-(a) 卡**全部重做**，不复用本计划的验收。
- **优先级（NWT ⑤）**：live 公测不停 > 节点 READY / gate (a) > 42 合约迁移；迁移各批**不撞 READY 窗**（T+0…T+125 只读段与 gate (a) 广播轮期间不落码不广播），rc1→正式版（≈9/6）之间只做批 A/B/C 的离线编译与向量，批 D 真链在正式版 + READY 后。

## 5. (e) 每批验收
- **不能按字节比对**（§2 codegen 变）。验收层级（NWT ①）：
  - **主证据 = 行为向量**：每合约 × 每 entry × **每条 `require` 一正一反**（反向 = 只破坏该 require 的输入，其它全合法；缺一条 require 的反向 = 一条未验路径，清单按 grep `require(` 机械生成、人工核"能否单独破坏"），用 rc1 `cli-debugger --run`（`--test-file` 批跑）；同一向量集对 pinned 修复版用旧 debugger（`scratch/j1-oppick-verify/debugger`）跑一遍 ⇒ **两版通过/拒绝集逐条相等**才算"语义不变"。
  - **辅证 = 归一化 opcode 序列比对**（`scratchpad/v1mig/cmpops.mjs` → 入库 `scripts/sil-opcode-normalize.mjs`）：剥离规则**逐条红队证语义中性**——(r1) dispatch 序言 `DUP <push4 tag> EQUAL IF … ELSE RETURN`：只选 entry，不触任何 require（红队：tag 碰撞/错 tag ⇒ RETURN 拒，不会放行别的 entry）；(r2) 越界检查 `SIZE <n> LESSTHAN VERIFY`：只加"拒绝"不加"通过"（红队：对合法输入必真，向量集里每条正向必须过它）；(r3) alt-stack `0x6b/0x6c` 位置：等价重排（红队：正向向量的 locals 与旧版逐字相同，如 §1 witness `enc/enc_a`）；(r4) `ROT/OVER` 替代 `DUP/OP_2`：等价栈操作（红队：同 r3）。剥离后业务段 op 序列与 pinned 修复版一致 = 辅证成立；不一致 ⇒ 逐处解释或红。
  - **终证 = 批 D 真链**：TN12 注资尘埃 + 每 exit 路广播（同 gate (a) 卡，INCONCLUSIVE ≤3），只在正式版 + READY 后。
- worktree 独立 `npm install`；编译器只用 `versioned-builds/silverc-v1rc1-*.exe`（禁 `target/release` 漂移，同 2026-07-08 事故硬化）。

## 6. 待 NWT 判
1. 并存方式：`sil-v1/` 目录 vs `*_v1.sil` 后缀。2. 批 B ① 的 `deadlineMs` 由谁烤（发布路径 `prediction-escrow-ss.mjs` / `pool-bshard-artifacts.mjs` 各自算一次 vs 公共 helper）。3. `OracleStake_v1.sil:46` 域错误是否单列紧急（已部署质押 UTXO 的锁是否真有效——按 magnitude：`lockUntilDaa` ≈ 8e7 < 5e11 ⇒ 链上当 DAA 锁解释，语义碰巧对；rc1 只是把它写明）。

## 附录 A · 批 B 逐处表（43 处 `tx.time`，机械生成 2026-08-30，**人工复核完成 2026-09-01**）

人工复核结论（逐行读原文 ±1 行上下文，`git grep -n -C1 "tx\.time" -- '*.sil'`）：
- **43 行 = 可执行 require 30 + 注释/声明 13**；30 处可执行全部归四形，无第五形。
- 复核改判 3 行：#1 改 **② grace**（`(attestedAtSeconds+21600)*1000` 是秒基+宽限再 *1000，非纯 ①；且该文件 `_j2_closezk_repro4.sil` 是根目录 repro 残件 → **退役候选，不迁**）；#20 生成尾注错（`300 seconds` 的括注误写 `7200 seconds = 2 hours`，正确 = **5 min**，下表已改）；#2/#4（S63A 探针）**不在本计划**——§4「§6-3 编译器绑定」：探针随 pinned `silverc-zk-8065184`，迁 rc1 属 §6-3 独立决策。
- 语义红线（全部 ①② 共享）：`deadline` 烤的是**秒** Unix ts（ShardLeaf:91 链上 LANDED precedent 实证 tx.time=ms），temporal 化后 ctor 值改喂 **ms**（`deadlineMs = deadline*1000` 由发布路径算，§6-2 待 NWT 判谁烤）——**烤错单位 = vacuous 恒真/恒假**，批 B 每合约的反向向量必须含「deadline 未到 ⇒ 拒」一条来抓它。

| # | 文件:行 | 现状 | 新写法（方案 B） | 形 |
|---|---|---|---|---|
| 1 | `_j2_closezk_repro4.sil:72` | `require(tx.time >= (attestedAtSeconds + 21600) * 1000);          // ⚠ 21600 占位, 见�` | **退役候选（根目录 repro 残件，正本 = CloseZkV2.sil #5），不迁** | ② grace(复核改判) |
| 2 | `docs/provenance/2026-08-29-s63a-probe-v03/S63A_TransitionProbe.sil:37` | `require(tx.time >= t_recovery);                          // parser 限  tx.time 只能 sta` | ctor `temporal t_recovery` | ③ 已 ms |
| 3 | `docs/provenance/2026-08-29-s63a-probe-v03/S63A_TransitionProbe.sil:44` | `//    8065184 的 `require(tx.time >= e)` 降成裸 `<e> OP_CHECKLOCKTIMEVERIFY`(compile.r` | 随正文 | 注释 |
| 4 | `docs/provenance/2026-08-29-s63a-probe-v03/S63A_TransitionProbe.sil:52` | `require(tx.time >= e);                                   // = CLTV(e)  块 DAA > tx.lockTi` | `require(tx.daa >= e)`（e = daaScore + n_probe, int） | ④ DAA 域(A′) |
| 5 | `kasia-console/src/lib/CloseZkV2.sil:67` | `require(tx.time >= attestedAtMs + 21600000);                     // ESCAPE_GRACE_MS=216000` | witness 字段 `temporal attestedAtMs`; `+ 6 hours` | ③ 已 ms |
| 6 | `kasia-console/src/lib/OracleStake_v1.sil:14` | `// 锁时语义 (silverc tx.time = tx.lockTime literal) ` | 随正文 | 注释 |
| 7 | `kasia-console/src/lib/OracleStake_v1.sil:46` | `require(tx.time >= lockUntilDaa);` | `require(tx.daa >= lockUntilDaa)`（int, DAA 域） | ④ 域错误 |
| 8 | `kasia-console/src/lib/PayoutShardV2.sil:86` | `int      new_attestedAtMs,        // 新增, witness供(self-read tx.time 经实测证实�` | — | 注释/其它 |
| 9 | `kasia-console/src/lib/PoolRoot.sil:56` | `require(tx.time >= deadline * 1000);               // post-deadline` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs)` | ① *1000 |
| 10 | `kasia-console/src/lib/PoolRoot.sil:144` | `require(tx.time >= (deadline + 7200) * 1000);      // deadline+grace 超时才可取消 (�` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs + 7200 seconds)`（7200 seconds = 2 hours） | ② grace |
| 11 | `kasia-console/src/lib/PoolShard_fold.sil:130` | `require(tx.time >= deadline * 1000);               // post-deadline` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs)` | ① *1000 |
| 12 | `kasia-console/src/lib/PoolShard_fold.sil:216` | `require(tx.time >= (deadline + 7200) * 1000);      // deadline+grace 超时才可取消 (�` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs + 7200 seconds)`（7200 seconds = 2 hours） | ② grace |
| 13 | `kasia-console/src/lib/PoolSide.sil:128` | `require(tx.time >= deadline * 1000);` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs)` | ① *1000 |
| 14 | `kasia-console/src/lib/PoolSide_v06.sil:263` | `require(tx.time >= (deadline + 7200) * 1000);` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs + 7200 seconds)`（7200 seconds = 2 hours） | ② grace |
| 15 | `kasia-console/src/lib/PoolSide_v07.sil:276` | `require(tx.time >= (deadline + 7200) * 1000);` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs + 7200 seconds)`（7200 seconds = 2 hours） | ② grace |
| 16 | `kasia-console/src/lib/PoolSide_v0_7_1.sil:93` | `require(tx.time >= (deadline + 7200) * 1000);  // grace 7200s 防 front-run` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs + 7200 seconds)`（7200 seconds = 2 hours） | ② grace |
| 17 | `kasia-console/src/lib/PoolSpine.sil:97` | `require(tx.time >= deadline * 1000);` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs)` | ① *1000 |
| 18 | `kasia-console/src/lib/PoolSpine.sil:130` | `require(tx.time >= deadline * 1000);  // bug 10d fix Path A` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs)` | ① *1000 |
| 19 | `kasia-console/src/lib/PoolSpine.sil:145` | `require(tx.time >= deadline * 1000);  // bug 10d fix Path A` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs)` | ① *1000 |
| 20 | `kasia-console/src/lib/PoolSpine.sil:175` | `require(tx.time >= (deadline + 300) * 1000);` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs + 300 seconds)`（300 s = 5 min，**非** 2h——生成稿此括注错，复核改） | ② grace |
| 21 | `kasia-console/src/lib/PoolSpine_i_proto.sil:390` | `require(tx.time >= (deadline + 7200) * 1000);  // grace 修 (bug 10d Path A ms 模式)` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs + 7200 seconds)`（7200 seconds = 2 hours） | ② grace |
| 22 | `kasia-console/src/lib/PoolSpine_v06.sil:274` | `// SS never verified "no bettor joined"; check was only `tx.time>=deadline*1000`.` | 随正文 | 注释 |
| 23 | `kasia-console/src/lib/PoolSpine_v06.sil:279` | `require(tx.time >= (deadline + 7200) * 1000);  // grace 修, bug 10d Path A ms 模式` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs + 7200 seconds)`（7200 seconds = 2 hours） | ② grace |
| 24 | `kasia-console/src/lib/PoolSpine_v07.sil:383` | `require(tx.time >= (deadline + 7200) * 1000);  // grace 修 (bug 10d Path A ms 模式)` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs + 7200 seconds)`（7200 seconds = 2 hours） | ② grace |
| 25 | `kasia-console/src/lib/PoolSpine_v08_agg.sil:298` | `// FRONT-RUN FIX (Bettor r388/r389)  REFUND_GRACE_SEC = 7200 (2h) >= 委员结算 SLA; tx.` | 随正文 | 注释 |
| 26 | `kasia-console/src/lib/PoolSpine_v08_agg.sil:302` | `require(tx.time >= (deadline + 7200) * 1000);  // grace 修 (bug 10d Path A ms 模式)` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs + 7200 seconds)`（7200 seconds = 2 hours） | ② grace |
| 27 | `kasia-console/src/lib/PoolSpine_v08_chunk.sil:316` | `require(tx.time >= (deadline + 7200) * 1000);  // grace 修 (bug 10d Path A ms 模式)` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs + 7200 seconds)`（7200 seconds = 2 hours） | ② grace |
| 28 | `kasia-console/src/lib/PoolSpine_v08_shard.sil:46` | `require(tx.time >= deadline * 1000);           // post-close-only(deadline 过)` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs)` | ① *1000 |
| 29 | `kasia-console/src/lib/PoolSpine_v0_7_1.sil:238` | `require(tx.time >= (deadline + 7200) * 1000);  // grace 7200s 防 front-run vuln` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs + 7200 seconds)`（7200 seconds = 2 hours） | ② grace |
| 30 | `kasia-console/src/lib/PredictionEscrowConsensualMid.sil:73` | `require(tx.time >= deadline * 1000);` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs)` | ① *1000 |
| 31 | `kasia-console/src/lib/PredictionEscrowUnanimous5.sil:146` | `require(tx.time >= deadline * 1000);  // bug 10d fix Path A` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs)` | ① *1000 |
| 32 | `kasia-console/src/lib/PredictionEscrowUnanimous5.sil:167` | `require(tx.time >= deadline * 1000);  // bug 10d fix Path A` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs)` | ① *1000 |
| 33 | `kasia-console/src/lib/PredictionPoolUnanimous3.sil:105` | `require(tx.time >= deadline * 1000);  // bug 10d fix Path A — Kaspa LOCK_TIME_THRESHOLD ` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs)` | ① *1000 |
| 34 | `kasia-console/src/lib/PredictionPoolUnanimous3.sil:158` | `require(tx.time >= deadline * 1000);  // bug 10d fix Path A` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs)` | ① *1000 |
| 35 | `kasia-console/src/lib/PredictionPoolUnanimous3.sil:184` | `require(tx.time >= deadline * 1000);  // bug 10d fix Path A` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs)` | ① *1000 |
| 36 | `kasia-console/src/lib/RootClose.sil:72` | `require(tx.time >= deadline_ms);                   // post-deadline (deadline_ms 已 ms)` | ctor `temporal deadline_ms`; 常量 7200000 ⇒ `2 hours` | ③ 已 ms |
| 37 | `kasia-console/src/lib/RootClose.sil:96` | `require(tx.time >= deadline_ms + 7200000);         // deadline+grace(2h) 超时才可取�` | ctor `temporal deadline_ms`; 常量 7200000 ⇒ `2 hours` | ③ 已 ms |
| 38 | `kasia-console/src/lib/ShardLeaf.sil:29` | `int      deadline,            // ★件1(J1)  partial-shard sweep deadline (Unix ts, ctor-` | — | 注释/其它 |
| 39 | `kasia-console/src/lib/ShardLeaf.sil:91` | `//   ⚠ tx.time 单位=【毫秒】(链上 LANDED refund precedent p2sh.mjs L7/SS L275 �` | 随正文 | 注释 |
| 40 | `kasia-console/src/lib/ShardLeaf.sil:93` | `//   ⚠ da9fc22 parser 限 tx.time 只能 standalone require(不能进 || 复合)→拆�` | 随正文 | 注释 |
| 41 | `kasia-console/src/lib/ShardLeaf.sil:94` | `//   sealed  不进 if→随时 LAND / partial  进 if→premature(tx.time < deadline*1000` | 随正文 | 注释 |
| 42 | `kasia-console/src/lib/ShardLeaf.sil:96` | `require(tx.time >= deadline * 1000);` | ctor `temporal deadlineMs`; `require(tx.time >= deadlineMs)`（在 `if (count != seal_count)` 内——rc1 须实测 temporal require 允不允许进 if 块，0.1.0 的「只能 standalone」限已由 da9fc22 记录，rc1 未验 ⇒ 批 B 首个试编对象） | ① *1000 |

## 附录 B · 主证据向量预算（机械盘点 2026-09-01，`git grep -c`）

- 规模：**42 合约 / 104 entry / 1337 条 `require`** ⇒ 主证据上界 = **2×1337 ≈ 2674 向量**（每 require 一正一反）+ 每 entry 至少 1 条全合法正向。机械生成（按 entry 切段列 require 清单），人工只核「该 require 能否被单独破坏」（复合条件如 `a==0||a==1` 反向取域外值）。
- 分层（按 §4 优先级，live 不停 > READY > 迁移）：
  - **T1 已部署/在钱**（旧盘不迁但要当 pinned 对照臂）：`PoolSide_v06/v07/v0_7_1`（137 卡盘）、`PredictionEscrowUnanimous5`（16 escrow 全 Unanimous5，8/30 实核）、`OracleStake_v1`（已注资质押）——**向量双跑（rc1 + pinned）全覆盖，先做**。
  - **T2 committed 目标件**：`CloseZkV2`、`PayoutShard/V2`、`PoolSpine_v08_*`、`RootClose/RootClaim/RefundClaim`、`ShardLeaf*`、`FoldNode*`、`PoolLeaf*`、`PoolRoot`、`PoolShard_fold`、`WinningsPool_v1`——全覆盖，次做。
  - **T3 探针/残件**：`RootStub_probe*`（p27/53/80/106 合计 270 require 全是機械展开）、`Blake2bProbe`、`CheckSigFromStackProbe`、`ProbeC_selfonly`、`PoolSpine_i_proto`、`_j2_closezk_repro4`（退役候选）——**逐个判「迁 or 退役」，退役的不出向量**；`S63A_TransitionProbe` 不在本计划（§6-3 绑定）。
- require 最重 5 件：`RootStub_probe_p106`(107)、`PayoutShard`(91)、`RootStub_probe_p80`(81)、`PayoutShardV2`(70)、`PoolSpine_v07/i_proto`(63)——T3 探针占两席，退役即省 ~270 向量。

## 附录 C · 批 C 逐处基表（rc1 拒而 0.1.0 收 = 潜伏 bug；机械盘点 2026-09-01，语义与真实影响逐处待批 C 执行时填）

**C-1 两参 `byte[](int, N)` ×42 处**（`git grep -nE 'byte\[\]\([^)]+,[^)]+\)'`；rc1 全拒 ⇒ `x as byte[N]`）——分布：`CloseZkV2` 3 / `_j2_closezk_repro4` 2 / `FoldNode` 2 / `PayoutShard` 2 / `PayoutShardV2` 7 / `PoolLeaf` 2 / `PoolRoot` 1 / `PoolShard_fold` 3 / `PoolSpine_i_proto` 2(+4 注释) / `PoolSpine_v07` 2(+4 注释) / `PoolSpine_v08_chunk` 1 / `PoolSpine_v0_7_1` 3(+2 注释) / `RootClaim` 1 / `CloseZkV2` 另 1 注释（合计可执行 31 + 注释 11 = 42 行命中）。
- 🔴 **每处都是 commit/merkle 前像的序列化**（`blake2b(byte[](pk) + byte[](amount,8))` 族）⇒ 迁移的承重验收 = **`x as byte[N]` 与 `byte[](x,N)` 字节逐位相等**（LE sign-magnitude，`serialize_i64`，PoolSpine_v07:334 已 source-verified）——先用 `Blake2bProbe` 迁移版跑 **digest 相等向量**（同输入旧/新两版 debugger 出同 digest），不等 = 全库 commit 断裂，批 B/C 全停上报。
- 🔴 **OP_PICK 触发形出处列**：0.1.0 下两参 cast 正是 off-by-one 触发形——每个**已部署**字节码须回答「当时 legacy 还是 fixed 编译器编的」，沿用 `docs/provenance/README-silverc-oppick-provenance.md` 已核项，未核的补（旧盘不迁但要按旧 exit 结算，栈位错的盘要单列）。

**C-2 域错误**：`OracleStake_v1.sil:46`（附录 A #7，§6-3 判是否单列紧急）。

**C-3 UB 7 节逐处**（行号机械盘点）：
- for 循环 16 处（unroll 上限）：`mask=mask*2` 位掩码族 8（`CloseZkV2:104,169`、`PayoutShard:195,359`、`PayoutShardV2:311`、`RootClaim:88`、`_j2_closezk_repro4:114`）＋ 折叠族 `prev_states.length`（`FoldNode:60`、`PoolLeaf:99`、`PoolShard_fold:95`）＋ merkle/segment（`PoolRoot:108`、`PoolShard_fold:180`、`PoolSpine_v08_chunk:183,249`、`RootClaim:73`、`Blake2bProbe:24`）。UB 点 = 循环变量越 unroll 界；rc1 若把界检查显式化/移除 ⇒ 每处写「删检查后果」。
- 整数溢出：`mask*2` @ bit_in≤63（2^63 溢出 i64——bound 63 是编译期 unroll 非运行时钳，须核 rc1 对 `bit_in=63` 的行为）；费率乘法 7 处（`PredictionEscrowConsensualMid:47`、`PredictionEscrowUnanimous5:70,72,73,124,152`）`spendable*pct` 上界 = spendable≤2.1e15 sompi × 10000 < 2^63 ✓（记账即可）。
- 除零：`/ totalStake`（`PredictionEscrowUnanimous5:152`，totalStake=maker+taker>0 由注资保证——但须写「若 0 注资路径可达 ⇒ 后果」）；`/ div` merkle 族（`_j2_closezk_repro4:100-109` 退役候选）；`/ 10000` 常量安全。
- struct `.length` 14 处与 `int→byte[N]` 尺寸：随 C-1/for 循环行号覆盖，rc1 `x as byte[N]` 全显式 ⇒ 迁移后消失，记账为「rc1 修掉的类」。
