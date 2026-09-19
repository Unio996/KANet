# 批 4 `close_commit`（J2 51b5133a）离线审 — NWT 2026-09-19

范围：Bettor 批准的**离线审**（deadline/CLTV 逻辑、签名来源、5 槽同签名不得外推）。**不给字节层面结论**（链上样本还没有，J2 未上 simnet）；没有向任何节点提交交易。
被审：`proto-tx-assembly-settlement.mjs` 的 `buildCloseCommitTxJson`、`proto-close-commit-witness.mjs`、`RootClose.sil` 的 `close_commit`/`refund_flip`。审时在 c0ed02f3（含 51b5133a）。

## 结论

**批 4 当前不能过 simnet：`close_commit` 会被共识拒绝。** B4-1 是阻断项，一行可修。其余为设计/运维层观察。

## B4-1（阻断 / HIGH）委员签名对最终 tx 的 sighash 无效——先签后挂 covenant

- 证据 1（代码时序）：`buildCloseCommitTxJson` 的 `mkTx` 里，`outputs` 数组创建时没有 covenant；`presignTx` 用它建出来、`kaspa.createInputSignature(presignTx, 0, …, SighashType.All)` 立刻签名；**之后**才 `t.outputs[0].covenant = new kaspa.CovenantBinding(0, …)`（同函数后半）。`scripts/presign_covenant_probe.mjs` 证明 wasm 里两个 Transaction 共享底层 output 对象，所以签名时刻 covenant 是空的、签完之后才有。
- 证据 2（共识）：`consensus/core/src/hashing/sighash.rs:233-235`（`hash_output`，v2.0.1 = `cfafeb4c`）在 `tx.version>=1` 时把 `output.covenant.is_some()`、`authorizing_input`、`covenant_id` 写进 outputs hash，进入 `calc_schnorr_signature_hash`。⇒ 签名承诺的是"output0 没有 covenant"的 tx，最终 tx 有 covenant，sighash 不同。
- 证据 3（对 J2 真实 builder 输出的直接验证）：`nwt_cc_sig_probe.test.mjs.txt` 是 J2 测试文件的副本 + 我追加的一条断言（**没改 J2 任何代码**，在我自己 worktree 里跑）：从 `closeCommitBuilt.txJson` 里取出 5 个委员签名，用我按 sighash.rs 移植的 sighash（`scripts/sighash_port.mjs`，先用 wasm 签名自检：同 tx 验真、去掉 covenant 验假）和 `@noble/curves` schnorr 验：**对最终 tx：`[false,false,false,false,false]`；对"去掉 output0 covenant 的同一 tx"：`[true,true,true,true,true]`**。J2 的 16/16 测试没有一条验签，所以全绿。
- 证据 4（上游 VM）：`scripts/cc_sig_experiment.mjs` 用 patched cli-debugger 跑 `RootClose.close_commit`（5 槽同一一次性测试密钥）：
  A 对照（tx 无 covenant、签名按无 covenant）= PASS（说明我复刻的其余 sighash 承诺字段都对得上）；
  **B（J2 时序：签名按无 covenant，最终 tx 有 covenant）= 失败于 `require(validSigs >= 4)`**；
  C（先挂 covenant 再签）= PASS。
- 后果：`validSigs=0 < 4` ⇒ 节点拒；不丢钱，但链停在 close_commit（结算主路径）。
- 修法：`fix-close-commit-covenant-before-presign.patch`——在建 `presignTx` 前给 `outputs[0]` 挂上 `CovenantBinding(0, rootCloseCovId)`。我在自己 worktree 里做了这一行的临时实验（已还原，未提交）：探针结果变为 `对最终 tx: [true×5]`、`去 covenant: [false×5]`。
- 回归要求：批 4 测试必须**验签**（推荐直接复用我的 `sighash_port.mjs`），且带反向臂（去掉 covenant 后必须验假）。结构性教训：凡是"先签后改 tx"的构造顺序都要用**验签**来测，txid 相等测不出来（签名不进 txid）。

## B4-2（中）deadline/CLTV：本地时钟守卫是单边代理，缺余量

- 事实：合约 `tx.time >= temporal(deadline_ms)` 是 CLTV；builder 设 `lockTime = BigInt(deadlineMs)`（时间戳域，`deadlineMs>=5e11`，市场创建处 `proto.js:114-115` 用 `Date.parse` 保证 ms 域）、所有输入 `sequence=0`（CLTV 要求 sequence≠MAX ✓）。
- 节点的 finality 比较是 `tx.lock_time < context_time`（严格小于，`tx_validation_in_header_context.rs`），其中 `context_time` 是块头 past-median-time，比本机墙钟滞后。builder 只校验 `Date.now() >= deadlineMs`。⇒ 在 `[deadline, deadline+pmt 滞后+时钟偏差)` 内提交，本地放行、节点以 NotFinalized 拒。不丢钱，只是重试；但如果状态机把"被拒"记成 ambiguous，会留残留。
- 建议：(a) builder 守卫加固定余量（≥120 s，具体值由 simnet 实测 pmt 滞后后定）；(b) 提交侧把 NotFinalized 分类为"可重试、无状态变更"，不进 ambiguous。
- 另注意：`RootClose.close_commit` 的合法窗口不是无限的——见 B4-3。

## B4-3（中/运维）`refund_flip` 不需要任何签名：deadline+2h 后任何人可把市场翻成取消

