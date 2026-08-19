# D-012 §6-3 fair-exchange 设计卡 v0.1 — Exchange 裁决角色（报备层 · 零生产改动）

> **Status**: DRAFT **v0.3** · Bettor 2026-08-20 主笔 · 设计层, 零生产码。**v0.2 = J1 二审 + NWT+J2 红队; v0.3 = 并入 Codex 红队(MSG-251)四条**(§8 收窄/§7 MUST-FIX A/§2 措辞纠/§4 MUST-FIX B)+ J2 (20:03) 三处记录更正。**方向 Codex GREEN, 两条 MUST-FIX(A/B)未闭。** 见 §11。
> **定位**: §6-1 Oracle 权限边界契约(all-review-passed 冻结, target `154291d8`)的**第一个复用消费者**; DECISIONS.md §6 执行序 item3 = "从零造裁决角色, 非接现成接口"。**造它同时是对 §6-1 冻结的反向审计**(第一个消费者暴露契约漏没漏)。
> **依据**: Codex `RESPONSE-20260731-…-ADVERSARIAL-CONCLUSION`(规定卡的 11 节 + 3 打回)· §6-1 冻结稿 `docs/2026-08-03-oracle-skill-interface-permission-boundary-freeze-design.md` §4 · KB `architecture/zk-track-c-verified-trustless-settle.md` + `00-position/northstar-open-collaboration-protocol.md` · 现有 exchange 码(exchange-machine.js / api/exchange.js:747-796 / exchange-machine.js:563)。
> **权分**: Bettor 设计 × J1/NWT 审 × Codex 红队。**真实 roster**(J2/NWT 独立性未证实但内容可用; J1+Codex 确证独立)。
> **证据纪律(承 §6-1 §6)**: 每条设计决策标 `[CONFIRMED·读]`/`[INFERRED]`/`[DESIGN-CHOICE]`, 且引它消费的 §6-1 §4.x 条款。

## §0 Track 边界（先于正文，承 D-012 §0）
本卡是 **Track B 协议能力设计**。**不授权 Owner 实例(Track A)对外开放**; 部署随北极星 + Owner 拍。设计层可推进; 任何实现码/部署 = 停, 走报备等 Owner。

## §1 先把【不做什么】写死（避开 Codex 三打回 + 已知陷阱）

- 🔴 **不主张"跨域结算是 KANet 唯一不可替代的位置"**(Codex 打回1)。可辩护的**唯一**主张 = 「**跨域交换是这样一类场景: 单一域自己无法 enforce 整个状态转移时, 一个额外协调层【可能】有帮助**」。卡的 §8 必须对 plain HTLC / adaptor-signature 做对比、证明协调层在何处真加价值, 否则本卡不及格(Codex 明令)。
- 🔴 **不假设"原子性需要一个中立裁决域"**(Codex 打回2)。原子性有**四形态**, 本卡 §4 选一并辩护: (i)单域裁决 (ii)密码学耦合的本地裁决 (iii)外部 attestation (iv)非原子顺序执行。
- 🔴 **不用"链上揭示 secret/preimage"做数字商品交割**(Codex 打回3): 链上 preimage 是**公开**的、非买家私有 ⇒ 对可复用 license key/凭证/API token 不适用; 且"hash 相等"不证明"揭示的东西=承诺的东西"。**v0.1 brick 明确 out-of-scope 隐私保护数字商品交割**(需 verifiable/adaptor 加密, 重子设计); v0.1 只做**交割本身即链上可独立验证的转账**那一类(KAS ↔ 另一链上资产)。
- 🔴 **不把裁决角色框成"无签字 escrow"**(Codex 打回0/frame): 那是错框。
- 🔴🔴 **裁决角色【不能】靠委员签名把钱移给赢家**(§6-1 §4.2 守恒: "签一笔付赢家的 tx"在冻结接口里不存在)。也**不能**独立裁判链下真相(KB northstar ⑥ + zk-track-c: covenant/ZK enforce 已授权转移 / closes layer-2 算术, **closes 不了 layer-1"谁赢"**)。

## §2 裁决角色到底是什么（本卡的锚·先定锚再设计怎么证）

**[DESIGN-CHOICE]** 裁决角色 = **一个对【共识态可独立验证的结果事实】产出 §6-1 类型化 attestation 的角色**, 三条硬边界:

