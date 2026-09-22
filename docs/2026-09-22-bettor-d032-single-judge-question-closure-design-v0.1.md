# D-032 出题端闭环设计 v0.2 —— 一题一个裁判（单口径）· 拆掉批 B 的"双裁判" · 题面与机器命题绑定

> **Status**: CURRENT · Bettor 2026-09-22 · Owner 本机终端「对齐没问题，D-032 按单口径出设计稿」· 依据 DECISIONS D-032 / D-031 / D-030 / D-021 · 账本 1623 / 1625 / 1629 / 1630 / 1631
> v0.2（同日）：并入 Codex 桥 22b33bb2 的 OPEN MUST——"人看的题面 ↔ 唯一机器命题"无绑定（title 写 A 场、predicate 指 B 场仍可建）⇒ 新增 §2.6 命题身份绑定 + §3 / §4 / §7 对应行。v0.1 其余不变。
> v0.2.1（同日）：Codex 159a4763 对 v0.2 判 SUPPORTED + 1 MUST——事件 id 不得只抄 URL 参数，须与取回载荷自报的事件身份相等 ⇒ §2.6-1 补"载荷身份核对"，§7 补负测 3。
> v0.2.2（同日）：NWT 设计审（`origin/nwt/d032-v021-review-20260922` @6d113f28）方向通过 + 1 MUST——赛前变体没有"参赛方已确定"约束，预告页一侧占位符（待定）会被冻进 spec，对阵确定后 §2.6-6 回验必然 `event_identity_mismatch` 冻结 ⇒ §2.6-1 补"参赛方已定"fail-closed；两条 SHOULD（D-032 §2 枚举加状态注记；`assertUmaWindowSafe` 死代码与 proto.js:144 未用 import 落码顺手清）已记。另补 §2.7：`/resolve` 人工裁决占位不实现（D-029 9-3 由 D-032 取代，Owner 可否决）。
> v0.2.3（同日）：Codex 7aab3e2c 审 v0.2.2 SUPPORTED + 两点收紧——参赛方已定以**结构化身份为主判据**、占位符字符串只作辅助（§2.6-1）；主网非判定题在 /resolve 不存在时**建题即拒**，不许隐含手工出口（§2.7 建题闸 + §7 测试）。
> 待 NWT 设计审（红队：出题端）→ 派 J2 实现 → NWT 审 diff → 合入 → 随下次主网 console 重启生效（adapter 开关仍默认关，有价值判定题仍 N5b 限制 + Owner 单独批）。

## 0. 已有什么（D-031 第一问 · 扫 kasia-console/src/services 全目录 + index.js 启动注册 + 主网日志 + 能力清单 v0.1）

