# oracle simnet e2e 基础轮 provenance —— 四臂 H / D / F / A(J2 · 2026-09-21)

> ## 🔴 更正记录(2026-09-21 · NWT 复核 b804c805 / 账本 1616 三处更正采纳;原文保留、此处与行内已改;原始 evidence 文件一字未动)
> ① **时钟**:§3 及下文凡写"冻结 18:47:58Z"处,那是 `settlement_frozen_at` 存的 **pmt 读数**(`frozen_reason` 的 `clock=pmt`),**墙钟写入时刻 = 18:52:29.9Z**(`actions.jsonl` `emergency_freeze_harness`,pmt 落后墙钟约 4.5 分钟)。`readback-final.txt` 里 `settlement_frozen_at_iso` 字段名易误读为墙钟——它是 pmt 域毫秒的 ISO 换算。
> ② **节点侧读回的 idx1**:§3.2 `unspentOutputsFoundOnNode=[{"idx":1,"amount":"77425600"…}]` 是 close 交易的 **fee 找零(P2PK)**,**不是** close 的 covenant 后继 out0。它证明"该交易被节点接受(其输出在 UTXO 集)",不证"covenant 后继落在哪"。out0 已被后续已知意图(convert_to_claim)的字节花掉——新 verify-arms 判据读出 `spent_by_known_tx`。
> ③ **verify-arms F 判据**:旧判据"close_commit 意图=0"在自然竞态下会字面 FAIL(driver 冻结前 1 s 内自然建过一条 pending resolve 行,§3.1 已记),是判据太粗。新判据(`scripts/verify-arms.mjs`,并同步到 J2 scratch 工具)= **意图侧**无 submitted/landed/ambiguous 的 resolve 意图(pending 不算;prepared 本身不判红,F1 修复后 HOLD 态恰是 prepared)+ **节点侧**无该 close txid 痕迹(mempool / 输出仍未花 / 输出已被别的已知意图字节花掉;需 `--rpc … --network simnet`,先断言 networkId,只读 get*)。用新判据重跑(**旧 json 保留,新增 `-v2`**):
> - `verify-arms-pre-seed-v2.json`(F-pre-seed 快照,自然竞态态):**31/31 PASS**——旧判据的那条字面 FAIL 消失(证明它是判据粗,不是缺陷)。
> - `verify-arms-final-v2.json`(终态快照 + 节点):**29 PASS / 2 FAIL / 0 VACUOUS**,两条 FAIL 都在 F 臂且**都是预期的红**:意图侧 `resolve 意图状态=["landed"]`;节点侧 `eb5273995534… 痕迹=["unspent_out1","spent_by_known_tx"]`。
> - 因此本文首段"最终 30 项 = 29 PASS / 1 FAIL"是**旧判据**口径;新口径 = 31 项(F 臂由 1 项拆成 2 项)。

> **范围与口径(先读)**:simnet-only,主网零触碰(主网 console / 库 / env / relay 未读未写)。代码 = 冻结 worktree `c2352d91`(主线,含 oracle A/D/B + 批9结算 + pointers 修 + A① simnet wallet)。
> **本文件 = 证据汇编,不是新结论**:每条断言配原始输出(`actions.jsonl` 原始行 / 库快照读回 / 节点读回 / 驱动日志原行);推断另标"推断"。
> 🔴 **口径限定**(Bettor 1614/1615 · Codex 845ccf6f/df07b0ec):
> ① H 臂只证 normal path 通(集成证据);
> ② D 臂 = **harness 手拼** refund_flip 在 simnet 真共识落地,**只证合约允许该路径,不证 driver 会走**(driver 无 refund_flip 步骤 = N5b 活体证据),D 臂**不算** Codex MUST①/② 证据;
> ③ F 臂 = **F1(MUST①)缺陷红证**,不是绿证,prepared 行由 harness SQL 人造(非自然竞态);
> ④ A 臂 = 放弃臂,与 MUST③(F3/F4)同族,非直接证据;
> ⑤ simnet GRACE=2min/MIN=1min ≠ 主网默认 30/5,证机制不证主网预算;
> ⑥ 单节点单 relay、无对端,`isSynced` 靠 6 个新块翻转(见 §0)。
> **VACUOUS ≠ PASS**:本轮 verify-arms 最终 30 项 = 29 PASS / **1 FAIL(F 臂,预期为红,见 §3)** / 0 VACUOUS(`verify-arms-final.json`)。

