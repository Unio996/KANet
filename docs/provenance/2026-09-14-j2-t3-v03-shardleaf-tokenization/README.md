# ShardLeaf.sil — T3 v0.3 §2 全 23 入口 A/B 落位表代币化（ledger 1188 批次④第三处）

> 📌 **状态注记（2026-09-14 · NWT ledger 1196 MUST-FIX · Bettor 1197 批 (b)）**：本文件下方"一个未展开的
> 跨合约设计问题"一节里"独立两步（不强制同笔）"的假设**已证实是错的**——`consolidate_to_payout` 与
> `PayoutShard.absorb` 结构上必须同笔原子，且原实现自建的中间态代币输出会被 `absorb` 的
> `scanOwnedTokenInputs` 重复计入、造成代币冻结。修复与完整推导见
> `docs/provenance/2026-09-14-j2-t3-v03-shardleaf-payoutshard-handoff-fix/README.md`（不改本文件原文，
> 按仓库通则补状态注记）。本文件下方记录的 `consolidate_to_payout` 签名/向量已被该修复取代，仅作历史记录。

## 背景

延续 `RootClose.sil` 的代币化批次（`24aea3cc`/`60307fc1`），本次落码 `docs/2026-09-14-j2-t3-market-set-token-rewrite-design-v0.3.md` §2 表里 `ShardLeaf.sil` 的两行：

| 入口 | 类 | RHS | 合法在场不计入? | 输出侧派生绑定 |
|---|---|---|---|---|
| `register_append` | A | `pool_value`（本 leaf 自身既有持仓, 首次调用=0） | **是**——bettor 新下的注(owner 尚未变成本 leaf)天然被 owner 过滤排除 | `tok_out` owner = `OpInputCovenantId(this.activeInputIndex)`（自身） |
| `consolidate_to_payout` | A | `pool_value`（leaf 全部持仓, 整体转出） | 否 | `tok_out` owner = `OpInputCovenantId(psInIdx)`（真 PS 实例, 已核 == `payout_cov_id`） |

`ShardLeaf.sil` 没有 B 类入口（0 个，全 2 个入口都是 A 类）——与 `RootClose.sil`（2 B + 2 A）不同的分布，
按 §2 表如实落位，未强行套用相同模板。

## 改了什么

**ctor +1（11→12）**：新增 `byte[32] token_tmpl_hash`，插在 `deadline` 之后（其余原有 11 个字段位置/顺序
不变）。

**新增一个 helper 函数**（`scanOwnedTokenInputs`，与 `PayoutShard.sil`/`RootClose.sil` 逐字节一致手法）——
`ShardLeaf.sil` 没有 B 类入口，因此没有对应的 `noTokenInput`。

**`register_append`**（新增 4 个签名参数：`stakeInIdx, tok_out, tok_prefix, tok_suffix`）：
- 输入侧：`scanOwnedTokenInputs()==pool_value`（leaf 既有持仓，首次调用=0）+ `readInputStateWithTemplate
  (stakeInIdx,...)` 读真实新注 amount（不信任 witness 单独喂的 `stake` 数）。
- 输出侧：`validateOutputStateWithInputTemplate(tok_out, TokenState{amount: pool_value+stake, owner:
  OpInputCovenantId(this.activeInputIndex), ...})`——leaf 自身代币续约。
- **触发 V-T-8**（`readInputStateWithTemplate` 经 `scanOwnedTokenInputs`/`stakeTk` 读取 + 本合约 leaf 自身
  4-field State 续约共存于同一函数）：leaf 自身续约改 AB11 手写编码（同 `PayoutShard.absorb`/`RootClaim.
  claim_draw` 手法），`OWN_PREFIX_LEN=1`/`OWN_STATE_LEN=36` 用 `measure_shardleaf_state_span`(本次内联在
  编译验证步骤完成，见下)量测确认，不是拍脑袋。
- 原 R3 `require(tx.outputs[leafOutIdx].value == pool_value+stake)` 改 `>= DUST_MIN`（D-018 语义）。

**`consolidate_to_payout`**（新增 4 个签名参数：`tokenInIdx, tokenOutIdx, tok_prefix, tok_suffix`）：
- 输入侧：`scanOwnedTokenInputs()==pool_value`（leaf 全部持仓，整体转出，无续约）。
- 输出侧：`validateOutputStateWithInputTemplate(tokenOutIdx, TokenState{amount: pool_value, owner: ps_cov,
  ...})`——`ps_cov` 复用既有 `OpInputCovenantId(psInIdx)`（已核 `==payout_cov_id`）读数，派生表达式非裸
  witness。