| 现有物 | 位置 | 本设计的处置 |
|---|---|---|
| 老系统 voter：**一市场一源**，`deriveVote` 按 `outcome_market_source` 二选一（polymarket 路 / kanet_native 路） | `services/bettor-prediction-voter.js:748–784` | **复用其模型**：单口径就是回到这一模型；引擎内核 `deriveKanetNativeVote` 不改 |
| ESPN 确定性判定：`resolution_predicate` → `judgeLine`，命中即判、抽不到即 ABSTAIN、**永不回落 LLM**；平局 winner→NO、整数线 push→NO 已是确定性规则 | `voter.js:940–990`，`lib/judgeline.mjs:69–100,121–145` | 复用，作为唯一裁判；平局/push 规则写进公开视图（§4） |
| 判定题创建校验（白名单源、predicate 结构 + 干跑、side_map、5 必填、deadline 预算） | `lib/proto-oracle-spec.mjs:73–120`，入口 `api/proto.js:148` | 迭代：去掉第二裁判的三项输入（§2.1） |
| adapter tick（扫 sealed 判定题 → derive 两路 → 写 verdict → 批 D 门） | `lib/proto-oracle-adapter-core.mjs`，服务 `services/proto-oracle-adapter.mjs`（index.js:955 注册，`PROTO_ORACLE_ADAPTER_ENABLED` 默认关；主网 env 未设该键） | 迭代：删 uma 路（§2.2） |
| 批 D promote 门（冻结集 / 赞成集 / 宽限 / late_seal / R5） | `lib/proto-settlement-budget.mjs:170–221` | 迭代：赞成集改单裁判（§2.3），冻结原因表见 §3 |
| verdict 分类 / side 映射 | `lib/proto-oracle-verdict.mjs:34–92` | 迭代：删 uma 分支与极性翻转（§2.2） |
| "有判定题"唯一定义（四列任一非 NULL） | `db/proto-judged.mjs` | **不改**（`resolution_rule_spec` 非 NULL 即判定题） |
| 老系统 prevet 预审框架（`/api/pool/prevet`，120 fixture） | `scripts/prevet-fp-fn-*.mjs` | 参照：TypeSafe 建题预审 PoC（J1，账本 1629）跑在它的 fixture 上；本设计只留挂点（§6） |
| 退款出口 refund_flip（R-a 已合） | `lib/proto-settlement-store.mjs` / driver | 复用：冻结市场的出口已存在 ⇒ 批 B "缺 UMA 条件 = 无出口"这一前提**不再成立**（§1） |
| simnet 上游 mock（ESPN / Polymarket 拦截） | `scratch/_j2_e2e/upstream-mock.mjs`（J2 本轮在用） | 复用做 e2e（§7），不新造 |
| ESPN summary 参赛方定位解析 `parseEspnSummary`（只认 final）+ `normalizeAbbr`（抽取侧与谓词侧共用一个规范化函数） | `lib/oracle-evidence-extractors.mjs:72–92, 38` | 复用：§2.6 建题时的事件身份取自同一段 competitors 定位逻辑（抽出赛前变体，不另写第二份解析） |
| 老系统赛前取 ESPN 事件 `predictPreMatch`（fetch 15 s 超时 + competitors home/away） | `api/oracle-pool.js:571–596`（路由内嵌函数，做赔率预测） | 参照其 fetch / 超时 / fail-closed 形状；不复用其赔率逻辑 |
| 主网现状 | `proto_markets` 3 行均非判定题；`proto_market_verdicts` 0 行 | 无存量双裁判市场 ⇒ **不需要迁移**，uma 路可直接删 |

**为什么不能用现状**：批 B 把 ESPN 谓词与 Polymarket 条件 id 同时挂到一道题上（设计 §4 R2 "≥2 独立来源一致"），两路互不见对方输入（NWT 红队缺口①根因），配错 / 极性标反即 `inconsistent_verdicts` 冻结——这是"两个裁判在回答两道题"，不是数据源冗余。D-032 定：一题一个确定性口径；不一致不是冻结的正当理由。

## 1. 目标与不变量

- **I-1 一题一裁判**：判定题的 `resolution_rule_spec` 只允许一个判定口径 = `data_source_canonical`（ESPN 白名单）+ `resolution_predicate`；不再接受、也不再运行第二个自动裁判。
- **I-2 可复算**：任何人拿 `(data_source_canonical, resolution_predicate, outcome_end_ms)` 与 ESPN 当时的结构化字段能算出同一答案；`proto_market_verdicts.evidence_ref` 继续存 `fields + predicate + verdict` 的 hash（现状已如此）。
- **I-3 冻结只因基础设施故障**（D-032 §2）：源不可达 / 未 final / spec 损坏 / 源不在注册表 / 过截止未判 / 封盘太晚 / R5 预检失败。**`inconsistent_verdicts` 在单口径下不可达**；保留其守卫作为"出现了不该存在的第二裁判"的 fail-safe（§3）。
- **I-4 出口不变**：冻结 → refund_flip（R-a）→ R-b/R-c；本设计不动退款路。
- **I-5 零主网触碰**：adapter 仍默认关；N5b 有价值判定题限制不变；打开 = Owner 单独批。
- **I-6 无迁移**：主网无判定题行，不写 migration；`proto_judged.mjs` 定义不变。