## 0. 环境与 P0(actions.jsonl 首行原文)
```
{"at":"2026-09-20T16:53:35.453Z","action":"env_setup","node":"kaspad v2.0.1 simnet --enable-unsynced-mining ports 26510/26610/28510 (data _j2_e2e_run/node-data)","console":"127.0.0.1:3298 (worktree c2352d91, db _j2_e2e_run/console.simnet.db)","relay":"proto-e2e-oracle funded 4x0.99 KAS via one 4-output tx (single coinbase=50 KAS ⇒ cannot mine to relay)","miner":"9-4 miner.mjs 200ms/block, throwaway coinbase, timeout 10800s","p0":"isSynced=false at genesis (DAA 0, sink ts 2021); isSynced=true after 6 fresh blocks; single node no peers","mainnet_untouched":true}
```
- kaspad v2.0.1(`D:\rusty-kaspa-v201\kaspad.exe`)simnet 实例,`--enable-unsynced-mining`,矿工 19:40Z 后停。本轮读回时刻节点状态(`node-time-at-readback.json`,链时停在 daa 52628):
```
{"networkId":"simnet","isSynced":false,"pmtMs":1789932938047,"daa":"52628","wallMs":1790001620821}
```
- ⚠ 读回时刻 `isSynced=false`(矿工停后 sink 时间戳老化)。这正是 P0 探针的意义:driver 遇 `isSynced=false` 不前进,故 simnet 现在**不会**再产生新结算动作;本文件所有"落地"证据都取自矿工在跑的窗口(≤19:40Z)。
- 库快照(拷贝,不读写打开原件):`db-snapshot.sha256`(collect 时刻三文件 sha)。verify/readback 用的工作副本 `console.simnet.db` sha = `267c81b3162df1399aa3c58112260e5b3522427a5e3139e04c5d3a2caa2bc52c`。库本体不入 git(`*.db` gitignored)。

