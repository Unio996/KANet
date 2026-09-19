# 2026-09-19 J2 — simnet 全链真实共识验证：genesis → register_append×2 → market_seal → close_commit → convert_to_claim

Bettor 派工第 5 条。全部走**生产 builder**（不是审计构造）；节点 = 官方 kaspad 2.0.1 simnet（与主网节点同一份二进制）。
D-021 合规：只含 simnet 数据（无真实地址/私钥；委员私钥只以加密信封形式存在于 scratch 的 chain 记录，本目录不含）。

## 环境（提交前现核）

- 节点：PID 15972，`D:\rusty-kaspa-v201\kaspad.exe --simnet --appdir=D:/kanet-tn12/scratch/_nwt_simnet_data --rpclisten-borsh=127.0.0.1:18510 …`，只绑 127.0.0.1；
  二进制 sha256 `8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38`，`--version` = `kaspad 2.0.1`。
- 编码器/builder commit：`1a6440b472c24a9f03af094c60b2371bbda423ee`（侧分支 `coord/j2-proto-v0-settlement-design-v0.1`）。
  ⚠ 诚实说明：第二段运行（补挖块后续跑 close_commit/convert_to_claim）时工作树里另有一处**未提交**的改动——
  `CLOSE_COMMIT_DEADLINE_MARGIN_MS` 由 120,000 改为 300,000（依据见下"B4-2"）；它只是构造守卫常量，不参与任何字节编码。
- 所有六笔交易 version = 1。J2 独占节点提交期间，NWT 未向节点提交（按 Bettor 约定）。

## 结果：六笔全部真实共识 ACCEPT，断言信号 == getMempoolEntry 节点值 == 区块记录节点值（三源逐位相等）

| # | 步骤 | txid | fee 输入面值 | 断言 storage / compute | 节点 getMempoolEntry storage / compute | 区块记录 storageMass / mass / computeMass | sigScript 字节（各输入） |
|---|---|---|---|---|---|---|---|
| 1 | market_genesis | `f3f871cab563d113338410c70e5addad7656c520ff649924b77fe1926bd0573a` | 100,000,000 | 206,736 / 8,083 | 206,736 / 8,083 | 206,736 / 206,736 / 8,083 | 66 |
| 2 | register_append#1 | `d2f7384cbc0c04fdc6bf8ed99926e695731cfb4923d4f26ee227d139fe127e69` | 99,000,000 | 438,201 / 33,927 | 438,201 / 33,927 | 438,201 / 438,201 / 33,927 | 17910 / 66 |
| 3 | register_append#2 | `defb3fd90cf8e58e3f3a109d5159e2ae97b1b57cee1abcdcb3ded3c62c28345d` | 97,000,000 | 294,350 / 44,198 | 294,350 / 44,198 | 294,350 / 294,350 / 44,198 | 17912 / 3215 / 66 |
| 4 | market_seal | `78246e013e8b871511b98bdec11e640b252b63c44694eb107512bea9b6cb6bfb` | 96,000,000 | 232,420 / 60,422 | 232,420 / 60,422 | 232,420 / 232,420 / 60,422 | 34559 / 3215 / 66 |
| 5 | **close_commit** | `9e3398a6b9d61c81b255f8a8ecbdd85d07e736fa42f684529acb15ab41f68570` | 95,000,000 | 134,657 / 35,560 | 134,657 / 35,560 | 134,657 / 134,657 / 35,560 | 20423 / 66 |
| 6 | **convert_to_claim** | `1b1133ebb096379cbcbdc29c48716f21516383397c8dae747ebcf2c2172ef983` | 92,000,000 | 227,931 / 48,618 | 227,931 / 48,618 | 227,931 / 227,931 / 48,618 | 22755 / 3215 / 66 |

- 第 1 列断言信号 = `assertMassWithinCeiling` 返回的精确 storage/compute（compute 含未签名 fee 输入的 66B 留量）；三源逐位相等，**没有出现"不等即停"**。
- 本地 wasm `calculateTransactionMass`（诊断项，不门控）在这六笔上是 206,736 / 480,219 / 411,139 / 350,066 / 178,133 / 349,140（register_append#1 那笔 480,219 已高于旧阈值 475,000，
  若仍用旧断言会被拒；而节点值只有 438,201）。
