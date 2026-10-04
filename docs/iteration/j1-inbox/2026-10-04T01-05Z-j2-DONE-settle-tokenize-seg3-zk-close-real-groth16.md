# J2 段3 交件：zk_close 代币化 + 真 Groth16 simnet 真共识（账本 1832 段3）

分支 `coord/j2-pm-settle-tokenize-20261004`（只追加提交：`4bafb225`、`573de9cb` + 本交件提交）。证据 `docs/provenance/2026-10-04-j2-settle-tokenize-seg3/`。
simnet = 官方 kaspad 2.0.1。**未碰主网 env/代码/钱、未重启主网进程**（主网 kaspad 4752、console 3436 全程未动；我的 simnet kaspad/console/4 miner/WSL 常驻看门狗已停；relay `api.mjs` simnet 补丁已 `git checkout` 还原未提交）。仅合并，不部署。

## 0. 结论
**段3 通过：真 RISC0 Groth16（WSL + Docker，串行，常驻 memwatch）→ gate 注资 → `zk_close` 在官方 2.0.1 真共识上通过**（computeBudget 1560）。run2 为正式证据（`seg3_zkclose_run2.log.txt`），其间 **handoff 由生产自治 tick 完成、prove 由生产 worker 完成**（首次在 simnet 上自治走到这一步）；zk_close 的诚实广播走生产 admin 端点（`/api/admin/pool/zk-close-v2` → `dispatchUnlockZkClose` → `bshard_zk_close`），**未开 `ZK_CLOSE_TICK_V2_ENABLED`**（tick 与端点同走 `dispatchUnlockZkClose`，未单独演练）。
**真跑还抓出一个会烧钱的缺陷（gate 面值整枚烧毁，检查单 #6），已修并在 run2 真共识复验。**

## 1. 改动
- **relay `unlockBshardZkClose`（`p2sh.mjs`）重写**（旧版：裸选择器 `'00'`、无 tok 见证、续约输出值=consolidatedPool(KAS)、无 CovenantBinding、无找零）：
  - inputs `[0 CloseZkV2(zk_close, 无签) | 1 gate(真 Groth16 sigScript, 预算 1560)]`；outputs `[0 CloseZkV2 续约(closed 1→2, payoutRootField=guestPayoutRoot, 面值原样=dust, CovenantBinding(0, 本实例 cov id)) | 1 找零 = gate 面值 − 25M 固定费]`。
  - zk_close 不动代币（`noTokenInput`）：池代币 UTXO（owner=CloseZkV2 cov）原封不动，等 claim。
  - 当前状态从活 redeem 固定布局现读（不信 caller 的 state；与 caller 传的 `consolidated_pool` 不一致即拒）；`closed != 1` 拒。v1.0.0 action = `addData(gateSuffix) addData(guestPayoutRoot) addI64(selfOutIdx) addData(tok_prefix) addData(tok_suffix) + dispatch tag`；新增 `dry_run`（逐输入/输出真实字节 + prev outpoint，供 cli-debugger）。
  - **复用**：段1/2 的 `_combineActionAndRedeem`、`_psInputCovId`、`_appendChange`、`ScriptBuilder` 编码、`settleDispatchTags`（加 `zk_close`）、旧版的 splice 续约公式（213B 状态区）原样保留；**不能复用**：旧的 KAS 价值输出/无绑定/无找零。
