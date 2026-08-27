# §6-3 gate (a) · transition probe · READY 后广播段计划 v0.1

> **Status**: DRAFT v0.1 · J2 2026-08-28 · Bettor 派工（等候期报备层，**不落码**）· 前置于 Codex 119ec787 criterion 5/6（部署路径接受 + RPC/UTXO 回读同 cov_id 后继可按意图消费 + 五负向量拒因）· 离线段 = `scratch/_j2_s63a_transition/`（9 步 OK，Codex 438e46e9 ① PASS DIRECTION / 仍 OPEN）· 接口稿 v0.2 `17effcb7`
> 🔴 **作用域**：只证 `LOCKED_F → O_AUTHORIZED` 同 cov_id 续继缝（Codex 原话：不证四路 reveal 焊 / O 反向焊 / A2-whole / 资金路）。**不碰任何生产钱路、不用 relay 生产钥、不与 (17) 清单/③f 抢**。广播 = 本文 §7 前置全过 + Bettor 令 之后。

## §1 隔离地址与 funding（Owner-controlled，小额 testnet）
- **测试钥**：一把**新造**的 Owner-controlled 钥（`PrivateKey` 随机 → `toAddress('testnet-12')`），助记词/私钥只在 Owner 侧，**不是**任何 `relay_nodes` 行的钥；harness 侧只拿地址 + 由 Owner 在本机跑签名（同 builder 的密钥区纪律：不打印、不落盘）。
- **funding 来源**：Owner 从 faucet/自有测试地址转入该地址；**金额 = 2 笔的 dust + fee 上界 ×2 + 余量**：genesis seed 1 KAS（≫ dust 1000 sompi）+ 两笔 fee（`_bshardFeeV1`: 1 输入 0.01 KAS + 2 输入 0.02 KAS；红线 7 本地上界对 consolidate 真形 minFee 2.28M ≈ 0.023 KAS，取上界 0.05 KAS/笔）⇒ 1 + 0.1 ×2 + 余量 ⇒ **转 2 KAS** 足够；多余部分走 change 回同地址，结束后 Owner 自行收回（§5）。
- **零生产影响**：该地址不在 `relay_nodes`、不在任何 market/pool 表；harness 只读 RPC + 提交两笔；不写 console.db。

## §2 两笔顺序与等待判据
1. **genesis**（funding UTXO → out[0] = P2SH(redeem@phase0) 带 `populateGenesisCovenants([GenesisCovenantGroup(0,[0])])` + change）：`submitTransaction` → 记 txid → 等 **landed ∧ depth ≥ 20**（沿 `checkUtxoLanded(address, txid, 'testnet-12', 20)` :1559-1580 的判据：`getUtxosByAddresses([P2SH 地址])` 找到 outpoint ∧ `virtualDaaScore − blockDaaScore ≥ 20`；轮询 5 s，上限 10 min，超时 = 本段 FAIL 不继续）。
2. **reveal**（in[0] = genesis:0 `transition(0,0)` + in[1] = fee UTXO → out[0] = P2SH(redeem@phase1) 带 `CovenantBinding(0, Hash(cov_id))` + change）：同上等 depth ≥ 20。
3. 两笔都用离线 harness 的构造函数（换真 funding outpoint/真 cov_id），**签名由 Owner 侧完成**（harness 输出未签 JSON → Owner 签 → 回传已签 JSON → harness 只做 `_assertTxInvariants` 同式校验 + submit）。

## §3 criterion 5 · RPC 回读命令与判据
- **cov_id 回读**：`getUtxosByAddresses([O_AUTHORIZED 地址])` → entry 的 covenant 字段按生产惯用法 `_psInputCovId` :1753-1757 的三级 fallback 读：`entry.covenantId ?? entry.covenant?.covenantId ?? entry.covenantId`（**不自创路径**，同 `checkUtxoLanded` :1572 的教训）；判据 = 值 === 离线算出的 genesis cov_id（`populateGenesisCovenants` 与 `covenantId()` 双源一致者）。
- **mempool 期回读**（可选旁证）：reveal 提交后、入块前 `getMempoolEntry({transactionId, includeOrphanPool:true, filterTransactionPool:false})` 记 `fee`/`isOrphan`；若 entry 带 mass 一并记（红线 7 observe 同口）。
- **"后继可按意图消费"判据**：用后继 UTXO（真 outpoint、真 cov_id）离线构造 **claim 支 tx**（`claim(0)`：`phase==1 ∧ OpCovOutputCount(self_cov)==0`，输出全部到测试地址）与 **recovery 支 tx**（`recovery(0)`：`tx.time ≥ t_recovery`）—— **两者只构造 + 序列化往返 + `_assertTxInvariants`，不广播**（Codex 5 要"能进 reactive-claim/recovery 支"，构造可行 + 脚本谓词在离线 harness 已证；真花掉后继留给 §5 资金回收，用 claim 支一次性收回）。
- 全部回读打成 JSON：`{genesis:{txid,depth,cov_id_readback}, successor:{txid,depth,address,cov_id_readback,equal:true}, mempool:{...}, claim_tx_json_sha, recovery_tx_json_sha}`。

