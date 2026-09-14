> **Status**: CURRENT

# register_append 生产真实形状完整交易三执行 + validateOutputStateWithInputTemplate 源码确认(账本1434)

## ① 源码确认: `validateOutputStateWithInputTemplate` 不读 output.covenant, 换成 genesis 语义不需要换原语

Bettor 1434 的假设：该原语核的是 `output.scriptPubKey == P2SH(重建的 prefix||state||suffix)`，不读
`output.covenant` 字段，所以合并输出从"续约"改成"genesis"声明不需要换校验原语。**逐行核对确认成立**：

- `silverscript-lang/src/compiler/validate_output_state.rs:147-169`(D-019 pin
  `3ed973335b59269293564805cc2c58a14595ec03`)：`validateOutputStateWithInputTemplate` 在 AST 层面
  纯粹**降级**成 `validateOutputStateWithTemplate(output_idx, state, prefix, suffix, hash)` 调用——
  `input_template_parts`(同文件 `:296-320`)只是从**某个模板输入**的字节里切出 `prefix`/`suffix`，
  和输出的 covenant 声明毫无关系。
- `silverscript-lang/src/compiler/compile/state.rs:238-343`
  (`compile_validate_output_state_inner_statement`，`validateOutputState` 的字节码生成)与 `:345-421`
  (`compile_validate_output_state_with_template_inner_statement`，`...WithTemplate` 的字节码生成)：
  两者都是"重建 `prefix||encoded_new_state||suffix`→`OpBlake2b`→拼 P2SH 前后缀→和
  `tx.outputs[output_idx]` 的 `OpTxOutputSpk` 结果 `OpEqualVerify`"，**全文件 `grep -i covenant` 零命中**。

**结论**：这三个原语(`validateOutputState`/`...WithTemplate`/`...WithInputTemplate`)只关心脚本字节
匹配，完全不管这笔输出是不是声明了 `CovenantBinding`/`GenesisCovenantGroup`、是续约还是 genesis——
ShardLeaf_direct.sil 的 `register_append` 不需要为了"合并输出改 genesis"这件事换用任何别的校验原语。

## ② 生产真实形状完整交易, 三个脚本各自真实执行一次

复用 2026-09-14 既有14条向量的编译手法，但把合并输出从"从 `stakeInIdx` 续约"改成"全新 genesis 输出"
(账本1433/1434②的候选设计)。交易结构：

- 输入：`[0]leaf` `[1]heldKTT` `[2]stakeKTT` `[3]relay fee(普通P2PK)`
- 输出：`[0]leaf续约(CovenantBinding到leaf自己)` `[1]PoolSideTicket genesis` `[2]合并KTT genesis
  (真实用 kaspa.covenantId 纯函数算出的 covenant_id, authorizing_input=3=fee输入)` `[3]fee找零`

`active_input_index` 分别设为 leaf(0)/held(1)/stake(2)，**同一笔交易**真实执行三次：

| 向量 | active | 结果 |
|---|---|---|
| ①leaf_register_append_pass | 0 | ✅ PASS |
| ②held_transfer_zero_out_pass | 1 | ✅ PASS |
| ③stake_transfer_zero_out_pass | 2 | ✅ PASS |
| ④leaf_register_append_wrong_merged_amount_fail(合并输出amount少1) | 0 | ❌ **FAIL**，精确失败在 `ShardLeaf_direct.sil:142 validateOutputStateWithInputTemplate(tok_out, ...)` |
| ⑤held_transfer_zero_out_still_pass_when_leaf_output_wrong | 1 | ✅ 仍 PASS(不受leaf输出对错影响) |
| ⑥stake_transfer_zero_out_still_pass_when_leaf_output_wrong | 2 | ✅ 仍 PASS |

## 🔴 过程中发现并订正的真实设计错误(不是本笔预期结果, 是实测撞出来的)

第一版按"held/stake 两个 KTT 的 State.owner 都等于 leaf 的 covenant_id"构造(沿用本 session 更早对
`computeKttGenesisArtifact` 的理解)，`①leaf` 真实执行报错：