- **`_ZK_GATE_COMPUTE_BUDGET` 1500 → 1560。依据**：同 gate 真 RISC0 Groth16 receipt 在官方 2.0.1 上 1500 被拒（`used=15502875 > limit=15009999`）；OpZkPrecompile 验证耗 15,502,875 units，预算 N 给 `N×10000+9999` ⇒ N ≥ 1551（Bettor 要求 ≥1552；1552 在上一轮 `gate_spend` 实测过）；取 1560 ≈ +0.6% 余量。CloseZkV2 输入预算 200（未最小化）。
- **找零（检查单 #6）**：run1 真跑实测 zk_close 交易**只有 1 个输出**——dispatch 没传 `change_address`，`_appendChange` 静默不加找零，**整枚 gate（1 KAS）烧作矿工费**（simnet 上烧了 1 KAS，证据 `run1_gate_burned_no_change/`）。修：找零地址缺省 = relay 钱包地址，两者皆无 ⇒ fail-loud。run2 复验：输出 1 = 找零 `75000000`（= 100000000 − 25000000）。
- **`valueSompi` 拆分（Bettor 要求）**：`zk_continuation.valueSompi` 语义固定为【代币池（token 单位）】，新增 `utxoValueSompi` = 续约 UTXO 的 KAS 面值（dust）。写入点：handoff（`bshard-close-transport`）、zk_close 自治 tick 与 admin 端点（`advanceZkContinuationAfterSpend` 带入）；读取点：dispatch 的 `consolidated_pool` 仍取 `valueSompi`（token 池，且 relay 以活 redeem 现读并交叉核对）、`rehearsal-pre-broadcast-gate` 的 UTXO 面值改取 `utxoValueSompi`。relay handoff 返回 `utxoValueSompi`。
- 侧修（派工点名）：`bshard-settle-daemon` 的 `apiTransfer` 带 `x-kanet-admin-secret`（`ADMIN_SECRET_FUNDS` 已设时不再 403，同 relay.js 该 tier）；`p2pkAddr`/`_p2pkAddrSync` 由硬编码 `NetworkType.Testnet` 改 `configuredNetwork()`（我核了 kaspa-wasm `toAddress` 对 `mainnet/simnet/testnet-12` 返回 `kaspa:/kaspasim:/kaspatest:`）。这两处属 V1 委员会老路径，**无单测、未真跑**（V1 本轮范围外），只做了语法与映射核对。检查单 #5（FEE=settler）是 env 配置不是代码：simnet 里 `BSHARD_SETTLER_RELAY_ID` = `SETTLE_DAEMON_FEE_RELAY_ID` = settler，主网 env 块已在上一轮给过。

## 2. 真共识证据（run2，市场 `ext-pool-v07-1791073817312-8gmuv`，单片 3e9）
前置全自治：judge+propose → consolidate → 委员签 → close_attest → **handoff tick（自治）** → **prove worker 出证**（RISC0 imageId `c9918501…`，WSL+Docker Groth16）→ gate `e136a339…:0` 注资 1 KAS → `proving.status=ready`。
- **负向**（同一未动状态；`dbg_Z*.out.txt` + 真共识）：

