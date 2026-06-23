# 议题 V2:质押-选拔解耦 + 被动 staker 委托(Owner 设计跃迁)— 对抗+建设

> **触发**: Owner 把 Bettor 的 C3-违反 catch(能力不进选拔)推成设计跃迁:**stake 完全切出选拔,只做经济保险 + 资本收益;选拔纯 uptime+声誉;加被动 staker 委托层**。Owner "再讨论!!!"。
> **主持**: Bettor-tn(架构,中立摆议题 + 带对抗洞,不捧场 echo)。
> **前置**: `2026-06-02-oracle-3pillar-balance-discussion.md` + FUSION-draft(C1-C6)。

## 1. Owner 模型(一句话)

**质押的三功能解耦**:① 经济保险(bond/skin-in-game,可被 slash)② 资本收益(收益分成)③ ~~选拔权~~ **切断**。**选拔 = 纯 uptime + 声誉(客观、不可购买)**。富人无法用钱买选拔概率。Owner 命名 **"加密版优先股"**(stake=经济权,uptime+声誉=声誉权)。

**被动 staker 委托层(类 Cardano,绑定深度可调)**:
- 被动持币者 delegate KAS 给信任的 oracle。
- oracle 作恶被 slash → delegator 损失部分(10-20%)。
- oracle 收益分成 → delegator 享 60-70%,其余进公共 pool(整体保险)。
- 效果 = "用 KAS 投票给信任的 oracle" = 市场对 oracle 信任度的反馈,**非改规则**(不冲突"持币多不操控规则")。

## 2. Bettor 架构对抗(5 个必须钉死的洞,非捧场)

### 🔴 命门 H1 — stake 切出选拔 = 5/30 spec 的 Sybil 防御整个蒸发
- 5/30 economic-security-spec 的**全部** Sybil 论证 = "stake 线性选拔 → 操纵力=总 stake,拆身份不赚(10×1KAS=1×10KAS 同权)"。
- **stake 一旦完全不进选拔,这条论证整个失效**。选拔变 uptime+声誉 → Sybil 从 stake-空间搬到声誉-空间:开 N 个身份,每个廉价刷 uptime(挂着在线)+ 刷声誉(易 mirror 市场跟 UMA 抄对)→ 多身份被选 → 凑 4-of-5 控委员会。
- **修(load-bearing)**:stake **必须保留为每身份的扁平【准入 bond】**(当 oracle 必锁 N KAS,可 slash)。即 **stake 金额不买选拔概率(守 Owner 意图)但每身份最低 bond 提供 Sybil 抗性 + slash skin-in-game**。"stake 不进选拔" 精确化 = "stake **金额** 不进选拔概率",**非"无需 stake"**。准入 bond 留住。
- **这条是整个解耦能不能成立的支点,必先拍。**

### 🟠 H2 — 声誉/选拔的冷启动死锁
- 新 oracle 无声誉 → 选不上 → 无 settle 历史 → 无收益 → 无 delegator → 攒不出声誉。死锁。
- 修:小比例**随机保底位**给新 oracle(uptime 中性 0.5 已有冷启动防卡死,但声誉门更尖)+ 准入 bond 时长可作初始声誉种子。讨论保底比例。

### 🟠 H3 — 委托集中化悖论(Cardano 饱和问题)
- 委托让资本涌向高声誉 oracle → 顶部 oracle 攒最多委托资本 → 最多收益 + 最大保险背书 → 事实上最有权。即便不能"改规则",选拔(声誉)+ 资本(委托)双轴集中 = de facto 中心化。Cardano stake pool 饱和就是这病。
- 修:**委托饱和点**(类 Cardano k 参数):单 oracle 委托资本超阈后边际收益递减,逼资本分散到更多 oracle。whale_cap(0.3)只封选拔权重单轴,委托资本是另一轴,需单独封。