## 1. H 臂(happy:adapter 真 derive → verdict → promote → 结算到底)—— 376ede4b
判定题 LAL–BOS ESPN final(homeWins)+ polymarket prices [1,0] ⇒ extractor / uma 均出 side=1。**winning_side 不是 SQL 写的**,是 adapter 自动写。
- 驱动日志原行(promote + resolve 广播,`run-logs/console-proto-lines.log` 行 154-155、214-215):
```
154: [proto-oracle-adapter] PROMOTED market=376ede4b25f6 winning_side=1 source=extractor verdict=1
155: [proto-oracle-adapter] tick: {"scanned":1,"skipped":{},"verdictsWritten":0,"promoted":[{"id":"376ede4b25f62141671098ffae70a7abf70e0029e8c4bd77a68651df4d3f1d5d","side":1,"source":"extractor","verdictId":1}],"frozen":[],"waited":0,"errors":0,"aborted":null}
214: [relay:proto-e2e-oracle] 9/21/2026, 00:25:06 COVENANT_BROADCAST settle:market:376ede4b25f62141671098ffae70a7abf70e0029e8c4bd77a68651df4d3f1d5d:resolve prepared txid 1728bba7d5cf (bytes persisted at console) → broadcasting
215: [relay:proto-e2e-oracle] 9/21/2026, 00:25:06 COVENANT_BROADCAST(intent settle:market:376ede4b25f62141671098ffae70a7abf70e0029e8c4bd77a68651df4d3f1d5d:resolve) TX: 1728bba7d5cf6ae1c8493293e9699a8d2ca51e4c5b8840ae30da29bda4839380
```
- 库读回(`readback-final.txt` H 段;seal / resolve / convert_to_claim / claim_draw 四意图 **landed**,市场 resolved,ws=1 src=extractor,未冻结):
```
=== H market 376ede4b ===
{"id":"376ede4b25f62141671098ffae70a7abf70e0029e8c4bd77a68651df4d3f1d5d","status":"resolved","winning_side":1,"winning_side_source":"extractor","settlement_frozen_at":null,"frozen_reason":null,"deadline_ms":1789924782266,"outcome_end_ms":1789924182266,"settlement_frozen_at_iso":null,"deadline_iso":"2026-09-20T17:19:42.266Z"}
intent {"intent_key":"settle:market:376ede4b25f62141671098ffae70a7abf70e0029e8c4bd77a68651df4d3f1d5d:seal","step":"seal","status":"landed","prepared_txid":"7016d236c2d2867af7cb25eac1f4c87989e17c622c1e75bbbdf586c63c0ec097","submitted_txid":"7016d236c2d2867af7cb25eac1f4c87989e17c622c1e75bbbdf586c63c0ec097","last_error":null,"created_at":"20
intent {"intent_key":"settle:market:376ede4b25f62141671098ffae70a7abf70e0029e8c4bd77a68651df4d3f1d5d:resolve","step":"resolve","status":"landed","prepared_txid":"1728bba7d5cf6ae1c8493293e9699a8d2ca51e4c5b8840ae30da29bda4839380","submitted_txid":"1728bba7d5cf6ae1c8493293e9699a8d2ca51e4c5b8840ae30da29bda4839380","last_error":null,"created_a
intent {"intent_key":"settle:claim:d677b28b93c8f10c8720b3fb21ef8778ec538403e6d925a36fde086466bab9f7:convert_to_claim","step":"convert_to_claim","status":"landed","prepared_txid":"0ff423db4ea5cea4eb7ff6167df903355b097022d9107a071b25673120e9edb2","submitted_txid":"0ff423db4ea5cea4eb7ff6167df903355b097022d9107a071b25673120e9edb2","last_error
intent {"intent_key":"settle:claim:d677b28b93c8f10c8720b3fb21ef8778ec538403e6d925a36fde086466bab9f7:claim_draw","step":"claim_draw","status":"landed","prepared_txid":"63fc6c8d4cf32a3e07b638cf50c74b5ee603102933fb8b915be9c4f13e503be5","submitted_txid":"63fc6c8d4cf32a3e07b638cf50c74b5ee603102933fb8b915be9c4f13e503be5","last_error":null,"crea
verdict {"id":1,"source_kind":"extractor","outcome":1,"pmt_at":1789924195089}
verdict {"id":2,"source_kind":"uma","outcome":1,"pmt_at":1789924195089}
```
- verify-arms(`verify-arms-final.json`):H 13/13 PASS,含 `[链] seal / close_commit(resolve) / convert_to_claim / claim_draw landed`、`proto_claims 有 win 行且 claim_txid 非空`、`uma evidence_ref 哈希 = sha256(场景原文)`。
- 说明:H 的 resolve 在 pmt 越过 deadline+30s 之前,driver 每 20s 一次 `close_commit_pmt_not_ready`(日志行 156-211)属预期 not-ready 重试;越线后一次成功广播。

## 2. D 臂(dissent:extractor≠uma ⇒ 冻结 ⇒ refund_flip)—— 41bbd231
- 自动冻结(adapter tick,`run-logs/console-proto-lines.log` 行 232):
```
232: [proto-oracle-adapter] tick: {"scanned":1,"skipped":{},"verdictsWritten":0,"promoted":[],"frozen":[{"id":"41bbd2319aa2738e9b7eaf7fd7bf059556b212544b15d0427f5fbdf57bf73ac9","reason":"inconsistent_verdicts","clock":"pmt","changes":1}],"waited":0,"errors":0,"aborted":null}
```
- 库读回(sealed,ws=null,frozen=`inconsistent_verdicts|clock=pmt`,extractor=1 / uma=0,只有 seal 一个意图 landed):
```
=== D market 41bbd231 ===
{"id":"41bbd2319aa2738e9b7eaf7fd7bf059556b212544b15d0427f5fbdf57bf73ac9","status":"sealed","winning_side":null,"winning_side_source":null,"settlement_frozen_at":1789924973539,"frozen_reason":"inconsistent_verdicts|clock=pmt","deadline_ms":1789925541948,"outcome_end_ms":1789924941948,"settlement_frozen_at_iso":"2026-09-20T17:22:53.539Z","d
intent {"intent_key":"settle:market:41bbd2319aa2738e9b7eaf7fd7bf059556b212544b15d0427f5fbdf57bf73ac9:seal","step":"seal","status":"landed","prepared_txid":"a01b18e17d212f0a92d1f3bbe6bbe70a1b4144b9da482252e417b9f20ca32c28","submitted_txid":"a01b18e17d212f0a92d1f3bbe6bbe70a1b4144b9da482252e417b9f20ca32c28","last_error":null,"created_at":"20
verdict {"id":3,"source_kind":"extractor","outcome":1,"pmt_at":1789924666193}
verdict {"id":4,"source_kind":"uma","outcome":0,"pmt_at":1789924666193}
```
- 🔴 **refund_flip:harness 手拼,不是 driver 走的**。门 = `REFUND_FLIP_GRACE_MS=7,200,000` 以 pmt 计,D 开门 `2026-09-20T19:32:21.948Z`。
  - 负对照(门未开时提交,节点拒,`actions.jsonl` 原始行):
