> **Status**: CURRENT（2026-09-20，NWT；对象 = `docs/2026-09-20-bettor-oracle-batchB-adapter-verdict-promote-design-v0.1.md`（origin `c6f2abc0`）；设计红队第 1 轮 MUST-only；D-021：只写设计缺口类别）

# oracle 批 B 设计 v0.1（adapter：扫市场→deriveVote→verdict→经批 D 门 promote）—— NWT 红队

## 结论：**接线方向对（复用引擎、写值只经批 D 门 + 批 A 触发器、llm/human 只能冻不能批、M4 诚实定性）；但有 7 条 MUST，其中最重的一条是「llm 可以被贴上 extractor 的标签混进赞成集」——批 A/D 的门全靠 `source_kind` 标签，而标签怎么贴设计里没写。** 我读了 `deriveVote` / `deriveKanetNativeVote` / `derivePolymarketVote` 真码与创建路由后核的。

## 7 条 MUST
**B1 `source_kind` 的贴标规则必须写死，否则「LLM 不能批准」只是标签游戏。** `deriveVote` 一次调用只走**一条**分支（polymarket / kanet_native / 注册表抽取器），返回 `outcome:'YES'|'NO'|'ABSTAIN'` 与 `extractor_kind_used`。已知源上的**判定并不都是确定性的**：只有 `extractor_kind_used==='judgeline-deterministic'`（有结构化 `resolution_predicate` + 结构化字段）才是确定性算术；其余凡"抽到 clean evidence 再交给 Qwen 判"的都是 **LLM 决策**——只是证据由抽取器抽的。若实现者按"命中已知抽取器 ⇒ source_kind='extractor'"贴标，LLM 判的结果就以 extractor 身份进赞成集，批 A 触发器（按 source_kind 校验）与批 D 门（`AUTO_KINDS`）都拦不住。要求：**单一纯函数** `classifySourceKind(deriveResult, branch)`：仅 `judgeline-deterministic` ⇒ `extractor`；仅 `derivePolymarketVote` 且 `ok:true`（已过 UMA 定稿窗）⇒ `uma`；**其余一切有 outcome 的结果、以及任何未知/新增的 `extractor_kind_used` 值 ⇒ `llm`**（fail-safe）。测试用**真** `deriveKanetNativeVote` 各返回形态（含未知值）喂它；变异：把 LLM 路径改标 extractor 必红。同时 UMA 分支的定稿窗由 env `UMA_FINALIZATION_WINDOW_MS` 覆盖（注释写"testnet 0 = 关闭"）——**proto 路径不得接受 <24h 的覆盖**（0 ⇒ 未定稿的 UMA 结果会被贴成 `uma`）；启动校验/拒绝并 LOUD。

**B2 ABSTAIN 必须分"暂态 / 实质"，暂态一律不写 verdict。** 批 D 的 M1 冻结集里 `outcome` 非 0/1 即冻结，verdict 表只增不删。而 `deriveVote` 对"赛果还没 final / 抽取器返回 null / 取数失败 / 超时"也返回 `ABSTAIN`（`known-source-not-final` 等）——这是**常态**（比赛超过 outcome_end 才 final）。若 adapter 把这些也写成 `outcome=NULL` 的 verdict，市场在第一个 tick 就被**永久冻结→退款**（误拒）。要求：暂态（未 final / 取数失败 / 抽取异常 / TypeSafe 超时 / pmt 无效）⇒ **不写、下 tick 重试直到 cutoff**；实质（源已 final 但字段不足以判 / `judgeline-abstain` / LLM 低置信 / 明确争议）⇒ 写 NULL verdict。给出枚举表（`extractor_kind_used` → 暂态/实质）+ 未知值按**暂态**（不写；cutoff 自然兜底冻结）。另：**同一 (市场, source_kind, 证据哈希) 至多一条 verdict**——LLM 非确定性（同证据两次问出相反答案）会在 append-only 表里制造互相矛盾的两行、把市场冻死；LLM 每市场只在抽取器 final 后问一次。

**B3 outcome ↔ side 的映射没有定义，写值一次不可改。** `deriveVote` 说 YES/NO，`proto_markets.winning_side` / `proto_bets.side` 是 0/1，proto 侧没有任何地方存"哪一侧是 YES"（创建路由收到的 `resolutionNote` 目前**被丢弃**）；UMA 路径还有 polymarket 自己的 `outcome_side` 极性。映射错一位 = 赢家侧反了、且不可改。要求：规格里显式带 `side_map`（例如 `{yes:1,no:0}`）并在创建时校验、存入不可改列（批 A 的 R4 已锁题面列）；三条来源（judgeline / polymarket / llm）**各自**过同一个 `toSide(result, spec)`；用**真生产者输出**（三种路径各一份 YES/NO 真返回）做测试，含"极性反"的对照臂。

**B4 「pmt 无效则不写 verdict」对赞成票对、对**异议**票是 fail-open。** 与我批 D 的 M1 同型：赞成票可以等，但已实质推出的**异议/ABSTAIN**若因 pmt 暂时无效被丢弃，下个 tick 重推可能已不同（源被更正、LLM 换答案），异议信息就丢了。要求：**赞成（outcome 与将批的一致）⇒ pmt 无效则不写；实质异议/实质 ABSTAIN ⇒ pmt 无效也写（`pmt_at=NULL`，批 D M1 正是为这种行设计的）**。与 B2 合起来是一张表：`{暂态: 不写} {实质异议: 必写} {赞成: pmt 有效才写}`。

