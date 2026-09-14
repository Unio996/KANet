# ShardLeaf.consolidate_to_payout ↔ PayoutShard.absorb 手接口 MUST-FIX（NWT ledger 1196，Bettor 1197 批 (b)）

## 发现的 bug

`ShardLeaf.sil` 代币化提交（`07026eef`）里，`consolidate_to_payout` 自己新建了一个 `tokenOutIdx` 输出
（`owner=OpInputCovenantId(psInIdx)=ps_cov`），把持仓代币"relabel"成 PayoutShard 的 covenant id。NWT
红队复核（ledger 1196）指出：`PayoutShard.absorb` 的 `scanOwnedTokenInputs()` 是全交易扫描，会把这笔**已经
被 relabel 成 ps_cov** 的代币也计入 `owned_total`——而 `absorb` 同时又通过 `shardInIdx` 单独把它当作"新纳入
的 shard"再读一次、再加进 `consolidated_pool + shard_amount`。两条路径**对同一笔代币计了两次**：
`require(owned_total == consolidated_pool)` 在 `shard_amount > 0` 时必然失败（`owned_total` 实际等于
`consolidated_pool + shard_amount`）——后果是**代币冻结**（这笔交易永远构造不出来），不是被盗。

## 根因（为什么这不是"调个参数"就能修，而是设计本身错了一半）

`KanetTestToken.transferPolicy` 的 `(b-in)` 路由检查要求：一个新输出声明 `owner=X`，必须有一个 `covenant=X`
的输入在**同一笔交易**里在场（`recv_idx[j]` 指向的输入）。`ShardLeaf.consolidate_to_payout` 若要自己把
输出 `owner` 设成 `ps_cov`，这笔交易里就必须已经有 PayoutShard 自己的 covenant 输入在场——而 PS 的 covenant
输入在场，就必然要有某个 PayoutShard entry（`absorb`）在**同一笔交易**里跑，授权那个输入的花费。这一步
逼出 `consolidate_to_payout` 与 `absorb` 结构上**必须同笔原子**（`ShardLeaf.sil` 代币化 README 里"可能跨
交易"的猜测是错的，本次撤回）。

但两者同笔的话，`ShardLeaf` 自己新建的 `tokenOutIdx` 输出，属于**这笔交易自己的输出集合**——不可能被
**同一笔交易**的另一个入口（`absorb`）当作"输入"（`shardInIdx`）去读（一笔交易不能花费它自己正在创建的
输出，这是时序上的不可能，不是安全检查能不能过的问题）。也就是说：即使没有 NWT 发现的双计数 bug，
`ShardLeaf` 自己再造一份 `owner=ps_cov` 的中间态输出这个设计本身就是错的——它要么根本对不上 `absorb` 的
`shardInIdx`（时序不可能），要么（如果强行让两者对上）会把 `pool_value` 这份钱在两个输出里各代表一次
（经济上重复计数）。

`PayoutShard.absorb`（`edc8b959` 落码，此后未改动，`23/23`+`12/12` 向量长期 GREEN）本来就是**唯一正确**
的设计：它直接读 `shardInIdx`（`ShardLeaf` 之前 `register_append` 时就已经存在、此刻 owner 仍是
`SL_COV`——从未被 relabel 过——的那笔持仓代币），不检查它转移前的 owner，自己造一个
`owner=self=ps_cov、amount=consolidated_pool+shard_amount` 的合并输出——`SL_COV→ps_cov` 这一步 relabel
**本来就该、也只能**由 `absorb` 的 `tok_out` 一步做完。

## 修法（批 (b)，未改 (a)）

`(a)`（给 `scanOwnedTokenInputs` 加参数排除 `shardInIdx`）在架构上**不可行**——见上一段推导，问题不在
"扫描漏排除一个下标"，而在 `ShardLeaf` 一开始就不该造那个中间态输出。`(a)` 就算堵上了双计数，仍然留着
"一笔钱两个输出各代表一次"的经济错误，且要动一个已 GREEN、23/13 条向量都过的文件（`PayoutShard.sil`/
`PayoutShardV2.sil`）——不必要的改动面。

**`(b)`：`ShardLeaf.consolidate_to_payout` 去掉 `tokenOutIdx`/`tokenInIdx` 两个参数和对应的
`validateOutputStateWithInputTemplate` 调用**，职责收窄为纯输入侧核对：

