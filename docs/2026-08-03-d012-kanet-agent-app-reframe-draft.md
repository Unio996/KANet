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
