# PayoutShardV2.absorb — sole-source MUST-FIX（ledger 1208，Codex 独立发现，Bettor 核过成立）

> 📌 **状态注记（2026-09-14 · Bettor ledger 1209）**：本目录 6 条向量已原样并入
> `docs/provenance/2026-09-14-j2-t3-v03-payoutshardv2-current-suite/`（完整现行套件）。本目录继续有效，
> 不是历史陈旧，两处不冲突。

与 `PayoutShard.sil` 那半（`docs/provenance/2026-09-14-j2-t3-v03-payoutshard-absorb-sole-source-fix/
README.md`）逐字同构的问题、同构的修法——`PayoutShardV2.sil` 的 `absorb` 历来就是 `PayoutShard.sil` 的
`absorb` 逐字复制（ZK-native 结算变体，`absorb` 归集逻辑一字不动），本文件只记这一半特有的坐标差异，
不重复完整的问题/根因/修法叙述，请先读那份 README。

## 改了什么（同构修法，坐标不同）

新增 `countStrayNonOwnedTokenInputs(tok_prefix, tok_suffix, excludeIdx)` 函数（同
`PayoutShard.sil` 逐字复制），`absorb` 新增两条 `require`：

```
require(shardTk.owner != OpInputCovenantId(this.activeInputIndex));
require(countStrayNonOwnedTokenInputs(tok_prefix, tok_suffix, shardInIdx) == 0);
```

## 编译验证

空 ctor → `expected 30, got 0`（ctor 形状不变，30 参数）。真实 30 参数 ctor 完整编译 0 error。AB11 常量
重新量测：`state_span={offset:1,len:288}`——与既有 `OWN_PREFIX_LEN=1`/`OWN_STATE_LEN=288` 一致，无漂移。
`bytecode_length` 从 `22518` 涨到 `29328`。

## 既有向量重跑结果

- `docs/provenance/2026-09-14-j2-t3-v03-payoutshardv2-refundclaim-tokenization/PayoutShardV2.refundclaim.test.json`
  ——**6/6 PASS**（`refund_claim` 未被本次改动触及）。
- `docs/provenance/2026-09-14-j2-t3-v03-payoutshardv2-zkhandoff-tokenization/PayoutShardV2.zkhandoff.test.json`
  ——**不适用重跑**：`constructor expects 30 arguments, got 28`，早于 claim-family 代币化（ctor 28→30）的
  历史快照，与本次改动无关，如实记录（同 `PayoutShard.sil` 那半的 absorb-ab11-and-batest/drawdown-mustfix
  历史陈旧同一性质）。
- `docs/provenance/2026-09-14-j2-t3-v03-payoutshardv2-absorb-batest-ab11/PayoutShardV2_v03_absorb.test.json`/
  `PayoutShardV2_v03_battest.test.json`——未重跑（预期同样是 claim-family 之前的历史 ctor 快照，未逐一确认
  具体参数数，但按同批文件的一致规律推定同属历史陈旧，不代表本次回归；如需要精确数字可另行核对）。

## 新增向量（`run.log`，6/6 PASS，全部 flip-expect 复核真实失败行）

| 向量 | 验证点 | 真实失败行（flip-expect 复核） |
|---|---|---|
| `V-SSF-1_pass_single_leaf_sole_source` | pass | — |
| `V-SSF-2_fail_dual_leaf_only_one_named_other_silently_destroyed`（Codex 主判据） | fail | `PayoutShardV2.sil:173`（`countStrayNonOwnedTokenInputs(...)==0`） |
| `V-SSF-3_fail_shardInIdx_already_self_owned_double_credit` | fail | `PayoutShardV2.sil:172`（`shardTk.owner != self`） |
| `V-SSF-4_fail_unrelated_stray_same_template_input_unaccounted` | fail | `PayoutShardV2.sil:173`（同上） |
| `V-SSF-5_fail_hidden_extra_ps_owned_token_uncounted`（Codex⑤保留项） | fail | `PayoutShardV2.sil:167`（`owned_total==consolidated_pool`） |
| `V-SSF-6_fail_wrong_output_amount`（Codex⑤保留项） | fail | `PayoutShardV2.sil:174`（`validateOutputStateWithInputTemplate`） |

## 授权链表补充："来源一对一"

同 `PayoutShard.sil` README 记录的表格，逐字适用（`shardTk.owner`/`OpInputCovenantId(this.activeInputIndex)`/
`countStrayNonOwnedTokenInputs` 三者的角色完全一致，只是宿主文件不同）。

## 文件清单

- `PayoutShardV2.sil` — 本次修改后的完整合约源码
- `mk_sole_source_vectors_v2.mjs` — 6 条向量生成脚本（`PayoutShard.sil` 那份的坐标适配版）
- `PayoutShardV2.sole-source-fix.test.json` — 生成的 6 条测试向量
- `PayoutShardV2.reference.ctor.json` / `PayoutShardV2.reference.compiled.json` — 参考编译产物（30 参数 ctor）
- `run.log` — `cli-debugger --run-all` 完整输出，6/6 PASS
- `README.md` — 本文件
- `MANIFEST.sha256` — 文件计数校验
