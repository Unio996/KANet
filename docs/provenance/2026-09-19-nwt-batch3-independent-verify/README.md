# 2026-09-19 NWT — 结算批 3（market_seal）独立验证 + mass 断言设计红队审

审阅对象：J2 侧分支 `coord/j2-proto-v0-settlement-design-v0.1`（审时头 `c0ed02f3`，其后 `97f8baa2`/`cb5fd9e1` 也读了）。
派工：Bettor（claude-d1），账本 1494–1501 + 三条对等消息。**只读**：未向任何节点提交交易，未碰 J2 worktree，未动生产检出。
D-021：本文只含 simnet 数据与公开工具标识，无密钥值。

## 0. 被审工具与节点身份（先核再下结论）

| 项 | 值 | 怎么核的 |
|---|---|---|
| simnet 节点 | PID 15972，`D:\rusty-kaspa-v201\kaspad.exe --simnet --appdir=D:/kanet-tn12/scratch/_nwt_simnet_data --rpclisten-borsh=127.0.0.1:18510 ...` | `Get-CimInstance Win32_Process`（ExecutablePath / CommandLine），仅监听 127.0.0.1 |
| 节点二进制 | sha256 `8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38`，`--version` = `kaspad 2.0.1` | 本机 `sha256sum` + `--version`，与主网节点 PID 8268 同一份文件 |
| 共识源码坐标 | rusty-kaspa tag `v2.0.1` = `cfafeb4c093fa37a303f1b9f19c58f986b870ce3` | `git -C D:/rusty-kaspa rev-parse v2.0.1^{commit}`；只用 `git show cfafeb4c:<path>` 读，不 checkout |
| silverc | `silverc-v100-3ed9733.exe` sha256 `4378ba65…8643` | 脚本内硬校验（不符即 throw） |
| 独立编码器（上游 Rust） | `D:\silverscript-debugger-3ed9733-eprintln\target\release\cli-debugger.exe` sha256 `c8072cfa26fc58ce3ec5d0a6f5b7f753ddd02c299b360af7db0e02a24a083a34`，源码 = 3ed9733 + 只加 `eprintln!`（`git diff` 已核，未动 encode 路径） | 不是 versioned-builds 里那份干净 debugger（`b85bb524…`，不打印 sigscript）；这份是我此前审计用的诊断构建 |
| 主网 Toccata | 主网 `virtualDaaScore` 543,950,268 ≥ 激活分 474,165,565（`params.rs:724`），只读 RPC 17110 | `scratch/_nwt_batch3/mainnet_daa.mjs`（只读 getBlockDagInfo） |

## 1. 结果 A — `convert_to_rootclose` 见证编码器：独立验证 PASS（with notes）

对象：`proto-convert-to-rootclose-witness.mjs`（J2 自述"未经独立逐字节验证"）。链上样本：README 里的 market_seal `e2c45b32…24c8`（区块 `fea2c9be…`），由我直接从节点 `getBlocks` 取回（不是读 J2 的落盘）。

三条独立腿，**没有一条是 J2 写的实现**：

1. **自写 push 解析器**（`scripts/decode_pushes.mjs`，不用 kaspa ScriptBuilder）拆 input[0] sigScript（34,559 B）：
   `OP_0(rcOutIdx=0) / 6b(rc_prefix,1B) / rc_suffix(16,714B) / OP_1(tokenInIdx=1) / OP_1(tokenOutIdx=1) / 6b(tok_prefix,1B) / tok_suffix(3,078B) / ea68d205(tag) / PUSHDATA2 redeem(14,746B)`。
2. **pinned silverc 独立重编**（`scripts/recompile_leaf.mjs`）：ctor 取自链上 redeem（state 1/999/2/1000、own_redeem_len 14,746、rootclose_tmpl_hash 读自 redeem 烘焙位 [14157,14189)），重编 bytecode 与链上 redeem **逐字节相等（14,746 B，diff=0）**；同一份编译产物里 `convert_to_rootclose` 的 params 声明序 = `rcOutIdx, rc_prefix, rc_suffix, tokenInIdx, tokenOutIdx, tok_prefix, tok_suffix`，`dispatch_tag=ea68d205`，与链上一致。
3. **上游 Rust 编码器**（`scripts/make_dbg_fixture.mjs` + `compare_upstream.mjs`）：把腿 1 解出的 7 个参数喂给 patched cli-debugger，它经上游 `encode_contract_entry_sig_script` 生成的 action = 19,810 B，与链上 sigScript 去掉尾部 redeem push 后的 19,810 B **逐字节相等**（sha256 `de1bae8e…9bc1`）。

