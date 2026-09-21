# NWT 独立复核:F1 冻结绕过红证 + D 臂 refund_flip 落地(oracle simnet e2e 基础轮)

- 复核人:NWT(claude.exe PID 33408,Bettor 会话 claude-36 [3cfa4c] 于 2026-09-21T14:37:05Z 拉起)· 复核时段 2026-09-21T14:40Z–15:05Z
- 被复核对象:J2 `scratch/_j2_e2e_run` 原始产物,以及 J2 交件 `origin/coord/j2-oracle-simnet-e2e-provenance-20260921 @178f46ee`(`docs/provenance/2026-09-21-j2-oracle-simnet-e2e-four-arms/`)。代码 = `c2352d91`(J2 冻结 worktree 所用),用 `git show c2352d91:<path>` 读。
- 做法:库与 evidence 先整体拷进 NWT 自己的 scratchpad 再读(`node:sqlite`,不打开原件、不进 J2 worktree、不改任何 J2 文件);链侧只调只读 `get*` RPC(`getServerInfo` 先断言 `networkId=simnet`,无任何 submit)。主网 console / 库 / env / relay 零触碰。
- 环境事实(更正我中途的一个错判):J2 的 simnet **节点 pid 2692 / console 3298 pid 23416 / relay 19128 都还活着**(终端崩溃只带走了会话窗口,没带走这些无头进程);`isSynced=false`、daa=52628、pmt=1789932938047,与 J2 交件 `node-time-at-readback.json` 逐位相同 ⇒ 链自 19:40Z 矿工停后未再前进,驱动被 P0 同步闸挡住、没有新结算动作。因此本轮**能**对链做独立只读读回(§3)。

## 结论(先说证了什么、没证什么)

**MUST:0 条。** 下表是口径,不是待修项。

| 项 | 复核结论 | 证了什么 | 没证什么 |
|---|---|---|---|
| F1 红证 | **成立(库 + 驱动日志 + 节点链读回 + 代码 四层独立复现)** | 冻结市场上一条 prepared 的 close_commit 行,被**驱动自己**同字节重播并被共识接受;之后驱动继续走完 convert_to_claim + claim_draw | ① 顺序是"先冻结、后人造 prepared 行",不是 Codex 的"先 prepared、后冻结"——驱动在 `resolvePrepared` 看到的状态相同,所以只证 **crash-recovery/replay 路径**,**没证** first-send-after-prepare 路径;② 冻结是 harness 用仓库 `freezeMarket` 手调,原因串 `operator_emergency_stop` 是 harness 自拟(`kasia-console/src` 0 命中),**没证**主线现有生产触发器会造出"已 promote 且已冻结"的市场(§1.6) |
| D 臂 refund_flip | **成立,口径限定** | 合约允许 permissionless(输入 0 无 checkSig、第三方付 fee)refund_flip 在 deadline+2h 之后被共识接受;门未开时同一 txid 被节点拒("input #0 is not finalized"),门开后同一 txid 被接受 | 不证 driver 会走(driver 无该 step);`closed=2` 的 spk 只证"与仓库对 closed=2 的定义一致",不证"合约对 closed=2 的定义就是这个";refund 后无逐票退款(N5b) |
| J2 自记三处诚实记录 | **三处均成立**(§4) | — | 第三条(冻结后 convert/claim 也 landed)**不构成 MUST① 之外的新 MUST**(§4.3) |
| A 臂 net_loss_exceeded 作 F3 旁证 | **部分站得住**(§5) | 候选选择缺"值/成形"维度、确定性重选同一不可发候选 ⇒ 每 tick 连拒的活性死锁 | **不是** Codex F3 核心维度(毒化/covenant/unknown facts),**不是**"不安全花费"(relay 净损上限是下游兜底、已 fail-closed) |

## 1 F1 红证(F 臂 `d7d21bee…`)

### 1.1 时间线(全部 UTC;库 + console-stdout.log + 节点链读回)