## 2. 变更清单（只列改动，行号按主线 1ad8d235）

### 2.1 创建入口 `lib/proto-oracle-spec.mjs`（+ `api/proto.js:114/148` 只改解构/传参）
- `JUDGED_BODY_KEYS` = `['resolutionRuleSpec','outcomeEnd']`；请求体出现 `outcomeConditionId`（及任何 `outcome*` / `polymarket*` 形状键）⇒ 400 `dual_judge_not_allowed`（复用 `findUnrecognizedJudgedShapedKey` 的模式，不静默丢）。
- `ALLOWED_SPEC_KEYS` 去掉 `polymarket_outcome_side`；spec 出现该键 ⇒ 400 `spec_unknown_field`（既有错误码）。
- `validateJudgedMarketInput`：删 `outcomeConditionId` / `umaWindowMs` 参数与 L77 / L106 / L108 / L113–114 四段；`minDeadlineMs = outcome_end + graceMs + closePipelineMarginMs + 2·adapterTickMs`（去掉 UMA 定稿窗）。
- `normalized.outcome_market_source = 'kanet_native'`（migrate.js:3776 注释里既有的枚举值），`outcome_condition_id = null`。
- 其余（白名单源 + `kind==='espn'`、predicate 结构 + 干跑、side_map 双射、5 必填、deadline 预算）**一字不改**。

### 2.2 判定侧 `lib/proto-oracle-adapter-core.mjs` / `lib/proto-oracle-verdict.mjs`
- adapter：删 `deriveUma` 注入、`doUma` 分支、`assertUmaWindowSafe` 拒 tick、`CONDITION_ID_RE` 引用；L61 spec 校验改为 `!spec || !sideMap ⇒ permanentFreeze('spec_invalid')`（**去掉对 `polymarket_outcome_side` 的要求，否则单口径市场会在第一 tick 被永久冻结**）。
- verdict：`classifyDerivation` / `toSide` 删 `uma` 分支与极性翻转；`branch` 只剩 `'extractor'`。`planVerdictWrites` 不改。
- 服务 `services/proto-oracle-adapter.mjs`：删 `derivePolymarketVote` 与 `UMA_FINALIZATION_WINDOW_MS` 的 import / 注入；其余（开关、单飞、LOUD 启动行）不改。
- **不改** `deriveKanetNativeVote` 内核、`freezeMarket` / `promoteWinningSide`（批 D）、`proto_market_verdicts` 触发器。

### 2.3 promote 门 `lib/proto-settlement-budget.mjs:170–221`
- `AUTO_KINDS = ['extractor']`；赞成集 = `source_kind==='extractor' ∧ pmt_at ≥ outcome_end`，`consistencyMetAt` = 首条合格 extractor 票的 `pmt_at`；删"≥2 种 kind"循环与 `awaiting_second_source`，改 `wait: awaiting_canonical_verdict`。
- 冻结集不变（全部 verdict）；**新增守卫**：存在 `source_kind ∉ {'extractor'}` 的 verdict ⇒ `freeze: unexpected_verdict_kind`（fail-safe：单口径下不该有别的裁判写票；D-030 AI 不进出口闸，llm 票既不能批也不该出现）。原 `abstain_or_dispute` / `inconsistent_verdicts` 两行保留在其后（可达性由测试证明为"仅 unexpected 路"）。
- 宽限窗 / late_seal / R5 预检 / cutoff 逻辑**一字不改**（宽限缩短记 SHOULD 票，另议）。