附加：`scripts/verify_rootclose_out.mjs` 用我自写的 state 编码（int→`08`+8B LE，bytes32→`20`+32B）重算 `blake2b256(rc_prefix ‖ state7 ‖ rc_suffix)` = `9d3be0fc…f9f5`，与链上 out[0] 的 P2SH 逐字节一致 ⇒ rc_prefix/rc_suffix 的语义与 4 字段 state 携带在字节层被独立坐实。

**N1 残余盲区（同值成对）已用哨兵值闭合**（`scripts/sentinel_order.mjs`）：真实形状里 `tokenInIdx==tokenOutIdx==1`、`rc_prefix==tok_prefix==6b`，互换字节不变、共识也看不出。用两两不同的哨兵（3/`aa01`/`bb0202`/5/7/`cc03`/`dd040404`）分别走 J2 编码器与上游编码器：
`5302aa0103bb0202555702cc0304dd04040404ea68d205` 两侧**逐字节相等**，解码顺序 = ABI 声明序。⇒ 编码器层面的位置映射在非退化输入下也与上游一致。

结论口径（§9.1 级别词）：**端到端 demonstrate（单形状 n=1，simnet）**；不是"全栈闭环"。仅对 market_seal（seal_count=2、min_bet=1、pool_value=1000）这一形状成立。

## 2. 结果 B — mass：按 consensus 源码独立移植，节点值 8/8 逐位吻合

`scripts/port_mass.mjs` 直接移植 `consensus/core/src/mass/mod.rs`（`calc_storage_mass` 含 relaxed 分支、`calc_non_contextual_masses`、`transaction_estimated_serialized_size`、`utxo_plurality`），输入 amount / plurality 取自**链上父交易的真实输出**（不是 builder 的假设值）。对账 4 笔真实交易（节点值取自区块记录里的 `storageMass` / `verboseData.computeMass`）：

| 交易 | 路径 | 我算 storage | 节点 storage | 我算 compute | 节点 compute | 实付 fee(sompi) |
|---|---|---|---|---|---|---|
| market_genesis | relaxed | 207,749 | 207,749 | 8,083 | 8,083 | 20,280,700 |
| register_append#1 | arithmetic | 457,504 | 457,504 | 33,927 | 33,927 | 43,339,900 |
| register_append#2 | arithmetic | 293,116 | 293,116 | 44,198 | 44,198 | 39,666,700 |
| market_seal | arithmetic | 231,312 | 231,312 | 60,422 | 60,422 | 34,386,000 |

限制口径：`params.rs` 主网/simnet 的 `prior_block_mass_limits` 都是 `with_shared_limit(500_000)`（`:698`/`:814`），Toccata 后仅 transient 改 1,000,000（`:699`）；主网已过 Toccata。所以 simnet 的 500,000/维度上限与主网同口径。单 tx 质量上限来源：`check_transaction_standard.rs:21-46` 注释明写 Toccata 后 "block-fit limits … remain the only per-tx mass ceiling"（`MAXIMUM_STANDARD_TRANSACTION_MASS_PRE_TOCCATA=100_000` 已在主网窗口关闭）。

### 2.1 J2 手算与真值的差异（`scripts/j2_vs_node_4tx.mjs`、`fuzz_j2_vs_exact.mjs`、`fuzz2.mjs`）

