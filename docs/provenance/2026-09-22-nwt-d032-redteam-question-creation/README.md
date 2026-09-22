# NWT 红队(D-032):用现有建题接口出一道会被冻结的判定题 —— **能出,3 处缺口,均在出题端**

- 任务:Owner 定向(D-032,账本 1623)——"正常运营者按现有接口出题,会不会出出一道两个来源可以合法给出不同答案 / 题面本身有歧义的题,让输家有机会把市场逼进 `inconsistent_verdicts` 或 `abstain_or_dispute`"。
- 坐标:`origin/bshard-m3-deploy @5754fa59`。方式:读码 + 用**真实生产函数**(不 mock 判定逻辑,只 mock 网络 I/O 之外的部分)构造并跑通一次创建请求,证明它被接受。自己的 worktree `scratch/_nwt_wt_redteam_d032`(独立 `npm ci`);只读,零改码;主网零触碰。

## 结论先行

**能出。三处缺口,由小到大排列如下——但第①处是根因,②③都是它的表现。** 优先收紧现有校验(D-031,不另起):第①处只需在创建时加一次跨源关联校验;②③是文档/措辞层面的更正,不改行为。

## 缺口①(根因,最重):`data_source_canonical`(ESPN)与 `outcomeConditionId`(Polymarket)之间,创建时**零关联校验**——可以是两个完全不相关的真实事件

### 题面长什么样

```
title: "湖人今晚主场赢球吗?"
resolutionRuleSpec: {
  data_source_canonical: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=9101",
  secondary_sources: [...], ambiguity_handler: "...", dispute_keywords: [...], edge_case_examples: [...],  // 5 必填占满
  resolution_predicate: { metric: "winner", op: "==", operand: "LAL" },   // "湖人赢吗"——合法、确定性、ESPN 能判
  side_map: { yes: 0, no: 1 },
  polymarket_outcome_side: "YES",
}
outcomeConditionId: "0xabab...ab"   // 格式合法的 64-hex, 内容可以是【任何】Polymarket 市场——"12月是否降息""某场完全不同的比赛"都行
```

### 哪一条校验放过了它

我用**真实的** `validateJudgedMarketInput`(`proto-oracle-spec.mjs`,没有 mock 它的任何判定逻辑)跑了这个请求,**结果 `ok:true`**(逐行核对见附录探针输出)。逐条过了哪些检查、又漏了什么:

| 检查 | 结果 | 为什么漏 |
|---|---|---|
| 五必填字段(`data_source_canonical`/`secondary_sources`/`ambiguity_handler`/`dispute_keywords`/`edge_case_examples`) | 全过 | 只查存在+类型+长度,不查内容 |
| `data_source_canonical` 命中 `findExtractor` 白名单且 `kind==='espn'` | 过 | 真实 ESPN host,合法 |
| `resolution_predicate` 结构校验 + 干跑(`dryRunPredicate`) | 过 | `winner==LAL` 是合法、可判的 predicate,干跑给 YES |
| `outcomeConditionId` 格式(`0x` + 64 hex) | 过 | **只查格式,不查这串 hex 到底对应哪个真实市场** |
| `secondary_sources`/`ambiguity_handler`/`dispute_keywords`/`edge_case_examples` 与 `data_source_canonical`/`outcomeConditionId` 的**语义关联** | **不存在这项检查** | 见下 |

我往下追了一层,确认这不是校验漏了一处,是**架构上两条判定路径压根不共享输入**:`proto-oracle-adapter-core.mjs` 的 `deriveExtractor({resolution_rule_spec: m.resolution_rule_spec, ...})` 只吃 spec(含 ESPN URL);`deriveUma({outcome_condition_id: m.outcome_condition_id, ...})` 只吃 Polymarket condition id——**两个函数调用互相看不到对方的输入**。extractor 那边判"湖人赢没赢",uma 那边判"Polymarket 那个 condition 的市场,UMA 怎么定案"——如果 condition id 真的指向一个跟湖人比赛无关的市场,这两个判断在逻辑上**从一开始就是在回答两个不同的问题**,只是因为都被 `side_map`/`polymarket_outcome_side` 映射进同一个 0/1 空间,系统看起来像是"两个源在判同一件事,结果不一致"。

### 后果