| 时刻 | 事件 | 出处 |
|---|---|---|
| 18:50:27.889 | extractor=1、uma=1 两条 verdict 落库(pmt_at 1789929955119) | `proto_market_verdicts` id 5/6 |
| 18:52:27.912 | adapter promote ws=1 src=extractor(verdictId 5) | console-stdout.log:1946 |
| 18:52:28.989 | 驱动 tick 365 为该市场建 `resolve` 意图:pending、`close_commit_pmt_not_ready`、outcome=gated | console-stdout.log:1948-1949;库 `created_at` |
| ~18:52:29.7 | harness 调仓库 `freezeMarket(reason='operator_emergency_stop')`。**`settlement_frozen_at=1789930078295` 是 pmt 读数 = 18:47:58Z,不是墙钟**;写入墙钟 18:52:29.9Z | `watch-freeze-F.log`、actions.jsonl `emergency_freeze_harness` |
| 19:03:27.981 | harness 把那条已存在的 pending 行 UPDATE 成 prepared(status / prepared_txid / prepared_tx_json)。字节 = 仓库真 `ops.build`→`buildCloseCommitTxJson`,fee 输入由 throwaway 第二方签 | `seed-prepared-close.mjs:73`;actions.jsonl `seed_prepared_close_inserted` |
| 19:03:29 | **驱动 tick 398**:`COVENANT_BROADCAST … replay rebroadcast same bytes → eb5273995534`;`replayed same bytes txid eb5273995534 → submitted` | console-stdout.log:2067-2070 |
| 19:03:29.534 | **节点链读回**:eb527399 被虚拟链块 `4ed581c4…` 接受,daa **41930** | §3 |
| 19:03:49.255 | tick 399:意图 landed depth 96;市场 resolved | 库 `landed_at`;console-stdout.log:2072 |

### 1.2 我试过怎么打穿这份红证(都没打穿)

1. **"tx 无效,RED 是构造假象"**——打不穿:共识接受(§3 节点读回 daa 41930)且库里 `landed_depth=96`(relay `check_utxo_landed` 写的,不是 harness 读的)。tx 体读回:lockTime=1789930524358=F 的 deadline、in0 = F 的 seal 输出 `590ec128…:0`。
2. **"是 harness 广播的,不是驱动"**——打不穿:seed 脚本唯一的 `submit` 在 payer 自转 0.95 KAS 分支(非 close);日志 `replay rebroadcast same bytes` 是 relay 收到驱动 `replay_tx_json` 的分支(`proto-settlement-intent.mjs:176`)。节点 10s 窗 `in: 2 via RPC`(02:03:34)与"payer 自转 + 驱动重播"一致,**但不能靠它把两笔分开归属**——归属靠上一句的日志。
3. **"tick 碰巧"**——打不穿:tick 398 在 :29.x、tick 399 在 :49.255,20s 节拍与 `INTERVAL=20000` 一致;seed 落在 tick 前 1.5 s,是 harness 有意卡点。
4. **"冻结当时其实没生效"**——打不穿:v213 触发器 `trg_pm_d_frozen_one_way` 保证冻结单向;库里 18:52 后一直冻结;`resolvePrepared`(`proto-settlement-intent.mjs:154-197`)整段没有冻结读取,`listWork` 的 `preparedRows`(`proto-settlement-store.mjs` 头部)按 `status='prepared'` 直接推进,注释明写"不受冻结影响"。
5. **"人造 prepared 行与真路径的行不同"**——打不穿:真 `recordSettlementIntentPhase('prepared')` 写的正是 `prepared_txid`+`prepared_tx_json`+`status='prepared'`(`proto-settlement-intent.mjs:116-120`),harness 写同三列;重播的 `txid==prepared_txid` 断言通过。
6. **对照臂(同一冻结下 pending 路径是否被拦)**——**有**:冻结后 tick 366–397 共 32 个 tick 对该市场**完全静默**(无 actioned/gated/held),其中 pmt 越过 deadline+30s 之后约 9 个 tick 也如此。原因是 `listWork` 的 close_commit 选行 SQL 带 `AND m.settlement_frozen_at IS NULL`(注释"批 D D1 入口①")——冻结市场的 pending 行**根本不被选中**。所以缺陷精确限定为:**prepared 行绕过这道过滤**。(附带观察:被过滤的冻结市场既不 held 也不报警,静默;非 MUST。)

### 1.3 账本/交件措辞更正(非 MUST)

- 1615 与 J2 交件 §3.2 都写"冻结(18:47:58Z)":**18:47:58Z 是 `settlement_frozen_at` 里存的 pmt 读数;冻结写入的墙钟时刻是 18:52:29.9Z**(pmt 落后墙钟约 4.5 分钟)。两个时钟在同一行里被当成一个。
- J2 交件 §3.2 "节点 UTXO 读回该 txid 输出(idx1,77425600,daa 41930)":我读回 tx 体,**该 idx1 是 fee 找零输出(P2PK,发往 throwaway payer),不是 close_commit 的 covenant 后继(out0,20,000,000)**。结论"tx 落链"不受影响(我另以 accepting 块为据),但该行不应被读成"covenant 输出已在节点上"。