1. **只 attest 可独立验证的结果**(消费 §6-1 §4.3 binding): 它签的 OutcomeAttestation 里的结果, 必须能被任何验证方**从共识态独立复算/核验其绑定**(不接受喂来的结果对象)。链下不可验的真相 ⇒ **abstain**(§4.5), 绝不猜。
2. **只签类型化 attestation、从不碰钱**(消费 §6-1 §4.1 + §4.2): 签的是域分隔的 `OutcomeAttestation` typed 对象(绑协议版本/网络/市场身份/结果命名空间/证据承诺/有效期/oracle 身份/防重放序号, **对象内不含任何交易输入输出/地址/金额/fee/change** —— 承 §6-1 §2.1 正路)。**钱的移动 = covenant/结算路独立消费该 attestation 校验授权**, 裁决者的钥永不签 payout。
3. **abstain 是一等终态**(消费 §6-1 §4.5): 三态返回 `{agree|disagree|cannot-verify}`; `cannot-verify` ⇒ **零授权**, 不得降级成更便宜的检查再签, 不得折进 `disagree`。上线须报 abstain 率(≈100% abstain = defect 非"没触发")。

🔵 **为什么这个锚同时答了 Codex 打回**: 它不主张"中立裁决"或"唯一原子性"; 它主张的是——**对【本可验证但两边各自看不全】的跨域结果, 提供一份两边都能消费的 attestation**; 这正是"单一域无法 enforce 整个转移时协调层可能有帮助"的可辩护版本。协调层的价值 = **让 A 链的结算能消费一份关于 B 链结果的、可独立核验的 attestation**, 而非"替谁做主观裁判"。

🔴 **v0.3 措辞纠(Codex MSG-251·守住锚不被 §4 偷渡)**: 委员**只 attest 事实谓词**(如"B 侧要求转账在 anchor H 前未满足条件 X"), **不决定**退/罚/延/放。"这个事实意味着退款还是别的" = **P2/policy + covenant 执行**决定, **不是 P1**。⇒ §4 里 `disagree → refund` **不得**读成"委员判退款"; 正确读法 = `(receipt + baked policy/state) → 确定性允许的转移`。委员产事实, 转移由 policy 定。

## §3 参与者与资产（Codex §a/§b）

- **[DESIGN-CHOICE] 参与者**: maker(挂单方)· taker(接单方)· **裁决委员集**(§6-1 委员, 产 OutcomeAttestation)· 结算/covenant 路(消费 attestation 移钱, 非裁决者)。
- **[DESIGN-CHOICE] v0.1 资产范围**: KAS(本链)↔ 另一链上资产, **且交割腿本身链上可独立验证**(排除数字商品/凭证 → §1)。这样"结果事实"= 两条链上各自的转账是否落地, 均共识可验 ⇒ 满足 §2 边界1。

## §4 状态机与原子性边界（Codex §c/§d）

- **[DESIGN-CHOICE] 选原子性形态 = (iii) 外部 attestation + (ii) 密码学耦合的本地裁决 的组合**, 理由: KANet 委员已在做 outcome attestation(§6-1 v0.7 实例); 跨两条独立链**无法**做单域原子(打回2), 但可以: A 链的释放**密码学耦合**到「一份关于 B 链交割的 OutcomeAttestation」。**非**追求"全局原子"(不可得), 而是**每条腿的释放各自被一份可验 attestation 门控 + 超时兜底**。
- **[DESIGN-CHOICE] 状态机(承现有 exchange-machine.js 骨架, 替换 concede-only 死路)**:
  `open → matched → leg-A-locked → leg-B-locked → attesting →(agree)→ settling → completed`
  分叉: `attesting →(cannot-verify/超时)→ timeout-refund`(双腿各自退回, 无人被单边套住) · `attesting →(disagree/证伪)→ refund`。
  🔴 **替换 `api/exchange.js:747-796` 的 concede-only `/resolve`**: 现状"双方不认输即无路径达终态"(NWT ③)⇒ 新增 attestation 门控的 `attesting` 态, 使**不依赖任何一方认输**即可达终态(attest 或超时)。
