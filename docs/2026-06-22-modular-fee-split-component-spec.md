# 模块化分润组件 spec —— 即插即用 · 行业无关 · 先替代现有硬编分润

**作者**: Bettor (架构) · **日期**: 2026-06-22 · **状态**: 草案, 待全 vantage 对抗审
**Owner 钦定**: 分润模型强化成【第三方独立组件】, 模块化 + 即插即用, **先替代我们自己目前的分润组件**(= 系统优化). 任何现实行业可用。
**配**: [[project-economic-split-real-northstar]] · [[project-fee-model-adversarial-hardened-design]] · [[feedback-ss-attack-review-verify-value-source]]

---

## 0. 定位 (Owner 钦定 2026-06-22): 这不是分钱组件, 是【社会资源协调原语】
分润不是"分钱"——是**协调机制**。它把「谁该得多少」焊死在链上、自动履行、谁也偷不走 → 于是每个社会角色(产出/撮合/引荐/验证/基础设施)**因为确定能拿到自己那份, 才会去做自己那部分** → **不需要中心协调者, 激励结构自己把社会资源协调起来, 协调成本趋零**。
任何行业本质都是一个协调问题: 谁生产、谁撮合、谁引荐、谁验证、谁托管 + 价值怎么公平流给他们。本组件用 trustless 的价值分配解决"价值怎么流"→ 协调自动成立。**∴ KANet 占位 = 社会资源协调的信任基础设施; 预测市场只是第一个应用。**

## 0.1 一句话
把现在硬编在 `pool-shard-settle.mjs` 的分润逻辑(FEE_CONFIG 全局常量 + deriveFeeLeaves)抽成一个**纯函数、无状态、规则可配、链上焊死、行业无关**的组件。现有预测市场的分法变成它的**一个预设**——即【替代】不是【新增】, 即插即用替任何社会协调场景。

## 1. 即插即用的关键 = 纯函数 + 规则外置 + commit 内置
组件本身不持状态、不碰链、不知道行业。它只做一件事:
```
feeSplit(feeRules, poolSompi, winners) → { feeLeaves[], payoutLeaves[] }
```
- **输入**: ① feeRules(谁拿几 %) ② poolSompi(分配基数) ③ winners(赢家集 + stake, pari-mutuel)
- **输出**: feeLeaves(各 fee 方 {pk, amount}) + payoutLeaves(winners ‖ fee leaves, canonical 序)
- 纯函数 = 同输入同输出 = determinism = 跨节点 byte-equal(我们 Track B 一路守的). 可单测、可换、可独立分发。

## 2. 可配规则 schema (产品接口)
```jsonc
{
  "preset": "prediction" | "ecommerce" | "freelance" | "custom",
  "roles": [
    { "name": "provider",    "address": "kaspa:...", "bps": 9700 },  // 卖家/winner 池
    { "name": "facilitator", "address": "kaspa:...", "bps": 160  },  // broker
    { "name": "affiliate",   "address": "kaspa:...", "bps": 20,  "optional": true }, // introducer
    { "name": "verifier",    "derive": "committee",  "bps": 100 },  // oracle, 委员派生地址
    { "name": "infra",       "derive": "committee",  "bps": 20  }   // node, 委员派生
  ]
}
```
**schema 层硬不变量 (防恶意配置)**:
- `Σ all bps == 10000` (总和守恒, 否则拒)
- `provider.bps >= PROVIDER_MIN_BPS` (winners 下限, 防 facilitator 配 100% 抢光)
- 每 role bps ∈ [0, ROLE_MAX_BPS]
- `derive:"committee"` 的 role 地址 = 委员集链派生 (非 caller 供, 同现 oracle/node)

## 3. trustless 核心 = 规则上链焊死 (命门④ 扩展)
**这是配置性的唯一前提**: 可配的规则**必须建单时链锚**, settle 时只读不可改。
- 现状: `computeMarketCommit(predicate, {brokerPk, introducerPk})` 只锚 **fee 收款地址**, **不锚 bps**(bps 是全局常量).
- 改: `computeMarketCommit(predicate, feeRules)` 锚 **整个 feeRules**(地址 + bps + roles 结构), genesis 烤进 redeem offset-518(同 predicate_commit 模式)。
- settle: 委员从 **committed feeRules** re-derive feeLeaves + payoutRoot, `claimed != re-derived → BUST`。
- ∴ settler 改任何 bps/地址 → commit 不符 → 委员拒签。**可配 + trustless 同时成立**。

## 4. 行业预设 (证明行业无关 + 替代性)
| 预设 | provider | facilitator | affiliate | verifier | infra |
|---|---|---|---|---|---|
| **prediction**(现有) | winner 97% | broker 1.6% | intro 0.2% | oracle 1% | node 0.2% |
| 电商 | 卖家 90% | 平台 5% | 联盟 3% | 验货 2% | — |
| 自由职业 | provider 92% | 撮合 5% | — | 仲裁 3% | — |
| 供应链分账 | 按合约 N 方自定义 | | | | |
prediction 预设 = 现有分法的**逐字搬迁** → 证明组件【替代】现有, 行为不变。

## 5. 替代/迁移 (= 系统优化, 不破现有)
1. `FEE_CONFIG` 常量 → `PRESETS.prediction` (同值, 单源).
2. `deriveFeeLeaves(...)` 调用点(settle/enforce/claim 三处单源) → 改调 `feeSplit(feeRules, ...)`; feeRules 来自市场 committed 规则(prediction 预设)。
3. `computeMarketCommit` → 锚 feeRules 非只地址(载重一致: genesis 烤 == 委员 re-derive 同 schema 序列化, **否则命门④假牙 — 正是今天 2462l source-in-inner 同类坑**)。
4. **回归铁律**: 迁移后预测市场分润 byte-equal 现有(payoutRoot 不变 + x4kpq 重算对上) 才算替代成功, 不退化。

## 6. 对抗硬化点 (我先抛, 等 J1 determinism / J2 storage / NWT 验证 / KANet-UI 经济+UI 全 vantage 挑)
1. **载重一致性**: feeRules genesis 烤 == settle re-derive, 必同一 canonical 序列化(sorted-key + 固定字段序)。schema 变 → commit offset 变 → fail-loud。
2. **配置硬边界**: schema invariant(Σ=10000 / provider 下限 / role 上限)必在【组件入口 + commit 前】双验, 防恶意预设上链。
3. **determinism**: 规则全 create 烤死, settle 零 settler 输入、零 within-deal 激活条件(introducer 激活搬 pre-create, 同 6-21 设计)。
4. **storage**: fee-leaf 进 payoutRoot merkle(非 UTXO), N role ≤ 1024 depth 不炸(同 6-21 攻击5)。
5. **角色泛化的 verifier/infra 派生**: 非 prediction 行业没有"委员"概念时, verifier/infra 怎么定地址? (留作讨论: 可纯地址制, 失去委员自治 = 退化成 honest-oracle; 或保留委员模型作"验证即服务")。

## 7. 路径
spec(本文) → 全 vantage 对抗硬化(像 6-21 那场) → 落码(组件 + prediction 预设替代 + 回归 test 守 byte-equal) → 抽成独立 package(`@kanet/fee-split`?)可第三方引用。
**经济数值(各预设 bps)= Owner 决策, 非机制**; 机制保证【任意合法配置都 trustless】。
