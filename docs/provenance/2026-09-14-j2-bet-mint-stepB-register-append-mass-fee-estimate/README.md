> **Status**: CURRENT

# bet_mint 步骤 B（`ShardLeaf_direct.register_append`）mass/fee 实测 — 两个真实发现 + 一次自我纠正的构造 bug

出处：Bettor 1386③"不假设一样，每 kind 单独跑一遍 mass 实验"；用 T-KTT-BIN-TEMPLATE-LOCK-FIX 修法后的 KTT 设计（见 `docs/2026-09-14-j2-ktt-bin-template-lock-fix-design-v0.1.md`）跑，不是旧的尾部匹配设计。

## 结论先行

1. **修法后 register_append 的真实成本在预算内**：`required_fee ≈ 0.45~0.60 KAS`（取决于 ps ticket 输出是否正确声明 genesis，语义正确的做法是声明，对应 **0.5992 KAS**），远低于 `GLOBAL_ABS_FEE_CAP_SOMPI=1.0 KAS`，是可行的。
2. **一个真实的、此前未记录的设计约束**：`ShardLeaf_direct`/`KanetTestToken` 的**续约输出**（不是 genesis，是每次 `register_append` 都要重新构造的自续约）必须维持在 KIP-9 storage mass 的 U 形曲线最优点附近（**~20,000,000 sompi / 0.2 KAS**），跟 genesis 输出面临的是**完全相同的公式**——`ShardLeaf_direct.sil` 源码里 `register_append`/`convert_to_rootclose` 自己的 `require(tx.outputs[...].value >= DUST_MIN)`（`DUST_MIN=1000` sompi）是一个**危险地过低的下限**：合约本身只要求 ≥1000 sompi 就放行，但如果真按这个下限构造，`required_fee` 会因为 storage mass 爆炸到 40 亿 sompi 量级（实测数字，见下）。这不是合约的 bug（`DUST_MIN` 检查的是"够不够铺垫最基础的 UTXO"，不是"mass 意义上够不够"），是 **`buildAndBroadcast` 落码时必须知道并遵守的运营纪律**：每次续约都要把续约输出的 KAS 值往 ~20,000,000 sompi 靠拢，不能只满足合约的字面最低要求。
3. **一次值得记录的自我纠正**：本实验第一版直接构造续约输出（不带 `CovenantBinding` 声明），得到 `required_fee ≈ 20 KAS`——一度以为是修法后 witness 变大导致的真实经济问题，**幸好在报告出去之前自己发现了构造 bug**：续约（非 genesis）的 covenant 输出必须带 `new CovenantBinding(authInputIdx, covId)` 声明（同 `kasia-relay/src/lib/p2sh.mjs` 生产代码 `PayoutShard` continuation 的既有手法），漏掉这个声明会让 `calculateTransactionMass` 把它当"未声明用途的巨型脚本"，产出荒谬数字——跟 market_genesis 实验第一版"漏 `populateGenesisCovenants`"是同一族教训，只是这次是续约版本。修正后（带 `CovenantBinding` + 用 U 形最优值而不是 dust 值）数字才回到合理范围。**这次没有把错误数字报出去，是在继续深挖"为什么这么贵"的过程中自己抓住的**，如实记录不是掩盖。

## 方法

真实 `compileSilV100` 编译三份合约（`ShardLeaf_direct` 用有代表性的中间态 ctor：`min_bet=100000`/`count=1`/`pool_value=100000`，不用极端占位值，避免 int 变长编码低估脚本大小；`KanetTestToken` 用 T-KTT-BIN-TEMPLATE-LOCK-FIX 的实验性修法副本；`PoolSideTicket` 用真实 4 字段占位 ctor）。构造 3 输入 4 输出的 `register_append` 交易：

- 输入：`ShardLeaf_direct` 自己的 UTXO（sigScript 携带真实 redeem + witness 近似编码）、`KanetTestToken` 的 UTXO（sigScript 携带真实 redeem + `mkt_prefix`/`mkt_suffix` witness——这是修法后新增的、直接来自 `ShardLeaf_direct` 真实 `extractTemplateArtifact` 产物的字节，本实验的核心变量）、relay fee input。
- 输出：续约 `ShardLeaf_direct`（带 `CovenantBinding`）、新铸 `PoolSideTicket`（genesis）、续约 `KanetTestToken`（带 `CovenantBinding`）、relay 找零。