- **[CONFIRMED·读] 承重前提**: `checkStaleDisputes()`(exchange-machine.js:563)现为 stub ⇒ 超时兜底本就未建, v0.1 必须把 timeout-refund 设成**真终态**(记 `pre_dispute_status` 才能安全自动退, 见 :541-545 设计注)。
- 🔴🔴 **v0.2 修单边套牢洞(NWT ③)**: **每腿的 timeout 必须从【该腿自身锁定那一刻】起算, 不是从"两腿都锁定后"起算**。否则"leg-A 已锁、leg-B 从未锁"这个场景**根本没有计时器被触发** ⇒ maker 锁定资金无限期卡住(不是"到期退", 是"根本没有到期")。⇒ 状态机: 进 `leg-A-locked` 即启动 leg-A 的 deadline; 若在 leg-A deadline 前未进 `leg-B-locked` ⇒ leg-A 自动 timeout-refund。**每腿独立计时、独立可退。**
- 🔴 **v0.2 加验收(J2)**: 单边套牢负测不只测"另一方能不能走人", 还要测**走人之后账上有没有留半截状态**(fund_lock 泄漏 / 状态卡在中间态)——退出必须是干净终态, 零残留。
- 🔴🔴 **MUST-FIX B(Codex MSG-251)——两阶段【锁-结】时序不变量(独立每腿超时只解决"第二腿锁前", 没解决"两腿都锁后"的公平交换)**: v0.2 的每腿独立超时挡住了"leg-A 锁/leg-B 从不锁"; 但**两资产都 committed 之后**, 谁先 claim/release、对方还来不来得及对等 claim, 仍是公平交换的核心。需具体跨腿规则:
  - **① 时序须证成【不等式】非定性**: 任一腿的 claim/release 必须给对方腿留足**协议定义的时间/finality 余量**做对等 claim(`t_reciprocal_deadline − t_first_claim ≥ Δ_finality + Δ_margin`, 写成可核验不等式)。
  - **② 终态互斥 + 清锁**: 对**同一个锁定 output/session**, `abort/refund` 与 `completed` **必须互斥**; **每一条终态路径都必须清掉锁状态**(承 §5 脆弱点 fund_lock 泄漏教训)。
  - ⇒ **§4"两腿都锁后的公平交换" = OPEN/MUST-FIX B**(v0.2 只 ACCEPTED 了"第二腿锁前不套牢"这半)。

## §5 隐私与真实性（Codex §e/§f）

- **[DESIGN-CHOICE] 隐私**: v0.1 交割物是**链上公开转账**(非数字商品)⇒ 无 preimage 隐私问题(打回3 被 scope 规避, 非解决)。真实性 = OutcomeAttestation 域分隔签名(§6-1 §4.1)+ 结果绑定共识态(§4.3)。
- 🔴 **明列 v0.1 不覆盖**: 隐私保护的数字商品交割(license/凭证/token)—— 需 verifiable encryption / adaptor 条件揭示 / 买家绑定一次性凭证, 单列 v0.2+。

## §6 超时/griefing、重放/抢跑、证据连续性、确定性恢复（Codex §g/§h/§i/§j）

- **[DESIGN-CHOICE] 超时/griefing**: 每腿锁定带 deadline(DAA 计, 承 `check_utxo_landed`+minDepth 先例); 任一方不推进 → 到期 timeout-refund 双退。无单边套牢。
- **[DESIGN-CHOICE] 重放/抢跑**: OutcomeAttestation 带防重放序号 + market 身份绑定(§6-1 §2.1); attestation 一次性消费(CAS, 承 challenge store 先例)。
- **[DESIGN-CHOICE] 证据连续性**: attestation 绑「证据承诺」(§6-1 §2.1 正路字段); 结算路验证据承诺 ↔ 结果一致, 断链 → abstain。
- **[DESIGN-CHOICE] 确定性恢复**: 结果与 payout 均**纯函数 + 确定整数算术**从共识态复算(§6-1 §4.3 双条件: 确定性 AND 绑定)。恢复 = 任一节点从共识态重算得同一 (input-set root, payout-root) 对。

## §7 §6-3 作为 §6-1 复用审计（本卡的第二产出·反验冻结）