```
int owned_total = scanOwnedTokenInputs(tok_prefix, tok_suffix);
require(owned_total == pool_value);
```

——证明"我手上真有 `pool_value` 这么多代币，且这就是 `absorb` 会读的 `shardInIdx` 那笔"。原有 `psInIdx`/
`psOutIdx` 的 cov_id provenance 检查（`OpInputCovenantId(psInIdx)==payout_cov_id`、`OpCovOutputCount>=1`、
`OpOutputCovenantId(psOutIdx)==payout_cov_id`）**一字不动**——这些检查本来就已经在确认"`absorb` 真的在
同笔交易里跑、PS 是真实例"。`§2` 表"`tok_out owner=PS`"这条**最终语义不变**——只是这个 owner 写入动作由
`absorb` 一步做完，不是 `ShardLeaf` 自己写一遍、`absorb` 再写一遍。**`PayoutShard.sil`/`PayoutShardV2.sil`
零改动**。

**`ShardLeaf_direct.sil` 明确不动**（Bettor 1197 裁）：`ShardLeaf_direct.convert_to_rootclose` 创建的是
**本笔新建的 `RootClose` genesis 输出**——没有任何 entry 在同一笔交易里为一个"尚不存在"的 `RootClose`
运行，`ShardLeaf_direct` 必须自己造代币输出（用 continuation-case trick，同 `RootClose.convert_to_claim`
形状）。这跟"hand-off 给一个已存在、同笔在跑的 `PayoutShard`"是两种不同的情形，不能套同一个修法。

## 编译验证

`ShardLeaf.sil` 空 ctor → `expected 12, got 0`（ctor 形状不变，仍 12 参数——本次只改入口签名，不改 ctor）。
真实 12 参数 ctor 完整编译 0 error。`bytecode_length` 从 `15542` 降到 `15166`（去掉了一段
`validateOutputStateWithInputTemplate` 逻辑），`state_span={offset:1,len:36}` 不变（AB11 常量
`OWN_PREFIX_LEN=1`/`OWN_STATE_LEN=36` 无漂移——本次改动不影响 `register_append` 那部分代码）。

## 跨合约验收向量（ledger 1196 验收标准 + ledger 1198 Codex 补的五条负向量）

`cli-debugger` 一次只测一个合约的一个入口——跨合约验证用**同一份 `tx` JSON 分别喂两个合约各自的 test，
两边独立 PASS** 的形状：这等价于（不是简化）链上共识对多 covenant 输入各自独立验证同一笔交易的真实模型。

正向量场景：PS 起始 `consolidated_pool=P=100`（名下持仓代币真实 =100），ShardLeaf `pool_value=S=50`，
两者均 >0；真实 hand-off + 真实 `absorb` 同笔，成功后**恰一个**输出 owner=真 PS 的续约代币，amount 恰
`P+S=150`，无重复代币、无销毁、无未消费的已 relabel 分片代币（`shardInIdx` 那笔被正常花费，不残留）。

### `ShardLeaf.run.log`（3/3 PASS）

| 向量 | 验证点 | 真实失败行（负向量 flip-expect 复核） |
|---|---|---|
| `V-HOF-1_pass_shardleaf_side_consolidate_to_payout` | pass：ShardLeaf 侧对**同一份**跨合约共享 tx 独立验证通过（P=100/S=50） | — |
| `V-HOF-5_fail_shardleaf_smuggled_second_owned_token_uncounted` | fail：ShardLeaf 自己账本之外多塞一笔归己代币 | `ShardLeaf.sil:206`（`owned_total==pool_value`） |
| `V-HOF-6_fail_wrong_ps_covenant_id_fake_ps`（Codex①"错 PS cov-id"） | fail：`psInIdx` 指向的实例声明的 covenant 不是真 `payout_cov_id`（伪装 PS） | `ShardLeaf.sil:185`（`ps_cov==payout_cov_id`，既有未改动检查，本次纳入正式验收） |

### `PayoutShard.run.log`（7/7 PASS，含首个跨合约集成向量 + "下一次 absorb" + Codex 五条负向量里落在本文件的四条）

