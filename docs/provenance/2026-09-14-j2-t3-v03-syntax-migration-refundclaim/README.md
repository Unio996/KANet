# RefundClaim.sil — §7 纯语法迁移(v1.0.0)

Bettor ledger 1164①"RefundClaim 三步(迁移 → draw-down 修 + 恰好为 0 向量 → 代币化)"之第一步。标准同其余
四份 §7 迁移(CloseZkV2/RootClose/ShardLeaf/ShardLeaf_direct): 编译通过 + 既有向量不变(本文件此前**没有**任何
test.json，补 3 条烟雾向量证明) + **零业务逻辑改动**。

## 改动(纯语法, 逐条列清单方便 diff 审)

1. `entrypoint function refund_payout(...)` → `entry refund_payout(...)`。
2. `validateOutputState(rootOutIdx, { ... })`（裸 struct 字面量）→ `validateOutputState(rootOutIdx, State { ... })`
   （具名 struct 字面量, v1.0.0 强制）。
3. `byte[34] bettorLock = new ScriptPubKeyP2PK(...)` → `byte[36]`（v1.0.0 P2PK 脚本长度断裂变更, 同其余四份
   §7 迁移文件已踩过的同一坑）。

**没有**动 `readInputStateWithTemplate` 调用、`require` 顺序、字段语义——`refund_payout` 目前仍是"读 dust-ticket
→ 无条件重建 continuation（`pool_value - tk.stake`）"的原始形状，含其已知的 draw-down bug（`pool_value==
tk.stake` 时仍强制续约, 会产生 0-value output 被 Kaspa dust 策略拒绝）——**这个 bug 本次不修**, 按三步计划留给
下一个 commit（draw-down 修 + 恰好为 0 向量）。

## 向量(`run.log`, 3/3 PASS)

复用既有 `docs/provenance/2026-09-14-j2-t3-v03-drawdown-mustfix/PoolSideStub.sil`（dust-ticket 替身合约, State
形状对齐 `Tk{bettorPk,direction,stake,shardPoolId}`）编译真实 ticket 实例，`signature_script_hex` 供完整编译
字节码（`readInputStateWithTemplate` 的既定测试惯例，`state:`/短占位符都会读错）。

| 向量 | 验证点 |
|---|---|
| `SMOKE-refund_payout_pass_partial_drawdown` | pass：pool 100 内退 60，continuation `pool_value=40`，`output-bind weld` 精确核对 |
| `SMOKE-refund_payout_fail_not_cancelled` | fail：`closed=0`（未 cancel）结构性拒绝 `require(closed==2)` |
| `SMOKE-refund_payout_fail_ticket_wrong_pool` | fail：ticket 的 `shardPoolId` 跟本 pool 不符, `require(tk.shardPoolId==shard_pool_id)` 拒 |

## MANIFEST

见 `MANIFEST.sha256`（n/n 文件计数核对）。
