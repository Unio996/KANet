# §6-3 · ZK 目标形态决定稿 v0.1 —— 回 J1 ZK 六连（C1 silverc builtin / C2 纯 ScriptBuilder）

> **Status**: DRAFT v0.1 · J2 2026-08-29 · Bettor 派（READY 前设计层，**不动代码**）· 送 NWT 审 · 三方输入：J1 六连（`docs/iteration/j1-inbox/2026-08-28T19-35Z…` → `2026-08-29T00-40Z…` + `20-05Z-node-binary-has-zk`）/ D-001 + KB `architecture/zk-track-c §9` / live 二进制 `7b1e18cc`（`git show 7b1e18cc:<path>`）/ 本仓 `CloseZkV2.sil`·`PayoutShardV2.sil`·`p2sh.mjs`·zk-sdk 移植。
> 🔴 **作用域**：只回 Bettor 三问（①是否必须 ZK+内省叠加 ②C1 三件待定 ③与既有设计冲突/重复），**不改 D-001、不重开 rolling、不设计新电路**。凡本稿坐标，J2 2026-08-29 亲核（`sed -n`/`git show`），不是转述。

## §0 结论（三行）
1. **① 是——我们的结算 covenant 必须"ZK + 内省"叠加；但这件事【已经建成、已上链、生产 armed】，用的既不是 C1 也不是 C2，而是第三形 = "gate 委托"**：ZK 验证放在一个**独立 P2SH 输入**（redeem 内含 `OpZkPrecompile 0xa6`，由移植的 rusty-kaspa zk-sdk `ZkScriptBuilder` 生成），silverc 编的 covenant 用**内省**把该输入的 scriptPubKey 焊进自身 state。⇒ **C1（silverc 加 builtin）不是必经；C2（纯 ScriptBuilder）是 zk-sdk 已有能力的子集且形态与生产不同。两条都不起。**
2. **② 三件待定只在"将来真要做 C1"时才成立**；本稿给出建议但**排期为 0**（§4）。红线 7 估算器对 ZK 形**已覆盖**（按声明 `computeBudget` 取上界），不用改。
3. **③ J1 六连是高质量的链层重推导，但对本仓既有 ZK 资产【零引用】**——它把"silverc 发不出 0xa6"报成"第二步做不了"的缺件，与 D-001 已落链事实（`4ec9ddd1…` 2026-07-06，NWT 独立核实）相抵；另有三处链层版本错位（§5）。**不是 J1 的错——是"自己人知识让文档缺口隐形"（memory `reference-ambient-knowledge-makes-external-doc-gaps-invisible`）在 J1 身上的又一次发作**：没有一份接位文档把"ZK 怎么进 covenant"写成可查的形。本稿 §1 就是补这份。

