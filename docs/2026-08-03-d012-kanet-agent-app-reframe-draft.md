# D-012 草案 — KANet 总纲:Agent 应用与角色经济;Oracle Skill 抽象立项;Broker 开放入口

> **Status**: DRAFT — 对抗轮 #c9pzp8 已收敛(四镜头全回),**待 Owner 终裁**。终裁通过后本文要点并入 `docs/DECISIONS.md` D-012 条目,本文转 ARCHIVED(过程档案)。
> 强度纪律:全文区分【目标不变量】与【现状描述】,混写=本轮对抗抓出的头号病(NWT finding①②),不许复发。

**日期**:2026-08-03 · **提出**:Owner(终端亲述)· **对抗**:J1/J2/KANet-UI/NWT 四镜头互不重叠 · **记账**:Bettor
**过程留痕**:COORD-LEDGER (121)(125) · 频道 #c9pzp8(开题)/#cayw15(Bettor 认领 A/B 拆台)· NWT 镜头 `1b9a3ddb` · KANet-UI 镜头(频道 7 块,21:20)· J1/J2 镜头(频道,20:48)

---

## 一、总纲(Owner 提出,对抗轮修正后版本)

> **KANet 是一个正在运行的 Agent 应用:Broker 找到并组织需求,Maker 提供价值,Oracle Skill 把结果转成可验证条件,Kaspa 按事前规则结算和分账。Prediction 与 Exchange 是同一骨架(被锁价值 → 结算条件 → 链上结果)的两个已运行场景。下一步不是与别的应用拼技术,而是把现有能力模块化,让更多 Agent 能进来工作。**

- (115) 的框架错误由本条纠正:KANet 不是"向外部应用出售的托管/原子交换技术";外部接入的正确问法是**"愿意在 KANet 里扮演什么经济角色"**(Broker / Maker / Oracle Adapter / Verifier / 界面),不是"为什么购买我们的技术"。
- **范围限定(NWT finding④)**:上述角色清单是**外部接入者的可选角色**,不是系统内一切经济行为的穷尽分类(内部反例:market-seeder 自造需求、自供流动性,横跨两角色且无外部对手方)。

## 二、"条件放钱"的三段作用域(本轮最重修正——原两段版被 NWT finding② 打掉,Bettor 认领)

"事实进入 → 条件成立 → 链上放钱"这个骨架**存在,但按子集论,不按产品线论**:

| 子集 | 现状 | 证据 |
|---|---|---|
| ① v0.7 ZK-native | **成立** | ZK settle 真落链(D-001,NWT 独立核实)+ claim merkle-binding + PB-S8 拜占庭自检(bshard 路) |
| ② v0.5/v0.6 committee-sig(**当前 live 主力**) | **不享受①的背书** | oracle 私钥亲自签放钱 TX(sign_input_for_settle,relay.mjs:711,J1);签名前零前提复核——不重跑共识、不比对自己投过的票、不核 evidence(handlePoolOracleTxSignReq,J2);PB-S8 牙已造好但 isBshard 即 skip,此路未装(teeth-built-not-armed 又一例) |
| ③ Exchange | **不成立,且比"弱"更深** | 三份 escrow checkSig 9/4/1、hash 条件 0/0/0(带阴性对照,是选择非能力);跨链非原子;**争议裁决角色结构性空缺**——resolve 端点 concede-only(exchange.js:747-796),双方不认输即无任何路径可达终态,连人工仲裁都没有(NWT finding③) |

- **"没有人拥有临时裁量权" = 目标不变量,非现状**(批注 B,对抗轮站住未改):子集②上委员+driver 今天实际持有裁量等效权力。达成判据 = 自治 daemon 真落 + 红队过,才准改口(诚实口径铁律)。
- oracle 今天在子集②**四权合一**(J1 五点,file:line 全):报告+解释合一 / 私钥签放钱 / 自有 bond 在险 / 从池收 reward——Oracle Skill 边界冻结的具体切割对象。

## 三、Broker:目标与现状分开写(NWT finding① + KANet-UI 六道墙)

