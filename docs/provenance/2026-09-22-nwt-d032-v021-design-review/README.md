# NWT 设计审:D-032 单口径出题端闭环设计 v0.2.1 —— verdict:**方向通过;1 条新 MUST(赛前变体缺"参赛方已定"校验,可构造 100%必然冻结的正常题)**

- 被审:`docs/2026-09-22-bettor-d032-single-judge-question-closure-design-v0.1.md`(正文已是 v0.2.1,文件名沿用 v0.1),`origin/bshard-m3-deploy @c7637fec`。方式:读码(对照主线 `1ad8d235`,设计行号锚点)+ 静态推演(设计未落码,不能跑测试)+ 对 D-031 全目录 services/ 扫描。自己的 worktree `scratch/_nwt_wt_d032v021`;只读,零改码,主网零触碰。
- 派工四点逐条回,一轮只报 MUST,不审 R-b/R-c、宽限数值、§6 TypeSafe 挂点。

## 结论

**方向通过。1 条新 MUST(点②衍生,非我原三条缺口的复现)。点①③④均无新增 MUST。**

## ① §0"是不是已经有了"—— 按账本 1624 扩的范围扫过,没有漏列的现成物

- 扫了 `kasia-console/src/services` 全目录(194 个文件)+ `index.js` 启动注册,专门找"跟 ESPN 参赛方识别/事件身份绑定"同类能力,以及"判定题双裁判"是否在别处以其它形式活着:
  - `bettor-domain-detector.js`(LLM 分类 sports/politics/...)、`bettor-sports-enricher.js`(ESPN+TheSportsDB 拉 standings/schedule 给 LLM 做基本面分析)、`market-rules-parser.js`(拉 Polymarket gamma 市场描述)——都是**同名关键词、不同能力**:前两个是给 AI 决策研究用的"球队基本面"检索,不是"验证某 URL 对应哪个真实事件";`market-rules-parser.js` 拉的是 Polymarket 侧文本,而 v0.2.1 已经把 Polymarket/UMA 整条路删掉,不再需要它。三者都不构成 D-031 意义上的"重复造轮子"。
  - `startPredictionVoterCron`(index.js:701,老系统)确认操作的是 `exchange_offers` 表(与 `proto_markets`/`proto_market_verdicts` 完全不同的表),设计 §0 的"复用其模型"定位准确——只是借鉴"一市场一源"的**模式**,不需要接线到这个仍在跑的旧 cron,两者物理隔离,无冲突风险。
  - `oracle-sampler.js`(随机 oracle 委员抽样)、`derivevote-prompt.mjs`(LLM 判断 prompt 单源)、`prediction-parallel-judgment.mjs`(显式标注 EXPERIMENTAL/auto-grant DISABLED、testnet-only)——都不在单口径判定题这条路径上,不需要处置。
- **没找到需要追加进 §0 表的现成物**。

## ② 红队出题端(核心)—— 重跑三条题面全部拦住;新构造出一条"正常操作即必然冻结"的题

**重跑我 `4d540559` 的三条题面(逐条,按 §2.1/§2.6 的新校验推演,设计未落码,不能真跑,读码判定)**:
1. 无关 Polymarket condition id(缺口①原型)——请求体带 `outcomeConditionId` ⇒ 命中 §2.1 的 `JUDGED_BODY_KEYS`/未识别键检查(`outcome*` 形状键一律 400 `dual_judge_not_allowed`,复用既有 `findUnrecognizedJudgedShapedKey` 模式)。**拦住**。
2. 极性标反(缺口③原型)——请求体带 `polymarket_outcome_side` ⇒ `ALLOWED_SPEC_KEYS` 已删该键,出现即 400 `spec_unknown_field`(既有错误码路径,不新增)。**拦住**。
3. 四个"人工存档"字段判定时不读(缺口②原型)——设计明确不改这四个字段的行为("零行为变化"),只在公开视图标注"仅人工参考,自动判定不读取"。**这不是修复,是如实标注**,与我原判(SHOULD,不阻塞)一致,设计口径没有倒退。

