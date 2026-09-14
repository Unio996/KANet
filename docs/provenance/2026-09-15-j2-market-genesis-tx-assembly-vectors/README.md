> **Status**: CURRENT

# market_genesis/bet_mint tx 组装构造层守卫 + Bettor 账本1425"5 条向量清单"①②③④补齐

见 `docs/provenance/2026-09-15-j2-market-genesis-vectors`(⑤ T4 对照, `proto-covenant-builder.test.mjs`,
已在 `b47b2ba1` 交付)。本笔补齐剩下 4 条(①②③④), 生产代码落在
`kasia-console/src/lib/proto-tx-assembly.mjs`(+ `proto-tx-assembly.test.mjs`, 16 条离线向量)。

## ① genesisOutputValue 用"seed 减法"算出非常量值 ⇒ 构造层拒绝

`proto-tx-assembly.mjs` 的 `assertFixedOutputValue(value, expected, label)` ——精确 `!==` 比较(bigint),
不接受"减法算出来差 1 sompi"的近似值, 也拒绝非 bigint 类型(防 Number 精度静默出错)。
**这条与 relay 侧 `validateFixedValueOutputs` 是两条独立防线, 故意不共享实现**:relay 拦的是签名前最后
一步, 这条在构造阶段、送进 `covenant_broadcast` 的 cmd 之前就拦——即便未来 relay 那条被绕过或删掉,
构造层这条依然独立成立。见 `proto-tx-assembly.test.mjs` 向量①-1~①-4(4 条)。

## ② 故意漏掉一个续约输出的 CovenantBinding, computeRequiredFeeSompi 必须显著偏离正常值

**真实 kaspa-wasm 构造实验**(不是 mock): `vector2-covenant-binding-omission.mjs`, 复用
`docs/provenance/2026-09-14-j2-bet-mint-stepB-register-append-mass-fee-estimate/` 已验证过的
register_append 交易形状(3 输入 4 输出, 真编译 ShardLeaf_direct/KTT/PoolSideTicket), A/B 对照续约输出
带/不带 `CovenantBinding` 声明, 真调 `calculateTransactionMass('mainnet', tx)`。

**实测结果(`run.log`), 方向与最初假设相反, 如实报告**:

| | mass | required_fee |
|---|---|---|
| 带 CovenantBinding | 449203 | 44,920,300 sompi (0.4492 KAS) |
| 漏 CovenantBinding | 149203 | 14,920,300 sompi (0.1492 KAS) |

最初假设是"漏掉会让 fee 膨胀 >10x"(过估)。**实测是反方向：漏掉后 fee 只有正确值的 1/3(低估 3.01x)**，
不是 >10x 高估。机制：声明了 `CovenantBinding` 的输出按 covenant UTXO 真实 plurality 计费（KIP-9,
`p=2`，见 memory `reference-kip9-storage-mass-plurality-is-not-one`），漏掉声明后 wasm 把它当成普通
P2SH（`p=1`）计费，故意漏"更贵"的那一部分。**低估比高估对钱路更危险**——用低估的 `required_fee` 去广播，
真实链上可能因为 fee 不足被拒绝，而不是"多付冤枉钱"这种可容忍的浪费。

这次没有把断言硬凑成">10x"去匹配最初假设，而是把断言改成"比值必须显著偏离 1（无论方向）"，如实记录方向
和量级——量级本身（3 倍）已经足够证明"漏掉声明是一个真实、后果严重、容易犯的构造错误"这个核心论点成立，
不需要为了凑数字而扭曲实测结果。

**处置**：`proto-tx-assembly.mjs` 的 `buildContinuationOutput(...)` 是续约输出的唯一构造入口，
`covenantIdHex` 缺失直接 throw——结构上不存在"手写 `new TransactionOutput(...)` 漏第三个参数"这条代码
路径，而不是靠事后测试或代码审查记住这条规矩。

## ③ KTT 输入 outpoint 不在 proto_bets/proto_bet_intents 记录里 ⇒ 拒绝

