> **Status**: CURRENT (v0.2 · 2026-09-20 据 NWT 红队 9b14187e 并入 B1–B7 见 §10 · 待 NWT MUST-only 复核第 2 轮)

# oracle 整合 批 B 设计 v0.1：adapter — 扫市场 → deriveVote → 写 verdicts → 经批 D 门 promote

- 属主设计:oracle 整合 v0.2(两段式)。前置:批 A(3589baa2 write-once/verdicts 表)+ 批 D(e8de0781 promote 门/冻结/受理门/pmt 有效性)已合。
- 本批 = 把**现有 deriveVote 引擎**(bettor-prediction-voter.js:748 起,老系统在用)接到 proto_markets,**复用不重写**;写值仍经批 D 的 promote 门 + 批 A 的 write-once 触发器。
- **N5b 硬前置**:refund 执行(refund_flip 广播 + ticket reclaim)未接线 ⇒ **本批判定路径仅零价值/simnet 市场,不对有价值市场上主网**。
- 走既有门:Bettor 设计 → NWT 红队 → J2 实现 → NWT 审 → 合(只合不部署)→ simnet 端到端(含争议/超时/退款终局)→ 主网(Owner GO)。

## 0. 复用什么(不改内核)
- `deriveVote(market-like)`:按 `resolution_rule_spec.data_source_canonical` 走已知源抽取器(ESPN/CoinGecko/…)→ 确定性判 or LLM 共识;**ABSTAIN-not-guess**。
- `derivePolymarketVote`:UMA 镜像(48h 定稿窗)。
- voter cron 形态(5min tick、`processVoter`/`processPoolMarket` 的扫描-判定-写事件模式)。
- 批 A verdicts 表 + pmt_at;批 D promote 门(`promoteWinningSide` 六前置)、冻结、受理门。

## 1. adapter 扫描分支(新增,平行 processPoolMarket)
- voter cron 加分支扫 `proto_markets`:`status='sealed'` ∧ `winning_side IS NULL` ∧ `settlement_frozen_at IS NULL` ∧ 有判定题(批 A `JUDGED` 定义)∧ `pmt ≥ outcome_end_ms`(pmt 按批 D 有效性;无效则本 tick 跳过,方向安全)。
- 构造 offer 形状适配对象喂 `deriveVote`(把 proto_markets 的 resolution_rule_spec/outcome_* 映射成引擎入参);**只读市场行,不在扫描里写钱路列**。

## 2. verdict 写入(append-only,批 A 保护)
- 每个来源(extractor/uma/llm)一条 `proto_market_verdicts` 行:`source_kind`、`outcome`(0/1,或 NULL=ABSTAIN/异议)、`pmt_at`(写入时的有效 pmt;pmt 无效则**不写该 verdict**,等下 tick——因批 D M1 冻结集含 pmt_at NULL 异议,乱写 NULL 会误冻)、`evidence_ref`(必填)、`confidence?`。
- 同市场同来源同 tick 幂等(已存在则不重写,靠批 A dup-id ABORT + 上层查重)。**verdict 只增不改**(批 A)。

## 3. promote(经批 D 门,写 winning_side)
- 每 tick 对候选市场调批 D `promoteWinningSide` 门(六前置:sealed∧未判∧未冻 / outcome_end 已知∧pmt≥outcome_end∧verdict.pmt_at≥outcome_end / pmt<cutoff / 宽限窗过 / **R2 一致** / R5 胜方预检)。
- 门返回 **promote** ⇒ 执行批 D 的 guarded UPDATE 写 winning_side(source='extractor'/'uma'、verdict_id 指向那条一致判定);**wait** ⇒ 本 tick 不动;**freeze** ⇒ 写 settlement_frozen_at(批 D 冻结写不依赖 pmt、退墙钟标 clock=wall)。
- **赞成集**(批 D)仅 extractor/uma、pmt_at 安全整数∧≥outcome_end;**llm/human 永不批准、只能触发冻结**(M1/M3)。

## 4. R2 多源独立(批 D M1 已定,adapter 供数)
- "≥2 独立来源一致" = ≥2 条**不同 source_kind∈{extractor,uma}** 且 outcome 相同(同一 source_kind 多条不算独立)。来源清单来自 `resolution_rule_spec.data_source_canonical + secondary_sources`。
- 任一 extractor/uma/human/llm 的异议(outcome≠胜方)或 NULL(ABSTAIN)⇒ 冻结(批 D M1)。单一来源、来源冲突、全 ABSTAIN ⇒ wait/冻结,**绝不单源自动动钱**。