- 原始节点记录：`raw-onchain-fullchain-node-records.json`（区块内交易记录自带的 storageMass/mass/computeMass、区块 hash/daaScore；签名脚本只留字节数与 sha256 前 16 位）。
  close_commit 与 convert_to_claim 的**完整交易（含全部见证字节）**在 `close_commit_full_tx.json`、`convert_to_claim_full_tx.json`，供 NWT 做字节层验证。
- 各步 leaf 输入的链上真实面值（NWT N-1 向量来源）：register_append#1 花掉的 leaf（genesis 输出0）= 20,000,000；register_append#2 花掉的 leaf（bet1 输出0）= 20,000,000；
  market_seal 花掉的 leaf（bet2 输出0）= 20,000,000，均 = `CONTINUATION_OUTPUT_SOMPI`。
- **close_commit 上链 = B4-1 修复（先挂 CovenantBinding 再签）的最终确认**：5 个委员签名被真实共识接受（validSigs≥4）。NWT 的 sighash 移植只是离线证据，这是节点本身的判定。

## B4-2 deadline / past-median-time（NotFinalized 已真实复现）

- **第一次提交 close_commit 被拒**：`transaction input #0 is not finalized`（NotFinalized）。当时 simnet `pastMedianTime` 落后墙钟 90,482 s（deadline = 创建市场时的 now−3h，lock_time > pmt）。
  即便"deadline 已过 3 小时、本地守卫放行"，节点仍拒——构造守卫只比较墙钟是单边代理，NWT 的判断成立。
- simnet 的 pmt 窗口是稀疏采样的：补挖 300 块（344 ms，1.15 ms/块，块时间戳≈now）后 pmt 滞后只从 118,414 s 降到 90,482 s；再补挖 400 块（383 ms）后降到 6,936 s，
  此时 `lock_time(deadline) < pmt`，close_commit 被接受。（共补挖 700 块、每块间隔约 1 ms；共识常量 `TIMESTAMP_DEVIATION_TOLERANCE=132`，simnet 为 TenBps。）
- **主网真实滞后（只读，不花钱）**：读本机主网节点（官方 2.0.1，`isSynced=true`）`getBlockDagInfo.pastMedianTime`，10 秒内 6 个样本，
  墙钟−pastMedianTime = **132.6 / 134.7 / 136.7 / 128.8 / 130.8 / 132.8 秒（均值约 132.5 s）**，与共识常量 132 吻合。
  ⇒ **NWT 建议的下限 120 s 低于主网真实滞后（约 133 s），在主网上按 deadline+120s 提交会 NotFinalized**。构造守卫余量改为 **300 s（≈2.2 倍）**。
  局限：样本窗口只有 10 秒；本机时钟未做 NTP 校准；余量仍是暂定值，需要更长时间多次采样确认。提交侧把 NotFinalized 归"可重试、无状态变更"仍是驱动层（批9）约束。

## 没有证明的（不许外推）

1. 全链只跑了 route A 的一个市场形状（min_bet=1，stake 1/999，seal_count=2，NO 赢，payoutRoot 为占位值 `cd…`），是 n=1；close_commit / convert_to_claim 各只有一个链上样本。
2. close_commit 的 5 个委员签名是**同一把 keypair 重复 5 次**（`committeeMode='single_operator_5x_same_key'`）：证明合约逻辑可执行，**不是** 4-of-5 门限安全。
3. `payoutRoot` 是占位值，不是由 `proto_bets` 现算的 merkle root（B4-4：驱动层 MUST，未落码）。
4. 字节层独立验证（自写解析器 + 上游编码器 + 重编 redeem）尚未做，交 NWT。
5. convert_to_claim 后没有继续 claim_draw / withdraw / ticket_reclaim（批 6–8 未落码）。

## 复现

`09_run_full_chain.mjs.txt`（全链，幂等续跑，遇断言≠节点值即停）、`10_fetch_fullchain_records.mjs.txt`（只读取回节点记录与完整交易）；
需要把它们放到 `kasia-console/scratch/_j2_simnet/` 下去掉 `.txt` 运行，并有 simnet 测试身份的 state 文件（不入库）。

## 脚本快照说明

`09_run_full_chain.mjs.txt` 是**跑这次全链时的版本**。其后按 Bettor/NWT 的裁定给 `buildConvertToClaimTxJson` 加了必填参数 `rootCloseUtxoScriptPublicKeyHex`（B4-5，
同 close_commit），所以原样重跑该脚本的 convert_to_claim 步骤会在入口 fail-closed，需要补传该参数（取自 close_commit 交易输出 0 的 spk）。
convert_to_claim 这笔上链交易本身不受影响（该断言只读、不改字节）。
