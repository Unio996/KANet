> **Status**: CURRENT

# register_append 余额公式真实bug修复 + relay侧纵深防御(账本1455)

出处：金丝雀成本核算(账本1454)暴露"0.5/0.95 KAS 均构造失败"，NWT/Bettor 顺藤摸瓜诊断出一个真实的
money-path bug：`buildRegisterAppendTxJson`(`kasia-console/src/lib/proto-tx-assembly.mjs`)的
`leftover` 公式只计入 fee 输入的面值，漏计了交易里 leaf(每笔恒有，0.2 KAS)与 held(第二笔起，
0.2 KAS)这两个非签名 covenant 输入的真实面值——后果是每笔 register_append 都会**静默多付真实矿工费**
（不会被节点拒绝广播，因为 kaspad 只要求"至少付够最低费"，不要求"恰好"），多付的金额恰好等于
leaf.value(+held.value，若有)。

## 根因

```js
// 修复前(proto-tx-assembly.mjs buildRegisterAppendTxJson):
const leftover = feeUtxo.value - CONTINUATION_OUTPUT_SOMPI - GENESIS_OUTPUT_SOMPI - GENESIS_OUTPUT_SOMPI;
```

真实交易的 `txInputs` 除了 fee 输入，还包含 leaf 输入（`currentStateUtxoValueOf(leafOutpoint)` =
`CONTINUATION_OUTPUT_SOMPI`）以及第二笔起的 held 输入（`heldInput.value`）——这两者各自的真实面值
1:1 抵扣掉 leaf 续约 / 合并 KTT 这两个输出里对应的一份，是它们"自带"的续约价值，构造层却完全没有
把这部分记入"总可用余额"，导致 `selectChangeShape` 认为自己拥有的预算比真实预算少了
`leafValue(+heldValue)`，据此算出的找零/无找零形状最终都会让真实交易的
`Σinputs.utxo.amount − Σoutputs.value`(真实隐含手续费)比 `calculateTransactionMass` 算出的
`requiredFee` 恰好多出这部分——从不在任何地方报错，因为 kaspad 不检查"手续费是不是恰好等于最低要求"。

## 修复

1. **`proto-tx-assembly.mjs`**：`leftover` 改为把 leaf/held 的真实面值也 credit 进预算：
   ```js
   const leafInputValue = currentStateUtxoValueOf(leafOutpoint);
   const heldInputValue = heldInput ? heldInput.value : 0n;
   const leftover = feeUtxo.value + leafInputValue + heldInputValue − CONTINUATION_OUTPUT_SOMPI − GENESIS_OUTPUT_SOMPI − GENESIS_OUTPUT_SOMPI;
   ```
2. **新增不变量断言 `assertImpliedFeeMatches(tx, expectedFeeSompi, label)`**：finalize 后的真实交易，
   `Σ(inputs.utxo.amount) − Σ(outputs.value)` 必须【恰好】等于 `selectChangeShape` 返回的 `netLoss`
   （带找零形状 = `requiredFee`；并入形状 = 全部 `leftoverSompi`——`netLoss` 字段本身在两种情况下已经
   是这个值），不符即 `throw implied_fee_mismatch`，fail-closed 拒绝返回这笔交易。`buildMarketGenesisTxJson`
   同样加了这条断言（该函数只有 1 个输入，`leftover` 公式本身没有这个 bug 的作用面，加断言是纵深防御，
   不是修复自身问题）。
3. **relay 侧纵深防御 `validateImpliedMinerFee`**（`kasia-relay/src/lib/covenant-broadcast.mjs`，接线在
   `covenant-broadcast-relay.mjs`，与 `validateNetLoss` 并列、同一处签名后/广播前的位置）：独立核对
   `Σ全部输入.utxo.amount − Σ全部输出.value`（不筛 `signInputIndices`，与 `validateNetLoss` 刻意不同的
   口径）是否超过 `min(requiredFee×2, GLOBAL_ABS_FEE_CAP_SOMPI)`（与 `validateNetLoss` 同一公式），
   超过则拒签，返回 `code: implied_fee_exceeded`。这道闸不依赖 console 侧的构造逻辑对不对，是万一未来
   又有类似疏漏的最后一道防线。