- J2 `handComputeStorageMass` 在 4 笔真实交易上 = 节点值（含 genesis，因单输入时 harmonic≡arithmetic）。
- **缺 relaxed 分支**（`proto-mass-ceiling.mjs` 只实现 arithmetic）。由 Cauchy–Schwarz：harmonic 输入信用 ≥ arithmetic 信用 ⇒ relaxed 形状下 J2 值 ≥ 真值（保守）。按路径分表（`fuzz_j2_vs_exact`，40 万随机形状，面值 1e3–3e12）：**arithmetic 路径 338,084 例全等、0 低估；低估只出现在 relaxed 路径（224/47,470），且最大的一例出现在真值 ~1.7e9 的退化形状，与 500k 门槛无关。** 限定 realistic 面值（1e6–3e12 sompi，`fuzz2`，150 万形状）：低估共 74 例，真值 ≤2M 时最大低估 2 个 mass 单位（整数除法取整）；"J2 < 475,000 而真值 ≥ 500,000"的假放行 0 例。（`fuzz2` 未按路径分表，"全在 relaxed"一条只对 `fuzz_j2_vs_exact` 成立。）
- 反向代价：relaxed 形状下 J2 会**高估**（14,222/47,470），是假阳性（挡掉本可接受的交易）。当前 3 个已验证形状不走 relaxed（输入 plurality 和 ≥3），后续批次若出现单输入/单输出形状就会踩到。
- **J2 `handCompute` 偏低的原因不是"未独立验证"这么含糊，而是精确等于漏了 tx 序列化大小项**：`handComputeComputeMass(0, …)` 把 size 传 0。节点值 − J2 值 = 18,457 / 21,728 / 38,322，恰是各交易的 `estimated_serialized_size`（3/3 逐位）。

### 2.2 fee 与 mass 的耦合（观察，未实验）

`computeRequiredFeeSompiOrThrow`（`proto-tx-assembly.mjs:76-90`）= 本地 wasm `calculateTransactionMass` × 100。节点的 mempool 最低费按 `max(compute_mass, normalized_transient)` × 100_000/1000（`check_transaction_standard.rs:140-176`，`config.rs:23` `DEFAULT_MINIMUM_RELAY_TRANSACTION_FEE=100_000`）；transient = size×4（`constants.rs:36`），post-Toccata 归一系数 0.5。按此估：

| 交易 | 实付 fee | 节点 relay 最低费(估) | 倍数 |
|---|---|---|---|
| register_append#1 | 43,339,900 | ≈3,691,400（max(33,927, 18,457×4×0.5)=36,914） | ≈11.7× |
| market_seal | 34,386,000 | ≈7,664,400（max(60,422, 38,322×4×0.5)=76,644） | ≈4.5× |

且多付的 fee 直接缩小 change 输出，storage mass 的调和项 ∝ C/change：bet1 若 fee 取最低费附近，change ≈51.3M，storage ≈ 391,231（78.2%，`scripts/whatif_bet1_fee.mjs`），而非 457,504（91.5%）。**这是"mass 卡点"的一个根因线索：不是形状本身逼近上限，而是 fee 定价用了偏高的本地 mass。** 但矿工按 feerate 选块是否把 storage mass 计入优先级、最低费之上要留多少余量，我没有在节点上验证，**只作假设提交，未验证，不得直接落码**；需要 simnet 上的 fee 阶梯实验（提交前先通知 J2）。

## 3. 对 mass 断言改法 D1–D5 的 verdict

