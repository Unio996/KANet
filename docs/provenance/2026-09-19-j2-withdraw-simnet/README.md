# 2026-09-19 J2 — simnet：withdraw（批7，`KanetTokenClaim.spend` 路径 (ii)）真实共识 ACCEPT + 篡改签名负向臂被拒

Bettor 派工（账本 1520 裁定路径 (ii)，目的地为测试用、不可再花的 covenant 输出）。在批6 的同一条 simnet 链（chain3：genesis→…→claim_draw）上追加第八步 withdraw。
D-021 合规：只含 simnet 数据；委员私钥信封**未入库**（sanitized 记录里已置换为占位说明）。

## 环境（提交前现核）

- 节点：PID 15972，官方 kaspad 2.0.1 simnet，只绑 127.0.0.1；`D:\rusty-kaspa-v201\kaspad.exe` sha256 `8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38`，`--version` = `kaspad 2.0.1`（与批3–6 同一二进制）。
- builder/编码器 commit：`fd3bbbeb`（本批 withdraw builder；simnet 运行时工作树为 HEAD `cbcb773d` + 同一批未提交改动，运行后未再改 builder 代码，仅改了注释里的账本号与 anchors 文字）。所有交易 version = 1。
- 提交前 NWT 会话不在线（ListAgents 无其行），已通过 Bettor 转知；节点无并发占用。

## 结果

| 项 | 值 |
|---|---|
| withdraw txid | `39f4f2c6a0070b183fa7e5ffb241974b19db3b4346790ff4dfc1ab901c1ae508`（区块 daa 4334，紧随 claim_draw daa 4333） |
| 输入 | 0=KanetTokenClaim（claim_draw 输出0，20,000,000，covenant）；1=held KTT（claim_draw 输出1，20,000,000，covenant，owner=该 claim 的 covenant_id）；2=fee（85,000,000，普通 P2PK） |
| 输出 | 0=代币转出（owner=目的地输出的 covenant_id，GENESIS 20,000,000）；1=目的地 covenant genesis 输出（测试用、不可再花：`aa20`+`ee`×32+`87`，20,000,000）；2=找零 |
| 断言信号 storage / compute | 219,598 / 30,371（`inputHasCovenant=[true,true,false]`） |
| 节点 getMempoolEntry | storage 219,598 / compute 30,371 |
| 区块记录 storage / mass / compute | 219,598 / 219,598 / 30,371 |
| 三源逐位相等 | ✅（断言信号 == 节点 mempool == 区块记录）；builder 返回的 `massSignal` 与脚本层重算信号也逐位相等 |
| 实付 fee | 33,976,400 sompi（fee 输入 85,000,000） |
| C1（节点真实 UTXO） | claim=20,000,000、held=20,000,000，spk == 按当前状态现算 ✅ |
| 上链后 | 代币输出、目的地输出在节点上均可查；旧 KanetTokenClaim / held 已被花掉（终态，无 claim 续约） ✅ |

- **首次上链即被接受**：这同时证明了 KanetTokenClaim.spend 的全部检查在真实共识下通过——`blake3` 模板哈希、`readInputStateWithTemplate` 读被消费代币（owner==本 claim covenant_id、amount==claim.amount）、`OpOutputCovenantId(dest_idx)` 非零、`validateOutputStateWithInputTemplate` 代币输出状态（owner=目的地 covenant_id）、`checkSig(s, winner_pk)`。
- **签名前断言**：`assertClaimWinnerSigningKey` 先通过（由 market_cov_id、winner_pk、amount 重算 KanetTokenClaim P2SH == 链上 spk，再逐字节比公钥）；签名在 `populateGenesisCovenants` 之后对候选 tx 现签。

## 负向臂（真实共识）：篡改签名被节点拒

同一笔构造好的 withdraw，只把 KanetTokenClaim 输入 sigScript 里第一个 push（65 字节签名 `s`）的**第 1 个签名字节翻 1 bit**，其余一字节不动，提交：

> `RPC Server (remote error) -> Rejected transaction 39f4f2c6…ae508: failed to verify the signature script: script ran, but verification failed`

- 被拒的交易 txid 与真笔相同（txid 不含 witness），但未进 mempool，也不消耗任何 UTXO；随后真笔正常被接受。
- 归因：被拒版本与被接受版本**唯一差异是那 1 bit 签名**，其余合约要求（模板哈希、owner、amount、输出状态、目的地）两次一致 ⇒ 拒绝只能归到 `checkSig(s, winner_pk)`（H4）。这是"节点确实校验赢家签名"的共识层证据，不是测试自证。
- 原文记录在 `chain3-sanitized-record.json` 的 `withdrawNegativeTamperedSig`。

## 给 NWT：请按 F3' 推 `feeProfile.withdraw.cap` 专属值

- 布局固定：[KanetTokenClaim, held, fee] → [代币输出, 目的地输出, 找零]；节点值 storage=219,598 / compute=30,371 / 实付 fee=33,976,400（fee 输入 85,000,000）。当前 cap 仍是**暂借 1.0 KAS 的占位**。
- 说明：按 Bettor 1520 裁定批9 排除 withdraw（主网目的地允许清单 v0 为空），此 cap 仅服务 simnet 证据。
- `withdraw_full_tx.json`（完整交易，含全部见证字节）、`raw-onchain-withdraw-node-records.json`（claim_draw 对照 + withdraw 的区块记录）供字节层 / 上游 VM 验证（KanetTokenClaim.spend 的 4508B sigScript 与 held KTT 的 3215B sigScript）。

## 没有证明的（不许外推）

1. n=1：一个市场形状（金额 1000，单赢家）。
2. 目的地是**测试用、不可再花**的 covenant 输出（spk 是随手 32 字节脚本哈希）：**不证明赢家能把代币再花出去**（Bettor 1520 边界 ①：v0 不承诺；钱包 covenant 见设计票 T-TOKEN-WALLET-COVENANT）。
3. 只走路径 (ii)（`to_market_input=false`）；路径 (i)（再下注到 market 输入）未实现、未验。
4. 签名的赢家 = 委员 keypair（v0 映射 winner_pk === committee_pubkeys_json[0]），不是独立用户密钥。
5. 字节层独立验证（自写解析器 + 上游编码器 + 上游 VM 跑 KanetTokenClaim.spend）交 NWT。
6. 主网 withdraw 不可构造（builder 目的地允许清单 v0 为空且冻结；仅非主网 + 显式 `allowUnlistedTestDestination` 可用测试目的地）。

## 复现

`13_run_withdraw.mjs.txt`（由批6 的 `11_run_full_chain_v2.mjs` 派生：步骤1–7 因 chain3 已完成而跳过，追加步骤8）、`14_fetch_withdraw_records.mjs.txt`；放到 `kasia-console/scratch/_j2_simnet/` 下去掉 `.txt` 运行，需要 simnet 测试身份 state 与 chain3 记录（不入库）。