## 🔴 诚实记录一个局限：这道 relay 侧闸并不能拦住这次真实bug的精确量级

用真实数字核实过（`docs/provenance/2026-09-15-j2-d020-register-append-fee-formula-fix/` 内
`covenant-broadcast.test.mjs` 的 IMF-2a 向量）：首笔下注(无held)漏计的 leaf.value(0.2 KAS)叠加在
~0.44 KAS 的 requiredFee 上，隐含手续费 = 0.64022200 KAS，而 `min(requiredFee×2, GLOBAL)` =
0.88044400 KAS——**没有超过**，这道闸不会拒绝。第二笔(有held)漏计 0.4 KAS 叠加在 ~0.41 KAS 的
requiredFee 上同样只到 0.81015500 KAS，仍在 0.82031000 KAS 的容忍区间内。也就是说，**真正防住这个
具体bug的是 console 侧的公式修复本身**（`assertImpliedFeeMatches` 要求"恰好相等"，容不下任何偏差）；
relay 侧这道闸是给"未来某个更大量级/更小 requiredFee 组合的构造错误"准备的粗粒度兜底，不是这次事件的
第一道防线——`docs/provenance/.../covenant-broadcast.test.mjs` 的 IMF-2b/FRESH-10 向量证明它对"足够
大"的漏计确实有效，避免了对这道闸有效性的过度宣称。

## 修复后真实数字(真实 builder + 真实 mass，不签名不广播)

| 场景 | fee 输入 | required_fee | 锁进合约输出合计 | net_loss | 找零形状 |
|---|---|---|---|---|---|
| ①market_genesis | 0.5 KAS | 0.21333300 KAS | 0.2 KAS | 0.21333300 KAS | 带找零(0.08666700 KAS) |
| ②首笔下注(无held) | **0.95 KAS**(Bettor口径) | **0.43339900 KAS** | 0.6 KAS | 0.43339900 KAS | 带找零(0.11660100 KAS) |
| ③第二笔下注(有held) | 探测最小可行值 **0.56 KAS** | 0.35625000 KAS | 0.6 KAS | 0.36000000 KAS | 并入(无找零) |

**真实最小可行 fee 输入门槛（修复前 vs 修复后）**：

| | 修复前(bug) | 修复后 |
|---|---|---|
| 首笔下注(无held) | ≈1.05 KAS | ≈0.82 KAS(0.95 KAS 舒适可行) |
| 第二笔下注(有held) | ≈1.05 KAS(与是否有held无关，正是bug症状) | ≈0.56 KAS |

修复后 held 的真实面值确实降低了门槛(0.82→0.56，而不是修复前"有无held门槛一样"这个错误现象)，这才是
正确的物理直觉：held 自己携带 0.2 KAS 续约价值，理应让第二笔下注比首笔更便宜。

## 回归测试

- `kasia-console/src/lib/proto-tx-assembly-register-append.test.mjs` ⑦⑧(首笔)/⑦⑧(第二笔)：用
  0.85/0.65 KAS(舒适高于真实最小可行值、远低于修复前~1.05 KAS门槛)验证构造成功，并从反序列化出的
  真实 `kaspa.Transaction` 对象**外部独立复算** `Σinputs.utxo.amount − Σoutputs.value` 恰好等于
  `built.netLoss`(不只信内部 `assertImpliedFeeMatches` 没抛错)。
- `kasia-relay/src/lib/covenant-broadcast.test.mjs` IMF-1~IMF-6：`validateImpliedMinerFee` 单元向量，
  含 IMF-2a(诚实记录这次bug精确量级落在容忍区间内)、IMF-2b(更大量级确实被拒)。
- `kasia-relay/src/lib/covenant-broadcast-relay.test.mjs` FRESH-10：`validateNetLoss` 放行但隐含手续费
  超标的场景，`covenantBroadcastRelay` 正确返回 `implied_fee_exceeded`，零广播。

## 文件清单

- `recompute-fixed-cost.mjs` — 本次重新核算脚本。
- `run.log` — 完整真实运行输出。
- `README.md` — 本文件。