## §4 五负向量 · 逐条 submit 取拒绝码
- 顺序：**先负后正**？——否：N2/N3/N4/N5 都要"消费 genesis:0"，若任一被节点接受就把正路吃掉。⇒ **正路 reveal 落链（§2）之后**再跑负向量：N1 错 cid / N5 漏 binding / N3 错 continuation 地址 / N4 陈 state 各造**第二个 genesis**（每个负向量独立一笔小额 genesis，seed 0.1 KAS，5 笔 ≈ 0.55 KAS，已含在 §1 的 2 KAS 内）再提交坏 reveal；N2 错 outpoint 直接提交（引用不存在的 genesis:1）。
- 拒绝码来源：`rpc.submitTransaction` 抛出的 RPC 错误文本（live 日志实形：`Rejected transaction <txid>: failed to verify the signature script: script ran, but verification failed` = 脚本层；`… input #0 is not finalized` / `output (…) already spent … in the mempool` / missing outpoint = 链层；`… is not standard: transaction has N fees which is under the required amount of M for compute mass K` = 费地板层）。
- **判据表**（期望层 → 期望文本族）：N1 错 cid → 共识 covenant 验拒（文本待实测归类，预期非"signature script"族）；N2 错 outpoint → 链层 missing outpoint/orphan 族；N3 错 continuation 地址 → 脚本层 `verification failed`；N4 陈 state → 脚本层 `verification failed`；N5 漏 binding → 脚本层 `verification failed`。**拒绝码取不到（超时/连接断/文本不在任何族）= 该向量不算过，记 `inconclusive`**，不补跑不改期望。
- 每条记：提交时间、txid（本地算）、完整错误文本、归类层、是否 inconclusive。

## §5 失败回滚与资金回收
- **`t_recovery`**：ctor 烤 **`now_ms + 30 min`**（ms 单位与 `tx.time` 同；给 §3/§4 足够窗口又不长占资金）；recovery 支在 30 min 后可由测试钥把后继全额收回；claim 支随时可收（`phase==1` 即可）。
- 任一步 FAIL：停；已落链的 genesis/后继由 Owner 用 claim 支（或过时锁后 recovery 支）**一次性收回到测试地址**，再从测试地址转回 Owner；未提交的坏 tx 无资金影响。负向量的独立小额 genesis 同样各自 claim 收回。
- **不做**：不动 relay wallet、不动任何 market/pool UTXO、不写 console.db、不改 relay 代码。

## §6 证据入 `docs/provenance/2026-08-28-s63a-transition/`（NWT GREEN 后）
```
MANIFEST.txt                 每文件 sha256
S63A_TransitionProbe.sil     J1 正式产物(与 J2 dry-run sha256 相等的那份)
ctor_phase0.json / ctor_phase1.json / probe_phase0.json / probe_phase1.json
compiler.txt                 silverc-zk-8065184.exe sha256 + 版本 + 退出码
build.mjs                    离线 harness(冻结版)
offline/evidence.json, offline/{genesis,reveal,N1..N5}.tx.json   离线段(假 outpoint)
live/genesis.tx.json, live/reveal.tx.json                          真 outpoint 已签 tx JSON
live/readback.json           §3 回读 JSON(含 cov_id 相等、depth、mempool)
live/claim.tx.json, live/recovery.tx.json                           §3 只构造不广播的两支
live/negatives.json          §4 五条拒绝码 + 归类 + inconclusive 标记
live/run.log                 时间线(UTC)、daa、节点 isSynced 快照
README.md                    Codex ①–⑦ 逐条对应 + 作用域句
```

## §7 前置（缺一不跑）
1. J1 正式编译产物到并**复现** J2 dry-run 的 `script0/1_sha256`（否则以 J1 为准重跑离线段）；2. NWT 审离线证据 GREEN；3. 节点 READY ∧ (17) T+0…T+125 清单 + ③f 跑完；4. Owner-controlled 测试钥与 2 KAS 就位；5. **Bettor 令**。不与 (17)/③f 抢、不碰生产钱路、不推。
