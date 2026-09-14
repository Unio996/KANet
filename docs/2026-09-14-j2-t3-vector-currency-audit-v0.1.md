# T3/T1/T2 向量现行性审计表 v0.1（ledger 1210）

as-built 附录，配 `docs/2026-09-14-j2-t3-as-built-and-merge-readiness-v0.5.md`。动因：ledger 1209 发现
"历史向量集因 ctor 变更报'不适用重跑'"可能掩盖"当前代码零现行向量"的合入前提缺口（已在 `PayoutShard.sil`/
`PayoutShardV2.sil` 修过，见 `a8d05729`/`18c5d4c6`）。本表把同一检查方法系统化跑遍全部 10 个文件，逐入口
用 `cli-debugger --run-all`（或 `--test-name ... -r` 交互步进）**实测**（不是读 README 推断）对当前编译产物
是否至少有 1 条通过的向量，任何"不一致"就地补。

## 方法

对每个文件：(a) 直接读源码数 ctor 参数（`grep -n "^contract <Name>"` 起到 `) {`）；(b) 找该文件当前引用的
"现行套件"或最近一次修改随附的 provenance 目录，读其 ctor JSON/生成脚本参数数；(c) `git log -1 --oneline --
<path>` 拿最后改动 commit；(d) 逐入口跑该目录的 test.json，`grep -c "^  PASS/FAIL"`，任何入口零 PASS 则标
"不一致"；(e) 记录现行套件目录名。

## 结果总表

| 文件 | ctor(源码现行) | ctor(现行套件用) | 一致? | 最后改动 commit | 入口 | 现行套件目录 | 该入口现行 PASS? |
|---|---|---|---|---|---|---|---|
| `RootClose.sil` | 12 | 12 | ✅ | `60307fc1` | `close_commit` | `2026-09-14-j2-t3-v03-rootclose-tokenization` | ✅ 6/6 |
| | | | | | `refund_flip` | 同上 | ✅ 6/6 |
| | | | | | `convert_to_claim` | 同上 | ✅ 6/6 |
| | | | | | `convert_to_refundclaim` | 同上 | ✅ 6/6 |
| `ShardLeaf.sil` | 12 | 12 | ✅ | `9ff095a3` | `register_append` | `2026-09-14-j2-t3-v03-shardleaf-tokenization` | ✅ 10/10 |
| | | | | | `consolidate_to_payout` | `2026-09-14-j2-t3-v03-shardleaf-payoutshard-handoff-fix` | ✅ 3/3（`V-HOF-1/5/6`） |
| `ShardLeaf_direct.sil` | 12 | 12 | ✅ | `de7582ca` | `register_append` | `2026-09-14-j2-t3-v03-shardleafdirect-tokenization` | ✅ 8/8 |
| | | | | | `convert_to_rootclose` | 同上 | ✅ 6/6 |
| `PayoutShard.sil` | 25 | 25 | ✅ | `e0ae924a` | `absorb`/`close_attest`/`claim`/`cancel_attest`/`refund_claim`（5 入口全覆盖） | `2026-09-14-j2-t3-v03-payoutshard-current-suite` | ✅ 43/43（见下方重跑确认） |
| `PayoutShardV2.sil` | 30 | 30 | ✅ | `adc37c0a` | `absorb`/`close_attest`/`cancel_attest`/`refund_claim`/`zk_handoff`（5 入口全覆盖） | `2026-09-14-j2-t3-v03-payoutshardv2-current-suite` | ✅ 44/44（见下方重跑确认） |
| `RootClaim.sil` | 13 | 13 | ✅ | `6156e98d` | `claim_draw` | `2026-09-14-j2-t3-v03-rootclaim-tokenization` | ✅ 6/6 |
| `RefundClaim.sil` | 12 | 12 | ✅ | `6bc8ff55` | `refund_payout` | `2026-09-14-j2-t3-v03-refundclaim-tokenization` | ✅ 6/6 |
| `CloseZkV2.sil` | 28 | 28 | ✅ | `e52cc887`（纯注释，见下方专项核验） | `zk_close`/`escape_trigger`/`escape_claim`/`claim`（4 入口全覆盖） | `2026-09-14-j2-t3-v03-closezkv2-tokenization`（part1+part2） | ✅ 23/23 |
| `KanetTestToken.sil`（T1 v0.7） | 10 | 10 | ✅ | `32e480d9` | `mintOrTransfer`/`transferPolicy`（单入口模型，`genesisOrTransfer`） | `2026-09-14-j2-t1-v06-implementation` | ✅ 14/15（1 条 `V-harness_flip_of_V-T-1_expect_fail` 按设计翻转臂 FAIL，非缺口，见该 commit message） |
| `KanetTokenClaim.sil`（T2） | 5 | 5 | ✅ | `a8f8b913` | `spend`（单入口） | `2026-09-14-j2-t2-kanettokenclaim` | ✅ 9/9 |

**结论：10 个文件、全部入口，逐一实测确认对当前编译产物至少有 1 条（多数是全部历史向量）现行通过；无一处
"不一致"或"未打勾"。**

## Bettor 四项重点自查（ledger 1210 点名）——逐一实测结论

### 1. `ShardLeaf.sil` — `9ff095a3` 改 `consolidate_to_payout` 签名后，`register_append` 旧向量是否仍现行？