- **无续约**（leaf 生命周期终点，不调用 `validateOutputState` 续自身）→ 同 `RootClose.convert_to_claim`/
  `PayoutShardV2.zk_handoff` 同形，不触发 V-T-8，不需要 AB11。
- 原有 `psInIdx`/`psOutIdx` 的 covenant provenance 绑定逻辑（`OpInputCovenantId(psInIdx)==payout_cov_id` /
  `OpCovOutputCount>=1` / `OpOutputCovenantId(psOutIdx)==payout_cov_id`）**一字不动**——这部分本来就已经是
  cov_id PROVENANCE 绑定（比 ZERO32 guard 更强的精确匹配），不属于本批次要修的缺口。原 R3
  `require(tx.outputs[psOutIdx].value == tx.inputs[psInIdx].value + pool_value)` 改
  `require(tx.outputs[psOutIdx].value >= DUST_MIN)`（D-018：`psOutIdx` 现在只是 PS 自身 STATE 续约的
  KAS-dust 输出，真正的价值载体是新增的 `tokenOutIdx` 代币输出）。

## 一个未展开的跨合约设计问题（如实记录，供 Bettor/NWT 判断是否需要补充）

`consolidate_to_payout` 的 `tokenOutIdx` 输出目前是 ShardLeaf **独立**创建/校验的一笔新 `KanetTestToken`
实例（`owner=ps_cov, amount=pool_value`），本次实现让 ShardLeaf 自己完整证明"这笔代币归本 leaf 所有 + 转去
真 PayoutShard 的 cov_id"，**不依赖** `PayoutShard.absorb` 在同一笔交易里同时运行。这与 `PayoutShard.absorb`
自身对"新纳入 shard 代币"（`shardInIdx`）的处理方式是**两笔独立可以分开发生的操作**（consolidate_to_payout
产出一个新 UTXO；未来某次 absorb 调用把这个 UTXO 当作它自己的 `shardInIdx` 读入合并），而不是同一笔交易里的
两个入口互相引用彼此的 index。**这个"两步（可能跨交易）hand-off"的选择是本次实现自己做的，没有在
`docs/2026-09-14-j2-t3-market-set-token-rewrite-design-v0.3.md` §2 表的原文里被显式确认**（该表这一行只写了
"tok_out owner = OpInputCovenantId(psInIdx)"，没有进一步说明是否要求与 `absorb` 同笔交易原子执行）。选择
"独立两步"而非"强制同笔原子"的理由：(a) 更保守——不引入本会话未曾验证过的新跨合约 index 引用约定；(b)
`KanetTestToken.transferPolicy` 本身的 `(b-in)` 路由检查（`recv_idx[j]` 指向本 tx 一个已在场的市场模板输入）
已经独立保证了这笔新代币输出只能进入一个真实的市场模板持有者，`consolidate_to_payout` 的 `psInIdx`/`psOutIdx`
provenance 检查在同一笔交易里进一步确认这个市场模板持有者具体是 `payout_cov_id`——两层检查合起来，无论
`absorb` 是否在同一笔交易里运行都成立。**如果 Bettor/NWT 认为设计意图是"必须同笔原子"，需要另行确认并可能
调整 `absorb`/`consolidate_to_payout` 的签名让两者引用同一批 index**——这点本次未展开，留作后续确认项。

## 编译验证

空 ctor → `expected 12, got 0`；真实 12 参数 ctor 完整编译 0 error。`state_span={offset:1,len:36}`（结构
未变，`AB11` 常量 `OWN_PREFIX_LEN=1`/`OWN_STATE_LEN=36` 与真实编译产物核对一致，无漂移）。编译产物
`bytecode_length=15542` 字节——Bettor（1191）已核实 mainnet post-Toccata（DAA≈539.1M，激活阈值
474,165,565）sigScript 上限 250,000 字节，此规模合法（同批 RootClose 16.8KB 的关切已一并核实，见其 README
"如实记录一个尚未解决的架构关切" + Bettor 1191 回复）。

## 向量（`run.log`，15/15 PASS，全部 flip-expect 复核真实失败行）