### 2.4 公开视图 `presentProtoMarket`
- `judged` 去掉 `polymarket_outcome_side` / `outcome_market_source` / `outcome_condition_id`；新增 `judge: { kind:'espn-judgeline', predicate, tie_rule:'winner: 平局=NO; margin/total/score: 恰等于线(push)=NO', value_time: outcome_end_ms }`（文本由代码常量给出，不由运营者填）；新增 `human_metadata_only: ['secondary_sources','ambiguity_handler','dispute_keywords','edge_case_examples']`（§5）。

### 2.5 lint（复用 `scripts/lint-kanet.mjs` 规则模式）
- `R-SINGLE-JUDGE`：`src/lib/proto-*.mjs` / `src/services/proto-*.mjs` / `src/api/proto.js` 内出现 `derivePolymarketVote|outcomeConditionId|polymarket_outcome_side|UMA_FINALIZATION_WINDOW_MS` ⇒ 红。（老系统文件不在范围。）

### 2.6 命题身份绑定（v0.2 · Codex 22b33bb2 OPEN MUST · 题面 ↔ 唯一机器命题）
**问题**：§2.1 之后仍能"title 写湖人、predicate 指另一场"——现有校验只证 predicate 可执行，不证它与人看到的题是同一件事。**原则**：以机器命题为权威，人看的判定语句由机器命题**生成**，运营者对生成语句**原样回签**；title 退为展示标签。
1. **建题时取事件身份（fail-closed）**：`validateJudgedMarketInput` 通过后、`ensureMarketPending` 前，用 `data_source_canonical` 取一次 ESPN summary（15 s 超时，形状同 `predictPreMatch`），经 `oracle-evidence-extractors.mjs` 抽出的**赛前变体** `parseEspnParticipants(rawText)`（与 `parseEspnSummary` 共用同一段 competitors / home / away / league 定位代码，只去掉 final 要求）得到 `canonical_event = { event_id, league, home:{abbr,name}, away:{abbr,name}, start_ms（ESPN date）, fetched_at }`。取不到 / 结构异常 ⇒ 409 `source_unreachable_at_creation`，**不建**。
   **载荷身份核对（v0.2.1 · Codex 159a4763 MUST）**：`event_id` 取自**载荷自报**的 `header.id`（须与 `header.competitions[0].id` 相同），再与 URL 的 `event` 参数逐字相等；载荷缺 id / 两处不一致 / URL≠载荷 / 参赛方或开赛时间与该 id 不自洽 ⇒ 400 `event_identity_unverified`，不建。判定时（§2.6-6）的回验走**同一个**身份抽取函数（放在 `oracle-evidence-extractors.mjs`，与 `parseEspnParticipants` 同源），不另写第二份。J2 的 simnet 上游 mock 须补 `header.id` / `competitions[0].id` 字段（现 mock 无 id，见 `scratch/_j2_e2e/upstream-mock.mjs:23`）。
   **参赛方已定（v0.2.2 · NWT MUST；v0.2.3 按 Codex 7aab3e2c 定主次）**：两侧 competitor 都必须是已确定的真实球队才允许建题。**主判据 = 结构化身份**：每侧须有非空且互不相同的 `team.id`、非空 `team.abbreviation`（经 `normalizeAbbr` 后 ≠ `TIE_TOKEN`），以及判定器实际消费的字段齐全；**任一项拿不到即 fail-closed**，不靠字符串清单兜底。**辅助判据 = 占位符特征**（`TBD` / `TBA` / 含"Winner of" / "胜者" 一类）只作补充拦截；新拼法漏过清单**不得**因此变成合法身份（因为主判据已先拦）。具体结构与 signal 由 J2 落码前用真实 ESPN 预告页（未定对阵）与已定对阵两种响应核实并写进 provenance，抽成常量表放 `oracle-evidence-extractors.mjs` 与 `parseEspnParticipants` 同源。不满足 ⇒ 409 `event_participants_not_determined`，走与 `source_unreachable_at_creation` 同一拒建通道。同时 `home.abbr ≠ away.abbr`（既有规则）。本项是叠加，不削弱载荷 id 三向相等。**理由**：季后赛系列赛下一轮 ESPN 先建预告页、一侧占位，占位符冻进 spec 后对阵确定 ⇒ §2.6-6 必然冻结，这是正常运营节奏下 100% 撞上的"非故障冻结"，违反 D-032 §2。
