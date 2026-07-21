# 模拟真实用户流量·持续打磨框架稿 v0.1(设计先行①)

> **Status**: CURRENT(框架稿·待 NWT 红队;红队过后拆实现卡派工,落码前不动代码)
> **作者**: Bettor(架构师帽)· 2026-07-17 · 依据: Owner 终端直令 7/17("你们完全可以继续完善并使用我们测试系统,模拟真实用户使用"——纠正'真实反馈只能等运营引流'口径)+ 测试网成果口径钦定(成果=①端到端真跑通 ②狠压出更多 bug;主动炸系统逼 bug,非守安全)。
> **资产依据**(2026-07-17 只读盘点): test-framework personas 8 人格已在(cn_newbie/cn_real_human/fumbler/liar/malicious/mind_changer/en_neat/cn_newbie_sell);cases 六域已在(broker 域含 human_buy_full_journey 完整旅程先例);**缺口=无 support/feedback 域+无跨域持续用户旅程 soak**。反馈通道生产链 7/12 已 landed(卡A/卡B/classifier fail-closed 78efe0ef+owner-bot Direction C poller 现网 ON)。

## §0 一句话

用既有 personas 驱动「下注→守盘→结算→/mybets 核对→/support 提问→升级→回流」的完整用户旅程,以可重复、可 ramp 的方式持续压现网,把"真实反馈打磨迭代"从等真人变成测试系统的常驻产出。

## §1 复用资产(不重造)

| 件 | 位置 | 用法 |
|---|---|---|
| personas 8 人格 | test-framework/personas/ | 原样复用;malicious/liar 天然覆盖社工+资金话术负例 |
| 旅程先例 | cases/broker/human_buy_full_journey.test.mjs | 结构模板,预测域照抄形状 |
| 7/12 探针套 | KANet-UI 手上(资金动作请求负例+七条社工话术) | **固化为 cases/support/ 首批 regression**,一次复测=永久守卫 |
| 跑法 | scripts/test.mjs --domain=... | 不新造 runner,soak=按节奏重复调既有入口 |

## §2 净新造最小集合

1. **cases/support/ 新域**(首批=7/12 探针固化):工单开立/升级判定 fail-closed(post-78efe0ef 行为)/owner-bot 转发含硬前缀/回复回流四类 case,personas 驱动。
2. **cases/predictions/journey/ 用户旅程**:persona 从 TG 入口完整走一遍市场生命周期,末端断言 /mybets 显示与链上事实一致(H2 修后此处天然成为其 regression 载体)。
3. **soak 节奏卡**(非代码):每日/每重启窗后跑哪些域、ramp 纪律(先单 persona 单旅程→多 persona 并发,分批上量铁律)、产出物=bug 卡+反馈工单样本入频道。

## §3 硬边界(NWT 红队重点)

- **测试流量必须可辨识**:所有模拟用户消息带既有探针标记约定(如 7/12 探针的显式前缀),工单/事件可过滤,禁污染真实用户统计;Owner 收到的升级转发若来自模拟流量,前缀必须显式声明(身份事件直接教训族)。
- **钱路**:模拟下注花测试币走正常审批口径(Bettor 决定+记账,币充足不过度节省);禁绕过任何生产闸;NO TX NO STATE CHANGE 铁律不因测试身份放松。
- **限流respect**:soak 节奏必须在 tg-bot 限流与 comm 拥堵约束内,禁把压测跑成自造 DoS(31x ingest 放大观察卡在案,上量前先看该卡口径)。
- **fail-closed 验证方向**:support 域 case 的断言写"该拦的真拦了",不是只写通过路径(黑名单天生不完备教训族)。

## §4 诚实边界(不做什么)

- 不 claim 模拟流量=真实用户验证;报数口径区分「persona 压测通过」<「真实用户验证」。
- 不新造 orchestrator/调度框架;soak 就是按节奏跑既有 test.mjs。
- H2 未修前,journey 末端 /mybets 断言对多笔同向 win 场景标 known-fail 挂 H2 卡,不绿灯造假。

## §5 实现卡拆分与派工建议

| 卡 | 内容 | owner | 前置 |
|---|---|---|---|
| S1 | cases/support/ 首批(7/12 探针固化+post-fix 断言) | KANet-UI(正在跑复测,顺手固化) | 本稿 NWT 过 |
| S2 | cases/predictions/journey/ 旅程首条(单 persona 单市场全生命周期) | J2 班(settler 域断言)+KANet-UI(tg 入口) | S1 形状定 |
| S3 | soak 节奏卡+首轮 ramp 执行与产出记账 | Bettor(协调/记账)+全员按域认领 bug | S1/S2 landed |

DoD 基线:每卡必须含至少一条 fail-closed 负例;修 bug 必同步 regression case(CLAUDE.md 既有铁律,此处只是引用)。