逐条记「本卡消费哪条 §4.x + 有没有不 compose」:
- 消费 §4.1(类型签)✅ 直接用 OutcomeAttestation typed 对象。
- 消费 §4.2(守恒)—— **v0.1"谁签"问法问错了对象; v0.2 按 NWT/J2 红队重构为两层**(承重点从"谁签"移到"谁能凑 quorum attestation" + "哪些字段 baked"):
  - **🔴 v0.1 §7 原写"谁签这笔付-taker 的非守恒 tx"—— 只对【签名式放行】那一支成立**。本仓已有**另一支【条件式/covenant 放行】的先例, 且经 Bettor 实核**: `CloseZkV2.sil` **checkSig=0**(vs `PayoutShardV2.sil` checkSig=10, worktree 实测)= 一份**零-checkSig、纯条件放行**合约; `bshard-close-enforce.mjs`(Track B autonomous-enforce, J1 co-design)= script 自核验授权数据后按预置规则放行输出、**无专门签 payout 的钥**。⇒ **§6-3 选条件式分支 ⇒ "谁签"这个问题消失**(无可驱动的签字方, 攻击者驱动谁)。
  - **层(a) payout 执行**: covenant 消费 OutcomeAttestation 授权非守恒交割, **零额外自定钥**, 照 CloseZkV2/bshard-close-enforce 先例。**非新造能力**。
  - **🔴🔴 层(b) attestation 产出 = 真正的同机风险落点(NWT)**: "谁能绕 payout 门控"不取决于 covenant 设计多干净, 取决于**产出一份够 quorum 的 OutcomeAttestation 能不能被同一台机器凑齐**。⇒ **这不是 §6-3 新缝, 是 §6-1 自己的【委员-quorum-中心化】问题在 §6-3 这第一个消费者身上长出第一个【授权真实资金转移】的实例**。
  - **🔵 精确数(数字分歧已重测解决; 权威 = Bettor 重跑原始仪器)**: J2 先报 3.9%, NWT 指其为方法学 artifact(真根因见下方裁定 = 用 `relay_id` 跨节点匹配, **非**"空列")。**Bettor 亲跑原脚本 `scratch/bettor-committee-locality-0804.mjs --all`(原方法=`XOnlyPublicKey.fromAddress` 地址派生, 32/32 relay 成功派生), 逐字对上原始记录**——255 市场分布: `0/5→8 · 1/5→167 · 2/5→7 · 3/5→10 · 4/5→22 · 5/5→41`。⇒ **回溯: 本机可独立达 quorum(≥threshold=4)= 63/255 = 24.7%**(5/5 全本机 = 41/255=16.1%)。**3.9% 作废(artifact)。**
  - **🔴 前瞻(J2 (19:54) 补测, 与回溯同向且更重)**: 委员 = VRF **stake-weighted 抽 5** 入 `pool_committee`(migrate.js:4737 注), 质押池 = **`oracle_stake_enrollments`**(J2 (20:03) 更正: `oracle_stakes` 表不存在, Bettor 实核 CREATE TABLE 确认)。**当前池本机占 stake 权重 ≈ 86.4%** ⇒ 新市场委员 ≈ **86% 本机主导**。趋势非"早期集中今分散", 是"当时多抽外部、**今天池子已本机主导**"。⚠ caveat: 有放回近似、采样实现(去重/有无放回/权重入 VRF)未读 = **数量级参考**; 池仅 **16 条 active** = 小池本身脆弱(几笔质押改多数)。
  - **🏛 方法学裁定(Bettor, 与 §10 一致; 根因经 J2 (20:03) 更正)**: **权威判据 = 从本机 relay 地址【派生 pubkey】(`XOnlyPublicKey.fromAddress`)与 `committee_pks` 匹配**(原脚本所用, 32/32 派生成功)。**J2 3.9% 的真根因 = 用 `relay_id`(`committee_relay_ids` 配 `relay_nodes.id`=本地 UUID)做跨节点匹配** —— 而 relay_id 是节点本地命名空间、跨节点无意义(J2 在 §10 刚论证过、转头自己用了; = "错理由活得比结论久"同族)。⚠ **注: "空列 ecdsa_pubkey_xonly"是 J2 19:54 的猜测且 19:56 已撤, 非真根因**(v0.2 一度误记, 此处更正)。真根因是**选错了 key(relay_id vs pubkey)**, 与 §10 结论完全同源。
  - **§6-3 上线前【必答】(NWT: 比"设计层未决"更进一步)**: "是否接受用今天这个 quorum 集中度授权真实资金转移" —— 桌上的数 = **回溯 24.7%(≥threshold)/ 前瞻 ≈86%(当前池, 数量级)**。**⇒ 委员-quorum-中心化是【当前主导】而非缩小的历史 artifact; §6-3 授权真金前这是硬闸, 归 Owner 策略决定**(如同 §6-1 签发口的部署闸性质)。
  - **🔴 J2 补: 条件式不免费——绑定缺口**: 条件式下承重点移到 **"attestation 里哪几个字段是 baked 进合约 state、哪几个是 witness 喂的"**——witness 喂的攻击者说了算。⇒ **§4.3 复算的对象【必须是 baked 那部分】**, 否则复算的是攻击者给的值。
  - **🔴🔴 MUST-FIX A(Codex MSG-251)——freeze attestation→baked-state 绑定, 且【烤它的转移必须共识强制】**: CloseZkV2 证明的是 **"已 baked 的授权 → 无签字条件放行"**(claim 路: 证 payout leaf 对 `payoutRootField`, 无 payout-authority 签名, 真); 但它**只证** `already-baked state → signatureless payout`, **没证** `外部 §6-1 OutcomeAttestation → 可信 baked state`——`attestedWinner` 是从自身 state 读的、mint 管线 `closezk-v2-mint.mjs` 从上一个 PayoutShardV2 attested state 读它构造新 redeem。**缺的环 = 外部 attestation 怎么【成为】可信 baked state。** 两种可接受形态: (1) attestation **直接就是** baked commitment; (2) 一个**前置 covenant 验证阈值 attestation, 且只能产出唯一一个后继 output, 其 baked state 从验过的 receipt 确定性派生**, 后继再用无签字 claim。**两形态都要求验证方绑死 §6-1 receipt 的 {身份/version/network/market-state/outcome/证据/committee-epoch/replay/policy} + 精确后继 state commitment**。🔴 **host 侧 builder"读一行 attested row 编个新 covenant"【不是授权】**(= 同机可绕, §10§3 族)。⇒ **强化 J2 baked 点(Codex): 不只问【哪些字段 baked】, 要问【烤它们的那个转移本身是否从验证过的 attestation 共识强制】**——host-compiled ≠ consensus-enforced。**§7 层(a)由此从"照先例即可"降级为 OPEN/MUST-FIX A**。
  - 🟢 **这正是 §6-3 反验 §6-1 的价值兑现**: 第一个消费者把 §6-1 的 quorum-中心化(层 b)+ attestation→state 绑定(层 a MUST-FIX A)两条都顶成了"授权真金的活闸"。