**新构造(§2.6 命题绑定机制本身,试图打穿"人看的题 = 机器判的题"这条新闭环)**:
- title 写 A 场 + predicate/URL 指 B 场:§2.6-1 建题时取 `canonical_event`,§2.6-2 要求 `predicate.subject/operand ∈ {home.abbr, away.abbr}`,§2.6-3 服务端渲染语句、§2.6-4 强制原样回签——操作者没法让"人看到的题"与"机器实际判的 predicate"脱钩,因为公开视图(§2.6-7)以服务端渲染的 `judge.statement` 为主、`title` 降级为辅助标签。**拦住**(UI 是否真的把 `judge.statement` 摆在比 `title` 更显眼的位置是 KANet-UI 域的另一张票,这条设计本身已经把"真话"做成了权威优先展示的字段,不是本设计的责任缺口)。
- URL 指 A、载荷 `header.id` 为 B:§2.6-1 的"载荷身份核对"(Codex 159a4763 MUST)三向核对 URL `event` 参数 / `header.id` / `header.competitions[0].id`,三者不一致 ⇒ 400 `event_identity_unverified`。**拦住**。
- **新发现(见下 MUST)**:§2.6-1 的"赛前变体"(`parseEspnParticipants`,去掉 `final` 要求)对"这两个参赛方是否已经是真实确定的球队(不是占位符/待定)"没有任何约束。

### MUST(唯一):赛前变体没有"参赛方已确定"校验 —— 可构造一道对**正常操作、非恶意**运营者也会 100% 必然冻结的题,不是概率性风险

**场景**:某项体育赛事(季后赛/淘汰赛系列赛)的下一轮对阵尚未确定,ESPN 已经为该 slot 建好预告页(常见做法,如"东部决赛胜者 vs 西部决赛胜者"这类占位对阵)。运营者提前建一道"湖人赢下一轮吗"这样的题——此刻湖人一侧已经确定(假设湖人已晋级),对方一侧仍是占位符。§2.6-2 的校验只要求 `predicate.operand ∈ {home.abbr, away.abbr}`——湖人一侧是真实的 'LAL',这条校验会**通过**(校验的是"operand 是否在参赛方集合里",不管另一侧是不是占位符)。`canonical_event` 就此把占位符那一侧连同真实那一侧一起冻结进 `resolution_rule_spec`(§2.6-5,不可变)。等对方真正确定后,§2.6-6 判定时回验发现 `away_team`(真实值)≠ 冻结的 `canonical_event.away.abbr`(占位符)⇒ `event_identity_mismatch` **必然冻结**——不是运营者的错,不是攻击,是**在完全正常的操作节奏下、100% 会发生**的后果,因为占位符一侧无论最终变成谁都不会等于建题时冻的那个占位符字符串。

这比我原来红队报告里的③(极性标反,善意失误)更差:③是"标反才会冻",本例是"只要在系列赛前一轮结束前建题,不管标没标对都会冻",范围更宽、触发条件更容易被普通运营者的正常时间安排撞上。

**我没能验证的部分(如实标注,不夸大)**:我没有实际抓取 ESPN 的真实 JSON 去确认这类"占位对阵"页面里 `competitors[].team.abbreviation` 具体是什么值(常见做法是 `'TBD'` 这类占位字符串,但我没有现场验证,这次审查环境没有做外部网络请求)。**但这不影响缺口本身的存在**:不管 ESPN 用什么具体字符串表示"待定参赛方",§2.6 全文没有一处要求"这两个 abbr 必须是已确定的真实球队,不能是占位符/待定标记"——这条校验规则本身是缺的,不是我猜错了 ESPN 的数据格式。

**最小收紧**:在 §2.6-1 的 `canonical_event` 抽取里加一条 fail-closed 规则——`home.abbr`/`away.abbr` 若命中一个"已知占位符特征"(具体signal 需要 J2 落地前用真实 ESPN 响应核实,例如 `abbreviation` 缺失/为空、或等于某个已知占位 token、或该 competitor 对象缺 `id`/`uid` 等球队实体字段——ESPN 对占位对阵通常会用某种可辨识的方式区分"真实球队记录"与"待定占位"),命中 ⇒ 409 `event_participants_not_determined`,不建(与既有 `source_unreachable_at_creation` 同一类:让运营者晚一点(等对阵确定后)再建这道题,不是产品缺陷,是"现在还不能建"这条边界没画出来)。这不新造机制,是给 §2.6-1 现有的 fail-closed 抽取步骤加一条判据,复用同一个 409 拒建通道。

