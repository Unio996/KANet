# PayoutShardV2.sil — 完整现行向量套件（ledger 1209）

同 `PayoutShard.sil` 那份（`docs/provenance/2026-09-14-j2-t3-v03-payoutshard-current-suite/README.md`）
逐字同构的动因与结构，本文件只记 `PayoutShardV2.sil` 特有的坐标差异，请先读那份 README 了解背景。

## 套件构成（44 条，全部在当前 30 参数 ctor 下真实编译+运行验证）

| 分组 | 条数 | 来源 |
|---|---|---|
| `absorb` 既有 12 条（V-absorbV2-3 停用，理由同 PayoutShard.sil 那份） | 12 | 移植自 `payoutshardv2-absorb-batest-ab11`（ctor 28→30） |
| `absorb` 新增 1122 边界 3 条 | 3 | 全新 |
| `absorb` sole-source 6 条 | 6 | 移植自 `payoutshardv2-absorb-sole-source-fix`（已是当前 ctor） |
| `close_attest`/`cancel_attest` 各 6 条 | 12 | 移植自 `payoutshardv2-absorb-batest-ab11`（ctor 28→30） |
| `refund_claim` 6 条 | 6 | 移植自 `payoutshardv2-refundclaim-tokenization`（已是当前 ctor） |
| `zk_handoff` 5 条 | 5 | 移植自 `payoutshardv2-zkhandoff-tokenization`（ctor 28→30） |
| **合计** | **44** | |

`PayoutShardV2.sil` 比 `PayoutShard.sil` 多 `closeZkTmplAnchor`（ctor）+ `attestedWinner`/`attestedAtMs`/
`betsRootBaked`/`refundRootBaked`（state，共 4 个 ZK-native 字段）——`absorb` 的既有向量里
`V-absorbV2-12`/`13` 专门覆盖这 4 个字段里的 2 个（`attestedAtMs`/`refundRootBaked`），证明 AB11 手写编码
表没有遗漏 `PayoutShard.sil` 没有的字段。

## 装配时发现的三处构造问题（均已定位修正，如实记录）

1. **`splice.betsRootBaked`/`refundRootBaked` 双重十六进制编码**：`closezk_splice.json` 里这两个字段
   已经是 `"0x..."` 十六进制字符串，直接传进 `psCtor` 会被内部的 `hex()` 再编码一次（把字符串的每个字符
   当字节处理），产生 `byte[32] expects 32 bytes, got 66` 的报错——已改成先用
   `Buffer.from(v.slice(2),'hex')` 解码成真字节数组再传入。
2. **`close_attest` 与 `cancel_attest` 参数形状不同**：`PayoutShardV2.close_attest` 比 `cancel_attest`
   多 4 个字段（`new_attestedWinner`/`new_betsRoot`/`new_refundRoot`/`new_attestedAtMs`，插在
   `new_payoutRoot` 之后），最初两个入口共用同一个 `committeeArgs` 构造函数导致
   `function expects 64 arguments, got 60`——已改成按 `fnName` 分支插入这 4 个额外字段。
3. 同 `PayoutShard.sil` 那份记录的 1122 边界向量构造疏漏（漏放合法基线代币、victim 误写自持）——本文件的
   三条边界向量直接照抄已修正的版本，未重复踩坑。

## 编译验证

空 ctor → `expected 30, got 0`。真实 30 参数 ctor 完整编译 0 error。

## 运行结果（`run.log`，44/44 PASS）+ flip-expect 抽样复核

全部 44 条 PASS。抽样复核（含全部 3 条新增 1122 边界向量 + 各分组一条代表）：

| 向量 | 真实失败行 |
|---|---|
| `V-absorbV2-15_fail_bound_plus_one_9_inputs_rejected_by_length_guard` | `PayoutShardV2.sil:105`（`scanOwnedTokenInputs` 内长度守卫） |
| `V-absorbV2-16_fail_victim_stray_token_at_last_reachable_index_7` | `PayoutShardV2.sil:173`（`countStrayNonOwnedTokenInputs(...)==0`） |
| `V-absorbV2-2_fail_smuggled_second_owned_token_uncounted` | `PayoutShardV2.sil:167`（`owned_total==consolidated_pool`） |
| `V-close_attest-5_fail_victim_token_at_last_reachable_index_7` | `PayoutShardV2.sil:240`（`noTokenInput` 调用点） |
| `V-PSV2RFC-3_fail_destination_not_real_claim_template` | `PayoutShardV2.sil:509`（`validateOutputStateWithTemplate`） |
| `V-ZKHO-2_fail_wrong_templateD_anchor_mismatch` | `PayoutShardV2.sil:616`（`closeZkTmplAnchor` 全字节比对） |

## 文件清单

- `PayoutShardV2.sil` — 当前合约源码快照（与仓库当前状态一致，未改动，仅存档）
- `mk_payoutshardv2_current_suite.mjs` — 44 条向量生成脚本
- `PayoutShardV2.current-suite.test.json` — 生成的 44 条测试向量
- `PayoutShardV2.reference.ctor.json` / `PayoutShardV2.reference.compiled.json` — 参考编译产物（30 参数 ctor）
- `run.log` — `cli-debugger --run-all` 完整输出，44/44 PASS
- `README.md` — 本文件
- `MANIFEST.sha256` — 文件计数校验