`register_append` 与 `consolidate_to_payout` 同文件不同入口，`9ff095a3` 只动了后者的入口体（未改 ctor）。
实测：`docs/provenance/.../shardleaf-tokenization/ShardLeaf.tokenization.test.json` 对当前 `ShardLeaf.sil`
`--run-all`：

```
V-register_append-1..10 全部 PASS（10/10）
V-consolidate_to_payout-1..5 全部 FAIL（预期内——该文件里这 5 条是 9ff095a3 之前的旧签名快照，
  已被 shardleaf-payoutshard-handoff-fix 目录的 V-HOF-1/5/6 取代，两处不冲突，同 PayoutShard 那批的
  "superseded" 处置一致）
```

**结论：`register_append` 现行，无需补。`consolidate_to_payout` 的现行覆盖在 handoff-fix 目录，已现行
（`V-HOF-1_pass_shardleaf_side_consolidate_to_payout`/`V-HOF-5`/`V-HOF-6` 三条 PASS）。** 已给
`shardleaf-tokenization/README.md` 顶部补状态注记（见下）。

### 2. `RootClaim.sil` — ctor 10→13，向量是否现行？

实测 `docs/provenance/.../rootclaim-tokenization/RootClaim.tokenization.test.json` 对当前 `RootClaim.sil`
`--run-all`：**6/6 PASS**（`V-RCL-TOK-1..6`）。ctor 现读 13 参数（`ps_tmpl_hash`/`shard_pool_id`/7 个
`init_*` state 字段/`token_tmpl_hash`/`claim_tmpl_hash`/`market_suffix_hash`），与套件用 ctor 一致。
**结论：现行，无需补。**（该文件自 `6156e98d` 后再无后续 commit 改动，本就不该陈旧，此次实测排除"假设未
验证"风险。）

### 3. `RefundClaim.sil` — ctor 9→12，向量是否现行？

实测 `docs/provenance/.../refundclaim-tokenization/RefundClaim.tokenization.test.json` 对当前
`RefundClaim.sil` `--run-all`：**6/6 PASS**（`V-RC-TOK-1..6`）。ctor 现读 12 参数。**结论：现行，无需补。**
（同 RootClaim，自 `6bc8ff55` 后再无后续改动。）

### 4. `CloseZkV2.sil` — `e52cc887` 注释改动后产物 hash 是否不变？

**不是靠读 diff 推断"只改了注释"就下结论**——实测流程：

1. `git show e52cc887 -- CloseZkV2.sil`：diff 只涉及两处 `//` 开头行的措辞（ZERO32 守卫注释同步 1173 用语），
   逻辑行零改动（`grep -v '^\s*//'` 剥离注释后 diff 两版文件字节级相同）。
2. 更强验证——**实际编译前后两版**，用同一份 ctor JSON（`closezkv2-tokenization/CloseZkV2.ctor.json`，
   全零锚定值，结构不依赖具体值）分别喂给隔离工具链 `silverc.exe`：

   ```
   sha256(before compiled) = 8350a6fa3f234d06076e31be5d77d7e04e97ffbf3163657d1ed22311b050b45b
   sha256(after  compiled) = 8350a6fa3f234d06076e31be5d77d7e04e97ffbf3163657d1ed22311b050b45b
   ```

   **两次编译产物 SHA256 完全一致**——不只是"没改逻辑行"的文本推断，是编译产物字节级证明零影响。

**结论：`e52cc887` 对编译产物零影响，确认为纯注释改动。** 现行套件（`closezkv2-tokenization` part1/part2，
23 条）对当前源码全部重跑 PASS，无需任何补救。

## 装配过程中发现的一处需要状态注记的历史陈旧（非 Bettor 点名，主动发现，同一病灶）

**`docs/provenance/2026-09-14-j2-t3-v03-rootclose-zero32-guard/`**（`24aea3cc`，RootClose 的
`convert_to_claim`/`convert_to_refundclaim` ZERO32 守卫向量，6 条）对**当前** `RootClose.sil` 实测：

```
全部 6 条 FAIL：Error: "constructor expects 12 arguments, got 11"
```

**根因**：该快照早于随后 `60307fc1`（同文件、同一天）的完整代币化改动，ctor 当时还没有 `token_tmpl_hash`
字段（11→12）。**不是安全回退**——`60307fc1` 的 `RootClose.tokenization` 现行套件里
`V-convert_to_claim-2_fail_bare_output_no_covenant_id_zero32`/
`V-convert_to_refundclaim-2_fail_bare_output_no_covenant_id_zero32` 两条，语义与 `V-RCLZ-2`/`V-RCLZ-5`
逐字一致（同一个 ZERO32 目的地守卫），且在当前 ctor 下 PASS——ZERO32 守卫本身在当前代码里连续现行被覆盖，
只是覆盖它的向量文件换了。已按同批 `payoutshard-absorb-ab11-and-batest` 等目录的既有处置惯例，给
`rootclose-zero32-guard/README.md` 顶部补"superseded by"状态注记（不改原文），不产生代码改动。

## 与 §2 表（`docs/2026-09-14-j2-t3-as-built-and-merge-readiness-v0.5.md`）的关系

本表是该稿"全部向量通过"合入前提的独立、逐文件、逐入口再验证，方法与 ledger 1209 的
PayoutShard/PayoutShardV2 处置完全一致。结论：**merge-readiness v0.5 §2 表关于"现行套件"的记录准确，未发现
新的隐藏陈旧缺口**（除上面新发现并已就地状态注记处置的 RootClose zero32-guard 一处，无代码改动需要）。