## §1 资产盘点（防重造 · 全部在仓、全部有链上实证）
| 件 | 坐标 | 作用 | 状态 |
|---|---|---|---|
| **gate 生成器** = rusty-kaspa zk-sdk（PR #953）移植 | `D:/rusty-kaspa-zksdk-isolated/crypto/txscript/zk-sdk/src/zk_to_script/{builder,fragments,wasm}`；WASM 由 `ZKSDK_WASM_PATH` 指（`zk-prove-worker.mjs:35`，单一加载器 `kaspaZk()` :45） | `ZkScriptBuilder.newR0({flags:{covenantsEnabled:true}}).commitToGroth16WithFixedJournal(imageId, journalHash).finalizeWithGroth16FixedJournalProof(receiptHex)` ⇒ `{sigScript, redeemScript}`，redeem = `0x20 ‖ journalHash(32B, 每盘变) ‖ suffix(800B, 每 imageId 固定, 含 R0 通用 Groth16 vk)`；public inputs **不由花费方给**，脚本内从 control_root + image_id + journal_hash 用 `OpSHA256` 算 claim digest（`fragments/groth16.rs:113,153,196-205`） | 14/14 官方测试过（memory `project-zk-sdk-builder-ported-verified-2026-07-06`）；首笔 0xa6 tx `bfd3d0e2…` 落链 7/6 |
| **covenant 侧绑定** = `CloseZkV2.sil` `zk_close` | `kasia-console/src/lib/CloseZkV2.sil:45-51`：`journalHash = sha256(betsRootBaked + byte[](attestedWinner,1) + guestPayoutRoot)`；`require(blake2b(gatePrefix + gateSuffix) == gateTmplHash)`；`gateRedeemHash = blake2b(gatePrefix + journalHash + gateSuffix)`；**`require(tx.inputs[1].scriptPubKey == new ScriptPubKeyP2SH(gateRedeemHash))`** | 这就是"ZK + 内省叠加"的实体：proof 在 gate 输入自验（每节点独立验，D-001 的跨节点死结正是这样解的），covenant 用 `tx.inputs[1].scriptPubKey` 把 journal（bets_root‖winner‖payout_root）焊进自身 state；全文**零 checkSig**（D-001 §2 :62） | 编译器 = `silverc-zk-8065184.exe`（`pool-shard-register.mjs:74` `SILVERC_ZK`；名字里的 zk = "ZK 家族合约用的 pin"，**不是**编译器有 ZK 能力——J1 六连 #1 这一点判得对） |
| **交接** = `PayoutShardV2.sil` `zk_handoff` | `:364-398`：`require(blake2b(templateA+B+C+D) == closeZkTmplAnchor)` + 逐字节重构 CloseZkV2 genesis redeem + `require(tx.outputs[selfOutIdx].scriptPubKey == P2SH(expected))` | 委员 attest 池 → ZK 盘的续继焊 | live |
| **relay 花费路径** | `kasia-relay/src/lib/p2sh.mjs`：`unlockBshardZkHandoff` :2212 / `_ZK_GATE_COMPUTE_BUDGET = 1500` :2298 / `unlockBshardZkClose` :2319（2 输入：closezk + gate，:2362 gate 输入带 `sig_script_hex` + `computeBudget:1500`）/ `unlockCloseZkV2Claim` :2396 / escape 两支 :2488/:2565 | p2sh.mjs **不手拼 gate 字节**；gate 的 `sig_script_hex`/`gate_suffix_hex` 由 console `rebuildZkCloseGateWitness` 确定性重建后经命令传入 | live |
| **guest + prover** | `zk-payout-guest/`（journal = 65B `bets_root‖winner‖payout_root`，`host/src/main.rs:87-91,107`）；`zk-prove-worker.mjs`（WSL 跑 ~4 min；铸 gate + 注资 1 KAS :38） | RISC0 guest → Groth16 wrap receipt | live，`ZK_PROVE_WORKER_ENABLED=1` |
| **常量** | `zk-close-builder.mjs:42-45` `imageId = c9918501…`，`gateTmplHash = 4ec7ca3d…`（D-009 半更新事故后 live-derive，`gate-tmpl-hash.mjs:76-` 跨源断言） | 烤进每盘 genesis | live |
| **六环自治** | `bshard-settle-daemon.mjs` :1026/:1074/:1108 → `zk-autonomy-ticks.mjs` → `zk-close-dispatch.mjs:73-110` | 无人值守结算 | armed（kanet.env:18-20 `ADMIN_ZK_*=1`；D-001 状态注记 8/27） |
| **链上实证** | D-001 :288 `4ec9ddd1d89b144bfec50e386be0221ab44e2f58f1c4f63207358a2eb80f3545`（7/6 首笔完整真实 ZK settle，真 RISC0 guest 出的真 Groth16 proof，NWT 独立核实）；7/9 1dv70 首个真实市场 e2e；7/12 a4343 六环 | — | **CONFIRMED·链上**（D-001 :112） |

🔴 **20 天停摆（7/20 起 output 0）是 D-007 liveness 五闸 + payout_ps_addr 陈，不是 ZK 机制**（COORD-LEDGER (234) 8/13："ZK 主线不是去建，是解锁 output"）。本稿不碰它。

## §2 回 ①：必须叠加，且叠加的正确位置是"输入间"不是"opcode 内"
**必须叠加的理由**（KB track-c §4 ②）：ZK 只证"给定 bets_root 与判决，payout 树算对了"；**journal 里的输入必须焊到链上真相**（bets_root 是 covenant 自己烤的，winner 来自 attest state），否则任何人拿任意输入出一个合法 proof 就能花——这条焊只能由 covenant 内省完成（`validateOutputState` / `tx.inputs[i].scriptPubKey` / `OpInputCovenantId` 族），纯 ZK 门禁（J1 C2 那一类"有 proof 就能花"）**不成立为结算形**。