2. **predicate 与事件对齐**：`normalizeAbbr(predicate.subject ?? predicate.operand)`（winner 用 operand，margin/score 用 subject）必须 ∈ `{home.abbr, away.abbr}`，否则 400 `predicate_team_not_in_event`。
3. **服务端渲染判定语句**（纯函数 `renderResolutionStatement(canonical_event, predicate, side_map, outcome_end_ms)`，代码模板，运营者不可改）：例 `ESPN {league} event {event_id} · {away.name} @ {home.name} · {start ISO} · 判定：winner == {operand}（平局=NO）· 取值时刻 ≥ {outcome_end ISO} · yes→side {side_map.yes} / no→side {side_map.no}`。
4. **回签**：请求须带 `attestStatement`；缺 ⇒ 409 `attest_required`，响应体回 `{ statement, canonical_event }` 让运营者第二次原样带回；不等 ⇒ 400 `attest_mismatch`。两步建题，不做模糊匹配。
5. **冻结进 spec**：`canonical_event` 与 `resolution_statement` 写入 `resolution_rule_spec`（与 predicate 同一 JSON，随市场不可变；`ALLOWED_SPEC_KEYS` 加这两键，但**只允许服务端写入**——请求体出现即 400 `spec_unknown_field`，与 relay 键同一处理）。
6. **判定时回验**：adapter 拿到 `extractEspnFields` 的 `home_team / away_team` 后，与 `canonical_event.home.abbr / away.abbr` 逐一相等才进 judgeLine；不等 ⇒ `permanentFreeze('event_identity_mismatch')`（源在建题后换了事件 = 基础设施故障，D-032 §2 允许）。这是"公开视图看到的 = 裁判实际用的"的往返闭合。
7. **公开视图**（§2.4 补）：`judge.statement` 与 `judge.canonical_event` 置于 `question` 之前返回；UI（KANet-UI 域，另票）展示语句为主、title 为辅。

**不做**：不用语义 / 模糊文本匹配判断 title 与事件是否"像"（Codex 明确不接受作为不变量；§6 TypeSafe 预审仍只是参谋）。

### 2.7 `/resolve` 人工裁决：占位不实现（v0.2.2 · Bettor 默认裁定 · Owner 可否决）
- **地面事实**（2026-09-22 核）：`POST /api/proto-markets/:id/resolve`（`api/proto.js:311`）调的是模块级占位 `buildAndBroadcast`（`proto.js:38–40`，任何调用必抛）⇒ 501、不写库；全仓唯一写 `winning_side` 的生产代码是批 D 的 `PROMOTE_UPDATE_SQL`（`proto-settlement-budget.mjs:221`）。主网 a59c7b48 的 `winning_side=1` 而 source / set_at / verdict_id 全空 = 账本 1602 所记 Bettor 受控 write-once 手写，1602 已把"正式 /resolve 授权路径"列为未验。**D-029 的 9-3 从未实现。**
- **裁定**：按 D-032（一题一个确定性口径；运营者没有裁决按钮；C2 判定题无人工 resolve 出口），**不实现人工 `/resolve`**。非判定题市场在主网没有结果路径，只能走冻结 → 退款，因此**主网新建市场必须是判定题**。`/resolve` 端点保留 501 占位并在响应 detail 写明"按 D-032 不提供人工裁决"，或随本批删除——J2 落码时二选一，NWT 审。
- **建题闸（v0.2.3 · Codex 7aab3e2c MUST）**：`/api/proto-markets/create` 在 `hasJudgedInput(body) === false` 且 `configuredNetwork() === 'mainnet'` 时 ⇒ 409 `non_judged_market_not_allowed_here`（detail 写明"主网无人工裁决路径，非判定题只许 simnet"），放在 tokenId / title 校验之后、任何 DB 写之前；network 读不到 ⇒ fail-closed 拒。与既有 `judgedMarketAllowedHere`（N5b：主网 + 有价值代币 ⇒ 拒判定题）并列 ⇒ 当前主网任何新市场都建不了，直到 Owner 单独开 N5b；这是有意的 HOLD，不是缺陷。任何测试不得依赖"事后手写 winning_side"这类隐藏出口。
- **对 J2 F1 对抗重跑的影响**：simnet 上非判定题市场的 `winning_side` 只能 SQL 写（J2 12:17Z 回执已查证，与本节一致），provenance 如实注明即可。
- **DECISIONS**：D-029 §1 "9-3 /resolve" 加状态注记指向本节（不改 Owner 原话）。

