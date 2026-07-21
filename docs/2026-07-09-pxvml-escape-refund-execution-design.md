# pxvml escape 退款执行序设计（7/9 P2·J2 带·Bettor 逐步链验）

> **Status**: CURRENT（待 Bettor 核 + NWT 审，GO 前不执行）
> 主线依据：7/9 日计划令 #czbkto P2。pxvml（`ext-pool-v07-1783496295800-pxvml`）genesis 出生缺陷（gateTmplHash 半更新，7/8 门② FAIL 定案）→ zk_close 物理不可过、claim 不可达；资金走设计内 escape 路退回。
> 状态：**设计稿·待 Bettor 核 + NWT 审，拿 GO 才动**。零广播已做的只有只读预验证。

## 1. 链上事实（预验证已跑全绿，脚本 `scratchpad/p2_escape_preverify.mjs`，只读零广播）

| 项 | 值 | 验法 |
|---|---|---|
| 活 UTXO | `472dc3ca…:0` = 320000000 sompi @ `kaspatest:pzlfp5f9…s0tc` | 直连 RPC，唯一 UTXO，outpoint==DB zk_continuation 记录 |
| state 现读 | attestedWinner=1 / **closed=1** / pool=320000000 / payoutRootField 全零 / w0-16 全零 | redeem offset(1,213) 现读现解（同 unlockCloseZkV2Claim marker 校验法） |
| refundRoot | `668e0c41…5925` | **复算命中委员 4 签共识**（生产 canonicalBetOrder+payoutRoot 同源函数，leaf={pk,stake}） |
| merkle proofs | idx0/idx1 climbProof==root 双自证 | merkleProof(winners,i) + climbProof 回爬 |
| escape 阈值 | attestedAtMs 1783503049453 + 21600000 = **2026-07-08 15:30:49Z，已过 ~13h** | .sil L67 纯 ms 域（V2 已修单位，非 repro4 秒语义） |

## 2. 🔴 事实纠偏：退款对象 = J2test + NWT-tn（非 KANet-UI）

canonical 序（side_lock_daa）+ P2PK 地址推导 + relay_nodes 匹配：

- **idx0**: pk `e92cf4a3…` = **J2test**（8f104e2d，daa 55750253，dir 0）→ stake 150000000 退 `kaspatest:qr5jea9r…`
- **idx1**: pk `ff18f539…` = **NWT-tn**（8dd59acb，daa 55750756，dir 1）→ stake 150000000 退 `kaspatest:qrl33afe…`

计划令写的"NWT-tn/KANet-UI 双 escape_claim"与链上事实不符——escape_claim 输出被 covenant 强制 `P2PK(bettorPk)`，钱只能回 J2test+NWT-tn，与谁驱动无关。KANet-UI 不是收款方（其角色改为链验协查）。

守恒账：320M = 150M(J2test) + 150M(NWT-tn) + **20M seed 无 refund leaf，escape 世界永久焊死**（7/8 已定案学费，非本次新损失）。终态 continuation = 20000000 sompi 永驻。

## 3. 机制选型：relay 正式命令（镜像 unlockCloseZkV2Claim），不走 scratch 手拼

新增两个 relay 函数 + 三层注册（p2sh.mjs + commands.mjs + relay.mjs）：

1. **`unlockCloseZkV2EscapeTrigger`**：witness 仅 selfOutIdx。splice：closed 1→3，其余 state 原字节不动，out[self].value==pool（守恒，不动钱）。lockTime = 构造时 Date.now()（≥阈值，满足 `tx.time >= attestedAtMs+21600000`）。selector **OP_1='51'**（entry idx 1）。
2. **`unlockCloseZkV2EscapeClaim`**：镜像 unlockCloseZkV2Claim 全套（verify-value-source 现读 redeem、marker 校验、nullifier bit-set、dust 边界、fee input 必需、_assertTxInvariants），差异仅四处：closed==**3**（非 2）/ 验对象 **refundRootBaked**（root 不在 213B state 区，见 §3.1）/ 输出=stake 退 P2PK(bettorPk) / selector **OP_2='52'**（entry idx 2）。