**为什么不把 0xa6 放进 covenant 自己的 redeem（= C1 的终点）**——四条，每条都是可测的差异，不是口味：
1. **字节隔离**：P2SH 每次花费都要把**完整 redeem** 放进 sig script。若 vk(424B)+verifier 骨架进 covenant redeem，则 `claim` / `escape_*` 这些**不需要 ZK 的入口每次也背 ≥424B+**；gate 委托让 ZK 字节只出现在 `zk_close` 那一笔的第二个输入里。（KB §8：ZK 盘 SIZE 2869 ≪ 9999 就是靠这个）
2. **费用隔离**：0xa6 成本 **140,000 grams**（`tags.rs:31`，Groth16 tag）按**输入**的 script-units 预算扣（`tx.rs:100-103 allowed = ComputeBudget×10,000 + 9,999`）。放在独立 gate 输入上 ⇒ 只有那个输入声明 `computeBudget=1500`（`p2sh.mjs:2298`，≥ 1400 的最小值），covenant 输入自身不涨。放进 covenant redeem ⇒ 每个含 0xa6 路径的入口都要带 ≥1400 预算，且静态估算 `estimate_script_units_upper_bound`（`lib.rs:263-323`）对"redeem 里有 0xa6"的输入取**前一 push 首字节查价、找不到就 max_cost=250k**——covenant 的 `claim` 入口也会被按 ZK 价预估。
3. **工具链隔离**：gate 由 zk-sdk 生成（上游代码、14/14 测试、链上已验），covenant 由 silverc 生成（我们 pin 的 8065184）；两者只在 `blake2b(prefix‖journalHash‖suffix)` 这 **一个 32B 值**上耦合。C1 把两条工具链焊成一条，任一升级都要重审另一半。
4. **跨节点性质不变**：两形都是"每节点独立验"，C1 在 D-001 关心的维度上**没有收益**。

**C2 的定位**：J1 用生产 kaspa-wasm `ScriptBuilder` 离线造出的**原生 Groth16 tag 形**（`inputs[rev]…, count, proof, vk, 0x20, 0xa6`，430B redeem / 296B sig，地址 `kaspatest:ppnsz9…`）证明的是"我们的工具能发 0xa6"——**这件 zk-sdk 移植在 7/6 已用另一形（R0 通用 vk + 脚本内算 public input）证过并上链**。J1 的形要配**自家 Groth16 电路**（circom/arkworks）才有意义，而我们的 prover 是 RISC0 guest ⇒ 换形 = 换整条 prover 栈 = **不在任何决策里**。🔴 J1 那个地址用的是**上游公开夹具 vk，绝不能打钱**（J1 自己已标）。

**⇒ ① 答**：必须叠加；叠加已存在于生产（gate 委托 + 内省绑定）；**C1 非必经，C2 不先走，两条排期 0**。§6-3（A-covenant / `LOCKED_F→O_AUTHORIZED`）若需 ZK，**复用同一形**：covenant 内 `require(tx.inputs[k].scriptPubKey == P2SH(blake2b(prefix‖journalHash‖suffixBaked)))`，gate 仍由 zk-sdk 生成；transition probe（`S63A_TransitionProbe.sil`）与此正交——它只证同 cov_id 续继缝，与 gate 绑定可以叠在同一入口里而不互相依赖。
> 🟡 **verify-when-built（NWT GREEN 附注，2026-08-29）**：上句"可叠同一入口"**未测**——本仓没有任何一个 spend 同时做 cov_id 续继内省（`OpInputCovenantId`/`OpCovOutputCount`/`validateOutputState`）**和** gate journal 内省（`tx.inputs[k].scriptPubKey == P2SH(...)`）的实体（CloseZkV2 零 cov_id 内省；transition probe 零 gate 内省）。A2-whole 落地时**必真核**：双内省同 spend 可编译可通过 + mass/computeBudget 交互（gate 输入 budget=1500 与 covenant 输入 budget=70 各自独立、`estimate_script_units_upper_bound` 对两输入分别估）。在那之前它是**设计假设**，不是结论。