```
{"at":"2026-09-20T18:32:07.681Z","action":"refund_flip_negative_control_rejected","marketId":"41bbd2319aa2738e9b7eaf7fd7bf059556b212544b15d0427f5fbdf57bf73ac9","expectedTxid":"38a05faf242fc9c55ad695043a5185dece4accc1dd542eeb7c66ca33a5240062","node":{"isSynced":true,"pmtMs":1789928848583,"wallMs":1789929127678,"daa":"32765"},"pmtMinusLockMs":-3893365,"error":"RPC Server (remote error) -> Rejected transaction 38a05faf242fc9c55ad695043a5185dece4accc1dd542eeb7c66ca33a5240062: transaction input #0 is not finalized"}
```
  - 门开后提交与落地(原始行):
```
{"at":"2026-09-20T19:37:33.705Z","action":"refund_flip_gate_open","node":{"isSynced":true,"pmtMs":1789932773043,"wallMs":1789933053705,"daa":"51860"},"pmtMinusLockMs":31095}
{"at":"2026-09-20T19:37:33.708Z","action":"refund_flip_submitted","marketId":"41bbd2319aa2738e9b7eaf7fd7bf059556b212544b15d0427f5fbdf57bf73ac9","expectedTxid":"38a05faf242fc9c55ad695043a5185dece4accc1dd542eeb7c66ca33a5240062","res":"38a05faf242fc9c55ad695043a5185dece4accc1dd542eeb7c66ca33a5240062"}
{"at":"2026-09-20T19:37:36.719Z","action":"refund_flip_landed_check","marketId":"41bbd2319aa2738e9b7eaf7fd7bf059556b212544b15d0427f5fbdf57bf73ac9","landed":{"newOutpoint":"38a05faf242fc9c55ad695043a5185dece4accc1dd542eeb7c66ca33a5240062:0","newValue":"20000000","blockDaaScore":"51861","oldRootCloseStillUnspent":false},"node":{"isSynced":true,"pmtMs":1789932773043,"wallMs":1789933056719,"daa":"51875"},"closedReadback":"RootClose successor UTXO sits at the spk recomputed for state closed=2 (winningSide=0,payoutRoot=0) — state readback via P2SH spk equality"}
```
  - 结论范围:新 outpoint `38a05faf…:0` 值 20000000 落链(daa 51861),旧 RootClose 已花,后继 UTXO 位于 closed=2 状态重算 spk。**只证合约允许 refund_flip 且无需委员签名(RootClose 输入 0 签名,fee 输入由 throwaway 第三方签)——不证 driver 会走此路径**。
  - 逐票退款(refund_payout)不在本轮,归 N5b(设计第一条 D-031:评估 `pool-seal-builder.mjs:93 buildConvertToRefundClaimCommand` 与 `proto.js:331` refund_payout 约定能否复用)。

## 3. F 臂(F1 = Codex MUST① 缺陷红证)—— d7d21bee
**假设(修复后期望)**:盘已冻结 ⇒ 已备(prepared)未播的 close_commit 不得再被 driver 重播/落地。**现码预期 = 重播落地(红)**。