## 5. TypeSafe(D-030,仅 proposal)
- LLM/主观判定路径用 TypeSafe(Noul/Choice+confidence)产 `source_kind='llm'` 的 verdict:**只作 proposal/置信参考,永不进赞成集**(不能促成 promote),但**可触发冻结**(与胜方不一致时,fail-safe)。
- **数据边界(D-021)**:只发非敏感/合成/公开判断输入给 api.typesafe.ai;`TYPESAFE_API_KEY` 不入库/日志;真实资金规模/内网/密钥不发。
- 低置信 TypeSafe 输出 = ABSTAIN(outcome NULL),按 M1 计入异议集(fail-safe:AI 拿不准就让人工/退款,不猜)。

## 6. 委员会框架(M4 诚实定性)
- 主网现 0 个 is_oracle relay ⇒ v0 判定 = **deriveVote 引擎由运营方跑 = "单运营方裁决机(operator-adjudicator)"**,如实定性,**不冒充去中心化委员会**。R2 的"多源"是**数据源独立**(不同 canonical 源),不是"多个独立 relay 委员"。
- 去中心化委员会(oracle 报名/押金上链)= 演进目标,另立票,不在批 B。

## 7. 创建入口要求(N3,批 B 前置)
- 建判定题市场时 **必填 outcome_end_ms** + 校验 `deadline_ms ≥ outcome_end_ms + 投票预算 + 宽限窗 + margin`(批 D §2 常量);缺 outcome_end_ms 或关系不满足 ⇒ 拒建(现创建路由只收 tokenId/title/deadline/resolutionNote,要扩)。
- resolution_rule_spec 5 必填(复用老系统校验 bettor.js:1032)。

## 8. 交付范围 + 上线前置
- adapter 扫描分支 + offer 适配 + verdict 写入 + promote 门调用 + TypeSafe proposal 接入 + 创建入口 outcome_end/spec 要求。
- **不改** deriveVote 内核、批 A/D 的门与触发器。
- **上线前置(N5b)**:refund 执行批未落地前,**仅 simnet / 零价值市场**;主网上有价值市场须等 refund 执行批 + Owner GO。
- 测试+变异:单源不 promote、来源冲突冻结、全 ABSTAIN 冻结/wait、llm 不能批准能冻、TypeSafe 低置信=ABSTAIN、pmt 无效不写 verdict、创建入口拒无 outcome_end、与批 A/D 门自洽(promote 走 guarded UPDATE、冻结经批 D)。
- **simnet 端到端**(批 B 合后):建判定题市场→下注→seal→adapter 判定(含注入不一致/ABSTAIN 触发冻结→refund 终局、注入晚 seal→冻结)→promote→close_commit→convert→claim,与批 9 结算链打通。

## 9. 待 NWT 红队(重点)
- R2 "独立来源"的真实独立性(同一 API 的两个字段算不算两源?canonical vs secondary 的独立判据)。
- TypeSafe/LLM 严格只 proposal、不越权进赞成集的代码级保证(与 M3)。
- adapter 读 pmt/抽取失败的 fail-safe(不写 NULL 误冻 vs 该冻不冻)。
- 与批 A/D 门/触发器逐一自洽(promote 只经 guarded UPDATE、冻结只经批 D 路径、write-once)。
- N5b 落地机制(怎么在代码/配置上保证"有价值市场不上主网",不只靠文档)。
- 创建入口扩字段对既有 proto 建市场流的影响面。

## 10. v0.2 据 NWT 红队(9b14187e)并入 B1–B7（设计审第 2 轮前定稿,待 NWT MUST-only 复核）
> Status 升 v0.2。B1–B7 是批 B 实现验收硬项。

