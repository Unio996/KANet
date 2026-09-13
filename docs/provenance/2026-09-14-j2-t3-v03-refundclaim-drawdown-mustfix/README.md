# RefundClaim.sil — draw-down MUST-FIX（第五处同 class，ledger 1164① 三步之二）

背景：`docs/2026-09-14-j2-t3-market-set-token-rewrite-design-v0.4.md` §1 记录了 NWT 发现的这个预先存在
（非代币化引入）bug——`refund_payout` 缺少"`remaining==0` 无续约分支"，同一 class 此前已在四处修过
（`PayoutShard.claim`/`PayoutShard.refund_claim`/`PayoutShardV2.refund_claim`/`RootClaim.claim_draw`，均引用
`docs/2026-09-13-j2-t3-market-set-token-rewrite-design-v0.1.md §3.0` 与 Bettor ledger 1068）。本文件是第五处，
Bettor 1164① 明确要求"draw-down 修 + 恰好为 0 向量"。

## 改动

`refund_payout` 原来无条件重建 continuation（`pool_value - tk.stake`），最后一个 refund claimant 精确清零
`pool_value` 时会产生 0-value continuation output，被 Kaspa dust 策略拒绝——即最后一位退款人事实上无法退款
（liveness 缺陷，非资金安全洞，但同样是"合约按设计根本走不完"的 bug）。改成与已修四处逐行同款的分支：

```
if (pool_value == tk.stake) {
    require(tx.outputs[payoutOutIdx].value == pool_value);   // 显式守恒
} else {
    require(tx.outputs[rootOutIdx].value == pool_value - tk.stake);
    validateOutputState(rootOutIdx, State { ...pool_value: pool_value - tk.stake... });
}
```

不变量：`remaining==0` ⇒ 无续约输出；`remaining>0` ⇒ 恰一续约且 `value==remaining`。

## 向量（`run.log`，4/4 PASS，NWT 明确会测"恰好为 0"边界）

与已修四处同一 4-向量形状（`docs/provenance/2026-09-14-j2-t3-v03-drawdown-mustfix/mk_drawdown_vectors.mjs`
的 `DD-PS-*`/`DD-PSV2-*` 系列）：

| 向量 | 验证点 |
|---|---|
| `DD-RC-refund-1_pass_exact_no_continuation` | pass：`pool_value=80`，退款 `stake=80` 恰好清零——**这正是 NWT 说要测的"`pool_value - tk.stake` 恰好 0"边界**——无续约输出，`tx.outputs` 只有 1 个（payout），`rootOutIdx` 越界但因为 `if` 分支根本不引用它，安全 |
| `DD-RC-refund-2_pass_partial_with_continuation` | pass：`pool_value=80`，退款 `30`，续约 `50`，正常部分退款路径不受影响（回归确认） |
| `DD-RC-refund-3_fail_partial_continuation_wrong_amount` | fail：续约输出金额写错（`49` 而非 `50`） |
| `DD-RC-refund-4_fail_partial_missing_continuation` | fail：该续约的场景下续约输出整个缺失（`tx.outputs` 只有 1 个，`rootOutIdx=1` 越界，这次 `else` 分支确实要用它） |

回归确认：本目录同时重跑了 §7 迁移那批 3 条烟雾向量（`docs/provenance/2026-09-14-j2-t3-v03-syntax-migration-refundclaim/`），
针对改完 draw-down 之后的合约再跑一遍，3/3 仍 PASS（`SMOKE-refund_payout_pass_partial_drawdown` 走的正是新
`else` 分支，形状不变）。

## MANIFEST

见 `MANIFEST.sha256`（n/n 文件计数核对）。
