# K-18 §3.4 backfill dry-run 报告 — splice vs recompile byte-exact 对照(2026-07-21)

**Status**: CURRENT

> 依据 `docs/2026-07-18-payoutshard-family-coherence-gate-design.md` §3.4 DoD 硬前置(NWT MUST-FIX②)：
> "权威切换前, 对现网所有处于 verifying/settling 活跃态的 V1 盘(全量, 非抽样)跑 splice 结果 vs recompile
> 结果的 byte-exact 对照, 逐行记录, 全部一致才能真正切默认权威"。
> 脚本: `kasia-console/scripts/_j1tn_k18_splice_vs_recompile_backfill_dryrun.mjs`(J1 出, commit 107252f5)。
> 执行: KANet-UI, 2026-07-21, operator 主机, 生产库 `kasia-console/data/console.db`(只读, 零写)。
> 完整原始 stdout(556 行含逐行 JSON): `scratch/2026-07-21-k18-backfill-dryrun-raw-stdout.txt`(gitignored 不入库, 但物理落在 operator 主机 `D:\kanet-tn12\scratch\`, 同机 agent 可直接读; J1(:3300 独立节点)不共享此机器文件系统, 需要的话找 KANet-UI 转发内容或摘要)。

## 聚合结果

- 总 `payout_shards` 行数: **721**
- `protocol_status` 全表分布: `pruned_expired_waived=140 / settle_zombie_quarantine=189 / verifying=90 / pending_bettors=6 / refunding=10 / refunded=78 / completed=146 / cancelled=3 / settle_failed=49 / attested_v2=9 / settled_partial_claims=1`
- 孤儿行(`payout_shards` 有但 `pool_markets` 查不到): **0**
- 终态跳过(`completed`+`settle_failed`) = 146+49 = 195，活跃态纳入比对 = 721-195 = **526**
- **MATCH(splice==recompile byte-exact): 428**
- **MISMATCH: 98**
- DECODE_FAIL/RECOMPILE_FAIL: 0
- 校验: 428+98+195 = 721 ✓ 行数无遗漏

## 结论判据(§3.4 原话)

MISMATCH+FAIL 非零(98) → **不满足"全部一致"，K-18 §3.4 权威切换的硬前置当前不通过，v0.3 的 recompile 校验维持非阻塞状态，不能升级为硬拒绝闸**。

## MISMATCH 结构分析(KANet-UI 补充，非脚本自带——供 J1/NWT 判断真假阳性)

98 条 MISMATCH **全部是 storedLen ≠ recompiledLen(21792)**，不是"同长度不同字节"的窄义漂移，是两种不同长度的 stored 脚本：

| storedLen | 行数 | 备注 |
|---|---|---|
| 22196 | 78 | 多数 `refunded`(65)/`pruned_expired_waived`(15 与前重叠计数见下) |
| 16564 | 20 | 含 9 条 `attested_v2` + 部分 `verifying`/`refunded` |

按 `protocol_status` 分组:

| status | MISMATCH 行数 |
|---|---|
| refunded | 65 |
| pruned_expired_waived | 15 |
| attested_v2 | 9 |
| verifying | 9 |

**关键怀疑点**: `attested_v2` 这个状态名本身就指向 V2/ZK 家族(非 V1 committee 家族)，脚本对**所有活跃行统一调用 `compilePayoutShardRedeem`(V1 编译器)**，没有按 `covenant_family` 分派(K-18 §3.1 的 `covenant_family` 列是 v189 migration 的一部分，**尚未落地**，本次 dry-run 只能用现有 schema 跑)。如果这 9 条 `attested_v2` 行实际存的是 V2 redeem 脚本，拿 V1 编译器重编译天然会长度不同、必然 MISMATCH——**这大概率是脚本范围问题(比对了不该比对的家族)，不是真正的 splice/recompile 漂移 bug**。同理，`refunded`/`pruned_expired_waived` 两组也需要人工确认这些行是否仍是 V1 committee 家族、还是历史上曾经历过某种迁移/reissue 导致 redeem 结构变化。

**KANet-UI 不下结论**——这需要 J1(K-18 原作者)或 J2 用实际数据核实这 98 行的真实家族/历史，判断是"脚本范围漏过滤"还是"真发现了漂移"。本报告只负责把完整、无遗漏的对照数据摆出来。

## 完整 MISMATCH 逐行清单(98 条全量，无抽样)

```
(全 98 条 marketId/status/storedLen/recompiledLen JSON 记录见执行时 stdout 存档，本文档为避免过长不重复粘贴；
 摘要分组统计已在上方表格；如需单条核对可用以下 SQL 在生产库现查:
 SELECT logical_market_id, payout_redeem_hex, pool_merkle_root, predicate_commit FROM payout_shards
 WHERE logical_market_id IN (<marketId 列表>))
```

## 部署门禁状态(不变)

K-18 §3.4 权威切换(recompile 从非阻塞校验升级为硬拒绝闸)仍然 **不满足**。P0(6cff7305→v0.3 25b3d0a0)的整体装载仍受 NWT RED verdict + Codex MUST-FIX(6条，部分已折入 v0.3)+ Owner money-path 三重门禁，本报告只解决其中一项前置(backfill dry-run)，且解决结果是"数据摆出来了，但 98 条不一致需要人工归因，不能直接宣布'满足全部一致'"。