### 1.4 verify-arms F 判据的字面 FAIL

J2 的 pre-seed 与 final 各 1 个 FAIL(F 臂 "close_commit 意图=0 / resolve 意图 1 条")。成因(驱动在 promote 后 1 s 内、冻结前自然建了 pending 行,从未 prepared/广播)我用 console-stdout.log:1948 与库 `created_at=18:52:28.989` **独立核实一致**。建议(SHOULD,非 MUST):F1 补丁落地后,该判据措辞改为"无 prepared/submitted/landed 的 resolve 意图 ∧ 节点侧无该 close txid",否则修复后同一自然竞态仍会字面 FAIL。

### 1.5 冻结后的下游:convert_to_claim / claim_draw 也走完了(J2 已自记,我核实)

`proto_claims` F 臂 win claim `5883453d…`(amount 1300):convert_to_claim 广播 `6c4fbb0d…`(19:04:09Z,链读回 daa 42127)、claim_draw 广播 `57603214…`(19:05:29Z,链读回 daa 42515),`claim_txid` 已写。这两笔发生在 Windows Terminal 崩溃(02:04:49 本地)前后,是驱动无人在座时自己走的。`listWork` 下游两类选行只看 `m.status='resolved'` 且 resolve 意图 landed,**不看冻结**。判定见 §4.3。

### 1.6 F1 在主线现码里的可达性(静态读码,**未运行,标 UNVERIFIED**)

- `freezeMarket` 生产调用点仅三处:`proto-oracle-adapter-core.mjs:43`、`:109`(候选 SQL 均带 `winning_side IS NULL AND settlement_frozen_at IS NULL`)与 `proto-settlement-freeze.mjs:51`(晚 seal 守卫,`winning_side != null` 返回 `already_decided`);v213 触发器禁止冻结后写 `winning_side`;`PROMOTE_UPDATE_SQL` 要求未冻结。
- 我**没有找到**主线现有生产触发器产生"winning_side 已写 ∧ 已冻结 ∧ 有 prepared close"。F1 当前性质更接近**边界缺口 + 为将来应急冻结/运营停机预留的守卫缺失**,而不是"现码已可被自然触发的资金损失"。**不改变修法**(Bettor 已采纳 Codex MUST①,方向对),只影响对外口径:不写成"已实证的生产可达缺陷"。
- 有一个我没能在本轮排除的窄窗,按 D-021(未修复利用细节不入库)**不写进仓库**,已用消息单独报 Bettor。

## 2 D 臂 refund_flip(`41bbd231…`)

- 库:`status=sealed`、`winning_side=NULL`、冻结 `inconsistent_verdicts|clock=pmt`(`settlement_frozen_at=1789924973539`=17:22:53.539Z pmt)、`deadline_ms=1789925541948`;verdict extractor=1 / uma=0(相反);seal 意图 landed depth 95;**无 resolve 意图**。
- 开门 = deadline+2h = 1789932741948,与 harness `REFUND_FLIP_GRACE_MS=7_200_000` 及 actions.jsonl `lockTimeMs` 逐位相等。
- **J2 交件三条原始行**(gate_open / submitted / landed_check)与我读到的 actions.jsonl 逐字一致;另有 J2 交件里的**负对照行** `refund_flip_negative_control_rejected`(18:32:07Z,pmt−lock=−3,893,365 ms,节点回 `input #0 is not finalized`,expectedTxid 同为 `38a05faf…`):**同一 txid 门未开被拒、门开后被接受** ⇒ 不是"节点什么都收"的空牙,这是 D 臂最硬的一条。
- 口径 "只证合约允许 refund_flip 且无需委员签名,不证 driver 会走":**成立**(§3 tx 体读回:in0 = D 的 seal 输出 `a01b18e1…:0`、sequence 0(<MAX,CLTV 需要)、lockTime=开门值;out0 20,000,000 沿用同一 covenantId `7132faf6…`,spk 与 seal 的 out0 不同 ⇒ 状态已变)。

## 3 独立节点读回(只读 RPC;脚本 `chain-read.mjs` / `chain-tx.mjs` 见本目录;库读回 q1/q3/q4.mjs)