### 3.1 时间线(全部原始行)
- 18:52:27.9Z adapter promote ws=1;18:52:28.989Z driver 自然建了 resolve 意图(pending,无字节,`close_commit_pmt_not_ready`);18:52:29.7Z harness watcher 冻结(自然竞态,watcher 轮询 2s vs driver tick 20s)。冻结注入原始行 + adapter / 驱动日志(行 372-374):
```
{"at":"2026-09-20T18:52:29.927Z","action":"emergency_freeze_harness","arm":"F","marketId":"d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a","node":{"isSynced":true,"virtualDaaScore":"38721","pmtMs":1789930078295,"wallMs":1789930349925},"pmtMinusDeadlineMs":-446063,"before":{"id":"d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a","status":"sealed","winning_side":1,"settlement_frozen_at":null,"frozen_reason":null,"deadline_ms":1789930524358},"after":{"id":"d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a","status":"sealed","winning_side":1,"settlement_frozen_at":1789930078295,"frozen_reason":"operator_emergency_stop|clock=pmt"},"changes":1}
```
```
372: [proto-oracle-adapter] PROMOTED market=d7d21bee2a04 winning_side=1 source=extractor verdict=5
373: [proto-oracle-adapter] tick: {"scanned":1,"skipped":{},"verdictsWritten":0,"promoted":[{"id":"d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a","side":1,"source":"extractor","verdictId":5}],"frozen":[],"waited":0,"errors":0,"aborted":null}
374: [proto-settlement-intent] settle:market:d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a:resolve attempt 1/1 fail: close_commit_pmt_not_ready: pmt(1789930078295) 尚未超过 deadline(1789930524358) + 30000ms(领先 -446063ms): 节点会以 NotFinalized 拒绝(lock_time < pmt 严格小于), 稍后重试(无状态变更)
```
- 🔵 **诚实记录(pre-seed verify 的 1 条 FAIL 及其成因)**:seed 之前对 `F-pre-seed` 快照跑 verify,`[F] close_commit 意图=0` **字面 FAIL**(`verify-arms-pre-seed.json`),因为库里已有 1 条 pending resolve 行(prepared_txid=null,无字节,driver 在冻结前 1s 内自然建的)。它从未 prepared / submitted;原始观察行:
```
{"at":"2026-09-20T19:03:19.488Z","action":"F_pre_seed_observation","arm":"F","marketId":"d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a","note":"verify-arms on snapshot F-pre-seed (pmt-now already 161s past deadline+30s): [F] close_commit 意图=0 FAILS literally because ONE resolve intent row exists with status=pending, prepared_txid=null, no bytes, last_error=close_commit_pmt_not_ready. The driver created it at 18:52:28.989Z (1s after promote 18:52:27.912Z) before the freeze at 18:52:29.7Z (natural race, harness watcher polls 2s vs driver tick 20s). Substantive state: never prepared/submitted, no tx, not selected by listWork after freeze (entrance 1). Reported as-is; verify-arms not modified.","snapshot":"evidence/snapshots/F-pre-seed"}
```
- harness 人造 prepared(**SQL UPDATE 该 pending 行 → prepared**;字节 = 仓库真 `ops.build → buildCloseCommitTxJson`,fee 输入由 throwaway 第二方签;pmt 已越 deadline+30s、墙钟已越 deadline+300s,故节点侧本可入块;脚本 `scripts/seed-prepared-close.mjs`)。**原始两行(逐字)**:
```
{"at":"2026-09-20T19:03:27.981Z","action":"seed_prepared_close_inserted","marketId":"d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a","intentKey":"settle:market:d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a:resolve","preparedTxid":"eb5273995534d5339c8a2b4bd93d430af06812147bdca799a6c5955a26acaa8c","frozenReason":"operator_emergency_stop|clock=pmt","winningSide":1,"node":{"isSynced":true,"pmtMs":1789930736029,"wallMs":1789931006389,"daa":"41915"},"before":{"mempool":false,"targetUtxos":0},"bytesSource":"repo ops.build -> buildCloseCommitTxJson (real), fee input signed by throwaway payer","note":"HARNESS-SEEDED prepared row (SQL), not a natural race; market already frozen before the row exists"}
{"at":"2026-09-20T19:03:30.990Z","action":"seed_prepared_close_observed","marketId":"d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a","preparedTxid":"eb5273995534d5339c8a2b4bd93d430af06812147bdca799a6c5955a26acaa8c","verdict":"RED: frozen market prepared close_commit WAS broadcast (node-side evidence)","seenBroadcast":true,"seen":{"inMempool":false,"landedOutputs":1,"intent":{"status":"submitted","submitted_txid":"eb5273995534d5339c8a2b4bd93d430af06812147bdca799a6c5955a26acaa8c","last_error":null}},"intent":{"status":"submitted","submitted_txid":"eb5273995534d5339c8a2b4bd93d430af06812147bdca799a6c5955a26acaa8c","last_error":null},"market":{"status":"sealed","winning_side":1,"settlement_frozen_at":1789930078295,"frozen_reason":"operator_emergency_stop|clock=pmt"},"node":{"isSynced":true,"pmtMs":1789930736029,"wallMs":1789931010990,"daa":"41938"},"windowSec":3}
```
- **驱动自己的日志(证明是 driver 重播,不是 harness 提交)**(`run-logs/console-proto-lines.log` 行 376-378;时间为本地 UTC+7 ⇒ 02:03:29 = 19:03:29Z):
```
376: [relay:proto-e2e-oracle] 9/21/2026, 02:03:29 COVENANT_BROADCAST settle:market:d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a:resolve replay rebroadcast same bytes → eb5273995534
377: [relay:proto-e2e-oracle] 9/21/2026, 02:03:29 COVENANT_BROADCAST(intent settle:market:d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a:resolve) TX: eb5273995534d5339c8a2b4bd93d430af06812147bdca799a6c5955a26acaa8c
378: [proto-settlement-intent] settle:market:d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a:resolve replayed same bytes txid eb5273995534 → submitted
```

