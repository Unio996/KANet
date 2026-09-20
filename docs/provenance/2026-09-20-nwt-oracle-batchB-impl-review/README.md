> **Status**: CURRENT（2026-09-20，NWT；对象 = `coord/j2-oracle-batchB-v0` @ `bacd6879`（基线 `fc086291`，28 文件 +1633/−39）；实现复核第 1 轮 MUST-only；D-021：类别级）

# oracle 批 B 实现复核（MUST-only）

## 结论：**B1–B7、C1–C2、批 D 留尾、批 D 已合文件的改动都成立；有 2 条 MUST（都是 adapter 编排里的活性/误拒缺口，不是安全缺口，都是几行修法）。** 修完我只看 delta 给 GREEN。

## 我做了什么（独立于 J2 自报）
- 在我自己的检出上取该 commit，重跑 12 个相关测试文件（verdict 10 / adapter-core 19 / spec 11 / policy 5 / service 6 / create-route / bet-intake 8 / intake-route / budget 21 / freeze-v213 13 / store 19 / driver-core 31）：**全 0 红**。
- **24 个我自己写的变异**（B1 贴标 ×3、B2 暂态/实质 ×2、B3 极性、B4 异议不写 ×2、B5 谓词/白名单/三处强制 ×5、B6 白名单/非 ESPN/干跑/UMA 预算/adapter 复核 ×5、C1 绕过/不一致 ×2、批 D 留尾 wallMs、B7 去 NOT EXISTS、UMA 窗接受 NaN、去重复检查）：**21 杀、3 活、树已还原**（`git status` 干净）。3 个活的见下"补测/等价"。
- 在**新迁移的真库**上直接跑 B7：`promoteWinningSide` 的 8 个绑参**顺序正确**（含 `winningSide=0` 这种 falsy 值也写成功）；"异议行在 gate 之后、写值之前插入"⇒ `changes=0`；"已存在反向 verdict"⇒ `changes=0`；干净路径 `changes=1` 且 `verdict_id` 正确。**SQL 与 §10-B7 逐字一致**（`NOT EXISTS (… v.market_id=? AND (v.outcome IS NULL OR v.outcome <> ?))`，与批 D M1 冻结集同口径：全部 verdict、不论 kind / pmt_at）。
- `classifyDerivation` 与真 `deriveKanetNativeVote` / `derivePolymarketVote` 的返回形态逐一对照：`judgeline-deterministic` ⇒ extractor、其余含未知 ⇒ llm ✔；UMA 只认 `ok:true`（真代码里定稿窗未到返回 `ok:false` 且无 outcome）✔；LLM 低置信的真 reason 前缀就是 `daemon_abstain`（分类器所依）✔。
- 批 D 留尾：`wallMs` 非有限数 ⇒ 503 fail-closed，语义**正确**（旧的"退回只看 pmt"恰是 M2 要堵的缺口；G12 翻转是对的）；缺 `outcome_end` 的分支先于墙钟判据，仍返回 409 `outcome_end_missing` ✔。
- C1：库层 fail-closed（去了 `if(betRequest)` 绕过口，变异"无 betRequest 直接放行"被杀）✔。公开读对非判定题**不新增任何键**（四个内部列在输出前被删）✔。

