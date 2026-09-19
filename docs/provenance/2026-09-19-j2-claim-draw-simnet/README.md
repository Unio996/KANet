# 2026-09-19 J2 — simnet 全链 v2：加入 claim_draw（批6），生产映射（bettorPk = 委员公钥），驱动层判据真实使用

Bettor 派工：在 convert_to_claim 之后补 claim_draw，每步断言信号与节点值三源对账，取回完整交易与见证字节，供 NWT 做上游 VM / 字节验证 / fee cap。
D-021 合规：只含 simnet 数据；委员私钥信封**未入库**（sanitized 记录里已置换为占位说明）。

## 环境（提交前现核）

- 节点：PID 15972，官方 kaspad 2.0.1 simnet，只绑 127.0.0.1；sha256 `8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38`，`--version` = `kaspad 2.0.1`。NWT 的实验已结束并让出节点。
- builder/编码器 commit：`ef45f5681396efcb265f56897e4a5d1a5142a81b`（工作树干净）。所有七笔交易 version = 1。
- 与上一轮（`2026-09-19-j2-fullchain-simnet`）的区别：① **生产映射**：两笔下注的 `bettorPk` = 本市场委员公钥（proto.js:212-215），claim_draw 的 ticket 才有私钥可签；
  ② `payoutRoot` = `blake2b256(委员公钥 ‖ le8(1000))` 现算，不再是占位 `cd…`（route A depth-0）；③ close_commit 走**驱动层 pmt 闸** `evaluateCloseCommitTiming` 并把放行时的 pmt 作为 `pmtEvidence` 传给 builder；
  ④ 每步构造前用**节点上的真实 UTXO** 做 C1 断言（`assertSettlementInputValuesOnChain`），并把链上真实 spk 作为 B4-5 入参传给 builder。

## 结果：七笔全部真实共识 ACCEPT；断言信号 == getMempoolEntry == 区块记录节点字段（三源逐位相等）

| # | 步骤 | txid | fee 输入 | 断言 storage / compute | 节点 mempool | 区块记录 storage / mass / compute | 实付 fee(sompi) |
|---|---|---|---|---|---|---|---|
| 1 | market_genesis | `d409e5a0012f62fa09c2cb8c5dda74cceb84b93d68bae055743d0311ae7fb03d` | （首次调用） | 209,616 / 8,083 | 同 | 209,616 / 209,616 / 8,083 | 20,334,200 |
| 2 | register_append#1 | `56b70960cb2b21b1f73f0ce7dd6689e7dcc0dba2687e8e8332ec948641126f4d` | 95,000,000 | 457,504 / 33,927 | 同 | 457,504 / 457,504 / 33,927 | 43,339,900 |
| 3 | register_append#2 | `608994952dbd26e8a698ba6ff7b1ef3a948869a144e3b14d43a69bc2e95a7ad4` | 95,000,000 | 293,116 / 44,198 | 同 | 293,116 / 293,116 / 44,198 | 39,666,700 |
| 4 | market_seal | `ed2dc8a5ec6ef01a385fb41c25e5962357d83a829060ae6fbd16a5e7cfd0cd8e` | 95,000,000 | 231,312 / 60,422 | 同 | 231,312 / 231,312 / 60,422 | 34,386,000 |
| 5 | close_commit | `c2efd4a424b434b83e0f1e87ceab8031bc78fe82f5ebc6c3ae81fdf0febe6bf0` | 95,000,000 | 134,657 / 35,560 | 同 | 134,657 / 134,657 / 35,560 | 17,574,400 |
| 6 | convert_to_claim | `515c73e23220c58d583cd18192bb65147e3f34bd36656812a8ab700cfb5afe64` | 95,000,000 | 231,312 / 48,618 | 同 | 231,312 / 231,312 / 48,618 | 34,386,000 |
| 7 | **claim_draw** | `0c1d966659fbb7cbc388a42a15ac05429f2ffdf4ae8088b39eeb324295c8c06f` | 95,000,000 | 179,586 / 40,407 | 同 | 179,586 / 179,586 / 40,407 | 30,547,100 |

- **claim_draw 首次上链即被接受**：ticket 的 `authorize_spend(bettorSig)` 由 builder 用委员私钥现签（签名前 `assertTicketSigningKey` 通过），签名在 `populateGenesisCovenants` 之后对本次候选 tx 现签；
  节点接受意味着 depth-0 的 `payoutRoot = leaf` 公式（RootClaim.sil:112）、ticket 签名、KanetTokenClaim/代币输出模板校验、`claimed_bitmap` 等全部通过真实共识。
