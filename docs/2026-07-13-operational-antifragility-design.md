# 运营强壮性(反脆弱)机制设计 v1.0 — "系统随时间越来越强壮"

> **Status**: CURRENT (DRAFT v1.0 · Bettor 拟稿 2026-07-13 · Owner 直令"深查根修+对抗性思考运营机制" · 待 NWT 红队 → Owner 终裁优先级)
> **依据**: 2026-07-13 全天 15+ 发现的模式归纳——单点表症各异(坏盘空转/死 relay id/假终态/隐身守卫/看门狗失效/fixture 腐烂),**共同病根 = 静默腐烂**: 指向活对象的引用与"应该在工作"的机制,坏了以后系统照跑,只是悄悄变笨/变盲/变穷,直到 Owner 亲身撞上。
> **原则**: 每柱都必须是**机制**(lint/cron/tripwire/告警),不是约定——"规矩靠自觉守不住,必须上机制"(铁律0根因)。

## 病根标本(今天一天收集的,每柱的立柱理由)

| 标本 | 潜伏期 | 发现方式 | 病根类型 |
|---|---|---|---|
| 9+1 生产文件死 relay id,退款安全网静默死 | ~2.5 月 | 测试失败顺藤 | 配置指向活对象无活性校验 |
| supervisor 自身 dead 无人看 | 数天×2 次 | 重启窗顺带发现 | 守卫无守卫 |
| 测试批跑假全绿(process.exit 杀 runner) | 未知(需考古) | Owner 直令实战测试 | 守卫说谎无 tripwire |
| 7 个 regression 守卫无 default export 从未被加载 | 未知 | 隔离扫 | 守卫隐身无计数核对 |
| ozzeu 假 completed 藏 100KAS+70KAS 三周 | 3 周 | 测试失败顺藤 | 假终态无链上对账 |
| 29-aukqt/70-ojizv 空转灌 lag 数周(2983 条看门狗误报) | 数周 | Owner 撞+埋点 | 重试无熔断+无观测 |
| fixture 死端口×2/死 relay id | 数月 | 隔离扫 | 同配置腐烂族 |
| classifier 关键词漏新话术(第三撞) | 反复 | live 红队 | 枚举防线无对抗演习节律 |

## 六柱设计

### 柱① 自愈隔离(repeat-offender 闸转正+推广)
- 今日落地的泛化闸(同签名连续 3 tick 重试耗尽→标记隔离+审计+可清 marker)从 settle-daemon **推广到所有重试型后台任务**(broker sweep/claim-auto/consolidate/scout catch-up):统一 helper `repeatOffenderGate(taskKey, reasonSignature)`,各任务接入。
- 配套:被隔离对象自动生成**处置卡**(events 表 + 周报聚合),隔离≠遗忘。

### 柱② 观测常驻(系统自己喊疼)
- heartbeat/heap/tick-duration 三探针从"临时诊断码"**转正**(保留在 main,文档化)。
- **自动告警**: lag>30s 或 heap>700MB → 直接发 dev-coord 频道(复用既有 send 原语,限速 1 条/10min 防刷)——系统先于 Owner 喊疼。
- 每日摘要一行(cron): 当日 lag 事件数/最大值/heap 峰值,进频道,趋势可见。

### 柱③ 配置腐烂防线(指向活对象的引用必须验活)
- **启动时**: 所有 env/常量里的 relay id/端口/地址在服务启动时对 relay_nodes/live 端口做活性校验,dead→fail-loud(12f272ac 模式推广)。
- **每日 cron 活性审计**: 扫 kanet.env+白名单常量表,逐项验活,dead 项报频道。
- **lint**: R-RELAY-ID-HARDCODE / R-PORT-LITERAL(src/** 禁 UUID/端口字面量,白名单制)。

### 柱④ 假终态防线(状态字段会说谎,链不会)
- 第八层洋葱扫脚本(2012 盘终态×链上 unspent,全量链验 ~10s RPC)**转每周 cron**,差异对比上周基线,新增即报。
- 终态写入点收紧:任何写终态 status 的代码路径必须同事务写入对应 txid 锚(lint 启发式:UPDATE 终态无 txid 列同写→WARN)。

### 柱⑤ 守卫的守卫
- 测试套件**案例数 tripwire**: 批跑 summary 必含"ran N/total M/skipped K",N+K≠M 即 FAIL(今天假全绿的根治);case 文件顶层 process.exit lint 禁令(cases/** 范围)。
- **supervisor watchdog**: 独立最小 cron(系统级任务计划,不依赖 console)每 10min 核 supervisor 存活,dead→频道告警(守卫链终点落在 console 之外)。
- lint 规则覆盖率月报:每条 ANTI-PATTERNS 规则是否有对应 lint/tripwire,无机制的规则=裸奔清单。

### 柱⑥ 对抗性演习节律(不等它坏)
- **每周一次红队演习**(NWT 轮值主持):随机抽一个"应该在工作"的机制(看门狗/告警/退款 sweep/备份恢复/escalation 通道),用今天验证看门狗的方式实测它真的工作——注入一个受控故障看防线响不响。
- 演习结果进 ledger 记账;哑火的防线=当周最高优先修复。
- 语料库维护:classifier/正则类防线每次演习补 5 句新话术,枚举防线靠节律保鲜而非一次修全。

## 落地优先级(建议,Owner 终裁)
P1(本周): 柱②告警+柱⑤案例数 tripwire+柱③启动验活推广——全是今天事故的直接复发防线。
P2(下周): 柱①推广+柱④周 cron+柱⑤supervisor watchdog。
P3(节律): 柱⑥演习制度化+柱③日审计+柱⑤月报。

## 不做什么
- 不引入外部 APM/监控系统(自建三探针+频道告警已够 testnet 规模,外部依赖=新腐烂面)。
- 不做自动 kill/自动重启钱路进程(告警归告警,重启永远人工按 runbook——自动化不可逆动作需单独慎重设计)。
- 不把本设计当一次性大整合一把梭(D-004 教训): 按柱分批,每柱独立 STOP 点。
