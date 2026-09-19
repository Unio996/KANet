# 2026-09-19 J2 — simnet：ticket_reclaim（批8，输家 ticket 自我回收，`PoolSideTicket.authorize_spend`）真实共识 ACCEPT + 两条负向臂被拒

> **STATUS-NOTE（2026-09-19，J2；本文其余内容一字未改）**：本目录记录的是批8 **v1 形状**（单输入、builder 已完整签名，提交 `5e62e24f`）。Bettor 账本 1524 裁定②改形状后已被 `2026-09-19-j2-ticket-reclaim-v2-simnet/` 取代。本目录仍有效的证据：单输入形状本身的共识 ACCEPT、篡改签名负向臂、"本地 wasm 低估费被节点拒"的实测。**失效的结论**：本文"批9 接线阻塞项"一节只讲了空 `signInputIndices`，实际更深的阻塞是 relay fee 估算器与节点最低费之间无可行 fee，见 v2 目录；本文写的 `feeProfile.ticket_reclaim.cap` 2,000,000 占位随形状变更作废。


Bettor 放行批8（账本 1491 输家自签回收已在 simnet ACCEPT；回收 2,000,000 sompi 是当时的保守固定值，**不当生产算法**）。在批6/7 的同一条 simnet 链（chain3）上追加第九步：回收**输家 bet1** 的 ticket。
D-021 合规：只含 simnet 数据；委员私钥信封**未入库**（sanitized 记录里已置换为占位说明）。

## 环境（提交前现核）

- 节点：PID 15972，官方 kaspad 2.0.1 simnet，只绑 127.0.0.1；`D:\rusty-kaspa-v201\kaspad.exe` sha256 `8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38`，`--version` = `kaspad 2.0.1`（与批3–7 同一二进制）。
- builder/编码器 commit：`5e62e24f`（simnet 运行时工作树 = 批7 提交 `5efbc8fa` + 同一批未提交的 builder 改动；运行后未再改 builder 代码，仅改了 anchors 文字/文档）。交易 version = 1。
- 运行前 NWT 会话状态：本批运行时未收到其占用节点的信号；Bettor 已放行批8 simnet 顺序（先负向臂再真笔）。

## 结果

| 项 | 值 |
|---|---|
| ticket_reclaim txid | `7138c83a452964bc50f076353ca1577bbd21aceee7575cf00200b94b902a6621`（区块 daa 4335） |
| 输入 | 仅 1 个：输家 ticket（register_append#1 输出1，20,000,000，**普通 P2SH、无 covenant**；side=0，stake=1，bettorPk=委员公钥） |
| 输出 | 仅 1 个：bettor 指定的 P2PK 收款脚本，18,837,000 = 20,000,000 − fee；无 covenant |
| 签名 | 唯一输入由 builder 现签（v0：委员 keypair，解密即用即弃），交易**已完整签名**（`signInputIndices=[]`，relay 不签任何输入） |
| 断言信号 storage / compute | 3,087 / 7,750（`inputHasCovenant=[false]`，path=relaxed） |
| 节点 getMempoolEntry | storage 3,087 / compute 7,750 |
| 区块记录 storage / mass / compute | 3,087 / 3,087 / 7,750 |
| 三源逐位相等 | ✅；builder 返回的 `massSignal` 与脚本层重算信号逐位相等 |
| fee | 1,163,000 sompi = 精确需求 775,000（100 × max(storage, compute, transient) = 100×7,750）× 3/2，向上取整到 1000 |
| C1（节点真实 UTXO） | ticket=20,000,000，spk == 按 (bettor_pk, side, stake, marketId) 现算 ✅ |
| 上链后 | 收款输出在节点上可查（18,837,000）；旧 ticket 已被花掉 ✅ |

- **首次上链即被接受**：`authorize_spend(bettorSig)` 的 `checkSig(bettorSig, pubkey(bettorPk))` 在真实共识下通过。
- **可回收闸**（builder 侧 fail-closed，先于任何解密/签名）：只有【市场已结算（closed=1）且这张票是输家（side ≠ winningSide）】才构造；赢票自花 = 永久放弃应得 payout、未结算/已取消时票还要用于 claim_draw / refund_payout。本次 `MARKET_STATE = {closed:1, winningSide:1}` 取自 chain3 记录（见"没有证明的"第 3 条）。
- **签名前断言**：`assertTicketSigningKey`（与 claim_draw 同一个）先通过。

## 负向臂（真实共识，两条都在真笔之前提交，被拒不消耗 UTXO）

**N1 篡改签名**：同一笔，只翻 ticket 的 `bettorSig` 第 1 个签名字节 1 bit →