节点:kaspad v2.0.1 simnet(`8afe6a68…` 与 `D:\rusty-kaspa-v201\kaspad.exe` 一致),`networkId=simnet`,`isSynced=false`,daa 52628。以 `getVirtualChainFromBlock(includeAcceptedTransactionIds)` 查各 txid 的 accepting 链块:

| txid | 含义 | accepting 链块 | daa | 块时间(UTC) | 与 J2 读数 |
|---|---|---|---|---|---|
| `eb527399…` | F1 冻结后被驱动重播的 close_commit | `4ed581c420ed…` | 41930 | 19:03:29.534 | J2 交件 daa 41930 ✓;seed 时 daa 41915、观察时 41938,夹在中间 ✓ |
| `6c4fbb0d…` | F 臂 convert_to_claim | `1221a4746cdf…` | 42127 | 19:04:09.975 | 与驱动日志 02:04:09 ✓ |
| `57603214…` | F 臂 claim_draw | `8f78fa25f4af…` | 42515 | 19:05:29.614 | 与驱动日志 02:05:29 ✓ |
| `38a05faf…` | D 臂 refund_flip | `b809a3b649f1…` | **51861** | 19:37:33.958 | J2 `blockDaaScore` 51861 ✓;harness 提交 19:37:33.708 ✓ |
| `a01b18e1…` | D 臂 seal | `5bb9ad00532a…` | 9637 | 17:13:07.150 | — |

tx 体读回(节选):
- `38a05faf…`:in0 `a01b18e1:0` sigScript 19894 B、in1 fee 输入 sigScript 66 B(单个签名 push)、lockTime 1789932741948;out0 20,000,000 covenantId `7132faf6…`;out1 **4,980,059,600**(找零)。**独立算术**:fee 输入 5,000,000,000(coinbase)− 4,980,059,600 = **19,940,400** = harness 记录的 `requiredFee`/`netLoss` ✓。
- `eb527399…`:lockTime 1789930524358 = F deadline;in0 `590ec128:0`(F 的 seal 输出);out0 20,000,000 covenant;out1 77,425,600 P2PK(payer 找零,见 §1.3)。

## 4 J2 自记三处诚实记录 —— 是否成立

1. **pre-seed FAIL 成因**:成立(§1.4)。
2. **prepared 行系 SQL 人造**:成立(`seed-prepared-close.mjs:73-74`;actions.jsonl note 逐字写明 `HARNESS-SEEDED … not a natural race`)。
3. **冻结后 convert_to_claim/claim_draw 也 landed**:事实成立(§1.5,链读回佐证)。**是否构成 MUST① 之外的新缺口——判:否(不作 MUST)**。理由:(a)冻结语义在 v213 头注与 `proto-settlement-freeze.mjs` 头注里都限定为"close_commit 三入口 fail-closed",下游以 close 已落链为前提;(b)主线所有 `freezeMarket` 调用点都要求 `winning_side IS NULL`(§1.6),"close 已落链之后才冻结"没有生产触发器;(c)F1 补丁(resolvePrepared 遇冻结 HOLD)让 close 不落链 ⇒ 下游选行的前提 `resolve 意图 landed` 不成立,冻结市场不会走到 claim。**SHOULD(补丁说明)**:写明冻结语义边界=不回溯已落链的 close;若日后加运营应急冻结,需先决定"close 后冻结,是否还允许 convert/claim"。只判定,不扩面。

## 5 A 臂 net_loss_exceeded 作 F3 旁证 —— 站不站得住

事实(我核实的):J2 交件 `console-proto-lines.log` 中 `REJECTED (net loss` 共 **21** 条,00:06:26–00:11:26(本地)≈5 分钟,同一 UTXO(`signed_input_total=39208800`、`returned_to_relay=0`,即无找零)被每 tick 重选、每 tick 被 relay 净损上限(`min(required_fee×2=34899200, …)`)拒;靠 harness 手工 `split-utxos`(17:11:42Z)才解开。

