# D-012 §6-3 fair-exchange 设计卡 v0.1 — Exchange 裁决角色（报备层 · 零生产改动）

> **Status**: DRAFT **v0.6**（+§15 A2 receipt→唯一后继绑定 spec, Bettor 并行） · Bettor 2026-08-20 主笔 · 设计层, 零生产码。**v0.3 = Codex MSG-251/f5fce55b(方向 GREEN); v0.4 = 冻结两条 MUST-FIX**——**A**(J1+J2 实读 PayoutShardV2.sil 真码定机制: close_attest 4-of-5 链上验 + merkle 成员证明对 baked 根 + 确定性后继 + 脆弱钉死; 授权根=§7 闸)· **B**(诚实降级 = bounded-loss 协调结算 + 授权原子性, 非原子公平交换, 承 Codex 退路)。见 §13。
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
- 🔴🔴 **MUST-FIX B —— v0.4 冻结: 相位状态机 + 诚实降级(Codex 退路)**: v0.2 的每腿独立超时只挡"第二腿锁前"; 两腿都锁后, 跨两条独立-finality 异构链**无共享时钟** ⇒ 严格"公平交换"时序不等式**证不成协议不变量**(`Δ_finality+Δ_margin` 无跨链权威)。⇒ **按 Codex 退路诚实降级主张**, 冻结如下:
  - **相位(两阶段, 共享 session commitment)**: `BOTH_LOCKED` 前——任一腿**只能退自己锁的资产**(v0.2/v0.3 已定)。`BOTH_LOCKED` 后——两腿的释放/退款资格**都由同一份 §6-1 OutcomeAttestation(= 共享 session/phase commitment)导出**。
  - **🟢 得到什么 = 【授权原子性】**: 两腿被**同一份**单一 attestation 授权 ⇒ **不存在"leg-A 已授权而 leg-B 未授权"这个态**(要么该 attestation 落链两腿皆可 claim, 要么它没落两腿皆退)。这是 shared-attestation 相对独立双 preimage 的实质收益。
  - **🔴 得不到什么 = 【执行原子性】**: attestation 落链后, 每方仍须在**自己腿的 timelock 窗内** claim; 非对称 finality/reorg 下, "谁先 claim、对方来不来得及"无法跨链严格保证。⇒ **只能 bounded-loss**: 用 **timelock 非对称**(照 HTLC: 后手腿的 refund-timeout 比先手长足 Δ)把最坏暴露**界死在 timelock 窗 + 手续费级 griefing**, **非本金被盗**。
  - **"观察到"须定义在源域 finality 层级**(非首见): 首个不可逆 release 的判定 = 达到源域要求 finality 深度, 否则 reorg 翻盘。
  - **终态互斥 + 清锁**: 同一锁定 output/session, `completed` 与 `refund` **互斥**; **每条终态路径清锁**(承 §5 fund_lock 泄漏教训)。
  - ⇒ **v0.4 冻结的主张 = "bounded-loss 协调结算 + 授权原子性", 明确【不是】"原子公平交换"**(Codex 退路)。§8 的价值命题(计算型跨域结果 attestation 桥)在此主张下成立且诚实; 严格原子性留给"两腿都是 hashlock 可搞定"那类(那类本就 HTLC 更优, §8 已认)。

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
  - **🔴🔴 MUST-FIX A —— v0.4 冻结机制(选形态2·J1+J2 实读真码定, 非列选项)**: Codex 要"选定冻结一个机制+机械可检转移", 据 J1(20:22)+J2(20:24)逐行实读 `PayoutShardV2.sil:80-125` `close_attest` 定:
    - **选形态(2)**: 前置 covenant 验证阈值 attestation → 只能产出唯一后继, 后继 baked state 从验过的 receipt 确定性派生 → 后继用无签字 claim(CloseZkV2 路)。**buildability = 确定**(有活实例)。
    - **🔴 冻结的授权链(机械可检, 逐环)**: ① **阈值**: N 个 `checkSig` + `require(validSigs >= threshold)`(`close_attest` 实为 5 sig + `>=4`)。② **委员集授权 = 对 baked 委员根的 merkle 成员证明** —— 🔴🔴 **授权【不是】** `require(blake2b(pkConcat)==committeePkHash)`(J2 实证: 那是 witness-vs-witness 自洽、**什么都不绑**); **真承重 = 5 组 merkle 成员证明对 `poolMerkleRoot`(ctor-baked 值)**。③ **后继确定性**: 后继 output/state commitment 从验过的 receipt 确定性派生, **一条规则让所有其他后继不可能**(单一后继)。④ **绑死 §6-1 receipt**: {身份/version/network/market-state/outcome/证据承诺/committee-epoch/replay/policy}。
    - **🔴 记进卡的实脆弱(J2 捞出·refactor-trap)**: 那句非承重的 `committeePkHash` require "看起来像委员绑定"; 谁将来删 merkle 段留 hash 句 → **合约静默失守**(任意 witness 委员都过)。⇒ **落地时 `.sil` 该 require 上方钉注释**: 「本句只保证 5 pk 与 committeePkHash 自洽, **不构成委员授权; 授权来自下方对 poolMerkleRoot(ctor 烤值)的 5 组 merkle 成员证明, 删它即失守」**。负测(实现): 改后继 commitment 拒 / receipt 复用第二后继拒 / 错 network-version-session-policy-epoch 拒 / 委员签名不足或重复拒 / host 供非确定性后继拒 / **删 merkle 留 hash 必须挂**。
    - **🔴🔴 授权【根】的残留 = §7 同一闸(A 机制可冻, A 授权不可冻)**: 上述链把授权锚在 **`poolMerkleRoot`(ctor-baked)= host 在建市时选的委员集**。⇒ Codex "host-compiled ≠ authority" 与 §7 quorum-中心化**是同一条根**: 链上阈值验证验的是 host 自选(§7: 且 86% host 自控)的委员 ⇒ **"多方独立见证"是戏**。⇒ **MUST-FIX A 的【机制】v0.4 冻结(可建、可机械检); 但 A 的【授权独立性】= §7 硬部署闸**(委员根须来自 host 不控的源: 外部质押池稀释 + §10 pubkey-身份), **授权真金前不成立**。J2 元教训入册: 提"把闸放 X"必问"X 的授权来自谁"(= gate-strength-lives-at-call-site 族)。
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

## §13 v0.4 冻结两条 MUST-FIX（2026-08-20 · Codex f5fce55b 要"选定冻结"非"列选项"）

**MUST-FIX A — attestation→authoritative-state 机制【已冻结】**(J1 20:22 + J2 20:24 逐行实读 `PayoutShardV2.sil:80-125` `close_attest` 真码, 非逆向):
- 选形态(2): 前置 covenant 验阈值 → 唯一后继 → 确定性 baked state → 无签字 claim。**可建=确定**(活实例)。
- 授权链: N `checkSig`+`require(validSigs>=threshold)`(实为 5+`>=4`)· **委员集授权=对 `poolMerkleRoot`(ctor-baked)的 5 组 merkle 成员证明**(**不是** `committeePkHash` 那句 witness-vs-witness 自洽 require)· 后继确定性(一条规则让其他后继不可能)· 绑死 §6-1 receipt 全字段。
- **实脆弱记档(J2)**: 那句非承重 hash require = refactor-trap(删 merkle 留 hash → 静默失守); `.sil` 钉注释 + 负测"删 merkle 留 hash 必挂"。
- 🔴 **A 机制可冻, A 授权【不可冻】= §7 同一闸**: 授权锚在 host 建市时选的委员根(§7: 且 86% host 自控)⇒ Codex "host≠authority" 与 §7 quorum-中心化同根; 授权真金前须委员根来自 host 不控的源(外部质押池稀释 + §10 pubkey-身份)。

**MUST-FIX B — 时序/finality【已冻结·诚实降级】**:
- 跨两条独立-finality 异构链无共享时钟 ⇒ 严格公平交换时序不等式证不成不变量 ⇒ **按 Codex 退路降级主张**。
- **得到=授权原子性**(两腿同一份 attestation 授权, 无"A 授权 B 未授权"态); **得不到=执行原子性**(非对称 finality/reorg 下用 timelock 非对称把暴露界死在 timelock 窗+手续费级 griefing, 非本金被盗)。
- "观察到"定义在源域 finality 深度; completed/refund 互斥; 全终态清锁。
- **v0.4 主张 = "bounded-loss 协调结算 + 授权原子性", 明确非"原子公平交换"**。

**净**: 两条 MUST-FIX 从"列选项"进到"冻结机制/状态机"(Codex 要的)。A/B 均冻结; **A 的授权独立性 + quorum = 授权真金前硬部署闸(归 Owner)**。下一审 = Codex 对 v0.4 冻结物。

## §14 v0.5 FROZEN — A + B 冻结物（consolidated·给 Codex 终审的单一权威处·2026-08-20）

> 本节把散在 §4/§7/§11-13 + 账本 (573)-(587) 的冻结物**集中一处**(应 J2 "不可撤记录更正须可被找到" 判据)。**A 机制冻、E2E-gated; B 冻。** 无实现/部署/money-path 授权。