> `failed to verify the signature script: script ran, but verification failed`

被拒版与被接受版唯一差异是那 1 bit ⇒ 拒绝只能归到 `checkSig`（节点确实校验 bettor 签名）。

**N2 fee 陷阱在真实节点上的证据**：同一笔，但 fee 只按"本地 kaspa-wasm `calculateTransactionMass` × SOMPI_PER_MASS(100)"付（即复用 `computeRequiredFeeSompiOrThrow` 会付的数）：本地 wasm mass = **3,087**，费 = **308,700** →

> `transaction … is not standard: transaction has 308700 fees which is under the required amount of 775000 for compute mass 7750`

- 节点报的所需费 775,000 恰等于 builder 的精确需求（100 × compute 7,750），也与 NWT fee 阶梯实验的"最低费=100×max(compute,normalized_transient)"一致。
- 🔴 与账本 1491 记的"本地 814 / 节点 7,750（低估 9.5 倍）"**数字不同**：本次同形状下 wasm 给出 3,087（恰等于节点的 storage mass，即 wasm 只算了 storage 一维、漏了 compute 维度），低估约 2.5 倍而非 9.5 倍。**陷阱结论不变（复用旧辅助函数会少付 → 被拒），但 814 那个数不要再引**——它对应 NWT 当时的另一种构造（具体差别未追）。
- 原文记录在 `chain3-sanitized-record.json` 的 `ticketReclaimNegatives`。

## 给 NWT：请按 F3' 推 `feeProfile.ticket_reclaim.cap` 专属值

- 布局固定：[输家 ticket] → [P2PK]；节点值 storage=3,087 / compute=7,750 / 精确需求 775,000 / builder 实付 1,163,000。当前 cap 仍是**暂借 2,000,000 sompi 的占位**（账本 1491 的保守值，仅作有界上限：`dynamicNetLossCeiling = min(2×required, cap, 1 KAS)`）。
- `ticket_reclaim_full_tx.json`（完整交易，含见证字节）、`raw-onchain-ticket-reclaim-node-records.json`（register_append#1 对照 + ticket_reclaim 区块记录）供字节层 / 上游 VM 验证。

## 🔴 批9 接线阻塞项（本批发现，未修）

relay 的 `covenant_broadcast`（`kasia-relay/src/lib/covenant-broadcast.mjs`）在 `validateSignedInputCeiling` / `validateNetLoss` / `signOnlyDeclaredInputs` 三处都对**空的 `signInputIndices` 直接拒绝**（"must be a non-empty array"）；而本批 builder 返回的是"已完整签名、无 relay 签名输入"的单输入交易。**现有 relay 路径无法广播它。**
计划 §5 写的"relay 侧无需改动"对 ticket_reclaim 不成立。可选解：① relay 新增/放宽"已完整签名单输入"广播路径（改 relay = 钱路，须走批准流程）；② 把回收改成带 relay fee 输入的形状 [ticket, fee] → [P2PK, 找零]（relay 签 fee 输入；与其他 builder 一致，但偏离 NWT 已验证的单输入形状，需重新 simnet + 重推 cap）。需 Bettor 裁定；本批只交付 builder 与 simnet 证据。

## 没有证明的（不许外推）

1. n=1：一张输家票（side=0, stake=1），收款脚本为 simnet 测试身份自己的 P2PK。
2. 签名的 bettor = 委员 keypair（v0 映射 bettor_pk === committee_pubkeys_json[0]），不是独立用户密钥。
3. `marketState={closed:1, winningSide}` 在本脚本里取自 chain3 记录，**不是**从链上 RootClose/RootClaim UTXO 状态现验的；驱动接线时必须由链上已验证状态提供（写入批9清单）。本链里 RootClaim 已在 claim_draw（full 分支）终结，无 UTXO 可验。
4. 不证明"提前自花 ticket 不影响他人资金"这一账目性质（那是 NWT 账本 1491 的源码核查结论，本批未复验）；本批只证明 builder 的闸在赢票/未结算/已取消时拒绝构造。
5. 字节层独立验证（自写解析器 + 上游编码器 + 上游 VM 跑 authorize_spend）交 NWT。
6. 未经 relay 广播路径（见上"阻塞项"）；simnet 直接用 RPC 提交。

## 复现

`15_run_ticket_reclaim.mjs.txt`（由批7 的 `13_run_withdraw.mjs` 派生：步骤1–8 因 chain3 已完成而跳过，追加步骤9）、`16_fetch_ticket_reclaim_records.mjs.txt`；放到 `kasia-console/scratch/_j2_simnet/` 下去掉 `.txt` 运行，需要 simnet 测试身份 state 与 chain3 记录（不入库）。