### 3.2 库读回 + 节点侧读回(`readback-final.txt`)
- 目标断言:intent eb527399… `status=landed`;市场 d7d21bee `status=resolved`、`settlement_frozen_at` 非空(1789930078295)、frozen_reason 未被清;节点 UTXO 读回该 txid 输出:
```
=== F market d7d21bee ===
{"id":"d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a","status":"resolved","winning_side":1,"winning_side_source":"extractor","settlement_frozen_at":1789930078295,"frozen_reason":"operator_emergency_stop|clock=pmt","deadline_ms":1789930524358,"outcome_end_ms":1789929924358,"settlement_frozen_at_iso":"2026-09-20T18:47:58.
intent {"intent_key":"settle:market:d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a:seal","step":"seal","status":"landed","prepared_txid":"590ec1282291b84e1447f7005baf0fa72aea4287083de2be79af27f5aa3bcebc","submitted_txid":"590ec1282291b84e1447f7005baf0fa72aea4287083de2be79af27f5aa3bcebc","last_error":null,"created_at":"20
intent {"intent_key":"settle:market:d7d21bee2a04d897bd504d1de926f3f29c1692df12e93c8d8f4f0ae2ce489b1a:resolve","step":"resolve","status":"landed","prepared_txid":"eb5273995534d5339c8a2b4bd93d430af06812147bdca799a6c5955a26acaa8c","submitted_txid":"eb5273995534d5339c8a2b4bd93d430af06812147bdca799a6c5955a26acaa8c","last_error":null,"created_a
intent {"intent_key":"settle:claim:5883453d6b41316e4a7c22ca800de7d2db9902240a0ab0e18ea604deb377772f:convert_to_claim","step":"convert_to_claim","status":"landed","prepared_txid":"6c4fbb0d4a3dde99a9a6307f1c8d3310f2620c7bf4f40bcd2918cf6aef4a0a75","submitted_txid":"6c4fbb0d4a3dde99a9a6307f1c8d3310f2620c7bf4f40bcd2918cf6aef4a0a75","last_error
intent {"intent_key":"settle:claim:5883453d6b41316e4a7c22ca800de7d2db9902240a0ab0e18ea604deb377772f:claim_draw","step":"claim_draw","status":"landed","prepared_txid":"57603214c4b38cb9d085cce058d17137f975934308247f08162356076ce290cd","submitted_txid":"57603214c4b38cb9d085cce058d17137f975934308247f08162356076ce290cd","last_error":null,"crea
verdict {"id":5,"source_kind":"extractor","outcome":1,"pmt_at":1789929955119}
verdict {"id":6,"source_kind":"uma","outcome":1,"pmt_at":1789929955119}
```
```
F1 resolve prepared_txid eb5273995534d5339c8a2b4bd93d430af06812147bdca799a6c5955a26acaa8c inMempool=false unspentOutputsFoundOnNode=[{"idx":1,"amount":"77425600","daa":"41930"}]
```
- ⇒ **MUST① 缺陷实证为红(节点侧)**:冻结(**墙钟 18:52:29.9Z**;`settlement_frozen_at=1789930078295` 存的是 pmt 读数 = 18:47:58Z、`clock=pmt`,见文首更正 ①)之后,prepared resolve(eb527399…)被 driver `replayed same bytes → submitted`,节点侧读回该 txid 有痕迹:**idx1 = 77425600 是 fee 找零(P2PK)**,不是 close 的 covenant 后继(见更正 ②);covenant 后继 out0 已被后续已知意图字节花掉(`readback` 之外由 verify-arms 新判据 `spent_by_known_tx` 读出),意图 / 市场最终 landed / resolved。**冻结只拦了 pending 路径的重读,prepared 行的重播不经过冻结检查**,与 1614 F1 读码结论一致(`proto-settlement-intent.mjs:236-237 resolvePrepared → :176`;`proto-settlement-store.mjs:54` 注释明写 prepared 不受冻结影响)。
- 🔵 **附带观察(不下断言)**:该市场冻结后,后续 `convert_to_claim` / `claim_draw` 也 landed(见上 intent 行 19:04:29 / 19:05:49)——冻结后 resolved 市场的 claim 路径未被冻结拦。是否属设计意图待 F1 补丁设计时读码定,**此处只记事实**。
- ⚠ **局限**:prepared 行是 SQL 人造的,证的是"只要有 prepared 行,冻结拦不住重播",不证"自然竞态一定发生"。自然窗口读码依据:relay 先落 prepared(`covenant-broadcast-relay.mjs:189`)后 submit(:197),submit 失败即停 prepared 等下一 tick replay(1614 已述)。
- ⚠ **对照缺口(诚实)**:没有跑"未冻结的同构 prepared 行"正对照(会同样 landed,信息量低);也没有"节点拒收的 tx"对照——tx 在节点上真入块本身即"tx 合法"的证明。