## 2 条 MUST
**M1（误拒）adapter 会把"批准票"盖上落在 outcome_end 之前的 pmt 时间戳，之后这条票永远算不进赞成集，市场必然走到 cutoff 冻结→退款。** 扫描条件是 `wall ≥ outcome_end ∨ pmt ≥ outcome_end`，而 pmt 稳态落后墙钟约 2.3 min；`planVerdictWrites` 只要 `pmt` 有效就写批准票并用 `pmt_at = 当前 pmt`。所以在 `[outcome_end, outcome_end+~2.3 min)` 这段窗内被写下的 extractor 票，`pmt_at < outcome_end`，而批 D 的赞成集要求 `pmt_at ≥ outcome_end`——**该票永久失格**；且 adapter 因"该 kind 已有行"不再重新 derive。**真库复现**：`wall=oe+60s, pmt=oe−80s`，extractor 判 YES ⇒ 写入 `pmt_at = oe−80000`；之后 UMA 定稿写入 YES，三个 tick 后 gate 仍是 `wait awaiting_second_source`（对照臂：extractor 票 `pmt_at ≥ oe` ⇒ 宽限窗后 `promote`）。这是 ESPN 赛果在 outcome_end 前后就已 final 时的**常见**情形（extractor 票几乎总是在第一个可扫的 tick 出结果）。修法：**批准票只在 `pmt 有效 ∧ pmt.pmtMs ≥ outcome_end_ms` 时才写**，否则该 tick 推迟（`approval_deferred_pmt_before_outcome_end`，下 tick 再 derive/写）；异议/实质 ABSTAIN 不受此限（照 B4 任何时候都写）。加"wall=oe+60s ∧ pmt=oe−80s ⇒ 不写批准票 / 下一 tick pmt≥oe ⇒ 写、`pmt_at≥oe`"的测试，并把它做成变异（放宽为只判 pmt 有效 ⇒ 必红）。

**M2（活性）候选市场按 `created_at` 升序取 `LIMIT 20`，没有时间过滤，等待中的旧市场会饿死新市场。** `CANDIDATE_SQL` 只按状态过滤；`outcome_end` 还在很久以后的市场每 tick 都占一个名额（结果是 `skip('outcome_not_known')`）。**真库复现**：20 个 outcome_end 在远期的旧市场 + 1 个已可判的新市场 ⇒ 一个 tick `scanned=20, skipped={outcome_not_known:20}`，**新市场没被扫到**（它最终到 cutoff 也不会被 adapter 冻结，只等自然 refund）。同理，被 `spec_invalid` / `source_not_registered` 这类**永久**跳过的行也永远占名额。修法：SQL 加 `AND m.outcome_end_ms <= ?`（绑当前墙钟毫秒；墙钟 ≥ pmt，是可判集合的超集）并 `ORDER BY m.outcome_end_ms ASC`；**永久性不可处理**（`spec_invalid` / `source_not_registered`）⇒ 直接 `freezeMarket(reason=…)` 让它离开候选集（冻结是 fail-safe 且单向）。测试：21 个市场（20 个未到期）⇒ 已到期者被扫到；永久跳过者被冻结后不再占名额。

## 补测 / 等价（不阻塞）
- **B1c 活**（"UMA 标签不要求 `ok:true`"）：真代码里 `ok:false` 从不带 outcome，故对真形态等价；但这是 B1 的直接约束，请补一条 `{ok:false, outcome:'YES'} ⇒ 不是 uma 票` 的测试。
- **B2b 活**：`TRANSIENT_ABSTAIN_KINDS` 常量只是文档（分类靠"不在实质表里 ⇒ 暂态"），去掉它不改行为——等价，可删常量或留作注释。
- **B5d 活**：promote 前第二次 `judgedMarketAllowedHere` 与同 tick 扫描时那次输入相同，等价；保留无害。

## SHOULD（记票）
1. `startProtoOracleAdapter` 在开关打开后 `await import('./bettor-prediction-voter.js')` 没有 try/catch，而 `index.js` 用顶层 `await` 调它——导入失败会拖垮控制台启动；建议包一层并 LOUD 后自停。 2. 创建路由只认 `resolutionRuleSpec / outcomeEnd / outcomeConditionId` 三个驼峰键；若调用方用蛇形键（`resolution_rule_spec` 等）会被**静默丢弃**并建成一个普通（非判定题）市场——正是我们批评过的"接受却丢弃"形态。建议对任何形如 `^(resolution|outcome)` 的未识别键 400。 3. UMA 定稿时刻取自 Polymarket 的 `closedTime`，可能远晚于 `outcome_end`（争议期）；§7 的 deadline 关系假设二者相近，晚到的 UMA 票会撞 cutoff 而冻结（方向安全，属诚实边界，写进 runbook）。 4. 仍无带鉴权+审计的人工冻结入口（已在票）。

## 我没做
未部署、未在 simnet 端到端跑；derive 全注入，真 ESPN / Polymarket / relay pmt 没跑（与 J2 自述边界一致）。