| 用例 | 篡改 | 共识 | cli-debugger（`CloseZkV2.sil`） |
|---|---|---|---|
| Z1 | guestPayoutRoot 末字节翻转 | 拒 `script ran, but verification failed` | **:109** `require(tx.inputs[1].scriptPubKey == P2SH(gateRedeemHash))`（journal 绑定了 payoutRoot）|
| Z2 | gate_suffix 末字节翻转 | 拒 同上 | **:106** `require(blake2b(gatePrefix+gateSuffix) == gateTmplHash)` |
| Z3 | Groth16 proof 中间字节翻转 | 拒 `false stack entry at end of script execution`（gate 输入内 OpZkPrecompile 验证失败）| 无（debugger 不执行 gate 输入）|
负向后 CloseZkV2/gate UTXO 各仍 1 笔。
- **诚实**：tx **`adcecacd703870a5b0137e6faeb3b7aa5307bae2ec1d42675e53ebd770ca3814`**（块 `602c37ad…`，DAA 30031；按块读 `seg3_post.json`）：输入 [CloseZkV2 17256B/预算200 | gate 966B/**预算1560**]；输出 [0 续约 20000000 covenant `acf6ac5c…` authInput 0（**== handoff 输出 0 的 CloseZkV2 cov id，同一 covenant 延续**）| 1 找零 75000000]。
- **读回（按 UTXO）**：旧 CloseZkV2(closed=1) UTXO 0、gate UTXO 0；新 CloseZkV2 UTXO 1 笔(20000000)，续约 state `closed=2`、`payoutRootField=b8dec685…` **== proving.guestPayoutRoot**；**池代币 UTXO 原封不动**（`fc9e1577…:1`，由 handoff 输出的 cov id 派生地址读到，amount 同前）；`zk_continuation`：`valueSompi=3000000000`（代币池）、`utxoValueSompi=20000000`、`poolAtZkCloseSompi=3000000000`。
- run1（`run1_gate_burned_no_change/`）同流程第一次真跑：4 项结论一致，**但暴露 gate 整枚烧毁**；修后 run2 复验。

## 3. 真 Groth16 / 内存纪律（Bettor 要求：串行 + memwatch）
- 全程**同一时刻只有一个证明在跑**；WSL 里常驻 `zk_memwatch_persistent.sh`（`MemAvailable < 1200MB` 杀 r0vm/host，沿用上轮阈值），日志 `memwatch.log`。
- **诚实记录：4 次出证尝试里 2 次被我的看门狗杀掉**（`MemAvailable=1090MB`、`1047MB`，均发生在 STARK→Groth16 的 Docker 阶段，MemAvailable 在 ~6s 内从 ~4–6GB 掉到 ~1GB），**另 2 次通过**（最低 `1336MB`、`1303MB`）。与 KANet-UI 的实测（最低 1315MB）同量级、贴着 1200 阈值，**结果取决于当时 WSL 其它进程占用（vLLM/avatarforcing 在同 VM）**。被杀的 job 我手工重置回 pending（simnet DB 改 `zk_prove_jobs.status`，harness 操作，未改生产代码）。
- **建议（需 Bettor 定，我不擅改阈值）**：主网上出证应在 WSL 空闲窗口跑，或把阈值/重试策略定成明确规则（现 worker 对被杀 job 直接标 failed，不自动重试）；若要自动化，需要 worker 侧重试 + 出证前读 MemAvailable 的门。
- 顺带发现：被杀那次 worker 日志里能看到 `Compiling hyper/tokio…`——host 二进制过期时 `cargo run` 会现场编译依赖（占内存且慢）；本机用已编译的 `_j2_wt_pm_e2e/zk-payout-guest` 目录（`ZK_PAYOUT_GUEST_HOST_DIR`）。主网部署需保证 host 已预编译。

## 4. 单测 / lint
- `propose-predicate-commit-anchor.test.mjs`（含 `settleDispatchTags` 5 入口互异）、`own-redeem-len`、`closezk-v2-mint.e2e/ctor-position` ALL PASS；lint 0 errors。
- ⚠ `zk-close-dispatch.test.mjs` 在**未改动的主线 checkout 上同样失败**（`gateTmplHash 配置漂移: 烤死 4ec7ca3d… != 本机测试环境现算 24d69e33…`），属测试环境（kaspaZk 加载路径）问题，非本改动；simnet 真跑里 `ensureGateTmplHashFresh(force:true)` 通过（env `ZK_GATE_TMPL_HASH=4ec7ca3d…`）。我没有为 `unlockBshardZkClose` 写离线单测（依赖 RPC/真 gate），其行为由真共识证据覆盖。

## 5. 未做 / 交接段4 / 需拍板
1. 段4 未动：`unlockCloseZkV2Claim`/`EscapeTrigger`/`EscapeClaim`、`unlockBshardRefundClaim`/`CancelAttest`（仍旧形）、`zk-autonomy-ticks.mjs:214-216` claim 后 `valueSompi = newPool`（现在语义=代币池，是对的；但 claim 续约的 `utxoValueSompi` 需沿用）、`rehearsal-pre-broadcast-gate` 的 claim 门（25 参数旧 ctor）。**池代币现在躺在 `fc9e1577…:1`（owner=CloseZkV2 cov），claim 要消费它。**
2. 找零已修；gate 注资默认仍 1 KAS（`ZK_GATE_FUND_SOMPI`），zk_close 后回收 0.75 KAS，**净成本 0.25 KAS/盘**（固定费 25M，未按 mass 精算；≥0.157 KAS 是节点下限）。
3. 自治 zk_close tick 未演练（见 §0）；prove worker 对被杀 job 的重试策略（见 §3）需拍板。

## 6. 复现
harness 同段1/段2；console env 额外：`ZK_HANDOFF_TICK_ENABLED=1 ZK_PROVE_WORKER_ENABLED=1 ADMIN_ZK_CLOSE_V2_ENABLED=1 ADMIN_SECRET_ZK_CLOSE_BROADCAST=… ZK_PAYOUT_GUEST_HOST_DIR=<已预编译 host 目录>`（**不开** `ZK_CLOSE_TICK_V2_ENABLED`）；**市场必须单片**（只跑 `s2_create` + `s3_bets`，不跑 `s4`）；WSL 起 `zk_memwatch_persistent.sh`；`seg3_zkclose.mjs`（等 proving ready → 负向 → 诚实 → 读回）→ `seg3_post.mjs <handoffTx> <closeTx> <pool>`（块扫描 + 池代币读回）。
