> **Status**: SUPERSEDED-BY D-020

> 📌 **状态注记（2026-09-15 · J2 · D-020 账本1446/1448/a4878d7d）**：本文档验证的是 bet_mint 两步设计（独立铸 stake 筹码 + register_append 消费它）下的构造/编码行为——NWT 用真实 cli-debugger 证明该设计存在更严重问题（ZERO32-owner 的筹码可被任意第三方连本带锁定的真实 KAS 一起偷走，见账本1446），Owner 裁定 D-020：取消步骤A，register_append 改单笔交易。本文档内容作为历史记录保留（不删除，不改原文），新的验证见 `docs/provenance/2026-09-15-j2-d020-register-append-single-tx-verification/`。

# stake 新铸筹码 owner=STAKE_CHIP_OWNER_UNBOUND(全零32字节)真实验证(账本1436)

## 背景

账本1435 曾裁定"stake 筹码 owner = 它自己的 covenant_id(自持有)"，但真实 rusty-kaspa 源码
(`consensus/core/src/hashing/covenant_id.rs:13-14`：covenant_id 把输出的完整脚本字节——含 State,
含 owner 本身——喂进哈希)证明这是一个自指不动点方程，无解（不是编码能力问题，是数学上不可行，见
`docs/provenance/`前一笔的报告消息）。账本1436 更正方向：**stake 筹码 genesis 时 owner = 全零32字节
(具名常量 `STAKE_CHIP_OWNER_UNBOUND`)**。

## 依据(源码逐字确认)

1. `ShardLeaf_direct.sil:140-141`（`register_append` 只核 `stakeTk.amount==stake`，不核
   `stakeTk.owner`）+ `:104`（`scanOwnedTokenInputs` 按 `owner==leaf covenant_id` 求和）——"合法在场
   不计入"这句头注的真实含义就是"owner ≠ leaf 的 covenant_id"。`ZERO32 != leaf 的 covenant_id`（leaf
   的 covenant_id 是 genesis 时консенsus 算出的非零值），满足。
2. `KanetTestToken.sil:84`（leader `require(OpInputCovenantId(owner_input_idx[i]) ==
   prev_states[i].owner)`）与 `:114`（delegate 同形）——非 covenant 输入（如 relay 的普通 P2PK fee
   输入）的 `OpInputCovenantId` 回退为 `ZERO_HASH`。bet_mint 步骤B 花这枚筹码时，`owner_input_idx`
   指向 fee 输入即可让 `ZERO_HASH == ZERO32` 自然成立，不需要额外签名。
3. `KanetTestToken.sil:102`（`owner != ZERO32` 检查）只作用于 `next_states`（`transferPolicy` 正在
   创建的输出），不作用于 `prev_states`（正在花费的输入），也不作用于 genesis 阶段——genesis 时把
   owner 写成 ZERO32 不会被合约自己拒绝。

## 验证：生产真实形状同一笔交易，三脚本各自真实执行(7条向量)

复用 `2026-09-15-j2-register-append-full-tx-three-execution` 的构造手法（leaf续约CovenantBinding到
自己 + ticket genesis + 合并KTT genesis 真实 `kaspa.covenantId` 算出 + fee找零）。

| 向量 | 场景 | 结果 |
|---|---|---|
| ①a leaf(有held, stake.owner=ZERO32) | `owned_total==pool_value`(stake 不计入) | ✅ PASS |
| ①b held(zero-out续约) | | ✅ PASS |
| ①c stake(owner=ZERO32, owner_input_idx→fee输入index3) | | ✅ PASS |
| ②stake(owner=ZERO32, owner_input_idx→leaf输入index0——故意指错) | 在场检查该失败 | ❌ **FAIL**, 精确失败在 `KanetTestToken.sil:84`(trace确认, `owner=0x00...00`, `OpInputCovenantId(0)`是leaf真实非零covenant_id, 不相等) |
| ③leaf(回归固化: stake.owner=leaf的covenant_id, 账本1435的错误写法) | `owned_total`该不等于`pool_value` | ❌ **FAIL**(与2026-09-15-j2-register-append-full-tx-three-execution 撞到的原始bug同形, 固化为常驻回归) |
| ④a leaf(第一笔下注, 无held输入, pool_value=0) | | ✅ PASS |
| ④b stake(第一笔下注, owner=ZERO32, owner_input_idx→fee输入) | | ✅ PASS |

7/7 符合预期，未出现任何意外结果。

## 已知代价(账本1435/1436 明确接受，不加机制防范)

步骤A(bet_mint 铸筹码)落链后、步骤B(register_append 消费)广播前的窗口内，**任何人都能用任意一个
非 covenant 输入冒充"在场"把这枚 stake 筹码花掉**（`owner_input_idx` 指向自己控制的任意 P2PK 输入即
可满足 `OpInputCovenantId(...)==ZERO32` 的在场检查），导致这次下注的步骤B失败、筹码孤儿化。

**但攻击者拿到的东西和自己免费铸一份完全等价**（KanetTestToken genesis 本身就是任何人免费无限铸），
没有真实损失路径——并入既有的 `T-ORPHAN-CHIP-RECOVERY-ENTRY`（`docs/DATABASE.md` proto_bets 章节已
记录该已知限制），v0 接受。

🔴 **这条取舍只在"KTT 是零价值测试币"这个前提下成立——如果未来 KTT 承载真实价值，这个
`owner=ZERO32` 设计必须重做，不能直接沿用**（已写入 `proto-covenant-builder.mjs` 的代码注释）。

构造层能做的缓解：步骤A落链后尽快发步骤B，不人为延迟（`driveBetIntent` 既有的两步链式依赖——B 只在
A `landed` 后才允许从 pending 转 prepared——天然就是"尽快"的语义，不需要额外机制）。

## 代码处置

- `kasia-console/src/lib/proto-covenant-builder.mjs`：新增具名常量 `STAKE_CHIP_OWNER_UNBOUND =
  ZERO32`（导出），`computeKttGenesisArtifact` 的 `ownerCovIdHex` 参数文档订正，明确区分"步骤A用
  `STAKE_CHIP_OWNER_UNBOUND`"vs"合并奖池代币走 register_append 自己的输出构造，owner=leaf 的
  covenant_id，不经过这个函数"。
- `kasia-console/src/lib/proto-tx-assembly.mjs`：`buildMarketGenesisTxJson` 里 `shardLeafCovId` 那段
  注释订正，撤销"这就是 bet_mint 步骤A ownerCovIdHex 必须传的值"这句错误说法。

## 文件清单

- `mk_owner_unbound_vectors.mjs`(生成脚本)
- `owner_unbound_vectors.test.json`(7条真实向量)
- `ShardLeaf_direct.sil` / `KanetTestToken.sil` / `PoolSideTicket.sil`(D-019 pin 真实编译源，冻结副本)
- `run.log`(7次真实 cli-debugger 执行的完整输出)
- `README.md`(本文件)