- **纯意外**:运营者复制粘贴错了 condition id(同一天多场比赛、Polymarket 页面切换错标签页)——两个独立二元事件按各自真实结果落地,**约 50% 概率**刚好落在同一侧(表面像"过了"),**约 50% 概率**不一致 ⇒ `inconsistent_verdicts` ⇒ 冻结 ⇒ 退款。运营者完全不知道自己出的题有这个坑,直到市场冻结才发现。
- **故意搞事(Owner 原话场景)**:任何能影响"该配哪个 condition id"这一步的人(运营者本人被骗、或流程里有一步让别人建议/提供 condition id),只要故意挑一个**跟 ESPN 那场比赛结果反相关**(或干脆无关但已知会开出相反结果)的 Polymarket 市场,就能把"约 50% 概率"提升到**接近确定**——不需要动任何代码、不需要污染 ESPN 数据本身,只需要在建题这一步递交一个"看起来合法但语义不对"的 condition id。这正是 Owner 问的"钻题面"。

### 最小收紧(优先方案,不新造)

创建时增加**一步关联校验**:调用 Polymarket `gamma-api`(`bettor-prediction-voter.js` 已有现成的 `condition_ids=` 查询手法,`derivePolymarketVote`/`fetchGammaMarket` 同款)按 `outcomeConditionId` 取回该市场的**问题文本**(question/title),与 `spec.title`/`data_source_canonical` 指向的 ESPN 事件做一次**弱匹配**(不要求语义 AI 判断,起步可以只做:队名缩写/球队全名是否同时出现在 Polymarket 问题文本里,或要求运营者显式填一个 `polymarket_market_question` 字段供人工核对,创建时把两边的问题文本一起回显在响应里,强制运营者肉眼确认)。**更彻底但仍不新造**:复用 `oracle-evidence-extractors.mjs` 已有的 host 白名单机制,给 Polymarket 也加一层"取市场文本回显"的确定性检查,不引入新的判定逻辑,只是让创建时的"两个源是不是同一件事"从"无人检查"变成"至少有一次机器可读的交叉展示"。这不需要解决"语义完全一致"这个通用难题(不可解),只需要把"完全不相关"这个最容易出的坑挡在创建时。

## 缺口②:五必填字段里,四个(`secondary_sources`/`ambiguity_handler`/`dispute_keywords`/`edge_case_examples`)在判断时**从不被任何代码读取**——是理论上的"防歧义"字段,实际是摆设

我全仓 grep 了这四个字段名(排除测试文件、排除 `proto-oracle-spec.mjs` 自己的校验代码和 `api/bettor.js` 里那份**另一套老系统**的必填清单),**零命中**——没有任何 derive/judge/adapter 代码读取它们。我又跟着 `deriveKanetNativeVote`(`bettor-prediction-voter.js:879`)的实现走了一遍:它只读 `spec.data_source_canonical`(和更下游的 `spec.resolution_predicate`),同样不读那四个字段。

**这意味着**:运营者被要求在 `ambiguity_handler` 里写"若比赛取消则按平局处理"这类文字,给人一种"歧义已经被规则覆盖"的错觉——但系统自动判定时**完全不会读这段话**,真遇到取消的比赛,ESPN 结构化字段抽不出来 → `judgeLine` 返回 `ABSTAIN` → 走 `abstain_or_dispute` 冻结,跟运营者填的"按平局处理"没有任何关系。**这是缺口①在字段层面的一个具体表现,同一根因**:创建接口收集了"看起来能防歧义"的输入,但自动判定管线完全绕开它们。

**最小收紧**:不建议现在就给这四个字段接判定逻辑(那是新功能,且自然语言规则本身无法被 `judgeLine` 确定性消费——引入即违反"确定性可复算"这条 D-032 的硬要求)。建议:① 在创建响应/UI 上明确标注这四个字段"仅供人工存档/争议时参考,自动判定不读取它们";② 或者按 D-032"逻辑闭环"的精神,评估是否该把它们从**判定题**的必填清单里去掉(它们是老系统 `bettor.js` 的遗产,`REQUIRED_SPEC_FIELDS` 里写"同老系统 bettor.js 的 5 必填"——但老系统本身可能就有人工兜底流程消费它们,proto-v0 判定题没有,复制了字段却没复制消费方)。这条我不下结论,列出来请 Bettor/Owner 定。