- `RootClose.sil` `refund_flip`：只 `require(closed==0)`、`noTokenInput`、`tx.time >= temporal(deadline_ms+7200000)`，**没有 checkSig**。所以 close_commit 必须在 `deadline+2h` 之前落链，否则任何观察者都能发一笔公开交易把 `closed 0→2`（取消/退款路径），且 close_commit 之后再也进不来（write-once 锁）。
- 对照 Owner 的"只 settle 不 refund"先例：结算驱动的 SLA 必须写成"deadline 起 2h 内完成 close_commit"，并且监控要在 deadline+1h 报警。这不是 builder 缺陷，是设计属性，需要进运维口径。

## B4-4（中/设计）builder 是"任意结果的签名预言机"

- `buildCloseCommitTxJson` 接收调用方给的 `newWinningSide`、`newPayoutRootHex`，5 槽自动签名，**builder 内部不核对**：胜方是否等于市场的裁决结果、payoutRoot 是否由 `proto_bets` 现算且 Σpayouts==pool_value。这些必须在调用方（结算意图状态机/ingest）里由 DB 派生并断言。verify-value-source 口径：`newPayoutRootHex` 目前的来源是"调用方参数"，checker（合约）在链上读不到对应 binding（合约只保证格式，不保证与下注一致）。
- 建议：批 4 的落码说明里写清"结果值来源不在本 builder"，并在状态机侧加一条断言测试：payoutRoot = merkle(现算) 且与 `proto_bets` 汇总一致，否则拒绝调用 builder。

## B4-5（低）当前 RootClose 的 spk 与真实 UTXO 未做相等断言

`rcSpkCurrent` 由 `sealedState` 现算；`rootCloseOutpoint` 没有携带链上 spk。`sealedState` 与链上不符时，节点拒（P2SH 不匹配），不丢钱。建议 builder 入口加 `assert p2sh(currentArtifact.script) == 链上 UTXO 的 spk`（输入 amount/spk 与 relay 快照相等断言与批 3 的建议同一处）。

## B4-6（信息）5 槽同签名的如实标注

- builder 头注（`buildCloseCommitTxJson` 文档块）已如实写"5 槽同一把委员 keypair 重复 5 次…只是原型形状证据，不得外推 4-of-5 门限安全结论"，与 Codex 意见一致。我复核：合约 `committee_hash = blake2b(c0..c4)` 对 5 个相同 pubkey 成立（我在调试器里用 5 个相同 pubkey 的夹具跑通了 R8 与 5 次 `checkSig`），所以形状上可行；它证明的只是"合约逻辑可执行"，不是"4-of-5 抗共谋"。
- 建议：结算意图记录/账本/接口响应里带一个显式标签，例如 `committee_mode='single_operator_5x_same_key'`，避免下游把 close_commit 成功读成门限安全。目前只有代码注释。

## B4-7（低）私钥对象

`new kaspa.PrivateKey(committeePrivHex)` 在 `mkTx` 内每次候选建一次，没有 `.free()`；解密后的 hex 字符串留在 JS 堆到 GC。不落盘不入日志（测试 ⑦ 覆盖返回值不含私钥）。建议使用后 `free()`，并在 `finally` 里覆盖引用。

## 不在本审范围 / 未验证

- `close_commit` 字节层：无链上样本，**未做**；等 J2 上 simnet 后按批 3 同法（自写解析器 + 上游编码器 + pinned silverc 重编）再做。
- `sequence`/`lockTime` 的节点侧接受与否：未在节点上实测。
- mass：inputPluralities `[2n,1n]` 与实际一致，形状 arithmetic 路径，J2 公式在此路径精确。
- 本审的验证基于：共识源码移植 + 上游 VM（debugger）+ J2 builder 真实输出的验签，**不是节点实测**。

## 复现

`scripts/`（`cc_fixture.mjs`、`cc_sig_experiment.mjs`、`sighash_port.mjs`、`presign_covenant_probe.mjs`），`batch4/nwt_cc_sig_probe.test.mjs.txt`（放到 `kasia-console/src/lib/` 下、去掉 `.txt` 运行，需要 `npm ci` + `npm rebuild better-sqlite3`），`batch4/run-output-batch4.txt`。

## 修后复核（J2 1a6440b4，NWT 独立复现）

J2 的 B4-1 修法 = 我的一行（签名前先给 `outputs[0]` 挂 `CovenantBinding`）。我在自己的 review worktree（`scratch/_nwt_wt_j2_7f1e339b` 检出 1a6440b4，独立 `npm ci`）里独立复现，**没有用 J2 的报告**：

- 把 J2 测试文件的副本追加一条断言（`nwt_vm_probe_after_fix_1a6440b4.test.mjs.txt`）：取 `closeCommitBuilt.txJson` 的真实 tx 与其中真实委员签名，还原成 patched cli-debugger 夹具（真实 prev outpoint / 金额 / lockTime / 输出 spk 与 covenant / ctor 由 `computeRootCloseGenesisArtifact` 给出），让上游 VM 执行 `RootClose.close_commit`：
  - **正向臂（output0 带 covenant，真实签名）= PASS**（整条入口跑通：`closed==0`、`noTokenInput`、CLTV `tx.time>=temporal(deadline_ms)`、R8 committee_hash、5 次 `checkSig`、`validateOutputState`）。
  - **反向臂（同一批签名，夹具里去掉 output0 covenant）= 失败于 `require(validSigs>=4)`**，证明签名确实绑定 covenant。
  - 自移植 sighash：最终 tx `[true×5]`，去 covenant `[false×5]`。
- 整个测试文件 39/39（含我的探针）。
- 局限：VM 是 debugger（只执行 active input），CLTV 只验了脚本层；节点侧 finality（`lock_time < pmt`）与 mempool 接受仍要等 J2 上 simnet 后实测。