- 消费 §4.3(复算+绑定)✅ 结果与 payout 复算。
- 消费 §4.4(无 bypass)🔴 **依赖一个 §6-1 冻结稿自己标注【未实现】的不变量**(§4.4(b) live path 未建 + 同机持 ≥4 委员拓扑把 4-of-5 塌成 1-driver)⇒ v0.1 不得假设它已 enforce; 明列为前置。
- 消费 §4.5(abstain)✅ 三态。

## §8 与 plain HTLC / adaptor-signature 对比（Codex 明令·卡的及格线 · v0.2 Bettor 主动啃, 待 Codex 红队）

**基线能力**: plain HTLC = 跨链原子交换成熟, 但 (a)要两链都支持兼容 hashlock/timelock (b)preimage 公开(打回3)(c)条件只能是"揭示一个 secret"。adaptor-sig = 更私密, 但仍要两域都能验对方腿, 条件仍绑定到签名/secret。

**🔴 最小例(HTLC/adaptor 结构上做不到)**: 交易者要用 KAS 买一个**其结算条件是【一个计算出来的跨域结果】而非一个 secret** 的头寸——例: "**iff B 链上预测市场 M 按规则 R 结算为 outcome X, 则放 KAS 给 taker**"。
- HTLC 表达不了: 没有 secret 可揭示; outcome X 是**从 B 链共识态按规则 R 算出来的事实**, 不是一把钥背后的原像。
- adaptor 同限: 它绑签名/secret, 绑不了"多输入算出的计算结果"。
⇒ 对 HTLC/adaptor **单独**而言, 这一类**必须**有一份"关于该结果的、可核验的 attestation"才进得来。**这就是 §2 锚说的"单一域无法 enforce 整个转移"的具体最小例。**
- 🔴 **v0.3 收窄(Codex MSG-251 纠我过声)**: **不得**说"轻客户端也做不到"——那是错的。若 A 链能验 B 的 header/finality **加一份足以验 P 的证明**(light-client/proof-verifier), 就能**完全去掉委员**。⇒ **正确边界 = "HTLC/adaptor 单独做不到; 但一个够表达力的 light-client/proof-verifier 能"**。KANet 是 **attestation 桥**——它的价值域 = **目标域【无法经济地/原生地】验证源域谓词, 且该谓词不可化约为 HTLC/adaptor 用的那个 secret 关系**; **不是**"委员中介唯一必要"的证明。