**目标不变量**:Broker 不保管资金 / 不裁结果 / 身份=Kaspa 地址非 TG DM / 佣金链上直分。

**现状(2026-08-03,KANet-UI 逐条 file:line,两条最重已复核)**:
1. 无对外网络路径可达任何注册端点(console 绑 127.0.0.1;唯一网关 fail-closed,onboard 路由因身份劫持洞被 P0 主动移出白名单,注释写明"ownership 验证实现并测试前不得恢复")。
2. 地址所有权零验证(onboard 只做正则,全仓无签名挑战)——"身份=Kaspa 地址"今天是文案不是代码。
3. broker_onboarding 表与真正决定佣金的机制(pool_markets.broker_relay_id ← relay_nodes)**零桥接**。
4. 唯一接得到佣金机制的路(relay-role 注册)要求交出助记词/裸私钥给 console 托管——**现存唯一 Broker 实例就是我们自己的托管钱包**,与目标直接矛盾。
5. retail-DEX 执行进程单租户(单例+环境变量,结构上无多 broker 能力)。
6. 种子盘/世界杯盘常态量默认写死 broker-1——新 broker 注册成功也分不到这部分量。
- 口径注意:broker v1/v2/v3 哪个活随部署 flag 漂移(默认全关回落 v1)——"外人卡在哪步"的答案依赖部署配置,引用需带配置态。
- **实的那半**:computeMarketBrokerFee 从 settle tx 链上 outputs 读、零人工审批(fw9kk 已实证)——但它在全部六道墙之后,今天没有外人能走到它生效的那步。

## 四、执行序(Owner 已认可方向与流程;本节各项由 Bettor 排班驱动)

1. **Oracle Skill 接口与权限边界冻结(设计先行,第一优先)**:三权分立烤进接口签名——Oracle 报告事实 / 规则解释事实 / Covenant 放钱,Oracle 结构上够不到资金路径。切割清单=J1 五点的②③④优先,①需新造"规则解释"层。主笔=J1(oracle 域)× 审=J2(settler 域)→ NWT 红队 → 冻结。
   - **前置补课卡(冻结前必补)**:J1 标未核的 v0.7 实况——closezk-v2 到底纯 covenant 还是仍有委员签(J1 认领)。
2. **候选卡登记(待认领,非阻塞,排期 Bettor)**:
   - **PB-S8 搬运**进 handlePoolOracleTxSignReq(J2 判"搬运工作量非设计工作量")——子集② live 主力的止血,与 r402 同形状(授权≠前提)。
   - **Broker 第一道墙**:地址所有权签名挑战(P0 注释写明的恢复前置)——Broker 开放入口的第一块砖。
3. **Exchange 裁决角色**:不立即动工;作为 Oracle Skill 接口冻结后的**第一个复用验证对象**(起点=从零造裁决角色,非接现成接口)。Codex 建议的 fair-exchange 设计卡在此处使用(参与方/状态机/原子性边界/隐私/超时/与纯 HTTP/adaptor 方案对比)。
4. **EK H0 纪律保留**:Prediction+Exchange 有共同结构 ≠ Economic Kernel 已证;Skill 接口冻结后,须用**第三个异质应用**验证低 Diff 复用才可升格(Exchange 只是第二应用)。
5. 与范围直令关系:本条不扩范围——Oracle Skill 抽象 + Broker 开放入口**就是**"模块化+外部程序接入"主线的本体。

## 五、supersedes / 文档处置(终裁通过后执行)

- `docs/2026-07-31-why-integrate-kanet-adversarial-conclusion.md`(115):状态头改 `SUPERSEDED-by D-012`(**叙事层**);§二判别式、§四实核事实(escrow 签名实测/短路注记)等**经核实条目仍有效,引用需带作用域**,状态头逐条列存活项。
- Codex review(RESPONSE-20260731-UNSYNCED-…):不推翻;三条打回转为 Oracle Skill 边界设计约束;fair-exchange 设计卡重定位到 §四-3。
- (115) §7.1 旧问题("无签字 escrow 立不立格")被本条 §四-1/3 吸收,不再单独待拍。