```
require(owned_total == pool_value);   // ShardLeaf_direct.sil:139
owned_total = 120  (= held.amount(100) + stake.amount(20))， pool_value = 100
```

**根因**：`scanOwnedTokenInputs` 是按 `owner == SL_COV` 对**全部**输入求和的，不区分"这是 held 还是
stake"——如果 stake 的 `owner` 也等于 `SL_COV`，会被**一起计入**，与源码头注"新注 stakeTk 合法在场
不计入"的设计原文矛盾。

**订正**：stake 新铸筹码 genesis 时 `owner` 必须等于**它自己的** covenant_id(自持有，
`owner_input_idx` 指向它自己的 input index)，绝不能等于 leaf 的 covenant_id。held(代表"已经进池的
筹码")则保持 `owner=leaf的covenant_id`(这条不变，`owner_input_idx` 指向 leaf 的 input index)。
订正后①④两个 leaf 向量的 `owned_total` 才精确等于 `pool_value`(不含 stake)，符合设计原文。

**处置**：本 session 更早写的 `computeKttGenesisArtifact({amount, ownerCovIdHex})`
(`kasia-console/src/lib/proto-covenant-builder.mjs`)对 bet_mint 步骤A 的 `ownerCovIdHex` 参数的
理解需要订正——不应该照搬 `shardLeafCovId`，需要传该次新铸筹码**自己**的 covenant_id(自持有)。
**这是一个需要另开一笔专门修的真实缺陷，不在本笔范围**，先如实记录。

## 另一个 bisect 过程中发现的 test-schema 用法坑(不是设计问题, 是我构造测试时的用法错)

给 `tx.inputs[i].state` 传 KanetTestToken 的字段(amount/owner/...)会被 debugger 拿**当前 active
合约**(这里是 ShardLeaf_direct, State=local_yes/local_no/count/pool_value)的 struct 去解析，直接
报 `"struct field 'local_yes' must be initialized"`——`state:` 这个 schema 糖只适用于"本合约自己的
续约 State"场景，不适用于 `readInputStateWithTemplate` 读的外部模板输入。foreign-template 输入必须
像既有14条向量一样只给 `utxo_script_hex`/`signature_script_hex`(真实编译产物，状态字节已经烤在
里面)，不要用 `state:` 语法糖。

## ③ 已知限制(不在 debugger 里验证，记为待办)

`GenesisCovenantGroup`(这里用 debugger test-schema 的 `covenant_id`+`authorizing_input` 表达)的
authorizing input 指向一个**本身是 covenant 输入**的 input(例如 held/stake KTT)时，节点是否接受，
cli-debugger 未必完整模拟 consensus 的 covenant_id 规则——本笔的 authorizing_input 全程选的是
**relay fee 输入**(普通 P2PK，非 covenant)，规避了这个未知项，没有验证"authorizing input 本身也是
covenant"这条路径。**这一点由首笔金丝雀交易实证**；构造时 authorizing input 优先选 relay fee 输入，
不要选任何已经是 covenant 的输入。

副产品：确认了 debugger 对 genesis covenant 声明是真消费 kaspa 共识层 `CovenantsContext` 校验的
(`WrongGenesisCovenantId` 报错)，不能瞎填 `covenant_id`——必须用 `kaspa.covenantId(authorizing_input
的 previous_outpoint, [{index, output}])` 现算真实值(debugger 对没显式给 `prev_txid` 的输入用默认
outpoint = 32字节全为该输入index的字节值, index:0，见 `debugger/cli/src/main.rs:772-777`)。

## 文件清单

- `mk_full_tx_vectors.mjs`(生成脚本，含 bisect 全过程的详细注释)
- `full_tx_vectors.test.json`(6条真实向量)
- `ShardLeaf_direct.sil` / `KanetTestToken.sil` / `PoolSideTicket.sil`(D-019 pin 真实编译源，冻结副本)
- `run.log`(6次真实 cli-debugger 执行的完整输出)
- `README.md`(本文件)