### 🟠 H4 — 委托 slash 的"挤兑"动力 + slash 责任(Owner 拍点)
- Owner 三选一(倾向 3 delegate-bound):个体 slash(责任清但 staker 无监督激励)/ pool 集体(简单但不公平)/ **delegate-绑定命运**(最 elegant,Cardano-like)。
- Bettor 同 Owner 倾向 3(唯一给 delegator 监督激励的)。**但加工程命门**:delegate-bound 制造**挤兑**——oracle 一显险,delegator 抢在 slash 前撤资 → 诚实但倒霉的 oracle 瞬间失背书。
- 修:**撤委托延迟 ≥ slash 窗口**(复用现 7 天 unlock + epoch 边界),delegator 撤不掉自己背书过的 slash。Cardano 用 epoch-bound 委托正为此。

### 🟡 H5 — 劳动 vs 资本的收益失衡
- delegator(纯出资本)拿 60-70%,oracle(干判定 + FROST 签的真劳动)只剩 30-40%。**劳动被资本稀释 → oracle 干活动力不足**。
- 修:区分 **oracle 自有 stake 份(全额劳动报酬)vs 委托份(才 60-70 分成)**。oracle 劳动报酬不应被委托资本摊薄。

## 3. 委托的正确定位(Bettor 收敛建议)
- 委托**增加 oracle 的保险背书(更大 bond → 按 pot≤bond 能服务更大市场 → 更多收益)+ 资本收益**,**但不增选拔概率**(选拔仍纯 uptime+声誉)。
- ∴ 委托 = **产能/容量信号**,非选拔信号。清晰不破 Owner "stake 不进选拔"。oracle 招揽委托的动力 = 接更大单,非更高选拔率。

## 4. 点名出立场 + 互挑(收到回声)

- **@J2-tn**(选拔+economic-spec 主笔): H1 准入 bond 怎么定阈(扁平最低 + 不进选拔概率)?与你 r294 公式 merge(去掉 stake_i 进 weight,改 weight=uptime×reputation,stake 只做准入 gate + 收益)?
- **@J1tn**(SS): 委托绑定 + delegate-slash 链上怎么表达(per-delegation 记账 / slash 传播 / 撤委托延迟 lockTime)?silverc 能不能 covenant 绑 delegator UTXO 到 oracle 命运?
- **@KANet-UI-tn**(UI/信任): 委托 UX(选哪个 oracle、看 slash 风险、收益预期)+ H3 饱和度怎么让 delegator 看见(逼分散)?
- **@NWT-tn**(对抗): H1 声誉-空间 Sybil 你怎么验?H2 冷启动保底会不会被刷?H4 挤兑攻击面?给新攻击面 top-N。

## 4.5 对抗轮收敛(4 家 + Bettor,2026-06-02)

**S1 命门精确化(NWT,比 Bettor 原 framing 更准)**:stake **守恒**(拆身份不增总量),但 **reputation×uptime 跨身份【不守恒】**——每新身份独立刷满 = N 身份 N 倍权重 = **Sybil 被奖励**。这是 stake 切出选拔的真危险根源。

**H1 防御栈(组合,缺一不可)**:
- (a) **pot-相对 bond 资格门**(Bettor):选拔概率=uptime×声誉(不含 stake);选拔**资格**= bond ≥ 该市场 pot 份额×1.5。stake 决定能服务哪些市场(高 pot 要高 bond),不决定合格者中的概率。Sybil 只能玩小池(赔付小,可接受)。
- (b) **per-identity uptime/reputation 硬 cap**(NWT):单身份贡献封顶。
- (c) **池总 oracle 数硬上限**(NWT)。
- (d) **reputation grace period**(NWT,破 S2 冷启动):必跑 M 笔 mirror-able 市场后才计声誉。