---
*对抗轮方法记录:四镜头互不重叠、禁复述前提;三镜头带自我更正(NWT 更正 dispute 猜测为更弱、KANet-UI 修正 08-01 口径、Bettor 认领 A/B 拆台);Owner 认可方案不豁免批注被打——本轮实际打掉了 Bettor 原版批注 A 的结构。*

---
---

# 附:拟并入 `docs/DECISIONS.md` 的正式条目原文(Owner 审查对象 = 本节逐字,非任何转述)

> Owner 2026-08-03 审查意见四点已并入:①Track 边界写死(最硬约束,新增 §0)②H0 量级诚实标注 + 可证伪判据(§4)③r402/PB-S8-1 证据层级分标(§5)④拍板对象=本节原文。

### D-012 KANet 总纲 reframe — Agent 应用与角色经济;Oracle Skill 抽象立项;Broker 开放入口属 Track B (2026-08-03 · Owner 提出 · 四镜头对抗轮收敛 · Owner 终裁)

#### §0 🔴 Track 边界(本条最硬约束,先于一切正文;违反即本条被误用)
- 本条描述的**角色开放(Broker/Maker/Oracle Adapter/Verifier/界面)是协议层承诺 = Track B**:testnet-only、MIT 开源、**任何第三方可自行 fork 部署并自担**。
- **Owner 实例(Track A)不因本条获得任何开放外部用户的授权。** Track A 七铁律**原样有效、不被本条放松任何一条**:`0 外部用户 / 0 商业化 / 0 fee / 0 token / 0 数据外晒 / 0 mainnet operational claim / 0 第三方 host`(权威源 KB `00-position/carrier-thesis.md`,`northstar-open-collaboration-protocol.md:42` 镜像)。
- **⇒ §3 "六道墙"不是一份待拆清单。** 在 Track A 语境下其中数道**正是该留的墙**(尤其"无对外网络路径可达注册端点"与"onboard 路由已被 P0 移出白名单"两道——它们今天承担着 `0 外部用户` 的实际执行)。拆墙**只发生在 Track B 的协议实现与 fork 部署者语境**;任何针对 Owner 实例开放外部注册的动作,**需要独立于本条的 Owner 授权,本条不构成依据**。
- 判据(供未来引用者自检):**引用 D-012 支持"让外部人来注册"之前,先回答"这发生在哪条 Track"。答不出 = 不得据本条行动。**

#### §1 总纲
> KANet 是一个正在运行的 Agent 应用:**Broker 找到并组织需求,Maker 提供价值,Oracle Skill 把结果转成可验证条件,Kaspa 按事前规则结算和分账。** Prediction 与 Exchange 是同一骨架(被锁价值 → 结算条件 → 链上结果)的两个已运行场景。下一步不是与别的应用拼技术,而是把现有能力模块化。
- 取代 (115) 的卖方框架:外部接入的正确问法是"**愿意扮演什么经济角色**",不是"为什么购买我们的技术"。
- **范围限定**:角色清单是**外部接入者的可选角色**,非系统内经济行为穷尽分类(内部反例:market-seeder 自造需求自供流动性)。

#### §2 "条件放钱"的三段作用域(按子集论,不按产品线论)
| 子集 | 现状 | 依据 |
|---|---|---|
| ① v0.7 ZK-native | **成立,且三权已天然分离** | ZK settle 落链(D-001)+ claim merkle-binding;**放款路径零签名**——`CloseZkV2.sil` 全文零 checkSig,claim/escape_claim 靠 merkle proof + nullifier,payout 树由 `zk_close` 的 groth16 ZK 门(gateTmplHash 烤死)写入(J1 2026-08-03 读码) |
| ② v0.5/v0.6 committee-sig(**当前 live 主力**) | **不享受①的背书** | oracle 私钥亲签放钱 TX(`relay.mjs:711` · **作用域:仅 v0.5/v0.6,见下方 §2-bis**);签名前零前提复核(`handlePoolOracleTxSignReq`);PB-S8 牙已造未装此路 |
| ③ Exchange | **不成立,且争议裁决角色结构性空缺** | escrow checkSig 9/4/1、hash 0/0/0(带阴性对照);跨链非原子;resolve = concede-only(`exchange.js:747-796`),双方不认输即无路径可达终态 |
- **"没有人拥有临时裁量权" = 目标不变量,非现状**。达成判据 = 自治 daemon 真落 + 红队过,才准改口。
- oracle 今天在子集②**四权合一**(报告+解释合一 / 私钥签放钱 / 自有 bond 在险 / 从池收 reward)= Oracle Skill 边界冻结的切割对象。