- **D1 门控只用手算 storage、阈值 475,000 不变 — PASS，附 3 个条件**：① 补 relaxed 分支（约 10 行，我的 `calcStorageMass` 可直接作参照实现），使其**精确**而非"保守近似"；② 回归夹具用链上 4 笔真实交易（`onchain_txs_with_parents.simnet.json` 是从节点取回的父交易+本交易，测试里由输入端 UTXO 现算 plurality/amount，而不是手填）；③ 每个新 kind 的 `inputPluralities` 必须来自 UTXO 事实（spk 长度 + 是否带 covenant），不是槽位常量硬编码。
- **D2 localMass 降为诊断项 — PASS**。攻击面（我试过的）：fee UTXO 面值（进入 change 值 ⇒ 已被精确公式覆盖）；输出个数（读自 tx 对象）；见证大小（只影响 compute，不影响 storage）；plurality（输出侧读自 tx，输入侧 covenant 输入 p=2 与链上一致；若 fee 输入误为 covenant UTXO，J2 估值只会偏高）。唯一能让手算低估的方向是**输入 amount 被调用方低估**（信用 ∝ 1/Σa），即 builder 传入的 `held.value` / `feeUtxo.value` 与链上 UTXO 真实值不一致——这种情形整笔交易本身就不成立（隐含费与真实不符，节点拒），不构成绕过，但建议在 builder 里把输入 amount 与 relay 的 UTXO 快照做一次相等断言。损失面：超限 tx 节点直接拒收，不丢钱；作门控它只有假阳性代价（已经在 register_append#1 发生过一次：链停）。
- **D3 compute 无独立守卫的措辞 — 措辞诚实，但可以做得更好**：J2 说"手算 compute 偏低且未独立验证"是对的，但缺口的全部原因是漏 size 项；我已按源码移植并 4/4 对上节点，**建议直接换成精确 compute 守卫**（tx size 用含签名的上界：fee 输入 sigScript 在断言时为空、签名后 +66 B）。若 J2 仍选"不守"，措辞需写明：实测最大 compute=60,422（占 500,000 的 12.1%），compute 随见证大小增长（本批 sigScript ≈35 KB），未来带 Merkle 证明的 claim 类批次可能显著增大，所以"不守"只对已测的 4 个形状成立。
- **D4 阈值 / relay 1.0 KAS 硬顶不动 — PASS**（relay 硬顶是 fee 上限，与 mass 门控无耦合）。
- **D5 验收向量 — PASS，附补充**：85M(994,327)/90M(518,872) 拒、95M(457,504)/100M(435,000) 过，我用移植公式在近似 fee（≈43.3–43.4M，J2 各行精确 fee 未知）下重推：85M→989,287、90M→518,786、100M→434,880（`scripts/whatif_bet1_fee.mjs`），与 J2 的 994,327 / 518,872 / 435,000 量级与方向一致（差 ≤0.5%，**不是逐位复现**）。再加：market_genesis 作 relaxed 路径向量；`fuzz2` 的随机形状对拍作属性测试；`sentinel` 见证向量。
- **Q4 形状超出已验证三个之外**：storage 公式是形状通用的（我的移植是逐行源码），**不因"未验证形状"拒绝**；该拒的是 `inputPluralities` 缺失/不可推导（现有的长度校验已做）。新 kind 首次 simnet 提交时，D-022 证据里必须同时记录"断言给出的 storage/compute 信号"与"节点值"，两者不等即回头修公式。compute 若仍不守，每个新 kind 必须把 compute 实测占比写进 provenance。

## 4. 其他 finding（对 J2 批 3/4 与 cb5fd9e1）

- **F1（已由 J2 落码）** `heldInput=null` ⇒ `tokenInIdx=-1` 编进见证（原 `proto-tx-assembly-settlement.mjs:73-74,108`）。共识必拒不丢钱，应构造期 fail-closed。`cb5fd9e1` 已修（throw）。
- **F2（已由 J2 落码，覆盖度我判"当前够，长期不够"）** `sealWitnessArgs` 纯函数 + `tokenIn≠tokenOut` 向量。三层覆盖：(a) 编码器位置映射——我的哨兵实验证明与上游逐字节相等；(b) `sealWitnessArgs` 内部映射——J2 的单测；(c) 调用点 `heldIdx: heldIdx` 的来源——**当前无任何测试或共识能区分**，但在固定布局 `[leaf, held, fee]` 下 `heldIdx≡1≡MARKET_SEAL_TOKEN_OUT_INDEX`，行为上惰性。风险在布局改变（多 held / 换序）之后：建议在 builder 里加结构断言——`inputs[tokenInIdx]` 必须花的是 `heldInput` 的 outpoint、`outputs[tokenOutIdx]` 的 spk 必须是 token 输出——让布局一变就大声失败，而不是靠"两者恰好都是 1"。后续批次（close_commit 等）的每个 witness-arg 映射都应该配一条"全部索引参数两两不同"的哨兵测试。
- **F3 fee 上限 1.0 KAS（Codex #2 / Bettor 点名）——判：可接受为有界临时值，附条件。** 事实：`dynamicNetLossCeiling = min(2×requiredFee, 该 kind cap, GLOBAL 1.0 KAS)`（`proto-tx-assembly.mjs:161-166`），所以借用来的 1.0 KAS 不是起作用的约束，起作用的是 `2×requiredFee`；1.0 KAS 只是背板，另有 relay 侧 `SIGNED_INPUT_CEILING_SOMPI` 与 GLOBAL 硬顶。实测 market_seal 实付 34,386,000（0.344 KAS），上限约 0.69 KAS。条件：(1) 合入主线前 `feeProfile.market_seal.cap` 换成按节点实测的专属数字（≈ 上述 fee 阶梯实验后的结论）；(2) relay 侧硬顶不动；(3) 必须知道 `requiredFee` 本身来自偏高的本地 wasm mass，所以 `2×requiredFee` 是个偏松的动态上限。主网 relay 仅约 4.09 KAS，每步 ≈0.34–0.43 KAS 的实付对 5+ 步结算是可见成本（见 §2.2）。
- **F4** `assertMassWithinCeiling` 在 fee 输入签名之前执行（sigScript 空），compute 少算 66 B（`proto-tx-assembly-settlement.mjs`，`inputs[feeIdx]` 的 `new Uint8Array(0)`）。目前无实际影响（compute 占比 12%），随 D3 精确化时顺手计入。
- **F5** `selectChangeShape` 注释 "先占位建一次量 mass（与找零【值】无关，只与结构有关）"（`proto-tx-assembly.mjs:195-197`）对 storage mass 不成立（storage ∝ C/change）：fee 是用 change=leftover 的 draft 算的，最终 change 更小，最终 tx 的本地 mass 更高（bet1：实付 fee 对应 draft mass 433,399，最终本地 mass 500,980）。这解释了为何 fee 与最终 mass 不匹配；不是安全问题，是注释/推理不成立。
- **F6 Codex 同意点**：`bettorPk=committeePubkeys[0]` 属实（`src/api/proto.js:214`），MUST-PROVE 公钥相等断言仍须落在 claim_draw/withdraw/ticket_reclaim 之前；本审未涉及该批（尚未落码），无新意见。

