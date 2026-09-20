> **Status**: CURRENT (v0.1 · 待 NWT 红队)

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