## 4. A 臂(放弃臂:并发创世 fee UTXO 冲突)—— ca062606
- 现象:D 与 A 同 tick 并发创世,fee-UTXO 选择器(升序取首个可构造)选中同一 UTXO `96cd7d79…:3`;D 先落地,A 的已备 tx 永不能落(inputs_spent)⇒ driver HOLD(genesis_ambiguous)。原始日志(`run-logs/console-proto-lines.log` 行 125-134):
```
125: [relay:proto-e2e-oracle] 9/21/2026, 00:11:46 COVENANT_BROADCAST genesis:ca06260604bc6414da189f96a2890612f89659c8a0961cbffd2c809e6646b45d prepared txid 967c0202f7f4 (bytes persisted at console) → broadcasting
126: [relay:proto-e2e-oracle] 9/21/2026, 00:11:46 COVENANT_BROADCAST genesis:ca06260604bc6414da189f96a2890612f89659c8a0961cbffd2c809e6646b45d broadcast failed: RPC Server (remote error) -> Rejected transaction 967c0202f7f4fad6502ef79b8c53b3e28afe6a1735573a20d335b3531d2ea00c: output (96cd7d79dd4431bc9aa628912b870f4258cbf8a74f987aa866d5e332fe0763ac, 3) already spent by transaction 96a727e34a37d280d791017f132c0bcb99f61b72d05
127: [relay:proto-e2e-oracle] 9/21/2026, 00:11:46 COVENANT_BROADCAST(intent genesis:ca06260604bc6414da189f96a2890612f89659c8a0961cbffd2c809e6646b45d) FAIL: broadcast_failed RPC Server (remote error) -> Rejected transaction 967c0202f7f4fad6502ef79b8c53b3e28afe6a1735573a20d335b3531d2ea00c: output (96cd7d79dd4431bc9aa628912b870f4258cbf8a74f987aa866d5e332fe0763ac, 3) already spent by transaction 96a727e34a37d280d791017f132c0b
128: [proto-market-intent] genesis:ca06260604bc6414da189f96a2890612f89659c8a0961cbffd2c809e6646b45d attempt 1/1 fail: RPC Server (remote error) -> Rejected transaction 967c0202f7f4fad6502ef79b8c53b3e28afe6a1735573a20d335b3531d2ea00c: output (96cd7d79dd4431bc9aa628912b870f4258cbf8a74f987aa866d5e332fe0763ac, 3) already spent by transaction 96a727e34a37d280d791017f132c0bcb99f61b72d05b80019408c891bc29b0b2 in the mempool
129: [proto-driver] genesis ca06260604bc6414da189f96a2890612f89659c8a0961cbffd2c809e6646b45d advance: market genesis ca06260604bc6414da189f96a2890612f89659c8a0961cbffd2c809e6646b45d exhausted 1 attempts: RPC Server (remote error) -> Rejected transaction 967c0202f7f4fad6502ef79b8c53b3e28afe6a1735573a20d335b3531d2ea00c: output (96cd7d79dd4431bc9aa628912b870f4258cbf8a74f987aa866d5e332fe0763ac, 3) already spent by transaction
132: [relay:proto-e2e-oracle] 9/21/2026, 00:12:06 COVENANT_BROADCAST genesis:ca06260604bc6414da189f96a2890612f89659c8a0961cbffd2c809e6646b45d replay refused: inputs_spent input 96cd7d79dd44:3 no longer in sender UTXO set — prepared tx 967c0202f7f4 can never land
133: [proto-driver] genesis ca06260604bc6414da189f96a2890612f89659c8a0961cbffd2c809e6646b45d advance: market genesis ca06260604bc6414da189f96a2890612f89659c8a0961cbffd2c809e6646b45d: inputs spent, ambiguous — HOLD (manual review)
134: [relay:proto-e2e-oracle] 9/21/2026, 00:12:06 COVENANT_BROADCAST(intent genesis:ca06260604bc6414da189f96a2890612f89659c8a0961cbffd2c809e6646b45d) FAIL: inputs_spent input 96cd7d79dd44:3 no longer in sender UTXO set — prepared tx 967c0202f7f4 can never land
```
- 库读回:`status=genesis_ambiguous`,无 bets / verdicts / intents:
```
=== A market ca062606 ===
{"id":"ca06260604bc6414da189f96a2890612f89659c8a0961cbffd2c809e6646b45d","status":"genesis_ambiguous","winning_side":null,"winning_side_source":null,"settlement_frozen_at":null,"frozen_reason":null,"deadline_ms":1789925759484,"outcome_end_ms":1789925159484,"settlement_frozen_at_iso":null,"deadline_iso":"2026-09-20T17:35:59.484Z"}
```
- 🔵 **同族现象(D/A 创世之前)**:先被 `net_loss_exceeded`(0.392 KAS 无找零 UTXO 被升序选择器优先选中,`net_loss 39208800 exceeds fee ceiling 34899200`)连拒多次(`console-proto-lines.log` 行 19-67),靠 harness 手工 `split-utxos` 清 fee UTXO 才继续(`actions.jsonl` `relay_split_utxos_force`)。**这是 Codex F3(创世/下注 fee 路径无资格过滤)的另一个活体旁证**:结算路径有 `filterFeeCandidates`,创世路径没有。
- 定性(Bettor 1614):与 MUST③(F3/F4)同族非直接证据;HOLD 为 fail-safe(活性非损失)。