## 缺口③(同根因,较轻):`polymarket_outcome_side` 是运营者自报的极性标记,创建时**无法**验证对不对——即便①的关联做了,极性仍可能标反

即使运营者认真核对过 ESPN 事件与 Polymarket 市场是同一件事,`polymarket_outcome_side`(Polymarket 的 YES 对应本市场 yes 还是 no)这个字段的正确性**在创建时原则上验证不了**(Polymarket 市场此刻可能还没解决,UMA 还没定案,没有"标准答案"可比对)。标反 = 100% 必然触发 `inconsistent_verdicts`(不是 50% 概率,是必然),而且是**善意运营者的操作失误**,不是任何人搞事。

这条**没有干净的创建时修法**(结构性限制,不是漏检)——列为已知限制,不算新增 MUST。缓解方向(留给设计,不在本轮范围):① 判定题上主网前先在 simnet/零价值代币跑一轮完整生命周期,人工核对 `polymarket_outcome_side` 的实际落地结果与预期一致;② 或者在 UI 创建流程里,把"Polymarket 那边 YES 对应的具体结果是什么"用人类可读的方式回显给运营者二次确认(而不是让运营者凭记忆填一个 YES/NO)。

## 与 D-032 的对齐

D-032 决定"冻结→退款不是设计出口,出题端必须闭环"。本轮红队证明:**当前出题端在①处不闭环**——不是"故障"触发冻结,是"两个来源本来就可能在回答不同问题"这个结构性漏洞,能被无恶意的操作失误、也能被有意构造的题面同时触发。①的最小收紧(取回 Polymarket 问题文本、创建时回显核对)不需要新设计,复用已有的 gamma-api 查询代码,符合 D-031。

## 局限 / 未做

- 现状缓解(不改变本发现的成立性,只影响"现在有多容易被真的撞上"):`PROTO_ORACLE_ADAPTER_ENABLED` 主网默认关(D-032 之前就是),且 N5b(`judged_market_not_allowed_here`)把判定题限制在零价值白名单代币——**当前主网还没有开着自动判定跑真实价值的判定题**,所以①③目前是"接口层面已确认可构造,尚未在主网被真实撞上",不是"主网正在发生"。这不改变结论:D-032 要求的是"开自动判定之前先把出题端闭环",本轮证明现在还没闭环。
- 没有起 simnet/临时库跑一次完整的"两个不相关源判定后走到 `inconsistent_verdicts`"的端到端(即用假 ESPN/Polymarket 数据把 verdict 写进库、跑 `evaluatePromoteGate` 到真的 `freeze`)——本轮只证明"创建通过"这一步,判定逻辑本身(`evaluatePromoteGate` 的 `inconsistent_verdicts` 分支)是我读码确认的既有代码(逐行贴在正文),没有必要再跑一次(那条分支本身不是新代码,不需要我重新验证它存在)。
- ②里"要不要去掉这四个字段"我特意不下结论——这是产品/流程决定,不是纯技术缺口,留给 Bettor/Owner。

## 附:探针输出(逐字节)

```
validateJudgedMarketInput 结果: {
 "ok": true,
 "normalized": {
  "resolution_rule_spec": "{\"data_source_canonical\":\"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=9101\",\"secondary_sources\":[...],\"ambiguity_handler\":\"...\",\"dispute_keywords\":[...],\"edge_case_examples\":[...],\"resolution_predicate\":{\"metric\":\"winner\",\"op\":\"==\",\"operand\":\"LAL\"},\"side_map\":{\"yes\":0,\"no\":1},\"polymarket_outcome_side\":\"YES\"}",
  "outcome_market_source": "polymarket",
  "outcome_condition_id": "0xabababababababababababababababababababababababababababababababab",
  "outcome_oracle_relay_ids": "[]",
  "outcome_end_ms": 1790066820193,
  "minDeadlineMs": 1790155740193
 }
}
dryRunPredicate: {"ok":true,"verdicts":["YES"]}
```
探针脚本跑在自己的 worktree 里(`_nwt_probe_d032_ambiguous_question.mjs`,调真实 `validateJudgedMarketInput`/`dryRunPredicate`,零 mock 判定逻辑),跑完已删除,未提交,主网零触碰。
