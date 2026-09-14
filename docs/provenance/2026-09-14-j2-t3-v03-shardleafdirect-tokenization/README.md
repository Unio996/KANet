# ShardLeaf_direct.sil — T3 v0.3 §2 全 23 入口 A/B 落位表代币化 + ZERO32 守卫（ledger 1186/1188/1121 批次④第四处，最后一处）

## 背景

批次④最后一处，`docs/2026-09-14-j2-t3-market-set-token-rewrite-design-v0.3.md` §2 表：

| 入口 | 类 | RHS | 合法在场不计入? | 输出侧派生绑定 |
|---|---|---|---|---|
| `register_append` | A | `pool_value`（同 `ShardLeaf.sil`） | 是 | `tok_out` owner = `OpInputCovenantId(this.activeInputIndex)`（自身） |
| `convert_to_rootclose` | A | `pool_value`（全池整体转出） | 否 | `tok_out` owner = `OpOutputCovenantId(rcOutIdx)`（本笔新建 RootClose，独立校验） |

ledger 1186/1121 明确点名 `convert_to_rootclose` 是"同 RootClose convert 形"——它跟 `RootClose.convert_to_claim`/
`convert_to_refundclaim` 一样是"新建外部合约实例"的 foreign-template 桥（这里新建的是 **RootClose 本身**），
属于 Codex/NWT 点名的同一 class 最高风险：`validateOutputStateWithTemplate` 只核脚本字节匹配，不核 covenant
绑定。

## 改了什么

**`register_append`**：与 `ShardLeaf.sil` 完全同规格处置（ctor +1 加 `token_tmpl_hash`；新增
`scanOwnedTokenInputs`；输入侧既有持仓 scan + 新注 `stakeTk` 真实 amount 核对，"合法在场不计入"正例；输出侧
leaf 自身代币续约 `owner=self`；触发 V-T-8 → AB11 手写编码，`OWN_PREFIX_LEN=1`/`OWN_STATE_LEN=36` 本文件
**重新编译重新量测**，不假设与 `ShardLeaf.sil` 数值相同——虽然本次测出的确相同（两文件都是同一 4-field State
结构，且 `OWN_PREFIX_LEN`/`OWN_STATE_LEN` 只对结构敏感不对 ctor 长度敏感），但按纪律仍是独立验证过的，不是
抄数字）。

**`convert_to_rootclose`**（新增 6 个签名参数：`tokenInIdx, tokenOutIdx, tok_prefix, tok_suffix` + 已有
`rcOutIdx, rc_prefix, rc_suffix`）：
- **ZERO32 目的地守卫**（新增）：`validateOutputStateWithTemplate(rcOutIdx, RootCloseState{...}, ...)` 之后
  加 `byte[32] rcCovId = OpOutputCovenantId(rcOutIdx); require(rcCovId != ZERO32)`——与 `RootClose.sil`
  第一次提交（`24aea3cc`）逐字一致的修法，同一 class 的漏洞、同一形状的修复。
- **A 类代币化**：`scanOwnedTokenInputs()==pool_value`（全池整体转出，无续约）+
  `validateOutputStateWithInputTemplate(tokenOutIdx, TokenState{amount: pool_value, owner: rcCovId, ...})`
  ——`rcCovId` 复用刚核过非 ZERO32 的读数，派生表达式非裸 witness。
- **无续约**（entry 是本 leaf 生命周期终点）→ 同 `RootClose.convert_to_claim`/`ShardLeaf.consolidate_to_payout`
  同形，不触发 V-T-8。
- 原 R3 `require(tx.outputs[rcOutIdx].value == pool_value)` 改 `>= DUST_MIN`（D-018 语义）。

## 编译验证

空 ctor → `expected 12, got 0`；真实 12 参数 ctor 完整编译 0 error。`state_span={offset:1,len:36}`（与
`ShardLeaf.sil` 相同结构，独立重新量测确认，AB11 常量无漂移）。编译产物 `bytecode_length=15687` 字节。

## Bettor 1190/1191 要求的量化：convert_to_rootclose 一次 spend 携带的 RootClose 模板字节数与估算 mass

**背景**：`RootClose.sil` 代币化后（`60307fc1`）编译产物涨到 `bytecode_length=16802` 字节，`state_span=
{offset:1, len:87}`。`convert_to_rootclose` 的 `rc_prefix`/`rc_suffix` 两个 witness 参数正是这份 RootClose
模板去掉 state_span 区段后的**完整**前后段字节——即**每一次**调用 `convert_to_rootclose`，签名脚本
（`sigScript`）里都必须携带这整份 16715 字节的 RootClose 模板见证：

```
rc_prefix.length + rc_suffix.length = 1 + 16714 = 16715 字节（本次真实编译产物实测，见
mk_shardleafdirect_tokenization_vectors.mjs 脚本末尾打印的 JSON：
{"rootclose_bytecode_length":16802,"rc_prefix_len":1,"rc_suffix_len":16714,"total_witness_bytes":16715}）
```

**估算 mass（更正版，Bettor ledger 1196：真实公式没有额外的 blake2b 计费项）**：

