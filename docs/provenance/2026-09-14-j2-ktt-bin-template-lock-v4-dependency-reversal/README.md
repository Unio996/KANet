> **Status**: CURRENT

# 候选④（依赖反转）真实编译验证 — 支撑 `docs/2026-09-14-j2-ktt-bin-template-lock-fix-design-v0.2.md`

出处：NWT (1395/1399) 用 Decoy 合约证伪候选②（`mkt_prefix`/`mkt_suffix`/`marketTmplHash` 全是 spender 自选的 witness 值，比旧尾部匹配设计还松）；Bettor/NWT 裁定评估候选④（依赖反转：KTT ctor 烤该市场全模板 hash + prefix/suffix 长度，`ShardLeaf_direct` 的 `token_tmpl_hash` 从 ctor 挪进 State）。

**工具链身份**：本次全部编译经 `compileSilV100`（`kasia-console/src/lib/pool-bshard-artifacts.mjs`），该函数内部每次调用都会先跑 `assertSilvercV100Pinned`（sha256 校验 D-019 锚点二进制）+ `assertSilvercV100GoldenSample`（黄金样本 deep-equal）——不是本 provenance 额外声明，是 `compileSilV100` 自身的既有安全闸门，任何一次编译产物都已经隐含这条校验，NWT 复跑本目录脚本时会自动重新触发同款校验。

**不改任何生产 `.sil` 文件**——全部实测用本目录下两份实验性副本：`ShardLeaf_direct.v4-tokenhash-in-state.sil`、`KanetTestToken.v4-ctorbaked.sil`（均从对应生产文件复制并只做候选④要求的最小改动）。

## 依赖顺序（无环，逐条验证）

1. 编译 `ShardLeaf_direct.v4-tokenhash-in-state.sil`（`token_tmpl_hash` 已挪进 State，用占位值）→ 得到 `M_hash`（真实 `extractTemplateArtifact` 产物）。
2. 用真实 `M_hash` + `M` 的真实 `templatePrefix.length`/`templateSuffix.length` 编译 `KanetTestToken.v4-ctorbaked.sil`（ctor 烤 `market_tmpl_hash`/`mkt_prefix_len`/`mkt_suffix_len`）→ 得到 `KTT_M_hash`。
3. 真实市场 genesis 时，`ShardLeaf_direct` 的 State `token_tmpl_hash` 字段填 `KTT_M_hash`。

全程只有"编译 → 用其真实产物喂给下一步编译"的单向依赖，不存在"A 需要 B 的产物、B 又需要 A 的产物"这种双向循环。

## 验证结果（`run.mjs`，原始输出见 `run.log`）

### (b) `ShardLeaf_direct` 自身模板 hash 与 `token_tmpl_hash`（现为 State）取值无关

用两组截然不同的 `token_tmpl_hash` 占位值（`Z32`/`F32`）编译，`extractTemplateArtifact` 产物逐字节相同（`dd059b32...`）——确认 `token_tmpl_hash` 移出 ctor 后，`ShardLeaf_direct` 自己的编译期身份真正独立于它引用哪个代币模板，编译期环（T-PROTO-TEMPLATE-CONST-ASSUMPTION-CORRECTED 记录的 1390 问题）在这个方向上被结构性消除。脚本长度 15,076 字节（原始占位版本约 15,687-15,690，字段重排导致的微小差异，非结构性变化）。

### (a) 两个不同市场的 `KTT_M` 模板 hash 不同（预期如此，代币不可跨市场互转）

用真实 `M_hash`（步骤 1 产出）编译出"市场 A"的 `KTT_M`，另用一个不同的假想 hash/长度编译"市场 B"的 `KTT_M`——两者模板 hash 逐字节不同（`d44e07b7...` vs `474aa220...`）。这不是 bug，是候选④的**设计本身**：每个市场需要自己独立编译一份 `KTT_M`，代币模板天然与市场绑定——见设计稿 v0.2 "代价"一节对此的产品级影响讨论（非安全问题，是 Owner 需要单独确认的产品行为）。

### (c) 字节预算对比

| 版本 | KTT 脚本长度 |
|---|---|
| 旧②设计 v1（`byte[]` witness，已作废） | 5,359 B |
| ②修正版（`int` 长度参数，`market_tmpl_hash` 存 State） | 4,697 B |
| ④依赖反转版（ctor 烤 `market_tmpl_hash`，无 witness 参数） | **4,326 B（最小）** |

④ 比②更省字节——因为④完全不需要 `transferPolicy`/`ownerIsMarketInput` 携带任何 market 相关的 witness 参数（全部 ctor 时定死），比②的"State 存 hash + 花费时传两个 int 长度"还要精简。

### (d) T3 侧改动点

`ShardLeaf_direct.sil` 唯一需要改的地方：
1. ctor 参数列表：`token_tmpl_hash`（ctor-only）→ 挪到 `init_token_tmpl_hash`（放进 genesis State 参数组）。
2. 合约顶层新增一行：`byte[32] token_tmpl_hash = init_token_tmpl_hash;`。
3. **`register_append` 的 AB11 `stateBytes` 手写编码必须新增一行原样拷贝 `token_tmpl_hash`（32 字节，不需要长度前缀，因为是定长字段）**——目前 `stateBytes` 只编码 4 个字段（`local_yes`/`local_no`/`count`/`pool_value`），漏加这一行会导致续约后 `token_tmpl_hash` 在链上真实字节里丢失/变造，这是 Bettor 明确要求记入 T4-lite 人工核清单的一条（本 provenance 未验证此逻辑本身的正确性，只验证了 ctor/State 结构变更后编译产物的 hash 不变性，AB11 编码正确性需要落码时的独立向量核实）。

**除此之外，`token_tmpl_hash` 在 `scanOwnedTokenInputs`/`register_append`/`convert_to_rootclose` 里的全部 5 处引用（原 ShardLeaf_direct.sil 行 93/103/140/149/208）不需要任何修改**——silverscript 把 State 字段和 ctor-only 常量都当普通合约顶层字段访问，语法完全一样，这是本次改动"diff 极小"的原因。

`KanetTestToken.sil` 需要的改动见设计稿 v0.2 §1（ctor 新增 3 项、`ownerIsMarketInput`/`transferPolicy` 签名简化，比②的方案改动更少）。

## 已知限制

- 未做 NWT Decoy 攻击在④设计下的实际负向向量复现（静态论证：④下 `market_tmpl_hash`/长度不再是 witness 参数，spender 无法在花费时选择，Decoy 攻击的前提条件已经不存在，但"确认前提不存在"≠"跑过一次真实攻击尝试仍然失败"——建议 NWT 复跑本目录脚本后，若有余力再补一条 cli-debugger 负向向量，本 provenance 未包含）。
- AB11 `stateBytes` 拷贝 `token_tmpl_hash` 这条要求只是设计标注，未做实际编码/向量验证（见上方 (d)）。
- 字节预算数字基于占位 ctor 值（`market_id`/`shard_pool_id` 等仍是 `Z32`），真实市场的具体 ctor 值不会显著改变脚本长度（同 §"逐字段隔离"系列 provenance 已确认的规律：ctor 字段值不改变长度，只有类型/数组长度会），但请求方如需精确值应在真实市场参数下重新编译确认。