**🔴🔴 但诚实的及格线在这里, 且它把 §8 钉死在 §7 上**:
- 上面那个最小例**不是 KANet 独有**——任何**预言机/委员/桥**都能提供"M 结算为 X"这份 attestation(Codex 打回1 明列这些替代)。所以 KANet vs "HTLC + 一个**可信**预言机"**必须**答: 多出来的是什么?
- KANet §6-1 契约多出的 = attestation 是**可独立复算 + 域分隔类型化 + abstain-不猜**的(§4.1/§4.3/§4.5)⇒ 目标是 **"可验证预言机"而非"可信预言机"**: 任何人能从共识态独立复算该结果、委员去中心 ⇒ 不必信任委员、只信数学。
- 🔴 **而这个"可验证而非可信"的独特价值, 恰恰被 §7 的 quorum-中心化【当前抵消】**: §7 实测委员**本机主导(回溯 24.7% / 前瞻 ≈86%)**⇒ "独立复算 + 去中心"今天是**戏**(一台机器凑齐 quorum, "多方独立见证"名存实亡)⇒ **今天 KANet 退化成"HTLC + 一个纪律好的【可信】预言机", 不比基线更优**。
- ⇒ **§8 的结论(诚实, 承打回1)**: KANet 相对 HTLC/adaptor 的可辩护增量 = **计算型跨域结果 + 可验证(非可信)attestation**; 但**该增量【当前不成立】, 因为它 100% 依赖委员去中心, 而 §7 证明委员今天本机主导**。⇒ **§8 及格 ⟺ §7 的 quorum-中心化被治好**; 两者是同一个闸。**在委员真去中心前, §6-3 不应对外主张"比 HTLC+可信预言机更优"。**
- 🟢 **这对 Owner 的净意义**: §6-3 的价值命题**真实但 contingent** —— 它值得造(计算型跨域结果确实是 HTLC 进不来的类), 但它"信任地基更硬"这半**要等委员去中心才成立**, 而委员去中心 = 北极星"开放测试网"本就要解的同一题(§10 pubkey-身份 + 更大外部质押池稀释本机权重)。⇒ **§6-3 与 §10/北极星不是二选一, 是同一个去中心化地基的两面。**

## §9 明列空白（不假装覆盖）
- §7 那条"谁签付-taker 的 tx + 怎么门控不被同机绕"= **最大未决**, 交 red-team 主攻。
- 隐私数字商品交割(§5)= v0.2+。
- §4.4 无-bypass 未实现 + 拓扑塌陷 = 前置, 非本卡解。
- §8 的"HTLC 做不到的最小例"= 及格线, 未填则本卡不成立。
- 具体表 schema / handler 落点 = 实现层, 另报备。

## §10 交接（真实 roster）
- **J1(独立节点)/ NWT**: 审 §2 锚是否真答三打回 + §7 复用审计的"付-taker 钥"缝 + §4 状态机无单边套牢。
- **Codex(bridge)**: 红队全卡, 重点 §8 及格线(HTLC 对比最小例)+ §7 §4.2 不 compose 缝 + §2 边界是否被后文任何一处偷偷越过。
- **Bettor**: 收意见迭代 v0.2。**实现层另起报备等 Owner。**

## §11 v0.2 红队整合记录（2026-08-20）

**J1 二审(独立节点)**: 三处 §6-1/exchange 引用逐行读真码核过全属实(concede-only `/resolve`:747 · `checkStaleDisputes`:563 stub · `pre_dispute_status`:541 · §4.2 守恒 · §4.4 拓扑塌陷)· 设计结构 **SOUND** · "自己把最尖的缝标出来了"。

**NWT+J2 红队三点**:
- **① §2 锚泄漏 = PASS**(NWT 通读 §4/§6 无偷渡, attesting 三态全锚在"能否共识态独立复算")。
- **② §7 最尖的缝 → 两层重构**(见 §7 §4.2 条): "谁签"只对签名式放行成立; 本仓已有条件式先例(`CloseZkV2.sil` checkSig=0 / `bshard-close-enforce.mjs`, Bettor 实核)⇒ 选条件式则"谁签"消失; 同机风险**挪到 attestation 产出层** = §6-1 委员-quorum-中心化(§6-3 第一个消费者顶成授权真金的活闸)。
- **③ §4 单边套牢洞(NWT)= 已修**(见 §4): 每腿 timeout 从**自身锁定那刻**起算(非"两腿都锁后"), 否则 leg-A 锁/leg-B 从不锁 → maker 资金无限卡; + J2 加验收(退出后账上零残留)。