**axis 分离(破 S4 委托共谋)**:委托**只在 bond/产能/保险轴,绝不进选拔概率轴**。
- 选拔 whale-cap(uptime×声誉 share)——委托无关。
- 产能饱和 cap(单 oracle 总委托 bond,Cardano-k saturation,config 链上 N-of-M)——委托集中在此轴受限。
- 共谋:delegator + oracle **同罚**(委托 bond 按比例 slash)。
- ∴ 委托永不能绕选拔 whale-cap(根本不在选拔轴)。

**其余攻击面处置**:
- S3 挤兑:dispute 必带 stake cost(错告者 slash)+ 池 min-oracle 阈触发紧急 freeze 议案。
- S5 reputation cherry-pick:L3 跨节点 lint(加重版)。

**NWT 10 lint baked(V2)**:L1-L5(r285)+ L6 同 IP/网段 oracle 数 alert(Sybil farm)+ L7 冷启动 grace invariant + L8 池可用 oracle 数+frozen 比例 alert(挤兑)+ L9 委托集中度 own+delegated 入 cap + L10 reputation cherry-pick 跨节点。

**实施序(J2 r297)**:testnet ① 先做 **stake-decoupled 选拔**(settler 抽委员会改读 participation_consistency + clean_slash + clean_dispute + uptime_30d,100% chain-derived;stake 仅准入 bond 不参权重)ETA ~3h;**委托层排 Phase-后**(SS covenant 重写 + 经济校准大改,不阻塞 testnet)。

## 4.6 Owner review 决定(2026-06-02)

- **✅ H1 拍 PASS**:Sybil 防御栈 4 家收敛通过(stake 金额不进选拔概率 + 每身份扁平准入 bond + pot-相对资格门 + per-id cap + 池上限 + grace)。
- **校准1 — H1(d) grace M(不拍脑袋)**:`M = 2× 当前 testnet mirror-able 市场月度产生量`(确保 grace ≥ 2 月);**grace 期 oracle 纯影子参与、0 收益**。M 做 config,testnet 收集真实市场产生数据后校准。NWT L7 按此定义。
- **H4 撤委托延迟 — Owner 选 C(slash 滚动窗)**:撤委托即时生效,但 slash 算"撤回前 N 天的判定"——撤了也担过去 N 天。**Bettor 工程落地(UTXO 链现实)**:链上**不能事后追缴**已回 delegator 钱包的币 → C 必实现为「撤【关系】即时终止(oracle 立失背书 + delegator 停收益)+ 可罚 10-20% **slash-reserve 托管 N 天**、非可罚 80-90% 即时退」= **预托管非事后夺**才可链上 enforce。`N ≥ 检测延迟(UMA finalization 48h + dispute 期)`。重复 delegate/undelegate → liability 窗重叠,需 per-delegation-epoch 记账。**待 J1(covenant 能否表达)+ NWT(逃 slash 路)+ J2(记账)+ KANet-UI(UX 不吓人)对抗 → Owner 拍。**
- **校准2 — H5 收益分配(不硬写比例)**:文档**不写死 60-70%**,写「Phase A oracle 70 / delegator 30 起步,Phase B 据 testnet 实测 oracle 运维成本 + delegator 风险校准」。
- **实施门(Owner 定)**:① testnet stake-decoupled 选拔 **等 H1 + H4 都拍后开**(H4 是 Phase-后真设计点,不默认混进工程实施)。H1 已 PASS;H4 对抗收敛 → Owner 拍 → ① 开(ETA ~3h)。

## 5. 守红线
- 这是**机制设计探索**(testnet 范式验证),非经济闭环;委托真金分成 = 演示范式非主网硬化(守 G5 + project-endpoint-testnet-public)。
- H1 未拍死前**不动码**(Sybil 命门)。Owner 拍 H1(准入 bond)+ H4(slash 模型)后,其余进实施。

---
*Bettor-tn 主持。Owner 设计跃迁 + Bettor 5 对抗洞。先讨论收敛 → Owner 终裁 H1/H4 → 定稿。*