| 向量 | 验证点 | 真实失败行 |
|---|---|---|
| `V-HOF-1_pass_payoutshard_side_absorb_same_tx` | pass：`absorb` 侧对**同一份**共享 tx 独立验证通过——两边同时 PASS 即证明修复后的交易在两个 covenant 各自独立验证下都合法（首个跨合约集成向量） | — |
| `V-HOF-2_pass_next_absorb_correctly_counts_merged_token` | pass：V-HOF-1 产出的合并 token（`owner=PS_COV, amount=150`）在**后续**一次 `absorb` 调用里被正确当作 PS 自己的持仓计入 `owned_total==consolidated_pool`——证明 relabel 后的代币真的"生效"成了 PS 自己的东西 | — |
| `V-HOF-3_fail_smuggled_second_owned_token_uncounted`（Codex③"隐藏的额外 PS 名下代币输入"） | fail：PS 账本之外多塞一笔归己代币 | `PayoutShard.sil:149`（`owned_total==consolidated_pool`） |
| `V-HOF-4_fail_shard_amount_undercount_mismatch` | fail：witness 喂的 `shard_amount` 比 `shardInIdx` 真实 amount 少算 | `PayoutShard.sil:152`（`shardTk.amount==shard_amount`） |
| `V-HOF-7_fail_duplicate_shard_token_inflated_output`（Codex②"重复的分片代币输入"） | fail：额外一笔同模板 "shard 状" 代币在场，`shard_amount`/`shardInIdx` 仍如实只证明一笔，但 `tok_out` 金额被抬高到"两笔都算" | `PayoutShard.sil:154`（`validateOutputStateWithInputTemplate` 金额不匹配，多余那笔不被采信） |
| `V-HOF-8_fail_wrong_output_amount`（Codex④"错金额"） | fail：`tok_out` 金额单纯算错(与 P+S 不符，非重复代币叙事) | `PayoutShard.sil:154`（同上调用，结构不匹配） |
| `V-HOF-9_fail_missing_continuation_scriptpubkey_mismatch`（Codex⑤"缺续约"） | fail：`selfOutIdx` 的 scriptPubKey 不匹配任何合法 PS 续约编码(AB11 手写比对) | `PayoutShard.sil:194`（`scriptPubKey==expectedSpk`） |

全部负向量已用 flip-expect 复核真实失败行（不是巧合通过）。

## 与 `ShardLeaf.sil` 代币化 README（`07026eef`）的关系

那份 README 记录了"未展开的跨合约设计问题：hand-off 是否要求与 absorb 同笔原子"，并选了"独立两步"的更
保守假设——本次证实那个假设是**错的**（必须同笔原子，见上方根因推导），已在那份 README 顶部加状态注记
指向本目录，不改原文（同 `CLAUDE.md` 通则：会漂移的判断补状态注记，不改历史记录本身）。

## 顺手更正：mass 估算公式（Bettor 1197）

`ShardLeaf_direct.sil` 代币化 README（`de7582ca`）与 T3 v0.5 as-built 稿都曾用"`~9 units/byte` 的
double-blake2b 经验比率"估算 `convert_to_rootclose` 一次 spend 的 compute mass，这条估算**不对**——真实
mass 公式没有额外的 blake2b 计费项：`compute = size × 1`，`transient = size × TRANSIENT_BYTE_TO_MASS_FACTOR
(=4)`。按 `rc_prefix+rc_suffix=16715` 字节真实计入交易体积重算：`compute ≈ 16715`（不是之前估的
`~167,150`），`transient ≈ 66,860`。两份文档已同步更正，删除"9u/byte"表述。

## 文件清单

- `ShardLeaf.sil` — 修复后的完整合约源码（`consolidate_to_payout` 收窄为纯输入侧核对）
- `mk_handoff_fix_vectors.mjs` — 6 条跨合约向量生成脚本（2 ShardLeaf + 4 PayoutShard）
- `ShardLeaf.handoff-fix.test.json` / `PayoutShard.handoff-fix.test.json` — 生成的测试向量
- `ShardLeaf.run.log` / `PayoutShard.run.log` — `cli-debugger --run-all` 完整输出，各自 2/2、4/4 PASS
- `README.md` — 本文件
- `MANIFEST.sha256` — 文件计数校验