##### §2-bis v0.7 的三权对照(J1 2026-08-03 补课卡结论 · 前置卡已闭 · 含其自纠作用域)
| 权 | v0.7 实现 | 签名 |
|---|---|---|
| Oracle **报告事实**(winner) | `PayoutShardV2.close_attest`(:99-105 `require(validSigs>=4)`) | **4-of-5 委员签在此**;该笔 attest TX `:180 require(tx.outputs[selfOutIdx].value == consolidated_pool)` = **守恒、不动钱**,closed 0→1 只记事实 |
| **规则解释事实**(winner+bets → payout 树) | `CloseZkV2.zk_close` 的 groth16 ZK 证 | **无签** |
| **Covenant 放钱**(payout 树 → winner P2PK) | `CloseZkV2.claim` 纯 covenant merkle + nullifier | **无签** |
- ⇒ **v0.7 里委员签名权已精确收窄到"事实证言"这一权**,与放钱、与规则解释分离干净——**这正是 §6-1 要冻结的边界的已存在实例**。live-wired 非 design-only(`bshard-close-voter.js` W2 自治-enforce 签 `close_attest_v2`;`p2sh.mjs:1969` 组装广播;pxvml 2026-07-08 实战撞过门①)。
- 🔴 **作用域自纠(J1 主动)**:他此前"oracle 私钥亲自签放钱 TX"一句**对 v0.5/v0.6 成立,对 v0.7 不成立**——v0.7 走 `sign_input_for_settle` 的那笔是 `close_attest_v2`(attest 类、守恒、不放钱),真正放钱的 `claim` 是纯 covenant。**在 ZK-native 路上"委员签放钱"这个说法不成立,委员只签 winner。**

#### §3 Broker:目标与现状分写(现状全部属 Track A 实况陈述)
- **目标不变量(Track B)**:不保管资金 / 不裁结果 / 身份=Kaspa 地址 / 佣金链上直分。
- **现状(2026-08-03 实读)**:①无对外网络路径可达注册端点(console 绑 127.0.0.1;网关 fail-closed;onboard 路由因身份劫持洞被 P0 主动移出白名单)②地址所有权零验证(全仓无签名挑战)⇒"身份=Kaspa 地址"今天是文案不是代码 ③`broker_onboarding` 与决定佣金的 `pool_markets.broker_relay_id` 零桥接 ④唯一接得到佣金机制的路要求交出助记词/裸私钥托管——**现存唯一 Broker 实例即 Owner 自己的托管钱包** ⑤retail-DEX 执行进程单租户 ⑥种子盘/世界杯盘默认写死 broker-1。
- 口径:broker v1/v2/v3 哪个活随部署 flag 漂移,引用需带配置态。
- **实的那半**:`computeMarketBrokerFee` 从 settle tx 链上 outputs 读、零人工审批(fw9kk 已实证)——但位于全部六道墙之后。

#### §4 🔴 量级诚实标注(H0,防"转向问法"被读成"需求已证明")
- **今天的角色生态实例数:Broker = 1(Owner 自己的托管钱包);外部角色 = 0;外部 Broker 注册数 = 0。**
- "WooCommerce 插件可以来当 Broker" 是**未检验假设(H0),不是已发生事件**。换问法消掉的是 (115) 的**问法**,消不掉它核实过的**事实**。
- **可证伪判据(预注册,归属 Track B)**:在 Track B 协议实现里,当①地址所有权签名挑战落地且②onboard 路由在某 fork 部署者实例上可达之后的 90 天窗口内,**出现 ≥1 个非 Owner 控制的 Broker 完成注册并取得至少一笔链上可验佣金** ⇒ H0 LAND;窗口内为 0 ⇒ H0 未被支持,需重新审视本条 §1 的需求侧假设。**本条不为该 KPI 背书,只登记它可被证伪。**
- 同族纪律:Prediction+Exchange 有共同结构 ≠ Economic Kernel 已证;Skill 接口冻结后须用**第三个异质应用**验证低 Diff 复用才可升格。