## 5. 对 Codex `RESPONSE-20260919-ACTIVE-LINE-D022-BATCH3-BETTORPK-D023-CODEX-REVIEW` 的对照

| Codex 点 | 我的独立结论 |
|---|---|
| ① bettorPk 来源缩窄但不豁免 | 同意，且我独立读到 `proto.js:214`。公钥相等断言 + 正反回归仍是硬前置。 |
| ② 批 3 未清主线：离线 8/8 只是构造证据；须 pinned 2.0.1 simnet 精确字节 | Codex 写时（账本 1500 语境）J2 的 simnet 真跑证据尚未入账；现已存在（`30d7e951`，4 步 ACCEPT）。我独立核了：节点 sha256/--version、txid 在链上、见证字节对上游编码器逐字节相等、重编 redeem 逐字节相等。**这满足 D-022 "生产字节→pinned 2.0.1 simnet" 一环**；仍需明确的是"落链那份字节 = 当前分支头 builder 的输出"——J2 `cb5fd9e1` 的黄金回归正是为此（期望字节取自链上，非 builder 输出）。所以批 3 我给 **合入闸 GREEN（条件：主线合入仍走 Bettor/Owner 闸，fee cap 条件见 F3）**。 |
| ②' 1.0 KAS 借用 cap 只作有界临时值 | 同意，见 F3 的四条判据与条件。 |
| ③ D-023 不授权资金路径激活 | 同意，我未接触。 |
| ④ 5 槽同签名 ≠ 4-of-5 门限；仍未证 distinct-key | 同意，批 4 close_commit 的"v0 单操作员 5 槽同一 keypair"如实标注即可，我没有测 distinct-key，本审不得据此外推。 |

## 6. 未验证 / 限制（不许漂成"全栈闭环"）

- 仅 simnet 数据，仅 4 个形状；`close_commit`（批 4）builder 我没有做字节级独立验证（无链上样本）。
- 编码腿 3 用的是 eprintln 诊断构建，不是 versioned-builds 里的干净 debugger；encode 路径未改（git diff 核过），但**这条腿的独立性依赖于该 diff 只有 eprintln 的事实**。
- ctor 的 `market_id`/`ps_tmpl_hash`/`token_tmpl_hash` 取自链上 redeem 与仓库 anchors 文件；最终以"重编 bytecode 逐字节等于链上 redeem"为准（已做）。
- 没有在节点上做突变 / 负向提交（比如翻一个 nibble 是否被拒）：本次不向 simnet 提交任何交易。负向的"牙"来自 J2 自己的 cb5fd9e1 负向对照，未经我重跑。
- 落链字节与分支头 builder 输出的等价：由 cb5fd9e1 黄金回归夹具承担（未由我重跑）。
- §2.2 fee 阶梯是假设，未验证。

## 7. 复现

所有脚本在 `scripts/`，输出在 `run-output.txt`，节点取回的原始交易在 `onchain_txs_with_parents.simnet.json`。脚本里有绝对路径（`D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/`），需要 `npm ci --ignore-scripts` 后的 kaspa-wasm 与 `@noble/hashes`；节点取回脚本需 simnet 节点在 `ws://127.0.0.1:18510` 运行。