## 5. 复现 / 核验
- 库读回:`node scripts/readback.mjs <库拷贝>`(只 readonly);verify:`DB_PATH=<库拷贝> E2E_REPO_KC=<c2352d91 worktree>/kasia-console node scripts/verify-arms.mjs --arms <arms-verify.json> --pmt-now 1789932938047 --scenario scenario.json --chain`(`arms-verify.json` = H/D/F 三臂,A 放弃臂不在其中,见 `arms.json`)。
- `scripts/` 不含任何 `*.key.json`、`kanet.simnet.env`;simnet 抛弃式密钥与主网无关。
- 原始证据:`actions.jsonl`(33 行)、`run-logs/`。⚠ `run-logs/drive-*.log` 里的 `UV_HANDLE_CLOSING` 断言与 `timeout waiting for ...` 是 **harness 驱动脚本自己**退出时崩 / 等待超时(libuv 已知问题,与结算无关;`drive-F.log` 的 timeout 是 F 臂 bet 等 fee UTXO,见 `actions.jsonl` 的 `relay_topup` 行),不是被测系统故障。

## 6. 未证 / 不主张
- driver 会自己走 refund_flip(N5b);逐票退款;F2(GRACE_MIN 压缩)活体(1614 已裁不跑 80 分钟活体证);F3/F4 修复;毒化 fee 向量(NWT 待解除);D 臂不算 MUST①/②。
- 主网:零触碰。