### A（attestation → authoritative state）— 机制冻结, 运行时 E2E-gated
- **形态**: 前置 covenant 验阈值 attestation → 唯一确定性后继 → 无签字 claim(CloseZkV2/bshard-close-enforce 先例)。
- **授权链**: N `checkSig`(spend 授权) + `require(validSigs>=threshold)`; **委员集授权 = 对 baked 委员根(`poolMerkleRoot` 类, ctor 烤)的 merkle 成员证明**(非 `committeePkHash` 自洽 require = 非承重, refactor-trap 已钉注释); 后继 state commitment 从验过 receipt 确定性派生(唯一后继); 绑 §6-1 receipt 全字段 {network/version/session/policy/outcome/evidence/committee-epoch/replay}。
- **A2 receipt 验签原语** = `checkSigFromStack`(upstream 名 `checkMsgSig`)编成 `OpCheckSigFromStack`。**状态 = SOURCE-PLAUSIBLE / RUNTIME-UNVERIFIED / E2E-GATED**: 前置 ①canonical 编译器**归档整树+重建流程**(不止 diff; 唯一同含 #132+OP_PICK 的 = `8065184` 脆弱未推分支)②最小 checkSigFromStack e2e(真 runtime 路径, 合法过/改一位拒)。**协议不变量钉 opcode 语义+编译器 commit, 非内建名。**
- **A 授权【根】= §7 委员-quorum-中心化(回溯 24.7%/前瞻~86% 本机)= 授权真金前硬部署闸**(归 Owner)。

### B（跨腿公平交换)— 冻结（v0.6 分层, 修 Codex 18e2725b 的 auth-atomicity-vs-C1 矛盾）
- **🔴 v0.5→v0.6 修**: v0.5 把 auth-atomicity 放成【默认】错了 —— auth-atomicity **需要 C1**(两腿都能验同一 A), 而 C1 可失败; C1 假时一腿 attestation-gated、另一腿验不了 A ⇒ 无 auth-atomicity。⇒ **分三层, 保证随谓词升级**:
  - **Tier 0(base·所有受支持腿的默认)= bounded-lock-duration(墙钟 ms, 值域 `>=5e11`)**。**不含** auth-atomicity。任一支持的对手链至少拿这层。
  - **Tier 1(需 C1)= + authorization-atomicity**(同一份 A 两腿各自独立验, 无"A 授权 B 未授权"态)。**C1 假 ⇒ 落回 Tier 0**(不静默假装有 auth-atomicity)。〔备选: 若要 auth-atomicity 成硬默认, 则无 A-验证器的对手链 = **unsupported/fail-closed**, 不接入; 本 v0.6 取分层-非强制, 支持面更宽。〕
  - **Tier 2(需 C1∧C2∧C3 + 下方 principal-safety 不变量 P-SAFE)= + no-theft**。
  - **🔴🔴 P-SAFE v0.7 块【作废】—— 见下方 §16 v0.8(Codex dc198ea6 否 v0.7)**: v0.7 的 "A valid@D→claim / A absent@D→refund" 不变式 + 那条 rejected-trace 有**可观测性错**: A 是链下委员签名消息, covenant 能正验"A 在"、**证不了否命题"A 不存在"**(对手可对一条腿隐瞒 A 走 refund, 该腿分不清"A 不存在"vs"A 被隐瞒")。故 v0.7 rejected-trace 不成立。**Tier-2 判据与 P-SAFE 机械定义以 §16 为准**(承 doc 通则: 删会漂移的旧断言、不与新版并存)。§14 保留的仍生效物: fail-closed 单位地板 + 可冻结不等式(下方)。
- **可判定谓词(缺一降一层, 非散文)**:
  - **C1**: 对手链能验同一份 A(具 msg-sig 验签原语); 否则收款方呈不了 A → 腿退化纯 timelock。
  - **C2**: 对手链 claim-land 最坏耗时可保守上界; 否则 refund_T 设不住。🔴 **任意对手链 C2 不可估 ⇒ 不可估性本身即降级触发, 非可调参数。**
  - **C3**: 每腿 refund deadline 用墙钟 tx.time(非 DAA; DAA 追赶期压缩窗)。
- **🔴 fail-closed 单位地板(B 任何安全等级的地基, 非可选纵深)**: covenant 侧 `require(refund_T >= 5e11)` + 构造侧同断言(**双闸**, 链上那道防构造侧漏)。理由: 单位口误(秒→DAA 侧)把 refund_T 打回 DAA 模式 ⇒ 连 bounded-lock 的"锁 T 后必可退"都破(退款腿 129 年/kaspad-reject)。
- **可冻结不等式(Codex MUST-FIX B·v0.6 typed: 每项定类型/参照系, 修 Codex "维度歧义")**: 每腿
  `refund_T > A_avail + finality_D + claim_land_worst + margin`, 其中:
  - `refund_T` = **绝对墙钟时间戳(Unix ms, >=5e11)** —— 该腿 covenant 的 refund lockTime。
  - `A_avail` = **绝对墙钟时间戳(Unix ms)** —— A 保证可得的最早时刻。
  - `finality_D` / `claim_land_worst` / `margin` = **时长(ms)** —— 分别: 该腿链达所需 finality 深度耗时 / 该腿链 claim tx 落链最坏耗时(含拥堵) / 安全余量。
  - ⇒ 量纲: 绝对ms > 绝对ms + Σ时长ms = 绝对ms(一致)。语义: refund 截止**晚于**"A 可得 + 走完 finality + claim 落链 + 余量"这个最迟完成时刻。
  - KANet 腿各项可估; 对手腿 `finality_D`/`claim_land_worst` 非 KANet 权威 ⇒ 落 C1/C2 判定。`finality_D` 取值法待 A2 e2e 定后 J1 补。

### v0.5 净状态
- 方向 GREEN(Codex 多轮)· §8 PASS(收窄)· A 机制冻+E2E-gated · B 冻(默认 bounded-lock+auth-atomicity, no-theft C1∧C2∧C3 子集, 单位双闸地板, 不等式)。
- **未闭/硬闸(明列)**: A2 e2e(runtime)· 编译器整树归档 · §7 quorum 独立性(授权真金前) · A1/A2 里 A1 未选(本 v0.5 走 A2 receipt 路)· rotate/revoke 连续性(out-of-scope)。
- **交 Codex v0.5 终审**(其要的"一个冻结 A + 一个冻结 B")。**无实现/部署/money-path 授权。**

## §15 A2 receipt → 唯一后继 绑定 spec（Bettor 并行任务·答 Codex "verified receipt 须唯一决定 successor state, host builder 非权威")

> Codex(18e2725b/4c14c1f7)反复要: A 闭合还须证【验证过的 §6-1 receipt 字段唯一决定后继 state】—— 否则 host builder 读一行 attested row 编个 covenant = 非权威(§10§3 同机族)。本节把"唯一决定"写成 covenant 链上可机械 enforce 的形态。

**冻结的绑定链(全部 covenant 链上 enforce, 非 host 侧)**:
1. **验 attestation**: N×`checkSigFromStack`(对 receipt digest)+ `require(validSigs>=threshold)` + 委员集对 baked 委员根的 merkle 成员证明(§14 A)。
2. **算唯一后继承诺(链上确定性)**: `successor_commit = H(canonical(receipt 绑定字段))`, 其中 canonical = §14 B 的长度前缀冻结序列化(同一冻结字节法), 绑定字段 = {network, version, session, policy, outcome, evidence_commit, committee_epoch, replay}。**同一 receipt → 同一 successor_commit(位确定)**。
3. **introspection enforce 唯一后继**: covenant 用 `tx.outputs[]` introspection(TN12 有 `tx.outputs[i].value/scriptPubKey`, 见 `reference-silverscript-real-capabilities`; PoolSpine/PayoutShard 已用同类)要求: **恰一个后继 output** 且 `tx.outputs[k].scriptPubKey(或 baked-state) == successor_commit`(链上从验过的 receipt 派生, 非 witness 喂)且 `tx.outputs[k].value == 确定性 payout 分配`。
4. ⇒ **任何替代后继**(改 state / 改 value 分配 / 多加 output / 少 output)**过不了第 3 步 introspection require ⇒ covenant 拒 ⇒ 没有合法花费能产出非-canonical 后继**。
- **host builder 非权威**: host 只【拼】tx; **enforce 唯一后继的是 covenant 链上 introspection**。host 拼错后继 = 被 covenant 拒(不是被 host 自己的检查拒)= 消除"读 row 编 covenant"的同机绕过面。
- **E2E 必含(接 A runtime 闸)**: 正确后继 → PASS; 变异后继(改 successor_commit 任一字段 / 改 value 分配 / 加/减 output / witness 喂非派生 state)→ 每条 REJECT。
- **依赖**: silverscript introspection(已用先例)+ §14 B 的冻结 canonical 字节法(successor_commit 跨实现一致)。⇒ **A 与 B 的冻结字节法共用一处**(不重复定义, 防漂移)。

## §16 v0.8 P-SAFE 重设计（答 Codex dc198ea6 P-SAFE-1 / P-SAFE-2·废 v0.7 "A-absent@D" 谓词）

> Codex v0.7 verdict 否 v0.7 P-SAFE。两处修：谓词从"证明不存在"换成本地正事实（§16.1）；no-theft 的跨腿原子性诚实 tiering（§16.2）。**§14 B 的 v0.7 P-SAFE 块与其 rejected-trace 已作废，以本节为准。**
> 🔴 **v1.0 更正（Codex v0.8 verdict, 见 §17）**：本 §16 的以下处已被 §17 更正，**以 §17 为准** —— §16.1 措辞→§17.1（UTXO 血缘）；§16.2 C4 角色标签→§17.2（密码学能力 + 参与方持密 s）；§16.4③ daaScore 检测→§17.3（共同观察域）；§16.4 水印→§17.4（降可选取证）；Tier-1 措辞→§17.5（per-leg 完整性非 atomicity）。

### §16.1 P-SAFE-1 修：refund 谓词 = 【本腿本地正事实】，不再"证明 A 全局不存在"（commit-by-cutoff 状态机）

**根因（Codex）**：A 是链下委员签名消息。covenant 能**正验**"A 在"（有人提交时验签），但**证不了否命题"不存在有效 A"**——对手可对一条腿**隐瞒** A、在那边走 refund，该腿 covenant 分不清"A 不存在"vs"A 存在但被隐瞒"。`同一 A + 有效签名`够正验、不够负存在验。

**修**：每腿 covenant 一个显式链上状态 + 授权 cutoff 墙钟 `T_c`：
- `LOCKED —(T_c 前，A 在本腿链上被提交且验签过)→ AUTHORIZED(A_hash)`：只可 claim；refund 支路**永久禁用**。
- `LOCKED —(T_c 到，本腿无 AUTHORIZED 转移)→ EXPIRED`：只可 refund；**T_c 后到的 A 对本腿非权威**（covenant 拒收晚到 A 的 AUTHORIZED 转移）。
- **refund 前置 = "本腿达 EXPIRED"** = 本地正事实（`T_c 过 ∧ 本腿无 AUTHORIZED 记录`），covenant **只读本腿本链态**，不再要求"A 全局不存在"。⇒ **谓词机械可判**。
- claim 前置 = "本腿达 AUTHORIZED"。每腿 {claimed, refunded} 恰一（UTXO 花一次，天然互斥）。

⇒ 消除 P-SAFE-1：refund 不再依赖不可证的否命题。

### §16.2 P-SAFE-2：跨腿非对称结局（= 盗本金 trace 新形态）——诚实 tiering + 不可能性证明

§16.1 单独**不防**"一腿 AUTHORIZED-claim、另一腿 EXPIRED-refund"的非对称结局（对手把 A 只提交给对自己有利那腿）。防它 = no-theft = Tier-2，须解跨腿原子。跨链原子无盗本金**本质上**两条路：

**(a) 确定性揭示序（HTLC 式，需 C4）**：A 起 preimage 作用——用 A claim 一腿时 A 进 claim witness ⇒ **在该腿链公开** ⇒ 对手方观察到、用**同一 A** claim 另一腿。加 cutoff 非对称：`反应腿 refund-cutoff > 揭示腿 cutoff + Δ`（Δ = finality + 观察 + claim 落链 + margin）。
- 🔴 **不可能性证明 ⇒ 必须 C4（确定性首动方）**：若两方**同时**持 A 且无序——护 taker 需 `T_A_reactive > T_B + Δ`，护 maker 需 `T_B_reactive > T_A + Δ`；二者 = `T_A > T_B ∧ T_B > T_A` **矛盾** ⇒ cutoff 非对称**只能护一个方向**，另一方暴露。⇒ **Tier-2 no-theft 必须有确定性首动方**（只一方能先揭示 A）。这与 HTLC 靠"仅一方持密"锁定首动序同源。
- **C4 实现**：委员把 A **加密投递给指定首动方**（对手方须等 A 上链才得）；或**协议角色固定序**（如"买方=收链下货者"为首动方，须先 claim 揭示 A、卖方反应）。
- 🔴 **C4 残留信任（红队须查）**：委员产 A ⇒ 委员可把 A **泄给反应方**破坏 C4（时序攻击）。这扩了信任模型：已信委员诚实产 A，现加"不泄 A 给反应方助攻时序"。记为 Tier-2 残留假设。

**(b) 跨链状态证明（light-client/SPV 证另一腿 AUTHORIZED）**：两阶段 PREPARED→AUTHORIZED、claim 须证另一腿也 PREPARED。但跨链态观察 = 重（光客户端）且 **§1 明列不做** ⇒ 本卡不走 (b)。

**⇒ 诚实结论**：
- **Tier-2（no-theft）= C1 ∧ C2 ∧ C3 ∧ C4 ∧ §16.1 状态机 ∧ cutoff 非对称（揭示腿 < 反应腿 − Δ）**。C4 缺 ⇒ 不给 Tier-2。
- **C4 不成立时**（同时持 A、无序、不走光客户端）：no-theft 不可达 ⇒ 落 **Tier-1（授权原子性经 §16.1 both-authorized-or-both-refund）/ bounded-lock**，且**必须披露**"非对称结局可能"（一方被套一腿），非静默当安全。
- 🔵 这不是本设计缺陷，是**跨链公平交换的本质**（HTLC 亦需单方持密的首动序）。v0.7 错在把它当已解 + 用了不可证谓词。

### §16.3 废止与合并（承 doc 通则：删会漂移的旧断言、不并存）
- §14 B v0.7 P-SAFE 块（"A valid/absent @D"不变式 + rejected-trace）**作废**，已在 §14 就地替为指向本节的指针。
- **C4 加入 §14 可判定谓词清单**：C4 = 确定性首动方（加密投递 / 角色固定序）。⚠ covenant 侧**不可直接链上验** ⇒ 属**部署前须证的运营条件**（同 §7 quorum 独立性档），非纯链上谓词。红队须把"C4 如何被破 + 如何检出"列清。
- **不变（仍是任何 tier 地基）**：§14 fail-closed 单位地板 `require(refund_T >= 5e11)` + 双闸；可冻结不等式（typed）。本节只改 refund 谓词**语义**（"A 全局不存在" → "本腿 EXPIRED 本地态"）与 no-theft 的 tiering。
- **待红队**：Codex 复审 §16 是否真闭 P-SAFE-1/2；J1 审 C4 实现的 covenant 可建性（AUTHORIZED/EXPIRED 状态转移用 §14 A 的 introspection enforce）；NWT 红队 C4 残留信任（委员泄 A 时序攻击）。

### §16.4 v0.9 — NWT C4 红队整合（2026-08-20·§16.3 派工回填）
- **① claim payout = baked/receipt-派生（非 witness 任意）⇒ 泄 A 后果量级钉死**：claim 的收款 output 由 §15 绑定链 enforce（`tx.outputs[k].scriptPubKey == successor_commit`，从【验过的 receipt】派生、非 witness 喂；`value == 确定性分配`）。⇒ 谁交出有效 A **改不了收款地址**，claim 只能付给 receipt 派生那方。⇒ **C4 被破（委员泄 A）最坏后果 = §16.2 的"非对称结局"（钱仍在两合法参与方间，一方被套一腿），不是"导去任意地址"的任意盗窃。** claim payout 与 §15 successor output = **同一物**（不重复定义）。〔答 NWT ④：安全支；doc 此前只在 §15 隐含，现 §16 显式钉。〕
- **② C4 残留信任量化 + 接 §7 quorum 独立性**：实测（`scratch/bettor-committee-locality-0804.mjs`，255 盘）5/5 委员共处一机 = 41/255（~16%）；若签名阈值 4-of-5，能实际凑出 A 的 quorum 共处 ≈ 63/255（~25%）。⇒ 对这批盘，"委员泄 A" 非多方合谋、是**单一操作者能否自律 = SPOF**。⇒ **C4 残留信任对共处-quorum 盘 = §7 quorum 独立性的同一个洞；Tier-2 no-theft 对这批盘【也 gated on §7】**（C4 首动方机制单独不够，须 §7 quorum 真独立才使"委员泄 A"回落成多方合谋难度）。〔NWT ②：新连接非新担心。〕
- **③ C4 被破的检测（补 §16.2 要求的"如何检出"）**：
  - 事后（链上直证，不需自证）：两腿 claim tx 经 order/tx-id 关联后，比对落链 daaScore 顺序 —— **反应腿 claim 早于（或近同时于）揭示腿观察窗所需 Δ ⇒ C4 被破的直接链上证据**。
  - 事前（建议，非硬要求）：委员对每次投递发水印/salt 过的加密 A ⇒ 泄露样本可回溯到具体投递 = 把"委员会不会泄"从纯自律变成"泄了能查源"增威慑。⚠ 待 J1 confirm 水印不破 A 功能性（covenant 可建性半）。
- **⇒ Tier-2 就绪条件（NWT 红队后收敛）**：C1 ∧ C2 ∧ C3 ∧ C4 ∧ §16.1 状态机 ∧ cutoff 非对称 ∧ **payout baked（①，§15 已 enforce）** ∧ **共处-quorum 盘另 gated §7（②）**；③事后 daaScore 检测 = 运营期监控。缺任一降层。

## §17 v1.0 P-SAFE — Codex v0.8 verdict 整合（5 fix·2026-08-20·RESPONSE-MSG256, 桥 6f58fb87）

> Codex v0.8/v0.9 verdict：方向 GREEN，Tier-2 未 design-closed，给 5 处 fix。**本节冻结修正形态；§16 v0.8/v0.9 的对应处以本节为准**（§16.1 措辞→§17.1；§16.2 C4 角色→§17.2；§16.4③ daaScore→§17.3；水印→§17.4；Tier-1 措辞→§17.5）。

### §17.1 P-SAFE-1 冻结为单一 UTXO/state 血缘（Codex：CLOSEABLE→措辞后 CLOSED）
refund **不**表述为"查无 AUTHORIZED 记录"，而是**单一活状态 UTXO 血缘的超时支路花费**：
- 活 `LOCKED(session)` output 在 chain-time `< T_c` **只能**花进唯一后继 `AUTHORIZED(A_hash, session)`（花费前验 A）；
- 同一活 `LOCKED(session)` output 在 chain-time `>= T_c` **只能**花进唯一后继 `EXPIRED(session)`；
- 两支路互斥 = **消费同一 UTXO/state 对象**（非"查记录"）；
- 晚到 A 必失败：AUTHORIZED 支路 require chain-time `< T_c`。边界冻死 `<`（AUTHORIZED）vs `>=`（EXPIRED），时域/单位用 §14 已 bank 的 fail-closed 墙钟地板。
⇒ P-SAFE-1 = **CLOSED**（covenant 判"活 LOCKED 经哪条支路花掉"=纯本地正事实）。

### §17.2 C4 = 密码学能力不变式；采纳 Codex【参与方持密 s + 公开 A 组合】（弃委员保密 A）
- 🔴 **角色标签不够**（Codex）：两方都持可携带 A 时，命名"首动方"挡不住另一方抢先交 A。C4 须是**密码学能力**：reveal 转移前，**恰首动方独有 reveal-leg spend 所需的缺失 witness**；反应方只能从链上 reveal 取得。
- 🎯 **采纳构造（弃我的委员加密 A）**：首动方生成随机 `s`、锁前把 `h = H(s)` commit 进 session；A 绑该 session（且绑 h）。**A 可公开**。reveal-leg claim require `valid A ∧ preimage s`（`H(s)==h`）；s 发上 reveal 腿 ⇒ 反应方用 `valid A + s` 上另一腿（cutoff 更晚 Δ）。
- 🔵 **委员不知 s ⇒ 委员泄 A 不再破坏 reveal 序 ⇒ 化解 §16.4② 的委员共处 SPOF**（泄 A 无用、仍需 s）。C4 顺序不靠委员保密 ⇒ 与 no-theft 解耦；委员共处只剩"A 诚实性"顾虑（=§7 闸），不再是 no-theft 破法。
- 🔵 **非退回 HTLC-alone**：A 表达复杂共识谓词（plain HTLC 不能），s 只供 cross-leg 确定性 reveal 序 = 组合非替代。
- 🔴 **C4 残留信任是【转移】非【消除】（NWT 红队 a）**：构造堵住"委员泄 A"，但 Δ 的隐含前提是"s 只经首动方**链上** reveal 才被观察（=观察窗 0 时刻）"。s 是首动方私持数据，**无密码学机制阻止其在链上 claim 前私下泄 s**（意外/被 compromise/主动合谋）⇒ 拿到 (A,s) 者可抢在首动方 reveal 前构造反应腿 claim、压缩反应窗。⇒ **残留信任从"委员多方/quorum 不泄 A"【转移】为"首动方单人不泄 s（早于自己链上 reveal）"** —— 非消除。🔵 好处：从 quorum-SPOF（§7 洞、~25% 共处盘）变**单一自然人主体**（风险更集中但**更易归责**）。**必须与委员那条并列显式记为 Tier-2 残留信任，不得因解决 A-泄露即当 C4 零信任。**
  🔴🔴 **严重度更正(v1.1·NWT)：(a) 首动方泄 s = principal-THEFT，非"操作层信任转移"**。即便 s 是货真价实 256-bit CSPRNG 强随机（C4-ENTROPY 满足），只要首动方在自己链上 reveal **之前**泄 s（主动/被 compromise/侧信道），拿到 (A,s) 的一方即可走与弱 s 完全相同的 `refund(己)+claim(对方)` 盗窃 trace。⇒ **C4-ENTROPY（s 生成强度）盖不住 s-secrecy（s 持有保密）这个缺口**——二者是**并列的两条 Tier-2 硬假设，且同为 principal-theft 级**：`(a) 首动方不泄 s`（保密）∧ `(b) s 强随机不可猜`（§17.2 C4-ENTROPY，强度）。缺任一 ⇒ 盗窃可达 ⇒ 不给 Tier-2。
- 🔴🔴 **弱 s = principal-THEFT，非骚扰（v1.1 更正·Codex v1.0 REJECTED 我 v1.0 的"骚扰"判定）**：我 v1.0（采 NWT 红队 b）写"弱 s 因 payout baked ⇒ 只骚扰不盗窃"——**错**。Codex 盗窃 trace：cutoff 非对称（reveal 腿早、reactive 腿晚；首动方 outgoing 本金那条 reactive 腿的 baked 收款方 = 反应方）。若 s 可猜，反应方提前算出 s ⇒ ①走自己腿 refund/expiry 拿回己本金 + ②趁首动方**更晚 cutoff** 那条 outgoing 腿仍活，用 (A,s) claim 首动方本金 ⇒ **refund(己)+claim(对方) = 正是要防的盗窃结局**。🔴 **baked payout 救不了 —— 攻击者【正是】那条腿的合法 baked 收款方**（付给"预定地址"=付给攻击者）。⇒ **preimage 不可预测性 = 本金安全硬假设，非防抢跑优化**（classic HTLC）。
  🔨 判据：baked payout 只挡"外人把钱导去第三方"，**挡不住"合法收款方本人就是攻击者"**。NWT(b)+我采纳都漏了"攻击者=baked 收款方"这一步。
- 🔴 **MUST-FIX C4-ENTROPY（Codex v1.0 新增·Tier-2 硬假设）**：Tier-2 须显式含密码学假设：`s` ≥256-bit CSPRNG 均匀采样 · reveal-leg spend 公布前对反应方**计算不可预测** · `h=H(s)` 两腿锁定**前** session-bound · 实现对 s 长度/格式非冻结 v1 格式**必 fail-closed**。熵不能从 h 链上证 ⇒ 这是**显式 key-gen/secrecy 假设，非 covenant 谓词**。⚠ 与 §17.2「首动方不泄 s」是**不同**假设：那条防"泄露强密"，这条防"用弱密被暴力/猜解"（无需泄露）。二者并列记为 Tier-2 残留。
- 🔴 **C4 cutoff leg-role + C4-FINALITY（v1.2·Codex v1.1 NEW MUST-FIX）**：Tier-2 须冻死 leg-role 非对称 deadline **且**加一条 reactive-leg **NOT-BEFORE** 规则。
  - **reveal 腿 = 更早 cutoff**（首动方在此用 witness 首次公开 `s`）；**reactive 腿 = 更晚**（从 reveal 学到 s 的一方在此 claim）。
  - 🔴🔴 **C4-FINALITY（新洞·连诚实路径都中）**：reveal tx 一广播就在 reveal 链**暴露 s，早于它达 finality**。⇒ 即便 s 完美随机且从不私泄：反应方从**非最终**的 reveal tx/mempool 立刻取 s → 花 reactive 腿 → **reveal claim 后被 reorg 掉** → reveal 侧退回反应方，而它已拿首动方本金 = 同一 `refund(己)+claim(对方)` 盗窃，**不需弱熵/私泄**。原不等式只界了 reactive **最晚**时间，没挡它 **claim 太早**（reveal finality 前）。
  - 🎯 **修 = reactive-leg NOT-BEFORE 规则（covenant 机械 enforce·no-light-client shape）**：
    - 冻结绝对 `T_reveal`（reveal claim 必须 **< T_reveal**）；
    - 冻结 reveal 链 finality 安全预算 `F_reveal` + 时钟/skew margin（概率性 finality ⇒ `F_reveal` 是**声明的概率安全假设/确认策略**，Tier-2 = **conditional on 该 finality bound** 的 no-theft，非无条件定理）；
    - reactive-leg claim 在本地 `T_react_min` **前 covenant-invalid**：`T_react_min >= T_reveal + F_reveal + clock_skew_margin`；
    - reactive refund cutoff：`T_react_refund > T_react_min + claim_land_worst(reactive) + safety_margin`。
  - 🔨 **修双重计数（Codex）**：不再写 `finalization_time + finality_D`（同一量算两遍）；改用**从最晚合法 reveal 时间 `T_reveal` 起算的预注册保守界** —— reactive covenant **不假装能观测外链实际 finalization 时间**，只用 `T_reveal + F_reveal`。
  - 🔴 **fail-closed 地板扩到全部三处 lockTime（J2 警告·防 fail-OPEN）** 〔🔴 **地板【方向】已被下方 v1.3 裁定翻转**：本条写的 `>= 5e11` 是**墙钟方向**，而裁定走 DAA-score ⇒ 三处地板改 `< 5e11`（DAA 模式）+ 真深度下限；`>= 5e11` 对这三处**作废**（并存即 fail-closed DoS，见裁定块）。以下保留原文记录当时"防 fail-OPEN"的动机，方向以裁定为准。〕：C4-FINALITY 引入**三个**约束 —— reveal spend `< T_reveal`、reactive spend 前置 lockTime `>= T_react_min`、refund lockTime `T_react_refund`。lockTime **双模**（按量级选 DAA vs 墙钟；官方教程示例正落错模）⇒ **每一个 lockTime 常量都必须过 fail-closed 地板（方向随单位：DAA=`< 5e11`+深度下限 / 墙钟=`>= 5e11`）**（不止 refund_T），covenant 侧 + 构造侧**双闸**。漏任一处 ⇒ 该约束静默换模式 = fail-OPEN（NOT-BEFORE 形同虚设）或 fail-closed DoS（锁死）。
  - `T_react_min`/`T_react_refund`/`T_reveal` 的 covenant enforce（lockTime 比较）+ leg-role/资产流细化由 J1（silverc 域）落。
  - 🔴🔴 **验收必含【提前 claim 必拒】阴性格（J2·否则测试全绿盖住 fail-OPEN）**：若 NOT-BEFORE 闸因量级写错静默退 DAA 模式（如秒级 delta `3600` 被当 DAA `3600 << 7.9e7` ⇒ 条件恒真），闸**形同不存在**，而**正例（合法方等够时间再 claim）照样 PASS** ⇒ 全绿假象。⇒ **判别力只在阴性格：故意在 `T_react_min` 前提交 reactive claim ⇒ 必须 REJECT**（接 §846181e4 验收设计 §3 族 A）。参照 silverscript 官方 `TUTORIAL.md:495` 反例 `require(tx.time >= 1640000000)`（1.64e9 < 5e11 ⇒ 被当 DAA 而非墙钟秒）——**官方示例本身就落在错模**，实现极易照抄。
  - 🔴 **F_reveal 取值须有协议出处（NWT②）**：`F_reveal`（reveal 链 finality 安全预算）是 Kaspa/GHOSTDAG 协议层**概率性参数**，不是本卡随手定的数。⇒ 仓里若有既有 canonical "多少确认算 final" 常量（settlement/payout 逻辑里）**必复用它**；若无，`F_reveal 取值依据` **单立一格验收判据**，不得悬空。🔴 **偏小 ⇒ 同一盗窃只是变成"需要更深 reorg"而非被消除**（Tier-2 = conditional on 该 bound 的措辞正为此）。
    - 🔴🔴 **但 canonical 常量是【深度】不是【墙钟】，换算不稳（J2 实测·承重）**：仓里既有 `REORG_SAFE_MIN_DEPTH=20`（`kasia-console/src/lib/pool-shard-register.mjs:88`，出处注释 :83-87）—— 是**确认深度**，而 covenant NOT-BEFORE 用**墙钟 lockTime**。深度→墙钟换算**不是常数**：J2 实测同链同轮 DAA 增速在 **0.48–0.96/s 摆动（2×）** ⇒ 20 深度 = 21–42 秒不等。🔴 **链一慢，墙钟窗在深度够【之前】先到期 ⇒ reorg 安全没真达到 ⇒ C4-FINALITY 盗窃仍可能**。且有未解矛盾（代码里 BPS 假设陈旧 vs DAA-score 增速≠出块速率，未定哪个）。
    - 🎯 **⇒ C4-FINALITY 落地前单立验收格「深度↔墙钟换算：出处 + 保守取值 + 单位分叉裁定」**（J2 建议，Bettor 排）：
      - (i) 定 DAA-score 增速 vs 出块速率的关系（消歧那个矛盾）；
      - (ii) F_reveal 若走墙钟 ⇒ 用**最慢合理速率的保守上界**（over-estimate 墙钟，使最慢时 20 深度仍达到），并给速率下界的出处；
      - (iii) **单位分叉裁定**：NOT-BEFORE 到底 enforce 在**墙钟 lockTime**（需上面保守换算）还是**DAA-score lockTime**（深度直接、天然 reorg 单位，但落回 DAA 模式、不吃 5e11 墙钟地板）——两条各自的 fail-closed 形态不同，必须选一条并冻死，不能悬空。
      - 🔴 **换算 provenance 不能信标准源码/代码注释（NWT 实查）**：标准 rusty-kaspa `config/params.rs:638-650` 把 testnet suffix 写死只认 `Some(10)`，TN12（suffix 12）直接 `panic!` ⇒ **TN12 跑的是 patch 版**，而 `p2sh.mjs:1474` 的 "8BPS/2.5s" 注释大概率是抄标准 testnet、**未核 TN12 自定义参数**。DAA score 定义（`difficulty.rs:151-164`）= `sp_daa_score + (mergeset_size − mergeset_non_daa…)`，**非直接=块高**。⇒ 换算取值必须来自 **① TN12 实际 patched BlockrateParams / 运行时配置**（KANet-UI 运营者域），或 **② 数据驱动的观测速率下界 + 安全系数**（J2 实测 0.48–0.96/s，取更保守的地板 + margin）；**不得用标准源码或代码注释的 BPS 数**。
      - 🔴🔴 **实测定量（J2·2026-08-20）**：60 秒窗（getBlockDagInfo 双快照）DAA 前进 30 ⇒ **0.5 BPS 实测**，而 `p2sh.mjs:1474` 注释假设 **8 BPS ⇒ 差 16×**。⇒ 20 深度实测 ≈ **40 秒**；若照 8BPS 烤 `F_reveal≈2.5s`，**covenant 在真 finality 前约 37 秒就放行 reactive claim = 那 37 秒正是 C4-FINALITY 攻击窗、闸亲手打开**。⇒ 🔴 **`p2sh.mjs:1474` 的 "~2.5s@8BPS" 注释是【看着给依据、实际引向 fail-open】的误导注释**，须标为"假设值·与活链实测不符（0.5 BPS）"（误导注释比没注释更坏——会把下一个做换算的人引向 fail-open）——**注释修正走正常审查（该文件属钱路，Bettor 不擅改），此处 doc 为权威记录**。
  - 🎯🎯 **裁定（v1.3·2026-08-20·Bettor 裁, J1 covenant+J2 实测+NWT 红队 收敛）——上方"单位分叉(iii)待裁"结案**：
    - **① 单位 = 三处 lockTime【全部】走 DAA-score/深度原生**（reactive NOT-BEFORE / reveal-上界改成的 refund 下界 / refund cutoff）。**决定性 = halt→fail-closed**：墙钟在链 halt 恢复瞬间已走过而深度没涨 ⇒ claim 窗立开=fail-open；DAA 在 halt 期间两侧冻结=fail-closed。TN12 出块由**单 CPU 矿工线程**驱动、halt 是真事（本仓先例）⇒ 块速是运营变量非协议常量 ⇒ 墙钟路无论怎么调保守值都补不了这个结构差。🔵 **权威出处（KANet-UI·TN 运营者域）**：TN12 协议 TARGET = **10 BPS**（tn12 分支 upstream commit `889abddf`，`params.rs` 继承 `BlockrateParams::new::<10>()`，非 8），**但实产出被单 CPU 矿工卡在 0.41–0.96/s（差 10–20×），不受协议常数支配** ⇒ "BPS 这概念在本链本就不代表出块速率"（miner-governed）⇒ 若走墙钟，换算只能用**实测最慢速率**、不得拿协议 target 回填。**走 DAA 无需换算 ⇒ 上方 F_reveal 换算 fail-open 坑【消失】**（reorg 安全本以深度计，F_reveal=深度 20 直用）。🔴 **三处必须同单位**（否则 `T_react_refund > T_react_min+margin` 变 DAA+墙钟混算=同族跨域坑，NWT）。可建性：DAA-mode lockTime 生产已跑（`OracleStake_v1.sil:46 lockUntilDaa`）；DAA增速==出块（60s 30/30=1.00，NWT 从 `difficulty.rs` 佐证单线程无并行块⇒1:1）。
      - 🔴🔴 **fail-closed 地板【方向随单位翻转】——修一个会锁死资金的矛盾（J1 逮·NWT 逐字核实·Bettor integrator 错）**：上方"fail-closed 地板扩到全部三处 lockTime"（commit 564b184e）写的是 `require(值 >= 5e11)`——那是**墙钟方向**，为强制墙钟语义。但本裁定走 **DAA-score**（值 ~7.9e7 **< 5e11**）⇒ `require(tx.time >= T_react_min_daa) ∧ require(T_react_min_daa >= 5e11)` 对 DAA 值**不可满足 = fail-closed DoS = 那笔谁都花不了**。🔨 **判据：fail-closed 单位地板的方向必须与所选单位一致**。⇒ **裁定：走 DAA ⇒ 三处地板翻成 `require(值 < 5e11)`（证落 DAA 模式，防被误当墙钟）+ `require(值 >= 真深度下限)`（防琐碎小值）；564b184e 的 `>= 5e11` 对这三处【作废】**（它是墙钟时代写的，与 DAA 裁定矛盾）。三处**同方向**（全 < 5e11 DAA 模式），否则 §5-bis "同单位不等式" 仍是跨单位比较。⚠ integrator 教训：我既加墙钟地板（564b184e）又裁 DAA（5e02cc1e），两 commit 并存即静默 DoS——跨-commit 一致性没人管、integrator 守缝，J1/NWT 逮住。
    - **② 上界不可强制（与①【正交】·J2 点对·分开裁）**：`reveal < T_reveal` **不能 require 上界** —— silverc `tx.time` = 花费方填的 lockTime literal，填 0 即绕过=静默不强制（J1 实核 30 处全下界/0 上界；J2 `OracleStake_v1.sil:14` 独立核实）。⇒ 正确构造 = **reveal-腿 refund `require(tx.time >= T_reveal)` 下界真强制 + 单 UTXO 互斥**（竞争支路表上界：到 T_reveal 后 refund 可取、谁先花谁得，非 require 上界）。走 DAA 走墙钟都成立（lockTime 语义限制非单位问题）。**具体构造归 J1 域。**
    - 🔴 **③ 跨链 vs 同链 pin（裁定后剩的真问题）**：若两腿在**不同链**，reactive covenant **读不到对手链 DAA-score** ⇒ T_react_min 仍须 baked 常量 + 跨链 rate 保守界（换算残留只从"墙钟"挪到"跨链 DAA 对齐"，未真消失）；**只有同链（两腿都 TN12）深度共享才真消失换算**。⇒ 首实现的同链/跨链归属待 J1/J2 确认后定 T_react_min 语义。
    - 🟡 **④ 可移植性留档（NWT·不影响 TN12 当前）**："DAA≈7.9e7≪5e11 ⇒ 自动落 DAA 模式" 依赖 TN12 慢速（~0.5/s ⇒ DAA 撞 5e11 需 ~3万年）；若本设计复用到快网（mainnet BPS）DAA 值可能网络生命周期内逼近 5e11，"自动 DAA 模式" 届时须重验。
    - 🎯 **covenant 构造冻结（J1·报备层零生产码·2026-08-20）**：
      - **① reveal-腿（单 UTXO 两支·竞争支路）**：claim 支 `checkSigFromStack(A) ∧ blake2b(s)==h_baked ∧ tx.outputs[k].spk==baked_首动方收款`（**无时间上界**）；refund 支 `tx.time >= T_reveal_daa ∧ spk==baked_首动方退款`。单 UTXO 互斥 ⇒ T_reveal 前只 claim 可行、到 T_reveal refund 开=竞争 ⇒ 结构性**激励**"reveal 须在 T_reveal 前"，不靠 require 上界（裁定②落地）。
        🔴🔴 **① OPEN（J2 逮·未 closed）——措辞≠机制**：竞争支路给的是**激励**（迟到 reveal 只要先被打包**仍可能赢**），而"reveal 须在 T_reveal 前"读起来是**硬保证**。二者不同一件事。须 J1 先定 **① 要保证的确切性质**（"s 公开不晚于 T_reveal" ⟵ 竞争支路交付**不了** / 还是"首动方迟发不获利" ⟵ 竞争支路**可能够**），再核机制。且钉死 **T_react_min 模型**：(a) 两腿锁定在前 ⇒ T_react_min = 基于 T_reveal 的**绝对烤常量** ⇒ 迟到 reveal 破 margin ⇒ **需硬上界等价物**；(b) reactive 引用 reveal **实际落链 DAA**（reveal-DAA+20）⇒ 需 reactive 腿在 reveal 后构造（破两腿锁定在前的原子性）**或** covenant 花费时 introspect reveal UTXO 的 DAA（能力待核）。**同链**下 (b) 可能绕开 ambiguity（NWT）、待 J1 定 (a)/(b)；**跨链**下 T_react_min 只能预烤绝对常量 ⇒ ambiguity 是**活洞**（再+1 给"首实现锁同链"）。⇒ C4-FINALITY ① 未 closed，待 J1 定性质+模型。
      - **② reactive-腿（单 UTXO 两支）**：claim 支 `checkSigFromStack(A) ∧ blake2b(s)==h_baked ∧ tx.time >= T_react_min_daa`〔NOT-BEFORE·真下界〕`∧ spk==baked_反应方收款`；refund 支 `tx.time >= T_react_refund_daa ∧ spk==baked_反应方退款`。不等式全 DAA 同单位：`T_react_refund_daa > T_react_min_daa + claim_land_worst + margin`。
      - **③ 三处 DAA lockTime 地板（全 <5e11 同方向·covenant+构造双闸）**：每个 `require(值 < 5e11)`（证落 DAA 模式）**+ `require(值 >= 真深度下限)`（防琐碎小值恒真 = DAA-模式自己的 fail-OPEN，J1 逮到——不止 DoS）**。
      - 🔴 **同链/跨链（定 T_react_min_daa 语义·Bettor 裁）**：**首实现锁【同链】（两腿都 TN12）** ⇒ reactive covenant 读得到同链 DAA ⇒ `T_react_min_daa = reveal 落链 DAA + REORG_SAFE_MIN_DEPTH(20)`，深度直算、**换算真消除、率免疫 = 唯一"无条件"情形**，闭 Tier-2 的无条件部分。**跨链 = 文档化 conditional 扩展**（reactive 读不到对手链 DAA ⇒ baked 常量 + 跨链速率保守界 ⇒ Tier-2 conditional-on-对手链 finality）。实际首实现链对随 §6-3 A2-covenant-build 的 Owner 决策定；design 层以同链闭无条件 Tier-2。
      - ⚠ 未定此格前，F_reveal 是**没人验证过的假设**，不得烤进 covenant。
  - 🔴🔴 **T_reveal 必须锚 covenant 可读的【链上量】，非广播/mempool 时刻（NWT③·否则整条规则不可 enforce）**：covenant **读不到**"reveal tx 几点进 mempool"（链下观测）。若 `T_reveal` 被实现成 mempool/广播时刻 ⇒ NOT-BEFORE 在 covenant 侧**根本无法机械验证 ⇒ 退回 P-SAFE-1 本要消除的不可判定谓词**。⇒ 钉死：`T_reveal` 及 `T_react_min` 的时间比较**只用 reactive 腿自己链上可读的时间量**（该 spend 所在上下文的 tx.time / 区块时间戳），`F_reveal` 作为**预注册常量**吸收 reveal 链的 finality 不确定性——reactive covenant **不读也不假装读** reveal 外链的实际状态（这正是 §17.3 "共同观察域仅 ops 证据、非 covenant primitive" 的同一条：跨链态不进 covenant 判定）。
  - ⇒ **C4-FINALITY 与 C4-ENTROPY、s-secrecy 并列第三条 Tier-2 硬前置**：s 强随机 ∧ s 未私泄 ∧ **public reveal 在 reveal 腿越过冻结 finality-risk 窗前不能授权对手本金花费**。
- **弃委员加密 A**：加信任-保密角色、弱化 §8 verifiable-attestation vs trusted-oracle、破法更多（aggregator/distributor 泄、门限联盟泄、log/backup/RPC 泄、误前发、误投）+ 可用性/审查另一条 liveness。若将来仍要委员加密 A，须显式把委员保密列为 Tier-2 信任假设（非监控项）。

### §17.3 C4-break 检测：弃跨链 daaScore（Codex 否），改共同观察域
- 🔴 §16.4③ 的"两腿 claim daaScore 顺序"**作废**：daaScore 是 chain-local namespace，跨两条独立链 `daaScore_X < daaScore_Y` 无因果/时间意义（Codex）。
- 改：**共同观察域**（NWT 方案）—— 每条腿 finalized claim 落链后取**该链自己的 block timestamp**（非 daaScore/height），按各自共识时间戳容差（中位数时间/漂移界）折成 `claim_ts ± margin` **可比区间**，比区间而非比两个不同链本地 index。跨双链自证时间戳的交叉校验 = **可选加固**（新增"见证者不作恶/不合谋"信任面，不作闭档必需）。= ops-证据层, 非链上 covenant primitive。

### §17.4 水印降为可选取证（Codex + J1 一致）
- 不 watermark canonical A 本身（改签名语义）；wrapper 水印对**明文 A 泄露**证不了源（泄的明文仍同一 A）。⇒ wrapper 只作投递审计证据，非明文泄露的密码学源归因。降**可选取证**，须先给精确构造再采纳。J1"信封层可建但不算防线"与此一致。

### §17.5 Tier-1 措辞更正（Codex MUST-CORRECT）
- §16.1 承认可"一腿 AUTHORIZED、另一腿 EXPIRED" ⇒ §16.1 单独**不**蕴含 both-authorized-or-both-refund ⇒ **不得**称 Tier-1 = authorization-atomicity。
- 冻正：**Tier-1 = bounded-lock + per-leg 授权完整性**（**明说容许跨腿非对称授权**）。C4 缺失 session 落 Tier-1 = 此义。真正 both-leg 原子性只 Tier-2（C4 hybrid-secret）给。

### §17.6 v1.0 净状态（送 Codex 复审）
> 🔴 **已被 §17.7 v1.1 替代（Codex v1.0 verdict 后）**：下方 "P-SAFE-2/Tier-2 待 Codex 复审 hybrid 是否闭" 已有结果（未闭·弱s更正+C4-ENTROPY+cutoff冻结），以 §17.7 为准。
- P-SAFE-1 = **CLOSED**（§17.1 血缘措辞）。
- P-SAFE-2/Tier-2 no-theft = C4 hybrid-secret（§17.2）∧ cutoff 非对称 ∧ §17.1 血缘 ∧ payout baked（§16.4①/CloseZkV2 已证）；待 J1 covenant 可建性 + Codex 复审 hybrid 是否闭。
- 检测 = 共同观察域（§17.3，NWT 出）。水印 = 可选取证（§17.4）。Tier-1 = per-leg 完整性（§17.5）。
- 硬闸不变：§7 quorum 独立性（真金前）· A2 runtime E2E（负方向重跑中）· 单位地板/不等式（§14）。

### §17.7 v1.1 净状态（Codex v1.0 verdict 后·2026-08-20·RESPONSE-MSG257 桥 37199c49）
> Codex v1.0 收: 方向 GREEN, 未 design-closed。本节替代 §17.6。
> 🔴 **Tier-2 开项清单已被 §17.8 v1.2 替代（Codex v1.1 后新增 C4-FINALITY MUST-FIX）**：Tier-2 状态以 §17.8 为准。
- ✅ **P-SAFE-1 = CLOSED**（design 层, Codex 接受 §17.1 单一活 UTXO 血缘）。
- ✅ **C4 hybrid 方向 = PASS**；委员保密依赖 = **移除**（Codex 认好）。Tier-1 措辞（§17.5）= PASS。
- ✅ **checkSigFromStack 原语 runtime = CLOSED**（Codex 独立确认 CLEAN 8 格, **限 pinned 探针 scope**）。
- 🔴 **Tier-2 no-theft = 仍 OPEN**, 待:
  - **弱 s 更正（§17.2, 已改 v1.1）**: 弱 s 是 principal-theft 非骚扰（Codex REJECTED 我旧判）。
  - **C4-ENTROPY MUST-FIX（§17.2, 已加）**: s 强随机+不可预测+session-bound+fail-closed 格式 = Tier-2 硬假设。
  - **C4 cutoff leg-role 冻结（§17.2, 已加）**: reveal 腿早/reactive 腿晚 + 不等式给 s-learner 留 finality+反应 margin; covenant 细化 J1 落。
  - Tier-2 残留信任（并列, 显式非零信任）: 首动方不泄 s（§17.2 a）+ s 强随机不可猜（§17.2 C4-ENTROPY）。
- 🟡 **A2-whole（receipt→state 授权路）= OPEN**（Codex 列 5 项, 均在真 covenant 非探针）: ①§6-1 receipt 字节绑定 ②threshold+委员根验 ③receipt→唯一后继 ④篡改 receipt/threshold/成员/后继/payout 负测 ⑤真 covenant path 的 durable provenance。**⇒ checkSigFromStack 原语闭 ≠ A2-whole 闭。**
- 检测（§17.3 共同观察域）= **仅 ops 证据, 非 covenant safety primitive**（Codex 明确）。水印（§17.4）= 可选取证。
- 硬闸不变: §7 quorum 独立性（真金前）· 单位地板/不等式（§14）。
- **下一步**: Bettor v1.1 已改 §17.2（弱s/熵/cutoff）→ 送 Codex 复审 Tier-2 是否闭; J1 covenant 可建性（reveal-leg `checkSigFromStack(A)∧H(s)==h` + s fail-closed + leg-role 资产流）; A2-whole 5 项另起（receipt-binding e2e）。

### §17.8 v1.2 净状态（Codex v1.1 verdict 后·2026-08-20·RESPONSE-MSG258 桥 3337f419）
> Codex v1.1: 方向 GREEN, v1.1 全部更正接受, 但 NEW MUST-FIX C4-FINALITY。本节替代 §17.7 的 Tier-2 开项清单。
> 🔴 **本节 Tier-2 开项已被 §17.9 v1.2-verdict 替代（Codex reframe: NOT-BEFORE 不足、须 positive finalized-reveal binding）**：以 §17.9 为准。
- ✅ v1.1 **全部接受**: weak-s=theft · C4-ENTROPY · s-secrecy(与熵分离, 同 theft 级) · cutoff leg-role 冻结 · P-SAFE-1 CLOSED(不变)。
- 🔴 **NEW MUST-FIX C4-FINALITY（§17.2, v1.2 已加）**: reveal tx 广播即暴露 s 早于 finality ⇒ 反应方从非最终 reveal 取 s 花 reactive 腿, reveal 后被 reorg ⇒ 盗窃(不需弱熵/私泄, 连诚实路径都中)。修 = reactive-leg NOT-BEFORE 规则(`T_react_min >= T_reveal + F_reveal + clock_skew`, covenant 机械 enforce)+ 修双重计数 + 概率 finality ⇒ Tier-2 conditional on finality bound。
- 🔴 **Tier-2 no-theft = 仍 OPEN / REDTEAM HOLD**: 三条并列硬前置 = C4-ENTROPY(s强随机)∧ s-secrecy(不私泄)∧ **C4-FINALITY(reveal 越 finality 窗前不授权对手本金花费)**。v1.2 已加 C4-FINALITY, 送 Codex MSG-259 复审。
- ✅ checkSigFromStack 原语 CLOSED(探针 scope 不变)。
- 🟡 A2-whole OPEN: 验收设计(846181e4)Codex 认方向 sound(含 merkle-删-vs-committeePkHash-诱饵判别测 + no-op 控制臂), **但零闭档 credit —— 生产 covenant 不存在**。建造 = Owner 闸(已上报)。
- 硬闸: §7 quorum 独立性(真金前)。
- **下一步**: v1.2(C4-FINALITY)送 Codex; J1 covenant 侧 enforce T_react_min/T_react_refund lockTime + leg-role 资产流; A2 covenant 建造待 Owner。

### §17.9 v1.2-verdict 净状态（Codex MSG-259 verdict 后·2026-08-20·桥 358b04a2）——C4-FINALITY reframe
> Codex v1.2 verdict：C4-FINALITY 未闭。**NOT-BEFORE(时间) 只是 hardening、不足以 closure**。本节替代 §17.8 的 Tier-2 开项。
- 🔴🔴 **核心 reframe（Codex §1）**：`NOT-BEFORE(time) ≠ reveal-finalized`。时间只证流逝、不证 reveal 被收录/finalized。活 trace（不需弱熵/私泄/迟发）：s 广播公开 → reveal tx **从未被挖/被逐/never finalize** → 时间过 T_react_min → 反应方持 (A,s) 满足本地 NOT-BEFORE → claim 对手本金 → reveal 侧 refund（从未 finalize）= 盗窃。
- 🎯 **要求（Codex §2）：reactive 授权须依赖【正的、共识可验的 finalized-reveal 事实】**，非时间延迟：
  - **R1 — finalized-reveal attestation（fits §6-1、无光客户端·Bettor 出设计见 §18）**：reveal claim finalize 后委员发第二份 typed receipt `RevealFinalizedAttestation`；reactive claim require `valid A + s + valid R`。🔴 重引入委员 liveness/correctness ⇒ 受 §7 quorum 闸。
  - **R2 — 光客户端/SPV**（已排除, 非 v1）。
  - 🔵 **R2-lite（同链·若 introspection 可建）**：同链下 reactive covenant introspect **reveal SPEND 的链上存在+落链深度(>=20)** = 正 finalized 事实、挡 Codex trace（reveal 没落链⇒无可 introspect⇒REJECT）。**判据变了**：不是"读时间"、是"读另一 UTXO/spend 的存在+深度"（@J1 能力查）。能 ⇒ 同链走 R2-lite；不能 ⇒ 同链也须 R1。
- ✅ **Codex 确认对**：① 竞争支路=race/incentive 非硬 deadline（OPEN 标注对）· 两腿锁定在前不能被 reactive-后构造悄悄替换（Codex §4 "别混模型"）· 同链 DAA 只解测量不解收录证明。
- 🎯 **Codex 要的下一 artifact**：冻一条精确 Tier-2 转移 `reveal finalized under frozen policy → 正 receipt/proof R → reactive claim authorized` + session 绑定 + replay + 被拒 trace `mempool/公开 s 但未 finalized → reactive MUST REJECT`；并定死两腿是否锁定在前（是⇒reactive 须验正 finalized-reveal artifact）。
- **状态**：P-SAFE-1 CLOSED · C4 hybrid PASS方向 · C4-ENTROPY/s-secrecy 硬假设接受 · **C4-FINALITY = 时间 gate PASS-as-hardening、NOT sufficient** · **positive finalized-reveal binding = NEW/CONTINUED MUST-FIX** · reveal 上界=OPEN(竞争支路 incentive 非硬 deadline) · A2-whole OPEN · §7 quorum 硬闸。
- **下一步**：Bettor 出 R1 设计(§18)· J1 introspection 能力查(读 spend 存在+深度)判 R2-lite · 据能力+同链/跨链选一路冻 + 出 Codex 要的转移 artifact + 被拒 trace。

### §17.10 v1.3 forgeability 解决净状态（Codex O-earmark 红队后·2026-08-20·桥 99436e8c/MSG-260）——同链 O-construction trustless 结构闭
> Codex 主动红队逮出 O 可伪造（session-bound script ≠ origin-bound UTXO）→ 团队走 Codex Option-C（covenant-id lineage）修 → NWT 全面红队闭。本节记同链结论。
- 🔴 **forgeable-O catch（Codex, 决定性·已修）**: `O_spk` 锁前可算=公开 ⇒ 攻击者造合成 O（同 script、无 reveal 血缘）⇒ 花合成 O 破 reorg-coupling ⇒ 盗窃重现。⇒ **script-bound ≠ origin-bound；唯一寻址证不了唯一来源**。
- ✅ **修 = Option-C covenant-id lineage（同链·trustless·可建·活先例）**: 锁前造唯一 capability C（cov_id 由 consensus 从 funding outpoint 派生、不可选/撞）→ reveal-claim 消费 C 造 O（O 的 cov_id 续自 C）→ reactive-claim（O-REPLACEMENT 无 (A,s) fallback）花 O 时 `require(OpInputCovenantId(O)续自 baked C)`。合成 O cov_id≠baked→BUST。原语 `OpInputCovenantId`/`OpOutputCovenantId`/`OpOutpointTxId`（compile.rs:452-479）· 活先例 ShardLeaf:99/PayoutShard/PoolSpine 续链。
- ✅ **NWT 4 闸红队全闭（方向 PASS）**: ①cov_id 派生不可伪（撞≡blake2b 原像+控 outpoint=不可行）②多 candidate 无优势（各 cov_id=f(outpoint) 不同、reactive 只认 baked）③**C 每条非-reveal-claim 支须 lineage-terminal**（J1 从 J2 的 O-T_O 侧门一般化到 C 全部 refund/timeout 支）④MITM 截取 non-issue（逐支显式控制非隐含 AND）。
- 🔴 **Q3 = 本构造真承重风险 = 漏写即静默的授权义务（PayoutShard:26 同病）**: 落码必**显式 require + 负测**（手写 refund 支产 cov_id output → 必 BUST），不靠"记得禁了"。= deploy 不变量。
- 🔵 scope: cov_id-consensus 依赖 covenant-enabled consensus（TX_VERSION_TOCCATA）= 整条 bshard 线已依赖的同底座、**非新信任假设**。
- **净参数账（J2 诚实定价）**: 消除 F_reveal（难估外链-finality 安全参数）→ 结构 co-reorg finality（无 proxy）+ T_O（本地 claim-延迟安全参数, 易估）。**非零参数、但从"外部难估"变"本地易估" + trustless + 无委员 liveness 瓶颈。**
- ✅ **同链 C4-FINALITY = design-CLOSEABLE**（O-replacement + cov_id lineage 结构闭, trustless）。REDTEAM HOLD 待解 = [J1 完整 §6-3 A covenant 把 Q3 落显式 require+负测 + Codex MSG-260 design concur + 实现（Owner 闸）]。
- 🟡 **跨链仍 OPEN**: O 在对手链 reactive 花不掉 ⇒ 退 R1（委员 finalized-reveal attestation）/ conditional / bounded-lock。⇒ **首实现锁同链 = 拿无委员结构 Tier-2**。
- **Tier-2 状态**: P-SAFE-1 CLOSED · C4-ENTROPY/s-secrecy 硬假设 · **C4-FINALITY 同链 = closeable via O-construction（待 Codex concur + Q3 落码）** · 跨链 = R1/conditional。

### §17.11 Codex MSG-260 verdict（2026-08-21·桥 09671451）——GREEN DIRECTION + 3 MUST-FIX（同链架构接受，未 design-closed）
> Codex 接受 cov_id-lineage 架构（script→provenance pivot / O-REPLACEMENT / terminal 支必终止 lineage / ShardLeaf 先例确认真 provenance 非 codegen 猜），但 J1 构造 v0.1 有 3 MUST-FIX。
- 🔴 **MUST-FIX 1（A-absent 回退·Bettor 认漏）**: J1 v0.1 reveal-侧 refund 写成 `require(A-absent) ∧ tx.time>=T_react_refund` = 回退 v0.7 已否决错（covenant 证不了链下 A 全局不存在）。⇒ **改回 §17.1 P-SAFE-1 单-live-lineage**（still-live LOCKED 互斥后继, cutoff 前只 validated-reveal 消费、timeout 后转 terminal refund）, A-absent 全清。⚠ Bettor 整合 §17.10 时没细读 J1 144 行、信收敛漏了此回退, Codex catch, integrator 守缝失手一次。
- 🔴 **MUST-FIX 2（唯一后继）**: `OpCovOutputCount(cid)>=1` 允许多续链 output ⇒ 违反唯一 capability。改 **`==1`** + 每条 terminal/refund/cancel 支续链 output **==0** + 变异负测（==1→>=1 / terminal 产续链 ⇒ 验收必挂）。
- 🔴 **MUST-FIX 3（T_O 相对锚）**: T_O 从绝对 DAA+无锚时长 改**相对 O 创建**: `refund 仅当 current_daa >= OpTxInputDaaScore(O) + N_claim + N_margin`（O 是 refund tx 的 input ⇒ OpTxInputDaaScore(O) 可用；早前解不了 model-b 的那个 opcode 这里正对上）。
- 附加: 双方锁前验精确 genesis C+baked cid; cid!=0/O script/value>=min_O 是格式检查非 provenance 替代; cov_id 派生须 durable 源码/runtime 证（Toccata path）。**跨链本轮不闭**（仍需正 finalized-reveal 证 R1/光客户端）。
- **状态**: synthetic-O attack FIX 方向接受 · cov_id ancestry/co-reorg PASS-AS-ARCHITECTURE · **P-SAFE-1 被 A-absent 回退 REOPENED=MUST-FIX** · 唯一后继 OPEN=MUST-FIX(==1) · T_O 反应窗 OPEN=MUST-FIX(相对锚)。
- **下一步**: J1 v0.2 修三条+A-absent全清 · J2 验收族B加 ==1/terminal==0 变异负测+T_O相对锚 · NWT 修后红队(P-SAFE-1 lineage ↔ O-lineage 交互) · 送 Codex 复审 → 同链 design-closed。

### §17.12 验收变异测试【三层】框架（J2 综合·2026-08-21·防"只做语句级"）
> C4-FINALITY 同链 O-construction 的验收族 B 凑齐三层, 每层逮不同盲区、每层由不同 reviewer 逮到——**它们能凑成一张表恰因没有一个人能靠自己想全**（验证多人对抗审查价值）。落码验收必覆盖三层, 不止第一层。
| 层 | 手法 | 逮的盲区 | 本卡实例 | 谁逮 |
|---|---|---|---|---|
| **语句级** | 删/改某一行 require | "写下来的东西不够紧" | 删 merkle 留 committeePkHash 诱饵 / `OpCovOutputCount==1` 放松成 `>=1` | Codex |
| **交易级** | 不改代码, 改【怎么提交】 | "该写的约束根本没写"（line-mutation 结构性失明） | LOCKED-transfer 与 C-consume/O-create 拆成两笔 tx 提交 → 领本金那笔必拒 | NWT |
| **配置级** | 不改代码, 改【烤入常量关系】 | "靠记得配对的 deploy 义务" | cutoff 顺序配反 → 同一攻击必 LAND（"有牙"双格: 正序 BUST / 反序 LAND） | NWT |
- 🔨 **判据**: 只做语句级变异 = 对"该写没写"（交易级）与"配错关系"（配置级）**结构性失明**。承重构造的验收**三层都要**。且"有牙"格（反配→攻击 LAND）比"正配→攻击 BUST”格更关键——它证防御的牙是真的、非摆设。
- 关联: 语句级=[[reference-a-self-consistent-require-can-look-like-the-binding-and-outlive-it]]；交易级/配置级=本 session 新增（缺失约束 + 隐含配对义务）。J2-BFAMILY-THREE-LAYERS。

### §17.13 Codex v0.3 verdict（2026-08-21·GREEN 方向·未 closed·对称承重缝）
Codex 复审 v0.3（RESPONSE-20260820-MSG261-SUPP-S6-3-V03）：**GREEN 架构方向, 但未 design-closed**。前 4 修全 PASS AS DESIGN（A-absent→P-SAFE-1 · `==1` 唯一续继 · T_O 相对锚 · v0.3 两-lineage 焊接="REAL FIX, 交易级负测恰当, 语句级测不出这类"）。
🔴 **新 MUST-FIX（对称缝, Codex 逮, 内部全漏）= O 生命期 ↔ 被保护本金退款生命期未耦合**:
- v0.3 焊死"拿反应方本金 LOCKED' ⟹ 同笔造真 O", 但**没焊**"真 O 存在 ⟹ 反应方有 ≥N_claim+N_margin 内不可被偷的本金可领"。
- 攻击: 首动方拖到最晚 reveal, 一笔原子 tx 消费 LOCKED'+C(领钱+造真 O, v0.3 焊全过), 但自己 LOCKED 已 refund-eligible → 抢在反应方凭 O 领前 refund 掉自己本金 ⇒ 既拿对方本金又收回自己本金, O 真但经济无用。= 同一 principal-theft; T_O 只锚 O 创建, 没锚被保护本金退款窗。
- 🎯 **Bettor 判方向 = Shape B（状态转移）非 Shape A（静态不等式）**: 全设计哲学=结构/相对/本地优于绝对/外部窗(O-construction 采纳初衷); A 重引绝对 cutoff + 需 `T_latest_reveal` 可强制链界=又一承重参数。**B 与 v0.3 焊接对称、统一 Codex 两点**: 造 O 那笔原子 tx 同时转首动方 LOCKED→`O_AUTHORIZED`(退款锚 `O_creation_daa+N_claim+N_margin` 或反应方凭 O 领)。⇒ 单笔四路原子焊: 消费 LOCKED'(付首动方)+消费 C+造 O+转 LOCKED→O_AUTHORIZED。不变量 `O 于 d 创建 ⟹ 被保护本金在 d+N_claim+N_margin 前不能回首动方`。
- 🔴 **Codex 第二点(§4(c) 拓扑显式)B 一并解**: §4(c) 反应 claim = `O_AUTHORIZED` claim 支、要求真 O 作 co-input(非"只花 O"独立支, 否则又一两-tx 缝)。焊 payout recipient/value/state 同笔。交易级负测: (a) 花 O 缺被保护本金输入/缺精确 payout → REJECT (b) 花本金缺真 O 输入 → REJECT。
- 派工: J1 v0.4(Shape B 四路焊 + §4(c)=O_AUTHORIZED 支 + 两交易级负测, 先裁源码可建性) · NWT 红队 v0.4(是否又开新对称缝) · J2 验收加两负测 + O_AUTHORIZED 拓扑。
- 硬 pre-code 门(Codex 重申 OPEN): A2 checkSigFromStack full leg canonical 8065184 · cov_id 派生 durable 证 · min_O/N_claim/N_margin 具名常量 · quorum 独立=pre-real-funds 硬部署门。
- ⇒ **同链未 closed = v0.4(此耦合)+ Codex 复审 v0.4**。对称缝 design 前逮住、非钱上。

### §17.14 v0.4 落地 + Shape A 认错 + REACTIVE-CLAIM-LIVENESS 硬假设（2026-08-21）
J1 v0.4（14fb878d）修 Codex v0.3 逮的对称缝，走 **Shape A（静态 baked 不等式）非我判的 Shape B**：
- **Shape A 实现**：`LOCKED_F` terminal-refund 支 `require(current_daa >= T_refund_LOCKED_F)` + baked `T_refund_LOCKED_F >= T_cutoff_LOCKED_R + N_claim + N_margin`（§4-d:184）；配置级负测 `T_refund_LOCKED_F < ...` ⇒ non-conforming（:209）；§4-c 改 `LOCKED_F` spend 支 + O 作 co-input + baked payout（Codex 拓扑 MUST-SPECIFY 闭，:11/79/207）；单位标注全 DAA-score（:187）。
- 🔴 **Bettor 认错（我判 Shape B 过度设计）**：我理由"A 重引绝对窗/需新 host 参数"错——`T_cutoff_LOCKED_R` 是构造里**已存在**的可链上 enforce reveal deadline（非新参数），A 与 v0.3 cutoff 排序不变量**同模式**（我已接受那条），Codex 明列 A/B 皆可接受。安全推导：O 由 reveal 创造、reveal 要 `current_daa < T_cutoff_LOCKED_R` ⇒ O_creation < T_cutoff_LOCKED_R ⇒ `T_refund_LOCKED_F >= T_cutoff_LOCKED_R + N_claim + N_margin > O_creation + N_claim + N_margin` ⇒ LOCKED_F 锁到 O创建+margin 后、反应方有 ≥N_claim+N_margin 领窗 = 满足不变量。**A 安全够且最小；B 只早释放 LOCKED_F=资本效率非安全**，J1 记 §7 备选待 Owner/团队定=对。J2 与我同错（判据"请回绝对参数=修错层"套错对象、没核 A 复用已存 cutoff），**J1 一人逮我俩** ⇒ [[feedback-a-criterion-is-strong-checking-others-weak-binding-self]]（判据越顺手越要核前件）。
- 🔴 **REACTIVE-CLAIM-LIVENESS = 第 4 条硬假设（J2 枚举逼出）**：v0.4 不等式保证反应方**有** ≥N_claim+N_margin 领窗，**不保证用**——反应方不领 ⇒ LOCKED_F 退首动方 ⇒ 首动方两本金都拿。"不去领自己的钱"合约救不了=标准 fair-exchange 活性模型（同 HTLC 超时），benign 但 load-bearing 于反应方本金安全，**必须显式命名不能默认**。⇒ 同链 Tier-2 正确表述 = **结构 no-theft【条件于此标准活性】非无条件**（并列 C4-ENTROPY / s-secrecy / C4-FINALITY 第 4 条）。
- **§2.6 两两独立性矩阵（J2·c0def909）**：8 支穷举，承重格全 WELDED/EXCL，无"本该绑却没绑"。NWT 逮标注精度（非洞）：`a×e`/`b×g` 非独立（时刻参数互授权）、被 blanket 误盖，安全已由 c×e/c×g 焊住 ⇒ J2 单拎标注。矩阵三自界（J2 写死）：① 没格被跳≠每格判断对（逐格仍须 J1/NWT 核，NWT 当场行使逮 a×e/b×g）② 只覆盖 8 支、新增即失效=改构造同步义务 ③ 两两 ≠ N-way（≥3 支同时缝照不到）。
- ⇒ **同链 design-closed 判据**：J2 修矩阵标注 → Codex 复审 v0.4（Shape A + 矩阵精标 + REACTIVE-CLAIM-LIVENESS 显式 + 三自界）+ 硬 pre-code 门（A2 leg 8065184 e2e · cov_id durable · min_O/N_claim/N_margin 具名常量 · quorum 独立 pre-real-funds）。跨链退 R1。落码 Owner 批。

### §17.15 Codex v0.5 verdict = REDTEAM HOLD（2026-08-21·一条剩余结构缝·O↔LOCKED_F 单向焊）
Codex 复审 v0.5（RESPONSE-20260820-MSG262-S6-3-V05）：**接受全部 v0.5 修**（Shape A timing PASS AS DESIGN / §4-c 拓扑方向对 / reactive-liveness ACCEPTED AS EXPLICIT CONDITIONAL / P-SAFE-1+A-absent PASS / C 唯一续继 PASS AS DESIGN / 矩阵=覆盖索引非闭合证）,但**NOT design-closed** —— 一条结构 MUST-FIX:
- 🔴 **O↔LOCKED_F 焊接只单向(蕴含非双条件)**: §4-c 证 `claim LOCKED_F ⟹ 含真 O co-input`, 但**没证逆** `花真 O ⟹ 必同笔 claim LOCKED_F 且带精确 baked payout`。O 自己 pre-timeout spend 支若只验本地 witness/state ⇒ reveal 后 s/A 公开, 外人/任一方可在**独立 tx** 消费真 O 不碰 LOCKED_F ⇒ capability 毁 ⇒ 反应方 F1 行使不了 ⇒ 首动方 T_refund_LOCKED_F 后收回 LOCKED_F。F1 侧 co-input 检查救不了(管不住从不进 F1 的独立 O spend)。
- 🎯 修法: O covenant 自己 pre-timeout 支加**互反同笔不变量**: require ①精确 LOCKED_F input(cov 身份/不可伪 baked capability)②精确 baked 反应方 recipient ③精确 principal value/state 转移 ④无其它 pre-timeout O spend 支能终止 O 而不交付 LOCKED_F(O 唯一续继)。⇒ `消费 O ⟺ claim LOCKED_F 到 baked recipient`。+ 3 对称负测(真 O 无 LOCKED_F input→O 自己 covenant 拒 / 真 O 错 payout→拒 / 删 O 侧焊→攻击 LAND)。
- 🔨 **Codex 用 J2 矩阵 caveat(a)(每格机制判断仍须对抗验证)逮的**: 矩阵 F1×O1 标 WELDED 只凭"F1 要求 O co-input"=蕴含非双向焊 ⇒ J2 修 F1×O1 标注。**验证矩阵+caveat 全套价值: 矩阵定位到具体格, Codex 逐格对抗验证逮出误标。** 同"单向焊"形状第 3 次(NWT LOCKED_R↔O创建 / Codex v0.3 O↔LOCKED_F 寿命 / Codex v0.5 O↔LOCKED_F spend 权反向)——J2 框架预言成立(第 N 缝是矩阵具体格非"没人想到处")。
- Codex: 无独立 N-way 缝存活(限 8 支模型, 非对未来加支的证明)。
- 派: J1 v0.6(O 侧互反焊 + 3 负测, 先裁可建性)· J2 矩阵 F1×O1 修 · NWT 红队 v0.6。⇒ 修完送 Codex 复审 = 同链 design-closed(subject to 硬 pre-code 门: A2 leg 8065184 e2e · cov_id durable · 具名常量 · quorum 独立 pre-real-funds)。无实现/钱路授权。

### §17.16 Codex v0.6 verdict = REDTEAM HOLD（2026-08-21·反向焊 PASS·但 anchor 矛盾·四人共错）
Codex 复审 v0.6（RESPONSE-20260820-MSG263-S6-3-V06）:**反向焊修好**——§4-e 使 `花 O ⟺ 领 LOCKED_F` biconditional **PASS AS DESIGN**、F1×O1 可标 WELDED（spend authority）、3 对称负测对。但**NOT design-closed**——一条 timing/anchor 矛盾:
- 🔴 **MUST-FIX（anchor 不可 enforce）**:§4-e 称 `T_O == T_refund_LOCKED_F` 且"均锚 `OpTxInputDaaScore(O)+N_claim+N_margin`" = **机制上不可能**。`T_refund_LOCKED_F` 在 reveal 前就 baked（那时 **O 还不存在**，`OpTxInputDaaScore(O)` 取不到）；且 LOCKED_F 跑 standalone refund 支时 O 非必需 co-input，covenant 读不到 O 的 daa。⇒ "令两 anchor 相等"是**散文/配置断言，非 covenant 可强制的不变量**。
- 🔴🔴 **四人共错（含 Bettor）**:J1 自抓对齐需求、NWT 确认、J2 升矩阵格、**Bettor 背书"三方三角 well-covered"** —— 但那个具体形式（equality + 都 O-anchored）机制上不可 enforce，**四人都没核 `T_refund_LOCKED_F` 在其 bake 时刻 O 还不存在**。Codex（外部对抗）逮出。⇒ 判据 [[feedback-samples-sharing-a-hidden-precondition-cannot-support-a-necessity-claim]] 的对偶:**多个独立 reviewer 三角"同意"一条不变量不使它可 enforce——他们可共享盲点。可 enforce 性须单独核:这个 covenant 在这个执行时刻【读得到】它要比较的量吗?**
- + 真 bug:F1（reactive claim §4-c）无 `< T_refund_LOCKED_F` 上界 guard，F2 在 `>=` 开 ⇒ UTXO once-spend 只在落一笔后互斥、不使两支 eligibility 不重叠 ⇒ 阈值后 F1/F2 可 race。
- 🎯 **修法 = Shape A1（Codex 给，最小，保 Shape A；Shape B 动态后继不需）**:① 删假 equality ② F1 加 `require(current_daa < T_refund_LOCKED_F)` ③ O 边界纯相对:O1 `< OpTxInputDaaScore(O)+N_claim+N_margin` / O2 `>=` 同式 ④ equality 换 **ordering**:`T_refund_LOCKED_F >= latest_possible_O_creation + N_claim + N_margin`（latest O creation `< T_cutoff_LOCKED_R` covenant-限 ⇒ 现有 v0.4 baked 不等式已保守满足，只须精确 off-by-one）。+ 5 边界负测（F1@>=阈值→拒 / F2<阈值→拒 / O1@>=相对界→拒 / O2<→拒 / 错序→theft race 可达）。
- 其余 v0.6 状态:反向焊 PASS AS DESIGN · P-SAFE-1/A-absent PASS · C 唯一续继 PASS AS DESIGN · Shape A 寿命耦合方向 PASS（normalized deadline model OPEN） · reactive-liveness accepted · 矩阵覆盖 artifact 非 ≥3 支证明（Codex 本轮未见独立 ≥3 支攻击, 除此 deadline model）。
- 派:J1 v0.7 Shape A1（先裁可建）· J2 矩阵据 v0.7 更 timing 格（纯相对 O + ordering 非 equality）· NWT 红队 v0.7。⇒ 修完送 Codex = 同链 design-closed（subject to 硬 pre-code 门）。

### §17.17 Codex v0.8 verdict = REDTEAM HOLD（2026-08-21·下界 pivot 对·但 Shape A ordering 塌·Shape B 现必需）
Codex 复审 v0.8（RESPONSE-20260821-MSG264-S6-3-V08）:下界-only pivot **方向 PASS**（反向焊 O⟺LOCKED_F PASS · P-SAFE-1 PASS · C 唯一续继 PASS · O 相对 recovery `OpTxInputDaaScore(O)+N` 方向 PASS），但**NOT design-closed**——竞争支路重构 **BROKE 了 Shape A 的本金寿命耦合**:
- 🔴 **MUST-FIX 1（T_cutoff_LOCKED_R 不再是最晚 reveal 界）**: 删 reveal `< T_cutoff_LOCKED_R` 上界后, `T >= T_cutoff_LOCKED_R` 只让 refund **可用**、reveal 支**仍有效**。首动方故意晚 reveal: 过 cutoff 后 LOCKED_R 若没被 refund 落链, 广播晚 reveal 抢赢 once-spend、消费 LOCKED_R+C、**cutoff 后**造真 O。而 `T_refund_LOCKED_F` 从 `T_cutoff_LOCKED_R + N` 静态导 ⇒ 离**实际** O 创建可能不足 N_claim+N_margin ⇒ 抢 refund LOCKED_F ⇒ **双拿**。⇒ Shape A v0.4 ordering 整个依赖"T_cutoff_LOCKED_R = 最晚 reveal 界"、而那依赖已不可 enforce 的上界 ⇒ **塌**。reactive-liveness 救不了(窗本身比承诺短)。§4-f 逐对重证漏此(推理"latest O creation <= T_cutoff_LOCKED_R"前提没了), 我 grep 也漏——[[feedback-samples-sharing-a-hidden-precondition-cannot-support-a-necessity-claim]] 又一实例(删上界这动作使一条被依赖前提静默失效)。
- 🎯 **修法 = Shape B 现在【必需】**（Codex 指, Bettor 裁; 我早前判 A 是 buildability 发现【之前】、现 A 塌）: reveal 消费 LOCKED_R+C 造 O 的**同一笔 tx** 把 LOCKED_F 转 `O_AUTHORIZED` 后继, 其 recovery 下界 = `OpTxInputDaaScore(O) + N_claim + N_margin`（consensus-visible 的**实际** O 创建坐标, 无上界依赖）⇒ 机制保证 `O 于 d 创建 ⟹ 被保护本金在 d+N 前不能回首动方`, 不假设 reveal 在任何不可 enforce 上界前。
- 🔴 **MUST-FIX 2（liveness 加强 confirm）**: 阈值后 claim 支与 recovery 支都 valid 到一笔落链 ⇒ once-spend 只保唯一、不保**谁赢**。§1.5 假设 5 改: "得利方 claim 须在对方 recovery 下界**开之前 LAND/CONFIRM**（bounded-inclusion / 抗审查假设, N_claim+N_margin 表征）"——非"广播"（mempool 里 <X 仍可能输给 X 变 valid 的 recovery）。这也改 watchtower: 须**确认**非只广播。
- 🔴 **MUST-FIX 3（buildability 措辞, Bettor 上轮 flag + Codex 确认）**: normative 里 `require(current_daa >= X)` 是 phantom（语言不暴露 current_daa）⇒ 冻**真 SilverScript 原语**（TxTime/CLTV 下界语义 + operand domain）, 别把 pseudo-var 留在承重 spec（它遮蔽 v0.8 要消的 buildability bug）。
- 派: J1 v0.9 = Shape B 四路原子（消费 LOCKED_R + 消费 C + 造 O + 转 LOCKED_F→O_AUTHORIZED）+ liveness 改 confirm + 真原语冻结（先裁每处可建）· J2 矩阵 · NWT 红队。⇒ 修完送 Codex = 同链 design-closed（subject 硬 pre-code 门）。跨链另 OPEN。

### §17.18 Codex v0.9 verdict = REDTEAM HOLD（2026-08-21·Shape B 方向对·但半成品迁移·两 MUST-FIX）
Codex 复审 v0.9（RESPONSE-20260821-MSG265-S6-3-V09）:Shape B pivot **PASS DIRECTION**（recovery 锚实际 reveal-后继 / confirm-not-broadcast liveness / 去上界 全 PASS），但**NOT design-closed**——v0.9 是**半成品 Shape B 迁移**（加了 O_AUTHORIZED 但没扫全构造更新旧 LOCKED_F 引用）:
- 🔴 **MUST-FIX 1（reveal 可完全不带 LOCKED_F）**: §4-d LOCKED_R transfer 支只 require `checkSigFromStack(A)+blake2b(s)+OpInputCovenantId(C_idx)==cid`——**无 LOCKED_F input 无 O_AUTHORIZED 要求**。`LOCKED_F→O_AUTHORIZED` 的 require 只在 LOCKED_F transition 支内、而那支仅当 LOCKED_F 真作 input 才被求值。⇒ 对抗 reveal 可**不含 LOCKED_F**: 花 LOCKED_R+C 造真 O 拿反应方本金, 留首动方 LOCKED_F 不动 → 后续 giveup/refund 仍可用 → 双拿。散文"由 §4-d 反向要求"与实际 require 列表不符。修: **拿 LOCKED_R 的那条 authority 支本身**须同笔 require 精确 LOCKED_F input + 精确 O_AUTHORIZED 后继身份 + 精确 value 转入 + 恰一后继无并行 skim。+ 交易级负测(有效 A+s、真 C/O 路径但省 LOCKED_F → LOCKED_R-paying tx 必拒)。
- 🔴 **MUST-FIX 2（O 侧反向焊 stale）**: §4-e O 支1 仍 `OpInputCovenantId(LOCKED_F_idx)==locked_f_cid`（旧 Shape-A target）+ 付 LOCKED_F_value。但 Shape B 下 reveal 已消费 LOCKED_F 换成 O_AUTHORIZED、旧 UTXO 不存在 ⇒ happy path 自相矛盾（除非 locked_f_cid 显式=oauth_cid, 但 v0.9 引入 oauth_cid 为不同身份且 §4-c 用 OAUTH_value ⇒ 等价没指定、不该推断）。修: O 支1 反向焊 target 改**活的 O_AUTHORIZED**（oauth_cid）: `花 O ⟺ 同笔花精确 O_AUTHORIZED 付精确 baked 反应方`。+ 对称负测(真 O 无 O_AUTHORIZED input→拒 / 真 O 带 stale LOCKED_F-形 input→拒 / O_AUTHORIZED claim 无真 O→拒 / 错 recipient/value→拒)。
- 🔴 **stale 文本扫除**: 矩阵/§2.5/§1.5 仍有 Shape-A 期"花 O ⟺ 领 LOCKED_F"、LOCKED_F claim/refund、旧静态 ordering ⇒ Shape B 下 branch set 变了（LOCKED_F 现 transition/giveup 支、O_AUTHORIZED 现 claim/recovery 支），"花 O ⟺ 领 O_AUTHORIZED"。矩阵须据**当前实际 branch set** 重建后才能作闭合证据。
- 🔨 **判据（我 grep 漏, 认）**: 验证一个【拓扑迁移】= 检查【旧引用是否都更新/一致】, 不是只检查【新代码加了】。我 v0.9 grep 只核 O_AUTHORIZED transition/recovery 加了、没核 LOCKED_R 支强不强制它 + O 侧焊 target 是新是旧 ⇒ 漏两处 stale。我 MSG-265 直觉问对了 binding 完整性、但没自己 grep 确认就说"Shape B 正确"。= [[feedback-verify-fix-does-not-reproduce-same-bug-elsewhere]] + incomplete-migration（[[feedback-fix-break-cycle-is-incomplete-migration-solve-with-mechanism]]）: 拓扑变必须扫全构造每处旧引用。
- 派: J1 v1.0（LOCKED_R 支强制 LOCKED_F+O_AUTHORIZED 同笔 + O 侧焊 target 改 oauth_cid + 扫 stale + 负测, 先裁可建）· J2 矩阵据 Shape B 实际 branch set 重建 · NWT 红队。（Bettor 频道因 node RPC 降级暂瘫, 经 git bridge 路由 Codex MSG-265; J1 从 bridge 独立接力。）

### §17.19 验收方法论【两轴矩阵】框架（J2 综合·2026-08-21·拓扑变更必出两表）
Shape B 新增支 `Fb`(giveup)带出两个洞、被两人分别逮（J2 逮 pair 排序缺口、NWT 逮 property 缺 `OpCovOutputCount==0`）⇒ 逼出验收方法论的一条通则:**每次拓扑变更, 除重建 pair 矩阵外, 另出一张 branch×invariant 合规表。**
- **轴① `branch × branch`（pairwise 独立性矩阵）**: 逮**交互缝**（两支能否各自独立发生、一方吃亏 → WELDED/EXCL/INDEP-SAFE/COUPLED）。**照不到单支自身是否满足既有不变量。**
- **轴② `branch × invariant`（合规表, J2 v0.11+ 新增）**: 逐支 × 每条已确立不变量（gate③ terminal 支禁产带 cov_id 续链 output=`OpCovOutputCount==0` / 单位同 DAA 域 / 无 `current_daa<X` 上界 / 下界须有排序出处）。逮 **per-branch 遗漏**（如 `Fb` 缺 `==0`——pairwise 结构性照不到, 因它是单支属性非支对关系）。
- 🔨 **判据（J2, 采纳）**: **新增一支时, 拿【全部已确立不变量】逐条过, 不是只想到哪条查哪条**——"脑子里当时什么问题, 就只查到什么问题"。= [[feedback-enumerate-by-effect-not-by-keyword-and-analogy-hides-unchecked-differences]] 应用到不变量合规。
- 🔨 **防呆理由须硬（NWT 第三路, J2 强调）**: `Fb` 缺 `==0` 目前推不出可兑现坏处（R1 要 `O_AUTHORIZED` 输出足额承接 `LOCKED_F_value`、钱已被 giveup 拿走）——但**该堵的理由是【纪律统一】非【当前无害】**: 漏写终止条款=静默侧门, 同形状支享同纪律, 不因"这次算出暂无坏处"破例。= [[reference-a-self-consistent-require-can-look-like-the-binding-and-outlive-it]] 族（该写没写, 靠别处约束偶然挡住≠安全）。
- 关联 [[reference-coverage-artifact-completeness-bounded-by-enumeration-basis-derive-from-allowed-not-intended]]（枚举基）+ [[reference-mutation-testing-has-three-layers-statement-transaction-configuration]]（变异三层）: 三者合为本卡的完整验收框架（枚举基对 + 两轴覆盖 + 三层变异）。