**🔴 数字分歧重测解决(方法论留痕·"两数不符重测")**: J2 先报 3.9% → NWT 指为方法学 artifact → **三方【对齐到同一正确方法后】重跑收敛 63/255**(`XOnlyPublicKey.fromAddress` 地址派生 pk 配 `committee_pks`, 32/32): Bettor `--all` 亲跑 + NWT 对上原始记录 + J2 复现并全额撤回 3.9%。
- **真根因(J2 20:03 更正, 非"空列")**: J2 3.9% = 用 `relay_id`(本地 UUID)做跨节点匹配; relay_id 跨节点无意义(§10 已证)⇒ 选错 key。"空列 ecdsa_pubkey_xonly"是 J2 19:54 猜测、19:56 已撤, v0.2 一度误记, 此处正。
- **🔨 收敛性质校准(J2 20:03)**: 三方跑的是**同一原始仪器/同一派生法** ⇒ 收敛证的是**可复现(reproducible)**, **不是独立正确**(三法得同数才叫独立佐证)。**正确性另有支柱** = "地址派生 pubkey 是对的 key、relay_id 不是"(§10 独立结论)。两者本次都要, 但不许把可复现读成独立佐证。
- **权威数 = 回溯 63/255=24.7%(≥threshold)、41/255=16.1%(5/5); 前瞻当前池 ≈86% stake(J2 补测·数量级)**。无人让步认错数、全部重测 = 正例。

**净**: §6-3 v0.1→v0.2 使 §6-1 委员-quorum-中心化从"历史编号"变成"**当前主导、授权真金前必答的硬闸**"(24.7% 回溯 / ~86% 前瞻)——**这正是造第一个消费者反验冻结的价值兑现**。下一步 Codex 红队(MSG-251, 待 Owner 触发)主攻 §8 HTLC 及格线 + 条件式 baked/witness 绑定缝。

## §12 v0.3 Codex 红队整合（2026-08-20 · MSG-251）

**Codex 裁: 方向 GREEN, v0.2 REDTEAM HOLD**, 四条:
- **§8 = PASS IF NARROWED** → 已收窄: 最小例对 HTLC/adaptor 单独真成立, 但**不得**说"轻客户端也不行"(够表达力的 light-client/proof-verifier 能验 P 去掉委员); KANet = **attestation 桥**(目标域无法经济原生验证源域谓词时), 非"委员唯一必要"。
- **🔴 §7 = PARTIALLY RESOLVED + MUST-FIX A** → 已加: CloseZkV2 只证 `已 baked → 无签字放行`, 没证 `外部 attestation → 可信 baked state`; **烤 state 的转移必须共识强制、host-compiled ≠ authority**; 两形态(attestation 直接是 commitment / 前置 covenant 验 attestation 产唯一后继)+ 绑死 §6-1 receipt 字段 + 后继 state commitment。
- **§2 = ACCEPTED + 措辞纠** → 已加: 委员只 attest 事实谓词, 退/罚/延=policy+covenant 非 P1; `disagree→refund` 读作 `(receipt+baked policy)→确定性转移`。
- **🔴 §4 = 单边套牢 FIX ACCEPTED + MUST-FIX B** → 已加: 两阶段锁-结时序**不等式**(claim 留对方对等 claim 的 finality+margin 余量)+ 终态互斥 + 每终态清锁。

**并入 J2 (20:03) 三处记录更正**: ①3.9% 真根因 = 用 relay_id 跨节点匹配(非"空列", J2 自撤的猜测被我误记)②表名 `oracle_stake_enrollments`(非 `oracle_stakes`)③三方收敛证"可复现"非"独立正确"(同法同数=reproducible; 正确性靠"地址派生 pubkey 是对 key"独立论证)。

**v0.3 状态**: 方向 GREEN; **两条 MUST-FIX(A attestation→baked-state 共识强制 / B 两阶段时序不等式)= 下一轮(v0.4)主攻**。J1 (20:02) 两条承重点待并(已 ping J1 restate)。