## §3 回 ②：若将来真做 C1，三件待定的建议（排期 0，只留判据）
| 待定 | 建议 | 依据 |
|---|---|---|
| (1) 变参怎么表达 | **不做成 builtin**。J1 三路里选 **(c) 走编译器内部 lowering 管线**（`add_data_with_push_opcode` 那套，与 covenant/blake2b lowering 同级），源语言形 `zkGroth16(vk: byte[], proof: byte[], inputs: byte[32][N])`，N 为**编译期常量**（silverscript 无运行时数组，本就只能这样）；lower 为 `input[N-1]…input[0], N, proof, vk, 0x20, 0xa6`。固定 arity 家族 `_1/_2/_4` = 返工源，J1 判得对 | `compile.rs:3562-3603` builtin 表末尾 `_ => compile_unknown_function_call`；无 raw-opcode 逃生口（J1 #1 §2 实核） |
| (2) >~240 编译期挡否 | **挡，且不用 240 这个数**：链层**没有** 240 常量（7b1e18cc `txscript/src/lib.rs:11` 只有 `MAX_STACK_SIZE = 244`），240 是 J1 的推算。编译期判据写成**机械式**：`N + 4(tag/vk/proof/count) + 该入口调用点的静态栈深 ≤ 244`，静态栈深由编译器已有的栈模拟给（它算 `pick_from_depth` 就得有）。超 ⇒ 编译错误带三个数 | `lib.rs:11-13`（244 / 1M / 1M）；`ArityMismatch`（count+1 ≠ gamma_abc 长）是**运行时**校验，编译期不知 vk 内容，不挡 |
| (3) fee 怎么算 | 🔴 **先纠一处版本错位**：J1 "fee 非常数、随 public input 数增长" 读的是 silverc 锁定的 **v2.0.1 (cfafeb4)**（`verify_zk(tag, dstack, runtime_resource_meter)` 三参 + `deserialize_verifying_key_with_metering`）。**live 二进制 7b1e18cc 是两参 `verify_zk(tag, &mut vm.dstack)`（`opcodes/mod.rs:898`），成本 = 常数 `Gram(1000×140)`（`tags.rs:31`）+ push 字节 1:1（`runtime_resource_meter.rs:121-122`）**。两版语义**都**被"声明 computeBudget 上界"盖住：无论计量怎么变，输入可用 units ≤ budget×10,000+9,999，超了是 `ExceededScriptUnitsLimit` 拒，不是多收费。⇒ **红线 7 估算器（`tx-mass-ub.mjs`）对 ZK 形不用改**：compute = size + 10×Σ(2+|spk|) + 100×Σbudget（v1），gate 输入 budget=1500 ⇒ +150,000 grams 已计；V3b 对缺 budget 的 v1 输入 throw（fail-loud）。要做的只是 **enforce 阶段把 zk_close 真形（2-in，gate sig 约 1.1 KB）加进 P-prod-shapes 向量**——记入 `project-s63-gate-d-next-version-todo` | `mass/mod.rs:342-347`；`tx_validation_in_utxo_context.rs:196-200`；`tags.rs:83,88` 测试断言 500k 块限 ⇒ 每块 ≤3 Groth16 / ≤2 STARK（**这是产能上限**：ZK 结算每块最多 3 盘，与我们节奏无冲突，记下） |