- **B1 source_kind 单一贴标(最重)**:批 A/D 全靠此标签,若"命中已知抽取器⇒extractor"贴标,LLM 结果会以 extractor 进赞成集、门拦不住。**单一纯函数 classifySourceKind**:仅 `extractor_kind_used==='judgeline-deterministic'`(有 resolution_predicate 的确定性算术)⇒ **extractor**;仅 `derivePolymarketVote` 且 `ok:true`(过 UMA 定稿窗)⇒ **uma**;**其余一切有 outcome 的结果 + 未知/新增 extractor_kind_used ⇒ llm**(证据由抽取器抽、判定交 Qwen 的都算 llm 决策)。用真 deriveKanetNativeVote 各返回形态(含未知值)测,变异"LLM 路径改标 extractor"必红。**UMA_FINALIZATION_WINDOW_MS 的 env 覆盖:proto 路径拒 <24h**(否则未定稿 UMA 被贴 uma)。
- **B2 ABSTAIN 暂态 vs 实质**(verdict 只增不删、NULL 即冻结):**暂态**(赛果未 final / 抽取器 null / 取数失败 / 超时 / pmt 无效)⇒ **不写、下 tick 重试到 cutoff**;**实质**(源已 final 但字段不足 / judgeline-abstain / LLM 低置信 / 明确争议)⇒ **写 NULL**。给 `extractor_kind_used → 暂态/实质` 枚举表,**未知值按暂态**。**同 (市场,source_kind,证据哈希) 至多一条 verdict**;**LLM 每市场在抽取器 final 后只问一次**(防非确定性写出相反两行冻死市场)。
- **B3 outcome↔side 映射**(写值不可改、错一位赢家侧反):规格显式带 `side_map`,**创建时校验 + 存入不可改列**(批 A R4 锁);三来源各过同一 `toSide()`;UMA 走 polymarket outcome_side 极性。用真生产者输出(三路径各一份 YES/NO)测 + 极性反对照臂。
- **B4 pmt 无效对异议 fail-open**(同批 D M1):**赞成 ⇒ pmt 无效不写;实质异议 / 实质 ABSTAIN ⇒ pmt 无效也写(pmt_at=NULL,批 D M1 正为这种行设计)**。与 B2 合成一张表:{暂态:不写}{实质异议:必写}{赞成:pmt 有效才写}。
- **B5 N5b 一个谓词、三处强制、默认关**:新 env **`PROTO_ORACLE_ADAPTER_ENABLED`(默认关,driver 开关同级,翻开须 Owner)** + **`PROTO_ORACLE_VALUELESS_TOKEN_IDS`(主网唯一允许判定题的 token 白名单)**;共享谓词 **`judgedMarketAllowedHere({network,tokenDefId})`** 在 ①创建入口(主网+非白名单⇒拒建判定题)②受理门(纵深)③adapter 扫描+promote 三处调用;启动 LOUD 打印生效值;测试/lint 钉"三处调同一谓词"。非主网不受限。
- **B6 创建入口(最大输入面)**:(a) **data_source_canonical 只接受 findExtractor(url) 命中的白名单源**,拒 free-text / 任意 http(s) / 本机内网(deriveKanetNativeVote 会在判已知源前 fetch(url) 且把 localhost 改写成本机 console 端口=SSRF 面),adapter 复核同一注册表;(b) **自动 promote 需"有 resolution_predicate 的确定性抽取器源"∧"polymarket/UMA 条件"两条都在**,缺一 ⇒ 创建时拒或标"仅人工/退款"(否则只会 cutoff 冻结→退款);(c) `deadline_ms ≥ outcome_end_ms + 各来源真实时延`,**UMA 默认 48h 定稿窗必算进 §7 预算**;(d) **不从请求体收 relay id 类字段**(复用 rejectRelayIdInBody),outcome_oracle_relay_ids 服务端定;ensureMarketPending 同一 INSERT 写全判定题列;不复制"收 resolutionNote 却丢弃"的形态;(e) **字段全可选,缺省行为与今天逐字节相同 + 回归测试**。
- **B7 promote 原子再守异议**:批 D PROMOTE_UPDATE_SQL 谓词只带 sealed∧winning_side NULL∧frozen NULL,R2/异议检查在 JS、与写值不原子;adapter 是第一个真调用方 + 写值不可改 ⇒ **把 `NOT EXISTS(SELECT 1 FROM proto_market_verdicts v WHERE v.market_id=? AND (v.outcome IS NULL OR v.outcome<>?))` 加进同一条 UPDATE 的 WHERE**(或包 BEGIN IMMEDIATE);测"异议行在检查后插入⇒changes==0"。
- **NWT ①–⑥ 采纳**:① R2 独立性=**运营方选源的机制独立(确定性抽取器 vs UMA 人投预言机),不含问题等价性证明**(predicate 与 polymarket 条件都建市场者填、无校验),复用现有 parallel judgment 的"假并行"守卫(独立源不得都是 polymarket/gamma);② **llm verdict 走本地 Qwen(deriveKanetNativeVote 的 LLM 路)还是 TypeSafe——设计明确:TypeSafe 用作主观题的 llm proposal,Qwen 路同归 llm 类**;"能冻"是 grief 杠杆(控证据页者可诱导异议)⇒虚假冻结率监控要真接线(SHOULD);③ 见 B2+B4;④ promote 只经 guarded UPDATE(+B7)、冻结只经批 D freezeMarket、write-once ✅;**人工冻结/human verdict 无写入路径 ⇒ SHOULD:带鉴权+审计的最小管理入口作应急刹车**;⑤ 见 B5;⑥ 见 B6。
- **SHOULD 记票**:人工冻结/human verdict 鉴权入口;同 (市场,来源) verdict 写入事务内查重;TypeSafe 只送标题/公开证据+长度上限+key 不入日志;resolution_rule_spec 5 必填复用 bettor.js;simnet 端到端补"UMA 未定稿⇒ABSTAIN 不冻结 / 定稿后 promote"、"LLM 诱导异议⇒冻结"。