- **站得住的部分**:候选选择只按"能否真实构造"(`selectFeeUtxoByConstruction`,`proto-tx-assembly.mjs:134`,升序取首个能编出的)——**构造成功 ≠ relay 会放行**;选择器确定性,同一 UTXO 被永远重选 ⇒ **活性死锁**。这确实是"候选资格缺值/成形维度"的活体证据,支持 F3 的"一个共享资格函数"结论,且提示该函数要把 relay 同款净损上限/最小找零判据纳入,并且拒收后应跳选下一个而不是原地重试。
- **站不住的部分**:① 不是 Codex F3 的核心维度(毒化 / covenant-bound / unknown facts fail-closed);② 不是"不安全花费"——relay 净损上限是下游兜底,**fail-closed 生效了**;③ 这份证据**不足以证"创世/下注 vs 结算的路径不对称"**:失败位置在三条路径共用的 `selectFeeUtxoByConstruction`(`proto-settlement-ops.mjs:5` 也用它);结算路径多一道 `filterFeeCandidates` 的 `feeMinAmount ≤ value` 地板(`feeMin(step)=loadFeeProfileCap(...)`),0.392 KAS 是否会被它挡掉**我没验证(UNVERIFIED)**。J2 自己在 H close_commit 前也手工 split 过("a 0.38 KAS leftover would be picked first")——说明 J2 并不认为结算路径天然免疫。
- 建议(SHOULD,进 F3/F4 设计稿的第一条"是不是已经有了"):复用点已存在——`filterFeeCandidates`(`proto-settlement-c1.mjs:196`)+ `selectFeeUtxoByConstruction`(`proto-tx-assembly.mjs:134`)已是三路径共享的骨架,F3 应是"把资格判定收进一个共享函数并补全维度",不是新造。parity 测试建议加一条:"spk 合法、未毒化、面值在带内,但无找零致净损超上限"的候选——各签名路径都必须跳过或 HOLD,不得原地重选。

## 6 没做 / 局限(逐条)

- 未验证 `closed=2` spk 的独立来源(需在 debugger/simnet 里跑 refund_flip 分支的编译产物;非本轮范围)。
- 节点读回是 accepting 链块 + tx 体,**没有**重跑 F 臂的 verify-arms(我对库做了等价的手工断言,见 §1);节点 `isSynced=false`,故 `getUtxosByAddresses` 类读回未作为主证据。
- F1 可达性(§1.6)与 §5 的 `feeMin` 结论均为静态读码,标 UNVERIFIED。
- 我未审 F1/F2 补丁(尚未交件)。

## 附:证据指纹(sha256)

原件(`_j2_e2e_run`,读取时 J2 console/节点仍在运行,库以拷贝读):
```
f82d745f2e5d5fede7e7d8a41c3f320a077c88008c52f8c6d473cbed6a2cb224  evidence/actions.jsonl
b012c9270332fcfc5a124af8d98a8918fce5792ec30d7c0ce4f110bd425b3afc  evidence/verify-arms-pre-seed.json
a045568fcd02ffcd265e11ff4c2fa3cfbe8c99d6eed13972e9187c49441a6e50  logs/console-stdout.log
e944ac8e08d52653f4f57c601bbdbb03e8a9094bf0b5bacd7d28e4731d42ccf9  logs/refund-flip-run.log
d165491ee0c2f11f89d41e7f2a54e26cec1dcb9e4ae48b5e2fbddb2aff6b4d11  logs/miner.log
4de0ddc19707a7de8cc02ee81daa7dc8a079c490cc0e7d852bdb60b0f2cd2c71  logs/node-stdout.log
ebb4424b6e6cd39120895a61372e8f6a1cc8a83bfa5d1a4d26beeb8909c85627  seed-prepared-close.mjs
2b1b52636d6ea92281f61e3830531249c0d08a4a8a0841e3f8b9f1616118a1e9  refund-flip.mjs
2011665145bcd6c5db83ff8505104e70c857b873e551e21a4b38a0e49e6bf269  sim-actions.mjs
d9bb57ce225260ecde7aaad45d31332190d3d1f4b57327a9e6625d78de67f746  watch-freeze-F.mjs
267c81b3162df1399aa3c58112260e5b3522427a5e3139e04c5d3a2caa2bc52c  console.simnet.db(主文件;与 J2 交件所述"工作副本 sha"一致)
c5f03aa312645a9d8752cc65f85051c17576ac51d84aa18f5fe682f73d544a59  console.simnet.db-wal(我拷贝时刻;console 仍在运行,WAL 会变)
```
读库:`node:sqlite`(Node 24)只读自己的拷贝。链读回:`chain-read.mjs`(acceptance)、`chain-tx.mjs`(tx 体),仅 `get*`,先断言 simnet。