## 3. 冻结触发清单（改后 · 对照 D-032 §2）

| reason | 触发 | 类别 | 处置 |
|---|---|---|---|
| `spec_invalid` / `source_not_registered` | spec 坏 / 源不在注册表（永久） | 规格损坏 | 保留 |
| `abstain_or_dispute` | 唯一裁判 ABSTAIN（源未 final / 抽取失败 / 源异常） | 数据源不可达或未出结果 | 保留（这是"故障"，不是"分歧"） |
| `pmt_invalid_past_cutoff` / `past_cutoff` | 过截止未判 | 过截止 | 保留 |
| `late_seal` | 封盘太晚装不下宽限 | 封盘太晚 | 保留 |
| `r5_precheck_failed` | 胜方侧非恰 1 笔 / 奖池 0 | 系统状态 | 保留 |
| `unexpected_verdict_kind` | 出现非 extractor 票 | 系统故障（不该存在的裁判） | **新增** |
| `event_identity_mismatch` | 判定时抽到的参赛方 ≠ 建题冻结的 canonical_event | 数据源在建题后指向了别的事件 | **新增（v0.2 §2.6-6）** |
| `inconsistent_verdicts` | — | 单口径下**不可达** | 守卫保留，测试证明不可达 |

## 4. 出题端闭环四要素 → 现有落点（D-032 §1）

| 要素 | 落点 | 状态 |
|---|---|---|
| 结构化来源 | `findExtractor(url).kind==='espn'`（白名单 + https + 拒私网） | 现有 |
| 取值时刻 | `outcome_end_ms`（结果可知时刻）+ ESPN `final` 标志（未 final ⇒ ABSTAIN） | 现有 |
| 阈值 / 比较方向 | `resolution_predicate {metric∈winner/margin/total/score, op, operand, scale, subject}` + `validateResolutionPredicate` + 干跑 | 现有 |
| 平局规则 | judgeLine：winner 平局=NO；数值 push=NO（代码常量，运营者不可改）；公开视图回显（§2.4） | 现有规则 + 新增回显 |
| **命题身份**（人看的题 = 机器判的题） | §2.6：建题取事件身份 → predicate 队名 ∈ 参赛方 → 服务端渲染语句 → 运营者原样回签 → 冻结进 spec → 判定时回验 | **v0.2 新增** |

## 5. 四个"人工存档"字段（NWT 缺口② / Codex）
- `secondary_sources` / `ambiguity_handler` / `dispute_keywords` / `edge_case_examples`：判定代码从不读取（Bettor 独立 grep 复核属实）。本版**不接判定、不删必填**（零行为变化），只在公开视图与 spec.mjs 顶注如实标"仅人工争议 / 审计参考，自动判定不读取"。
- SHOULD 票：从判定题必填清单移除（老 bettor.js 遗产），另议。