真实 mass 公式：`compute = size × 1`，`transient = size × TRANSIENT_BYTE_TO_MASS_FACTOR(=4)`——**没有**
"double-blake2b 按字节数额外计费"这一项（v0.1 初版曾用 `ShardLeaf.convert_to_foldnode` 2026-06-20
probe-B 的"~9 units/byte"链上实测比率去估算一个假想的哈希分量，那条比率描述的是**当年那次具体 probe 测到
的总 mass 现象**，不是 mass 公式本身的一个独立计费项，本次已确认这个套用是错的，予以撤回）。

按 `rc_prefix+rc_suffix=16715` 字节真实计入交易体积重算：
- `compute ≈ 16715 × 1 ≈ **16,715 mass 单位**`
- `transient ≈ 16715 × 4 ≈ **66,860 mass 单位**`

**如实记录**：`mass_per_tx_byte=1` 这条系数 Bettor（1195）已核对主网与旧网相同；`TRANSIENT_BYTE_TO_MASS_FACTOR`
本次未单独重新核对主网数值是否与已引用的旧网参数一致，`compute` 部分的精确公式细节交 NWT 复核（Bettor
1196）。这两个数字（~16.7k / ~66.9k）都远小于 v0.1 初版误估的 ~167,150，量级判断（"是否会挤占单块预算"）
应以这版更正后的数字为准，不要再引用已撤回的 "9u/byte" 估算。

## 向量（`run.log`，14/14 PASS，全部 flip-expect 复核真实失败行）

### `register_append`（8 条，同 `ShardLeaf.sil` 精简版）

| 向量 | 验证点 | 真实失败行 |
|---|---|---|
| `V-register_append-1_pass_first_bet_zero_existing_pool` | pass | — |
| `V-register_append-2_fail_smuggled_second_owned_token_uncounted` | fail：额外归己代币未计入账本 | `:139`（`owned_total==pool_value`） |
| `V-register_append-3_fail_output_diverted_to_stranger_owner` | fail：代币续约 owner 被导向陌生 covenant | `:142`（`validateOutputStateWithInputTemplate`） |
| `V-register_append-4_fail_output_wrong_amount` | fail：代币续约金额算错 | `:142`（同上） |
| `V-register_append-5_fail_self_output_below_dust_min` | fail：scriptPubKey 匹配通过，唯独 KAS 低于 DUST_MIN | `:162`（`value>=DUST_MIN`） |
| `V-register_append-6_fail_self_continuation_wrong_pool_value_field` | fail：`pool_value` 字段被改 | `:161`（`scriptPubKey` 比对） |
| `V-register_append-7_fail_witness_wrong_tok_prefix` | fail：代币模板 witness 供错 | `:93`（`blake3` 现场核） |
| `V-register_append-8_fail_stake_amount_mismatch` | fail：新注真实代币 amount 与 witness 喂的 `stake` 不一致 | `:141`（`stakeTk.amount==stake`） |

### `convert_to_rootclose`（6 条，同 `RootClose.convert_to_claim` 形状）

| 向量 | 验证点 | 真实失败行 |
|---|---|---|
| `V-convert_to_rootclose-1_pass_real_bridge_full_pool_token_out` | pass：真实 RootClose 创世桥接 + 全池代币转出 | — |
| `V-convert_to_rootclose-2_fail_bare_output_no_covenant_id_zero32` | fail：脚本字节匹配真实 RootClose，输出无 `covenant_id` | `:196`（ZERO32 守卫） |
| `V-convert_to_rootclose-3_fail_fake_template_shell` | fail：目标脚本字节不是真实 RootClose | `:186`（`validateOutputStateWithTemplate`） |
| `V-convert_to_rootclose-4_fail_outbind_token_diverted_to_stranger` | fail：代币输出 owner 被导向陌生 covenant | `:201`（`validateOutputStateWithInputTemplate`） |
| `V-convert_to_rootclose-5_fail_witness_wrong_tok_prefix` | fail：代币模板 witness 供错 | `:93`（`blake3` 现场核） |
| `V-convert_to_rootclose-6_fail_smuggled_second_owned_token_uncounted` | fail：额外归己代币未计入账本 | `:182`（`owned_total==pool_value`） |

## 文件清单

- `ShardLeaf_direct.sil` — 本次修改后的完整合约源码（ctor 11→12，新增 `scanOwnedTokenInputs`，两入口全部落码 + ZERO32 守卫）
- `mk_shardleafdirect_tokenization_vectors.mjs` — 14 条向量生成脚本（脚本末尾打印 mass 量化用的原始字节数字）
- `ShardLeafDirect.tokenization.test.json` — 生成的 14 条测试向量
- `ShardLeaf_direct.reference.ctor.json` / `ShardLeaf_direct.reference.compiled.json` — 参考编译产物（12 参数 ctor）
- `run.log` — `cli-debugger --run-all` 完整输出，14/14 PASS
- `README.md` — 本文件
- `MANIFEST.sha256` — 文件计数校验

## 批次④收尾

至此批次④（RootClose ZERO32 守卫 + RootClose 全面代币化 + ShardLeaf + ShardLeaf_direct）全部四笔文件级
commit 完成：`24aea3cc`（RootClose ZERO32）、`60307fc1`（RootClose 代币化）、`07026eef`（ShardLeaf 代币化）、
本笔（ShardLeaf_direct ZERO32+代币化）。
