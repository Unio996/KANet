# 模块化分润组件 spec —— 即插即用 · 行业无关 · 先替代现有硬编分润

**作者**: Bettor (架构) · **日期**: 2026-06-22 · **v1.1 更新**: 2026-07-11 · **状态**: v1.1 重启对抗审(Owner 7/11 直令"都搞,并行"),NWT 红队在途
**Owner 钦定**: 分润模型强化成【第三方独立组件】, 模块化 + 即插即用, **先替代我们自己目前的分润组件**(= 系统优化). 任何现实行业可用。
**配**: [[project-economic-split-real-northstar]] · [[project-fee-model-adversarial-hardened-design]] · [[feedback-ss-attack-review-verify-value-source]]

---

## v1.1 现实对齐(2026-07-11 Bettor·6/22 后世界变了,落地条件反而更好)

**A. D-008 单源派生已落码 = 迁移锚点现成**(2026-07-09,commit 15cb070d):`deriveSettlementFeeLeaves` 单源函数+**四侧接线**(propose/enqueue/committee-voter/guest-input)+lint R-FEE-LEAVES-BYPASS 旁路封死已在生产。§5 迁移路径更新:**组件替代的目标就是这一个函数**(6/22 时还是"三处调用点"的散状,现在是单一 chokepoint)——`feeSplit()` 落码后只需替换 deriveSettlementFeeLeaves 内部实现,四侧接线与 lint 门自动继承,迁移面比 6/22 设想小一个量级。**反 vacuous 铁律随之继承**:单源的是派生算法,值源四侧各自独立链读禁透传(D-008 原文)。

**B. 实测费语义现状(2026-07-11 实弹数据,设计必须如实面对的双轨)**:
- **V2/ZK 线**: fee 真实生效——bvh2c broker 实收 5,130,000 sompi(claim leaf)、tyr91/1dv70 各 6,080,000,按市场 `broker_fee_pct`(bps)池× 费率,claim tx 链上可验(zk_escape_audit 记录 claim txid)。
- **V1 委员线**: **fee=0**——28mln(17,613.9KAS 史上最大盘)结算实测 Σ154 赢家实付=全部池值,零 broker 费。根因:`computeSettlePlan`(bshard-auto-settler.mjs:76)调 `computePariMutuelPayout` 不传 feeLeaves/feeBps,V1 委员 enforce"字节不动"口径一致,双侧一致所以不是 bug 是**未实现**。
- **∴ 本组件落地即顺带统一双轨**:prediction 预设按 fee-on-total LOCKED 模型(见 C)接入 V1+V2 两线,"V1 broker 零收入"这个 broker 招募硬伤一并修复(Owner 6/13: "没人当 broker 这产品只有死")。V1 接入必须走独立回归(§5 铁律 4 的 byte-equal 检验对 V1 改为"新费下守恒精确+委员双侧同步升级",不是 byte-equal——V1 现状是 0 费,加费必然变 root,**委员 enforce 与 driver 必须同一 commit 升级否则 BUST**,同今晚 driver/committee 排除漏配家族教训)。
- V1 语义变更(0 费→有费)= 经济政策变更,**费率生效边界必须"新建市场起"**(存量在飞盘保持建单时承诺,规则链锚精神——建单时无费承诺的盘不得追溯收费)。

**C. 费率模型已 LOCKED**: fee-on-total(Owner 6/13 r791 终裁,见 `docs/iteration/fee-model-detailed-spec.md`)——prediction 预设的 bps 结构照 §2/§4,总抽成基数=总押注额,settle-time 计算。

**D. 新增对抗硬化点(今晚战役的直接输入,并入 §6)**:
6. **消费点枚举铁律**: 任何"改分润读/算路径"的落码,必须枚举**全部**消费点逐一接线并 NWT 全库扫尽确认无第 N+1 处——今晚同形状漏配(driver/committee/snapshot/enforce fallback)一夜炸了五处,家族性风险最高。
7. **终态语义**: 费用未实际转移不得记"已分润"(NO TX NO STATE;今晚 `pruned_expired_waived` 命名判例)。
8. **跨节点确定性**: feeRules 的任何判别值禁本地 id/本地时间,全部链锚(side_lock_tx 判别式判例)。

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

## 3.1 v1.2 机制钉死(2026-07-11 NWT 红队三点,全采纳)

1. **commit 形态澄清(答 NWT 结构问)**: feeRules **hash-commit**——`commit = blake2b(canonicalize(feeRules))` 固定 32 字节,烤 redeem 固定 offset(与 predicate_commit 同模式)。roles 数量可变不影响 commit 长度;settle 时委员对 DB 存的 feeRules 全文重新 canonicalize+hash,== 链上 commit 才继续(原文"烤进 redeem"未写死 hash 形态=表述债,此处钉死)。
2. **canonicalize = 单一共享函数,非"两处各自实现同一规范"**: create-time commit 与 settle-time re-derive **必须 import 同一个 `canonicalizeFeeRules()`**(嵌套 roles 数组按 role name 字典序+顶层 sorted-key+固定字段序,全部在该函数内实现)。两处独立实现同一规范=今晚 driver/committee 四处漏配家族的根,机制上不给复发机会(lint 可加 R-FEERULES-CANON-BYPASS 同 D-008 旁路封死模式)。
3. **schema 版本号进 canonicalize 载荷**: feeRules 顶层必含 `schema_v`(int),参与 hash。委员 re-derive 前先检查 `schema_v` 是否在本节点支持集——不支持则报**可辨识的版本不符错误**(非静默算错非裸 BUST);版本变更天然改变 commit=旧新版本物理不可混。driver/committee 同 commit 升级从"流程纪律"升为"机制保障"。

## 3.2 v1.3 ③好用层(2026-07-12 Owner 钦定,详见 KB `00-position/value-split-social-coordination-infra.md` v3 §6.5)

Owner verbatim: "站在人类, 特别是**个体经济利益驱动**角度设计构建; 理论上可应用于**人类任何领域**; **怎么才能好被其他人/其他系统使用**要不断迭代; **使用方便, 信息及时推送**很关键。" 折入为组件的第三维(①分得对+②看得见+**③好用**):
- **采用性=一等设计目标**: 独立 package(`@kanet/fee-split`)+接入文档+最小 example, 目标"不懂链的开发者十分钟跑通 demo";预设制是采用性的核心接口(§4)。
- **信息及时推送进组件边界(NWT 边界修正 2026-07-12: 推送在 package 不在纯函数)**: `feeSplit()` 本身保持**纯函数零副作用**(determinism/跨节点 byte-equal 的根基, §1 不变量不动摇——委员 settle-time re-derive 是纯计算, **永不触发推送**)。推送=package 内**独立 notify 层**: 订阅**落链事件**(landed 后), 单点 emit 推收款角色(tg DM/webhook/事件流)——即 broker-fee-emit(7/11 live 验证)的"landed 后单源 emit"同款模式泛化, 计算与通知解耦, 同一笔分润全网只推一次。"作为组件输出"指 package 交付物含这层, 非 feeSplit() 函数内部动作。
- **持续迭代姿态**: 本 spec 随实弹/采用反馈滚动升版, 非一次性交付。

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