`assertKttOutpointRecorded({ betId, txid, vout })`——真实临时 DB（`proto-tx-assembly.test.mjs`
用既有 M0a 手法：`DB_PATH` 临时库 + `run-migrations.mjs`），核对给定 outpoint 与 `proto_bets.mint_txid`/
`mint_vout`（= 步骤 A 铸筹码的记录产出）逐字段相等，5 条向量（③-1~③-5）覆盖：精确匹配通过 / vout 不同
拒绝（"按 owner 扫链扫到另一个 UTXO"的现实反例）/ txid 完全不相干拒绝 / 步骤 A 还没落地（`mint_txid`
为空）拒绝（不把 `null` 当"随便什么都行"）/ `bet_id` 不存在拒绝。

## ④ console 侧 calculateTransactionMass 不可用 ⇒ fail-loud，不回退估算值

`computeRequiredFeeSompiOrThrow(kaspa, network, tx)`——4 条向量（④-1~④-4）覆盖：方法不存在 / 抛错（原始
错误信息冒泡，不吞掉）/ 返回 `null`（不当 0 处理）/ 正常路径 `fee = mass * SOMPI_PER_MASS`。
**relay 侧 CRF-2（`covenant-broadcast-relay.test.mjs`）只覆盖 relay 自己那次调用，不覆盖 console 侧这次
独立调用**——两处必须各自守住，这是 console 侧独立补的那一半。

## 附带：§9.5 fee-UTXO 选择器 + 找零形状校验

`selectFeeUtxo(candidates, minRequiredSompi)`——v0 明确不做自动拆分/合并（Bettor 1425 条件⑥认可的"不做"
范围之一），选最小的单个够用 UTXO，找不到就 `no_suitable_fee_utxo` fail-loud。`assertChangeShape(change)`
——找零必须是 0 或 `>= CONTINUATION_OUTPUT_SOMPI`，中间的 dust 值拒绝。这两个不在 Bettor 5 条清单里，是
tx 组装本身需要的构件，一并交付、一并测。

## 验证

```
cd kasia-console && node src/lib/proto-tx-assembly.test.mjs     # 16/16 pass（①③④ + fee-UTXO 附带向量）
cd kasia-console && node ../docs/provenance/2026-09-15-j2-market-genesis-tx-assembly-vectors/vector2-covenant-binding-omission.mjs   # ② 真实 kaspa-wasm, PASS
```

## 尚未覆盖（如实列出，不是本笔范围）

- `⑤` 的"端到端 tx 组装层"确认（本笔只在 ctor-derivation 层做过 T4-lite，`b47b2ba1`）——要等完整
  `market_genesis`/`bet_mint` tx 组装函数写完才能补。
- `register_append` 的 AB11 stateBytes 手写编码 cli-debugger 真实向量（"手拼续约输出 PASS，改一个字节
  FAIL"）——**这条实际上已经在更早的既有工作里做过并且已提交合并**：
  `docs/provenance/2026-09-14-j2-t3-v03-shardleafdirect-tokenization/`（`de7582ca`/`c6c0e35c`）的
  `V-register_append-1_pass_first_bet_zero_existing_pool`（PASS 基线）与
  `V-register_append-6_fail_self_continuation_wrong_pool_value_field`（改掉续约 State 里的
  `pool_value` 一个字段即 FAIL）——2026-09-15 已针对 KTT v0.3 协议形状重跑，14/14 pass，见该目录
  `run.log` 的 RERUN 章节。不是遗漏，是识别出已有覆盖，避免重复造轮子。
- `market_genesis`/`bet_mint` 完整 tx_json 组装 + `proto.js` 的 `buildAndBroadcast` 接线——仍在进行中。

## 文件清单

- `vector2-covenant-binding-omission.mjs`（向量②真实构造脚本）
- `run.log`（向量②真实运行输出）
- `README.md`（本文件）

（① ③ ④ 的向量代码与运行证据在生产文件 `kasia-console/src/lib/proto-tx-assembly.mjs` /
`proto-tx-assembly.test.mjs` 里，不重复放进本 provenance 目录。）