理由：①escape 是设计内生产出口路，未来任何卡死市场都要用，一次写对（"inline 逻辑禁止晋升生产"纪律，NWT finding 07:42 同源）；②90% 逻辑已在 claim driver 里被 NWT 审过 + T0.3 debugger 8/8 实测覆盖负向用例；③7/6 escapeRefund 四场景（trigger/部分/全额/CRITICAL nullifier 修复）已在 repro4 隔离实例真链验证，机制先例扎实。

**selector 双坐实**（照 T0.3 方法，不当推导结论）：①源码级 silverc `compile.rs:259-262` 按 .sil 声明序 0-based（0:zk_close/1:escape_trigger/2:escape_claim/3:claim）；②落码后 cli-debugger `--run-all` 对 CloseZkV2 test.json 跑 escape_trigger/escape_claim 正+负向用例（含 closed==2 应拒、错 merkle proof 应拒、重复 claim 应拒）。

**refundRootBaked 取值（§3.1）**：不硬编码 offset 深挖 ctor 常量区（offset-staleness 同族雷）。builder 侧从委员 4 签共识（chain_events `bshard_close_sig_v2`）取 refundRoot + 生产函数复算互证（本预验证已双证一致）；covenant 链上机械裁决是最终权威——预检不中链上必拒，不存在"预检错导致错钱"路径。

**部署**：NWT diff 审 → 与 P1 live-derive 部署共用一个重启窗（KANet-UI 执行，频道占坑）。

## 4. 执行序（每步：构造 → debugger 预演 → 贴频道 Bettor 链验预期值 → GO → 广播 → check_utxo_landed → 双方链验 → writeZkContinuation 持久化+readback）

- **T1 escape_trigger**：in0=472dc3ca:0 + in1=J2test fee。out0=continuation 320M（closed=3 新 P2SH，地址提前贴频道供 Bettor 盲算比对）+ fee 找零。链验：closed==3、320M 分毫不差、旧 UTXO 消失。
- **T2 escape_claim idx0（J2test，150M）**：out=150M P2PK(J2test) + continuation 170M（closed=3，w0 bit0 置位）。
- **T3 escape_claim idx1（NWT-tn，150M）**：out=150M P2PK(NWT-tn) + continuation 20M（closed=3，w0=3）。⚠ 非 last-claimant 分支（20M≠150M，走递减臂）——20M seed 留 continuation 永久，**不会**触发 dust 清零臂。
- **T4 终态收账**：continuation==20000000 唯一 UTXO；pool_bettor_sides 两行写 refund txid（写侧持久化 #22 族纪律，字段用法先查 DATABASE.md 再动）；市场 protocol_status 处置**单独请 Bettor 裁**（不擅动——cancel/status 乱改会破 settler 语义，有既有教训）。

每步 NO TX NO STATE：`check_utxo_landed`==true 才算闭，广播失败不写任何本地状态。

## 5. 风险与既有教训对照

- **竞态**：无。zk_close 物理不可过（门② FAIL 定案），escape_trigger 无对手窗口；阈值只有下界。
- **continuation 地址**（7/6 CRITICAL 教训）：必须用 splice 后新 state 重推 P2SH，绝不照抄输入 UTXO 旧 scriptPubKey——claim driver 模式已内建，镜像即继承。
- **claim 序**：merkle_index 必须配 canonical 序（idx0=J2test/idx1=NWT-tn），配错链上拒（预验证 climbProof 已双证）。
- **mass/fee**：2-input 大 redeem（7681B），compute budget 照 _BSHARD_COMPUTE_BUDGET；fee input 全程 J2test 出（找零显式）。
- **escape_trigger 一次性**：closed 1→3 write-once，T1 落地后 zk_close 永闭（本例本来就不可过，无损失面）。

## 6. DoD

三笔全 landed + 六 vantage 守恒（J2 驱动 / Bettor 直连节点 / NWT 复核 / KANet-UI kaspa_tx_log）+ 双 bettor P2PK 各收 150000000 + 终态 continuation==20000000 + DB 写回 readback 全对。