脚本：[`estimate-register-append-mass-fee.mjs`](./estimate-register-append-mass-fee.mjs)，原始输出见 [`run.log`](./run.log)。

## 实测数据

| 场景 | mass | required_fee | KAS |
|---|---|---|---|
| 续约输出无 `CovenantBinding`（构造 bug，已纠正） | ~19,950,193 | 1,995,019,300 sompi | ~19.95 |
| 续约输出带 `CovenantBinding`，续约值=DUST_MIN 量级（危险，见下） | 4,000,000,000（同 genesis U 曲线 v=1000 那一点） | — | 天文数字 |
| **续约输出带 `CovenantBinding` + U 形最优值(20,000,000 sompi)，ps ticket 不声明 genesis** | 449,203 | 44,920,300 sompi | 0.4492 |
| **续约输出带 `CovenantBinding` + U 形最优值(20,000,000 sompi)，ps ticket 正确声明 genesis（语义正确的做法）** | 599,203 | 59,920,300 sompi | **0.5992** |

单独验证"续约输出值 vs mass"的 U 形曲线（隔离测试，固定其余条件只变续约 leaf 输出的 value）：

| 续约 leaf 输出 value (sompi) | mass |
|---|---|
| 1,000 | 4,000,000,000 |
| 100,000 | 40,000,000 |
| 1,000,000 | 4,000,000 |
| **20,000,000** | **200,000 ← 全局最小，与 genesis 实验完全相同** |
| 50,000,000 | 80,000 |

这条曲线跟 `docs/provenance/2026-09-14-j2-proto-v0-genesis-mass-fee-estimate/` 的 genesis 曲线**逐 sompi 相同**——证实 KIP-9 storage mass 的 `p²/v` 惩罚对"是不是 genesis"完全不敏感，只看**这个 covenant 输出的 value**，genesis 和续约面对的是同一条曲线。

## 对 T-KTT-BIN-TEMPLATE-LOCK-FIX 设计稿 §2 的补充

设计稿 §2 报的"+1888 bytes"只是**编译产物**（redeem 脚本本身）的增量——本实验量出了**真正的运营成本大头**：KTT 的 `transfer` 调用每次都要在 sigScript 里携带市场的完整 `mkt_prefix`/`mkt_suffix`（本例中 `mkt_suffix` 长度 15,653 字节，占 KTT 侧 sigScript 总长度 21,036 字节的绝大部分）。这个大小是**线性 mass**（NWT 已核实"输入侧大 sigScript 是线性 mass"），不是 storage mass 那种 U 形陷阱，实测总费用仍在预算内（0.5992 KAS），但如果未来市场合约（`ShardLeaf_direct`）体积进一步增大，这部分线性成本会跟着涨，是需要持续关注的成本来源，不是一次性的。

## 已知限制 / 未完成项

- witness 参数编码用的是**近似字节数**（`int` 按 9 字节粗算，`byte[]` 按"长度前缀+内容"粗算），不是最终精确编码（真实 `_pushInt`/`_pushBytes` 编码规则见 `kasia-relay/src/lib/p2sh.mjs` 生产代码，落码时需要按精确编码重新量一次，量级不会有数量级变化，但精确数字会有出入）。
- `ps_prefix`/`ps_suffix` 长度用的是当前 `PoolSideTicket` 真实编译产物（1B/33B，与 `proto-v0-template-anchors.json` 记录的一致），`tok_prefix`/`tok_suffix`（KTT 自己的模板，供 `ShardLeaf_direct` 侧校验代币输入）暂用旧设计基线长度近似（1B/33B 量级），修法后 KTT 的真实 `extractTemplateArtifact` prefix/suffix 长度需要另外量一次，不在本次范围（本实验的重点是 `mkt_prefix`/`mkt_suffix` 这一侧新增的开销，不是这一侧）。
- 续约输出维持 ~20,000,000 sompi 这条运营纪律**需要写进 `buildAndBroadcast` 实现规范**（同类型于 `genesisOutputValue` 的既有纪律），不是本文档能替代落码的地方——本文档只负责把这条约束的存在和数值测出来。