**B5 N5b 必须是"一个谓词、三处强制、默认关"，而不是文档。** `proto_token_defs` 没有"有无价值"标志，代码里现在无法区分。要求：新 env 开关 `PROTO_ORACLE_ADAPTER_ENABLED`（**默认关**，按 driver 开关同级对待，翻开须 Owner）+ `PROTO_ORACLE_VALUELESS_TOKEN_IDS`（主网上唯一允许判定题的 token 白名单）；一个共享谓词 `judgedMarketAllowedHere({network, tokenDefId})` 在 **① 创建入口**（主网 + 非白名单 token ⇒ 拒建判定题）、**② 受理门**（主网判定题且 token 不在白名单 ⇒ 拒下注，纵深防御）、**③ adapter 扫描与 promote**（同样排除）三处调用；启动时 LOUD 打印实际生效值。非主网（simnet/TN）不受限。lint/测试钉住"三处都调了同一个谓词"。（现有 `a59c` 等非判定题市场不受影响。）

**B6 创建入口是这批最大的输入面，且要"创建即可满足"。**（a）`data_source_canonical` 是**用户可控 URL**：`deriveKanetNativeVote` 在判断"是否已知抽取器"**之前**就 `fetch(url)`，且把 `localhost/127.0.0.1` 改写成本机控制台端口（本是给测试用的 mock oracle）。判定题创建必须**只接受 `findExtractor(url)` 命中的白名单源**，拒 free-text、任意 http(s)、本机/内网地址；adapter 侧再复核一次（同一注册表）。（b）**按 R2 的现实约束做创建期预检**：自动 promote 需要"有 `resolution_predicate` 的确定性抽取器源 **且** polymarket 条件（UMA）两条都在"，缺一条的市场**永远**无法自动 promote、只会到 cutoff 冻结→退款；创建时就该拒（或明确标为"仅人工/退款"）。（c）`deadline_ms ≥ outcome_end_ms + 各来源真实时延`：UMA 默认要 **48h** 定稿窗，§7 的"投票预算"必须把它显式算进去，否则 UMA 路径的市场必然踩 cutoff。（d）新字段**不得从请求体接受 relay id 类字段**（现有 `rejectRelayIdInBody` 的原因），`outcome_oracle_relay_ids` 由服务端定；`ensureMarketPending` 必须在**同一 INSERT** 里写全判定题列（批 A 的 R4 在 genesis 广播后锁列）；别复制现有"接受 resolutionNote 却丢弃"的形态。（e）⑥影响面：字段全可选、缺省时行为必须与今天逐字节相同（加一条"无判定题字段 ⇒ 与旧路径同"的回归测试）。

**B7 promote 执行必须在一条原子语句里再守一次异议。** 批 D 的 `PROMOTE_UPDATE_SQL` 谓词只带 `sealed ∧ winning_side IS NULL ∧ frozen IS NULL`；R2/异议检查在 JS 里、与写值之间不是原子的（这条我在批 D v0.2 记成 SHOULD，因为当时没有调用方）。现在 adapter 就是第一个真实调用方、写值又不可改——把 `NOT EXISTS (SELECT 1 FROM proto_market_verdicts v WHERE v.market_id=? AND (v.outcome IS NULL OR v.outcome <> ?))` 加进同一条 UPDATE 的 WHERE（或包进 `BEGIN IMMEDIATE`），并加"两 tick 并发/异议行在检查后插入 ⇒ changes==0"的测试。

## 你点的 ①–⑥（对应）
① **R2 独立性**：`source_kind∈{extractor,uma}` 在机制上不同，"同一 API 两个字段"**不可能**变成两源（同 kind 不算，且 secondary 抽取器同为 extractor）。但要诚实写清两点：（i）独立的是**机制**（确定性抽取器 vs UMA 人投预言机），不是"数据溯源"——体育类 UMA 最终也参照官方赛果，共因失误可能；（ii）**两个来源是否在回答同一个问题没有任何东西校验**（judgeline 的 predicate 与 polymarket 条件都由建市场者填）——M4 单运营方成立，但要在设计里写明"独立性 = 运营方选源的机制独立，不含问题等价性证明"，并复用现有 `parallel judgment` 的"假并行"守卫（独立源不得是 polymarket/gamma）作同一份判据，别另写。② **TypeSafe/LLM 不越权**：代码级保证 = B1 的单一贴标函数 + 批 A 触发器（引用 verdict 的 source_kind 必须一致、llm 不可引用）+ 批 D 的 `AUTO_KINDS`；这三层里**只有 B1 是新增责任**。另外设计 §5 说用 TypeSafe，`deriveVote` 内核的 LLM 路是本地 Qwen——请写明 llm verdict 究竟走哪条（建议单一，且都不进赞成集），并注意"能冻"本身是个 grief 杠杆（控制证据页/标题者可诱导 LLM 出异议）：已有的虚假冻结率监控要真接线。③ **fail-safe**：见 B2+B4 的表。④ **与批 A/D 自洽**：promote 只经 guarded UPDATE ✅（加 B7）、冻结只经批 D `freezeMarket` ✅、write-once ✅；缺口是"人工冻结/`human` verdict"谁来写——现在没有路径（SHOULD：一个带鉴权+审计的最小管理入口，作应急刹车）。⑤ **N5b**：见 B5。⑥ **创建入口影响面**：见 B6。

## SHOULD（记票）
人工冻结入口（上）；同一 (市场,来源) 的 verdict 写入需事务内查重（不只靠批 A 的 dup-id）；TypeSafe 只送标题/公开证据、长度上限、`TYPESAFE_API_KEY` 不入日志（D-021）；`resolution_rule_spec` 5 必填校验与 `bettor.js` 复用而非复制；simnet 端到端补"UMA 未定稿时 ABSTAIN 不冻结/定稿后 promote"一条。

## 我没做
只有设计，未审实现；对 `deriveVote` 各分支只读了返回形态与路由，没实跑（外部源/LLM 不适合在评审里实跑）。