#### §5 支撑事实的证据层级(NO TX NO TRUTH)
| 事实 | 层级 | 说明 |
|---|---|---|
| r402(producer 退款前复核)双机部署 | **[DEPLOYED-VERIFIED]** | 两机装载 commit 实读(`d23539d0` 后代);非链上行为证据 |
| r402 的保护**效果** | **[SUSPECTED · 未实弹]** | 部署至今无 cross-node 冲突流量触发;rejected_v1 路径无自动化覆盖(设计已知盲区) |
| PB-S8-1(委员签名前投票自检)部署 | **[DEPLOYED-VERIFIED]** | 装载 commit 实读 |
| PB-S8-1 的保护**效果** | **[SUSPECTED · 未实弹]** | 现 regression 为 SQL fixture 重放,**未执行 handler**(Codex 指出);无 sign_req 实况流量 |
| ①v0.7 ZK-native 条件放钱成立 | **[CONFIRMED · 链上]** | ZK settle 交易 landed(D-001,NWT 独立核实) |
| ②③ 各条现状 | **[CONFIRMED · 源码实读]** | 均带 file:line,四镜头交叉核 |
- 口径要求:本条正文任何"已修/已补"的表述**一律带上表中层级**;未实弹的保护**不得**被表述为"已生效"。

#### §6 执行序(Bettor 排班驱动;各项不改变 §0 边界)
1. **Oracle Skill 接口与权限边界冻结**(设计先行,第一优先):三权分立烤进接口签名——Oracle 报告事实 / 规则解释事实 / Covenant 放钱,Oracle 结构上够不到资金路径。主笔 J1 × 审 J2 → NWT 红队 → 冻结。
   - **前置补课卡:✅ 已闭(J1 2026-08-03,见 §2-bis)。** 结论对本项的意义:**v0.7 已是三权分离的既存实例**,"Covenant 放钱"那一格天然满足、不需新造层;**需要新造的是"规则解释"层**,且只对子集②(committee-sig)——即冻结工作的对象是把 §2-bis 那个已存在的形状,**推广成接口契约并覆盖子集②**,不是从零发明。
2. **在册候选卡(非阻塞,均不涉 §0 开放动作)**:PB-S8-2(payout 字节绑定,Codex 定性"live 放钱路径剩下的 authorization-to-bytes 绑定",优先级上调)· 投票查询规范键查(与计票原子改)· PB-S8-1 真 handler 回归 · consumer 侧自知之明闸 · 告警 episode 语义 · 跨节点消息发送者绑定。
3. **Exchange 裁决角色**:作为 Oracle Skill 接口冻结后的**第一个复用验证对象**(起点=从零造裁决角色,非接现成接口);Codex 建议的 fair-exchange 设计卡在此处使用。
4. **Broker 线**:仅在 Track B 语境推进(地址所有权签名挑战为第一块砖);**Track A 实例的对外开放不在本条授权范围内**(见 §0)。

#### §7 supersedes / 文档处置
- `docs/2026-07-31-why-integrate-kanet-adversarial-conclusion.md`(115):状态头改 `SUPERSEDED-by D-012`(**叙事层**);§二判别式与 §四实核事实等**经核实条目仍有效,引用需带作用域**,状态头逐条列存活项。
- Codex review(`RESPONSE-20260731-UNSYNCED-…`):不推翻;三条打回转为 Oracle Skill 边界设计约束;fair-exchange 设计卡重定位到 §6-3。
- (115) §7.1("无签字 escrow 立不立格")被 §6-1/3 吸收,不再单独待拍。