## §4 回 ③：J1 六连 vs 既有设计 —— 冲突/重复/版本错位表
| # | J1 陈述（出处） | 实况（坐标） | 判 |
|---|---|---|---|
| R1 | "silverc 完全没有发出 `OpZkPrecompile` 的能力" ⇒ 路线图第二步做不了（#1） | 事实对，结论错：生产不靠 silverc 发 0xa6，靠 zk-sdk gate（§1 行 1-2）；D-001 :288 已落链 | **重复造**（重推导已建成之物）；R1 本身可收进 KB §4 ④ 作实证 |
| R2 | "`covenants_enabled` 在 TN12 是否为真未实证"（#4 §5, #5 §4, #6 §5）+ "最小真链验证要 Owner 批打小额" | `params.rs:694 TESTNET12_PARAMS covenants_activation: ForkActivation::always()`；且 `bfd3d0e2…`/`4ec9ddd1…` 已落链 | **已被既有事实覆盖**，那笔小额验证**不需要做** |
| R3 | fee 随 public input 数增长（#2 §3, #4 §2.2, #6 §4） | v2.0.1 语义；live 7b1e18cc 常数 140k（§3 (3)） | **版本错位**；对上界估算无影响 |
| R4 | 接口稿全部坐标出自 `~/.cargo/git/checkouts/rusty-kaspa-…/cfafeb4`（#2） | live = 7b1e18cc（J1 #3 自己证了两台同 sha）；cfafeb4 比它**新 47 提交**，含 `72f814ed Integrate finalized ZK hardening and KIP-21 shortcut (#1027)` 触及 txscript | 🔴 **接口稿的"链层接口源码级"须重标为 v2.0.1；对 live 的坐标一律 `git show 7b1e18cc:`**（同红线 7 的规矩，memory `reference-rusty-kaspa-worktree-is-not-the-live-binary-commit`）。J1 自己在 #1 §4 问的"跨线语义一致否"——对 **gate 委托形**答案是"已由链上实证覆盖"；对**任何新形**答案是"必须在 7b1e18cc 上测" |
| R5 | 原生 Groth16 tag 形 P2SH（#5/#6/#7） | 生产 gate 形 = R0 通用 vk 烤 suffix + 脚本内算 public input（§1 行 1）；两形**不同**，proof 来源不同（自家电路 vs RISC0 wrap） | **另一形，不入生产**；作为"kaspa-wasm ScriptBuilder 能发 0xa6"的工具验证有价值，仅此 |
| R6 | `isScriptPayToScriptHash(ScriptPublicKey 对象)` 静默 false（#7） | 真坑，与 memory `reference-kaspa-wasm-xonly-pubkey-accepts-uppercase…` 同族（wasm 边界类型不抛） | **收 ANTI-PATTERNS**（Bettor 定），建议规则名 `R-WASM-P2SH-CHECK-PASS-RAW-SCRIPT` 静态查 `isScriptPayToScriptHash(` 实参非 `.script` |
| R7 | "跨线操作码编号是否一致不猜"（#1 §4） | `wasm/opcodes.rs:198 OpZkPrecompile = 0xa6`（7b1e18cc）= J1 读的 kaspa-wasm 1.1.0 = 166 | 一致，闭 |
| R8 | 上游 `wasm/examples/.../risc0-succinct.js` 示例栈序 | 与 `risc0/mod.rs:91` 验证器**不一致**（缺 control_id、顺序不同）——本稿实核发现，J1 没引用它 | 🟡 **别拿那个示例当 R0 形依据**；Rust 集成测试 `consensus_integration_tests.rs:2100-2124` 才是准的（我们不走 R0Succinct tag，只记） |
| R9 | `kaspa-txscript-zk-sdk` 在 silverc `Cargo.toml:23` 声明但零引用（#1） | 实核同；且 v2.0.1 与 7b1e18cc 两树里都**没有**这个 crate 的 Cargo.toml；zk-sdk 实体在 `D:/rusty-kaspa-zksdk-isolated`（PR #953 移植） | 那行是死声明；**不要**顺着它去 silverc 里找 ZK |

## §5 真正该给 J1（A 工具链主责）的活 —— 建议，Bettor 裁后我写 j1-inbox
1. **P0 不变**：transition probe `.sil`/ctor 正式编译（复现 `script0/1 sha256`）。
2. **P1（跨节点 ZK 可复现性，直接服务 D-001 "每节点独立验"）**：在 younio 用 `D:/rusty-kaspa-zksdk-isolated` 同版 WASM **独立复算 `gateTmplHash = 4ec7ca3d…`**（输入 imageId `c9918501…`；对照 `gate-tmpl-hash.mjs` 的跨源断言）。这是目前**唯一没在第二台机器上证过**的 ZK 环节——`imageId` 跨机不可复现（`zk-close-builder.mjs:28-31`，guest Cargo.lock 未入库）是已知债，P1 会把它逼出来。
3. **P2**：把 J1 六连的链层部分（栈布局/tag/成本/244）按 **7b1e18cc** 重标坐标后并入 KB `zk-track-c` §4 ④ 与 §1——填 R1 那个"外人看不见的缺口"，让下一个接位者不用再推一遍。
4. **不起** C1 / C2；**不**为 J1 的夹具地址注资；**不**做 R2 那笔"最小真链验证"。

## §6 不确定 / 未核（诚实边界）
- zk-sdk 移植版对应的上游 commit 与 7b1e18cc 的关系**未逐提交比对**（它 7/6 已在 live 链验过，本稿以链上实证为准，不以源码比对为准）。
- §6-3 A-covenant 最终是否需要自己的 gate（或只沿用 `zk_handoff → CloseZkV2` 交接）取决于 §6-3 A2-whole 设计，本稿只定"若需，用同形"。
- `zk-autonomy-ticks.mjs` 内部未逐行读；`.claude/worktrees/*` 下 CloseZkV2/PayoutShardV2 为陈旧副本未比对。
- 根目录 `_j2_closezk_repro{,2,3,4}.sil` 是 7/6 研究件、未跟踪，应归档 `scratch/`（临时脚本铁律）——我下次顺手，不在本稿内动。