## ③ §3 冻结清单是否有 D-032 §2 之外的路;两个新 reason 的可达性

- **清单对照**:8 个 reason 逐条能映回 D-032 §2 的五类基础设施故障(spec_invalid/source_not_registered→规格损坏;abstain_or_dispute→源不可达或未出结果;pmt_invalid_past_cutoff/past_cutoff→过截止;late_seal→封盘太晚;r5_precheck_failed→系统状态,批 D 既有、非本次新增)。`unexpected_verdict_kind` 与 `event_identity_mismatch` 是本轮新增,D-032 原文(账本 1623)写这五类时 §2.6 还不存在——**这两条是对 D-032 §2 精神的延伸而非违反**(都是"系统本不该允许发生的状态",不是"两个来源意见不同"这种被 D-032 明确否定的旧理由)。建议 SHOULD:把这两条追加进 `docs/DECISIONS.md` D-032 §2 的枚举原文旁(状态注记手法,不改 Owner 原话),否则下一个接位者读 D-032 原文会觉得"怎么多了两条没写的理由"。
- **`unexpected_verdict_kind` 可达性**:§2.2 删掉 `deriveUma` 后,正常运行时不会有代码路径写入 `uma`/`llm` 票——这条守卫是纯粹的 fail-safe(防将来某处代码退化/被误接回旧路径),§7 的测试计划(注入 llm/uma 票验证守卫存在)是对的验收方式,不需要、也不该追求"自然可达"。
- **`event_identity_mismatch` 可达性**:**确实可达**,而且是本轮找到的 MUST 场景证明的那条路(§2.6-6)——不是摆设,只是触发条件比设计者预想的更宽(见 MUST)。
- **`inconsistent_verdicts` 不可达性**:结构上成立——单口径下 `AUTO_KINDS=['extractor']`,赞成集永远只有一种 `source_kind`,`new Set(...).size` 永远 ≤1(除非先撞上 `unexpected_verdict_kind` 那条更早的守卫)。§7 要求"删该行所有测试仍绿"证明不可达,方法对。

## ④ "adapter L61 要求 polymarket_outcome_side"同族坑 —— 全仓扫过,没有第二处

- 全仓 grep `polymarket_outcome_side` / `outcome_condition_id` / `CONDITION_ID_RE` / `umaWindowMs` / `UMA_FINALIZATION_WINDOW_MS` / `derivePolymarketVote`,排除老 bshard/pool_markets/bettor.js/exchange_offers 系统(那是完全不同的表和产品,同名字段不是同一个坑)。**proto-v0 判定题路径范围内的命中,全部已在 §2.1/§2.2 的删除清单里覆盖**:`proto-oracle-spec.mjs`(validateJudgedMarketInput 内 4 处)、`proto-oracle-adapter-core.mjs`(L34/46/63/72/80/85/86 全覆盖,含你点名的 L61/63)、`services/proto-oracle-adapter.mjs`(注入点)。
- **SHOULD(非 MUST,顺手记)**:`proto-oracle-verdict.mjs` 的 `assertUmaWindowSafe`/`UMA_MIN_FINALIZATION_WINDOW_MS` 定义本身不会被删(只是调用点消失,变成死代码,不影响行为,不是坑);`api/proto.js:144` 的 `import { UMA_FINALIZATION_WINDOW_MS }` 若 §2.1 只改 148 行的调用参数、不清理 144 行的 import,会留一个不再使用的 import——不是 landmine(不会造成错误行为),是清理项,J2 落码时顺手删。

## 未做 / 局限

- 设计未落码,②③④的推演基于读码 + 静态分析,不能像审 R-a/F3F4 那样跑测试/突变验证——J2 实现后我会用真实测试重新走一遍这四点,尤其是 MUST 那条(需要真实 ESPN 响应格式核实占位符的具体 signal)。
- MUST 的"ESPN 占位符具体格式"部分明确标了 UNVERIFIED,不是凭空猜测——缺口本身(spec 没写这条校验)是我读码确认的事实,ESPN 具体怎么表示待定参赛方需要 J2 落地前用真实响应核实。
- 不审 R-b/R-c、宽限数值、§6 TypeSafe 挂点,按派工范围。