### `register_append`（10 条）

| 向量 | 验证点 | 真实失败行（flip-expect 复核） |
|---|---|---|
| `V-register_append-1_pass_first_bet_zero_existing_pool` | pass：首次下注(既有持仓=0) | — |
| `V-register_append-2_pass_second_bet_nonzero_existing_pool` | pass：既有持仓非零(100)时续注 | — |
| `V-register_append-3_fail_smuggled_second_owned_token_uncounted` | fail：额外一笔归己代币未反映在账本(1123-b3/V-absorb-2 同族) | `ShardLeaf.sil:134`（`scanOwnedTokenInputs()==pool_value`） |
| `V-register_append-4_fail_output_diverted_to_stranger_owner` | fail：leaf 代币续约 owner 指向陌生 covenant | `ShardLeaf.sil:139`（`validateOutputStateWithInputTemplate`） |
| `V-register_append-5_fail_output_wrong_amount` | fail：leaf 代币续约金额算错 | `ShardLeaf.sil:139`（同上，结构不匹配） |
| `V-register_append-6_fail_self_output_below_dust_min` | fail：scriptPubKey 匹配通过，唯独 KAS 低于 DUST_MIN | `ShardLeaf.sil:161`（`value>=DUST_MIN`，证明不是 160 行崩溃"意外救回"的假阳性） |
| `V-register_append-7_fail_self_continuation_wrong_count_field` | fail：`count` 字段(int)被改 | `ShardLeaf.sil:160`（`scriptPubKey` 比对） |
| `V-register_append-8_fail_self_continuation_wrong_pool_value_field` | fail：`pool_value` 字段被改 | `ShardLeaf.sil:160`（同上） |
| `V-register_append-9_fail_witness_wrong_tok_prefix` | fail：代币模板 witness 供错 | `ShardLeaf.sil:86`（`scanOwnedTokenInputs` 内 blake3 现场核） |
| `V-register_append-10_fail_stake_amount_mismatch` | fail：新注真实代币 amount 与 witness 喂的 `stake` 不一致 | `ShardLeaf.sil:137`（`stakeTk.amount==stake`） |

### `consolidate_to_payout`（5 条）

| 向量 | 验证点 | 真实失败行（flip-expect 复核） |
|---|---|---|
| `V-consolidate_to_payout-1_pass_sealed_full_pool_transfer` | pass：满片(count==seal_count)全额转入真 PayoutShard | — |
| `V-consolidate_to_payout-2_fail_outbind_token_diverted_to_stranger` | fail：代币输出 owner 被导向陌生 covenant，而非 PS 实例 | `ShardLeaf.sil:199`（`validateOutputStateWithInputTemplate`） |
| `V-consolidate_to_payout-3_fail_output_wrong_amount` | fail：代币输出金额算错 | `ShardLeaf.sil:199`（同上） |
| `V-consolidate_to_payout-4_fail_witness_wrong_tok_prefix` | fail：代币模板 witness 供错 | `ShardLeaf.sil:86`（`scanOwnedTokenInputs` 内 blake3 现场核） |
| `V-consolidate_to_payout-5_fail_smuggled_second_owned_token_uncounted` | fail：额外一笔归己代币未反映在账本 | `ShardLeaf.sil:196`（`scanOwnedTokenInputs()==pool_value`） |

`psInIdx`/`psOutIdx` 的既有 cov_id provenance 绑定逻辑（假 PayoutShard 的 cov_id≠baked → BUST）一字不动，
未重新起负向量——这部分不属于本批次改动范围，沿用既有安全性论证（`ShardLeaf.sil` 文件头注释与
`2026-06-20` NWT 异质核审查记录）。

## 文件清单

- `ShardLeaf.sil` — 本次修改后的完整合约源码（ctor 11→12，新增 `scanOwnedTokenInputs`，两入口全部落码）
- `mk_shardleaf_tokenization_vectors.mjs` — 15 条向量生成脚本
- `ShardLeaf.tokenization.test.json` — 生成的 15 条测试向量
- `ShardLeaf.reference.ctor.json` / `ShardLeaf.reference.compiled.json` — 参考编译产物（12 参数 ctor）
- `run.log` — `cli-debugger --run-all` 完整输出，15/15 PASS
- `README.md` — 本文件
- `MANIFEST.sha256` — 文件计数校验