- 数值随 fee 输入面值（进而找零值）变化：本轮 register_append#1/#2/market_seal 用 95,000,000 的 fee 输入，storage 与**批3 provenance（同为 95M）**逐位相同（457,504 / 293,116 / 231,312）；
  上一轮全链（fee 输入 99M/97M/96M）的对应值略低，均为节点原始值、三源相等。convert_to_claim 本轮 231,312（95M）vs 上一轮 227,931（92M）同理。
- **C1 用节点真实 UTXO 断言全部通过**：seal（leaf/held）、close_commit（rootClose）、convert_to_claim（rootClose/held）、claim_draw（rootClaim/ticket/held）各输入的链上面值均 = 20,000,000，spk = 按当前状态现算的 artifact spk。
- **pmt 闸真实使用**：close_commit 构造前 `evaluateCloseCommitTiming` → `canSubmit=true`。⚠ 诚实说明：本次它同时报 `sla='refund_flip_open'`，是因为 simnet 市场的 deadline 我设成"创建时 now−3h"，pmt 领先 deadline 约 2.5 h，
  不是 simnet 行为异常；主网真实 deadline 之后驱动应在 +1h 前提交。
- 原始节点记录 `raw-onchain-fullchain-node-records.json`（本目录，七笔）；`close_commit_full_tx.json`、`convert_to_claim_full_tx.json`、**`claim_draw_full_tx.json`**（含全部见证字节）；
  `chain3-sanitized-record.json`（各步 txid、状态、断言信号、C1 记录；已去掉委员私钥信封）。

## 给 NWT：claim_draw 的输入来源（ctor / 状态）

- **RootClaim 输入**（input 0）：outpoint = convert_to_claim 输出 0；state 8 字段 = `{local_yes:1, local_no:999, count:2, pool_value:1000, closed:1, winningSide:1, payoutRoot: blake2b256(委员公钥‖le8(1000)), claimed_bitmap:0}`；
  ctor = `(ps_tmpl_hash, marketId, 上述 state 各值, token_tmpl_hash, claim_tmpl_hash)`（`computeRootClaimGenesisArtifact`）；covenant_id = convert_to_claim 输出 0 的 covenant_id。
- **ticket 输入**（input 1）：outpoint = register_append#2 输出 1；ctor = `(bettorPk=委员公钥, direction=1, stake=999, shardPoolId=marketId)`（PoolSideTicket，**普通 P2SH、无 covenant**，值 20,000,000）；
  见证 `authorize_spend(bettorSig)`；`ticket_prefix_len=1`、`ticket_suffix_len=32`（由该 ticket 的 state_layout 得）。
- **held 代币输入**（input 2）：outpoint = convert_to_claim 输出 1；KTT ctor = `(amount=1000, owner=RootClaim covenant_id, …)`；见证 KTT transfer zero-out `[0]`。
- **fee 输入**（input 3）：relay 签。输出：0 = KanetTokenClaim genesis（`market_cov_id`=RootClaim covenant_id，`winner_pk`=委员公钥，`amount`=1000，`token_tmpl_hash`），1 = 代币转出（owner=新 KanetTokenClaim covenant_id），2 = 找零。
- claim_draw **节点值**：storageMass=179,586，computeMass=40,407，实付 fee=30,547,100 sompi（fee 输入 95,000,000）。**请按 F3' 推 `feeProfile.claim_draw.cap` 专属值**（目前是暂借 1.0 KAS 的占位）。

## 没有证明的（不许外推）

1. n=1：route A 一个市场形状（min_bet=1，stake 1/999，NO 赢，单赢家 depth-0）；只有 full 分支（payout == pool_value）。
2. ticket 与 close_commit 委员签名都用**同一把委员 keypair**（v0 单操作员映射）：不证明多用户/独立 bettor 密钥，也不是 4-of-5 门限安全。
3. claim_draw 之后（KanetTokenClaim.spend / withdraw、输家 ticket 回收）尚未落码、未上链。
4. 字节层独立验证（自写解析器 + 上游编码器 + 上游 VM 跑 ticket authorize_spend 与 RootClaim 入口）交 NWT。
5. C1 在这里是**脚本层**用节点真实 UTXO 调用断言函数，不是驱动接线（批9）；chainUtxos 必须由驱动从节点取、且读 pmt 的节点必须就是最终提交所用的节点（Bettor/NWT 提醒，写入批9 接线要求）。

## 复现

`11_run_full_chain_v2.mjs.txt`、`12_fetch_claimdraw_records.mjs.txt`；放到 `kasia-console/scratch/_j2_simnet/` 下去掉 `.txt` 运行，需要 simnet 测试身份 state（不入库）。