## 6. TypeSafe 建题预审挂点（D-030 · 仅参谋）
- 挂点 = `api/proto.js` 在 `validateJudgedMarketInput` **通过之后**、`ensureMarketPending` 之前；输入只用题面（title / predicate / 源 URL / 截止）；输出 `advisory: { resolvable_noul, threshold }` 回显给运营者，**不改变创建结果**（v1 不拒建）。
- 是否启用、阈值 = 等 J1 PoC #1 的 FP/FN 数字（账本 1629）；本设计只定挂点与数据边界（D-021：不发真实市场 / 余额 / 内网）。

## 7. 测试与验收（J2 交付；NWT 审 MUST-only）
- 单测（改既有文件，不新起套件）：创建拒 `outcomeConditionId` / `polymarket_outcome_side`；正常单口径创建 `outcome_market_source='kanet_native'`；adapter 单口径市场不因缺极性冻结；门：一条合格 extractor 票过宽限即 promote；ABSTAIN ⇒ `abstain_or_dispute`；注入 `llm` / `uma` 票 ⇒ `unexpected_verdict_kind`；`inconsistent_verdicts` 不可达（删该行所有测试仍绿 = 用突变证明不可达，写进 provenance）。
- 变异：删 §2.3 新增守卫必红；把 `AUTO_KINDS` 加回 `'uma'` 必红；lint 规则对四个标识各一条红。
- **§2.6 命题绑定（Codex 要求的证据）**：负测——title 写 A 场 + predicate / URL 指 B 场：无 `attestStatement` ⇒ 409 且响应语句写的是 B 场参赛方；带错语句 ⇒ 400；operand 不在参赛方 ⇒ 400；源不可达 ⇒ 409 不建；**URL 指 A 而载荷 `header.id` 为 B（参赛方可重叠 / 相似）⇒ 400 `event_identity_unverified`，删掉载荷 id 相等检查该测必红**。变异——删掉 §2.6-2 队名对齐或 §2.6-4 回签比对，负测必红。往返——公开视图 `judge.statement / canonical_event` 与 adapter 判定时实际比对 / 消费的 `home_team / away_team / predicate / side_map / outcome_end_ms` 逐字段相等（同一 fixture 走建题与判定两端）；篡改 mock ESPN 的参赛方 ⇒ `event_identity_mismatch` 冻结。**参赛方已定（Codex 7aab3e2c 六条）**：真实 ESPN 已定对阵 fixture ⇒ 建成；未定对阵（一侧缺 team.id / 占位）fixture ⇒ 409 `event_participants_not_determined`；绕过该检查 ⇒ 负测必红；**主网非判定题建题 ⇒ 409 `non_judged_market_not_allowed_here`**，simnet 允许；无任何测试依赖隐藏的手写出口。
- **NWT 红队复跑（关 3）**：用改后的建题接口重跑 1625 的三条题面——①无关 condition id ⇒ 400；③极性 ⇒ 400；②字段标注可见；再尝试构造任何"非故障却冻结"的题，能出即 MUST。
- simnet e2e（复用 J2 现有隔离环境与 upstream-mock）：建单口径判定题 → 下注 → seal → mock ESPN final → adapter 判 → promote → close_commit → claim（正臂）；mock ESPN 不 final 直到 cutoff → 冻结 → refund_flip（故障臂）。simnet-only。
- 验收口径：**机制证通（simnet）**，不 claim 主网；主网启用仍走 N5b + Owner 批。

## 8. 后续票（不在本版）
- Polymarket-only 单口径（UMA 定案作为唯一裁判）：需要"取回问题文本与结果标签、运营者确认极性并固化进 spec"的建题流程（Codex MUST），另出 v0.x。
- 宽限窗按单口径重估；四字段移出必填；`docs/2026-09-20-bettor-oracle-batchB-*` §4 / §5 / §7 已加取代注记。

## 9. 取代关系
- 取代批 B 设计 §4（R2 多源独立）、§5（TypeSafe 作 verdict 可冻结 —— 与 D-030 / D-032 冲突）、§7 第二段之"UMA 条件必填"；批 A / D 其余不动。
