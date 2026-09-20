# oracle 整合批 B(adapter: verdict 写入 + promote 接线)—— 实现说明(2026-09-20, J2)

设计 `docs/2026-09-20-bettor-oracle-batchB-adapter-verdict-promote-design-v0.1.md` v0.3(§1–8, §10 B1–B7, §11 C1–C2)。**只合不部署, 不动主网 live; adapter 默认关闭(`PROTO_ORACLE_ADAPTER_ENABLED` 缺省), 翻开须 Owner。** 无 schema 变更(无新 migration)。

## 🔴 B7 对批 D 文件的改动 —— 单独标出(Bettor 要求)
文件 `kasia-console/src/lib/proto-settlement-budget.mjs`(`PROMOTE_UPDATE_SQL`)+ `proto-settlement-freeze.mjs`(`promoteWinningSide` 绑参)+ `proto-settlement-budget.test.mjs`(G10 钉文本):
- `PROMOTE_UPDATE_SQL` WHERE 末尾追加(与要求逐字一致): `AND NOT EXISTS (SELECT 1 FROM proto_market_verdicts v WHERE v.market_id = ? AND (v.outcome IS NULL OR v.outcome <> ?))`; 占位符 6 → 8。
- `promoteWinningSide` 绑参 `(…, nowIso(), marketId, marketId, decision.winningSide)`。
- 语义: 冻结集(批 D M1: 该市场**所有** verdict, 不论 kind / pmt_at)里任一异议或弃权行在 gate 判定之后、写值之前被插入 ⇒ UPDATE `changes==0`, 不写 winning_side(写值不可改, 所以检查必须与写值同一条语句)。
- 测试: adapter-core A15(四种异议臂: NULL 弃权 / 早于 outcome_end 的相反票 / pmt_at=NULL 的 llm 异议 / human 异议, 对照臂: 一致的 llm 票不拦)、A16(adapter 内 Proxy 在 promote UPDATE 前一刻插入异议 ⇒ `promote_guard_changes_0`, 下 tick 冻结)、budget G10。变异 mb1(去掉 `v.outcome IS NULL OR`)被 core + budget 杀。
- 同一批还改了批 D 的 `evaluateBetIntakeGate`(批 D 留尾): `wallMs` 非有限数 ⇒ `503 wall_clock_unavailable_fail_closed`(此前 null 悄悄退化成只看 pmt); 批 D 测试里"不传墙钟 ⇒ 退回只看 pmt"的旧断言(G12)**按新语义翻转**——这是有意改动, 请审。
- 批 D 留尾第二项: 补 `[extractor+human] / [uma+human] / [extractor+llm] 一致 ⇒ wait(awaiting_second_source)` 三条断言 + 变异 mb3(赞成集含 human)被杀。

## 交付(逐条对派单)
1. **adapter 扫描**(`lib/proto-oracle-adapter-core.mjs`, 纯编排, db / readPmt / derive 全注入): sealed ∧ winning_side NULL ∧ 未冻结 ∧ 判定题 ∧ outcome_end 已知的市场 → offer → 复用 `deriveKanetNativeVote` / `derivePolymarketVote`(引擎内核不改) → 写 `proto_market_verdicts`(带 pmt_at)→ 批 D `evaluatePromoteGate` → `promoteWinningSide` / `freezeMarket` / wait。`services/proto-oracle-adapter.mjs` 独立 interval(默认 300s, 下限 30s), 单飞, `index.js` 里 `startProtoSettlementDriver` 之后启动。
2. **B1 单一贴标**(`lib/proto-oracle-verdict.mjs::classifyDerivation`): 仅 `extractor_kind_used==='judgeline-deterministic'` ⇒ extractor; 仅 polymarket 路 `ok:true` 明确 YES/NO(derivePolymarketVote 已过定稿窗)⇒ uma; **其余一切含未知 / 新增 kind ⇒ llm**。UMA 定稿窗生效值(voter 现在 `export` 该常量, 仅此一处改 voter)必须有限且 ≥24h, 否则 adapter 拒启动 / tick 中止(SHOULD①; NaN 会让 voter 的 `> 0` 判定为假 = 窗被静默关掉)。
3. **B2/B4 写入决策表**(`planVerdictWrites`): 暂态(取数失败 / known-source-not-final / 抛异常 / 未知 abstain kind)不写、下 tick 重试到 cutoff; 实质 ABSTAIN(judgeline-abstain / judgeline-no-fields / spec-no-question / daemon_abstain)必写 NULL, **pmt 无效也写(pmt_at=NULL)**; 冲突时冲突各方都写为异议(冻结集不漏); 赞成只在 pmt 有效时写; 同 (市场, source_kind, evidence_ref) 至多一条(事务内查重); LLM 每市场只问一次(kanet 路已有 extractor / llm 行即不再 derive)。
4. **B3/C1 side_map**: `side_map`(label→side 双射)+ `polymarket_outcome_side`(UMA 极性, 显式必填不静默默认)进 `resolution_rule_spec` JSON(被批 A R4 题面不可改触发器锁住); 三个来源过同一个 `toSide()`; 公开 GET 对判定题附 `judged{side_map, outcome_end_ms, data_source_canonical, polymarket_outcome_side, …}`(内部列不外露, 非判定题响应字节不变); 判定题下注必须带 `side_label`('yes'|'no')且与 direction 按 side_map 一致, 否则 400(在读 pmt 之前)。
5. **promote**: 只经批 D `promoteWinningSide`(含 B7 NOT EXISTS)。auto-promote 仅 ESPN 确定性路(两源 extractor + uma 一致 + 宽限窗 + R5 预检)。
6. **B5/N5b**: `judgedMarketAllowedHere({network, tokenDefId})`(`lib/proto-oracle-policy.mjs`)——非主网放行; 主网仅 `PROTO_ORACLE_VALUELESS_TOKEN_IDS` 白名单代币; 网络缺失 fail-closed; **三处强制同一函数**: 创建路由 / 受理门(`checkBetIntake`, 从库里取 token_def_id)/ adapter 扫描 + promote 前各一次; 启动 LOUD 打印生效策略; 源码钉测试(`proto-oracle-policy.test.mjs` P4)钉三处调用 + 全仓仅一份定义 + 仅 policy 模块读白名单 env。
7. **B6/C2 创建入口**(`lib/proto-oracle-spec.mjs::validateJudgedMarketInput`): `resolutionRuleSpec / outcomeEnd / outcomeConditionId` 三个全可选, **全缺省 = 旧流程行逐字节不变**(回归断言), 任一出现 ⇒ 全套校验(半套 400); data_source 只收 `findExtractor` 命中的源(复用, 不另写)且 v0 仅 ESPN; 缺 resolution_predicate / 缺 UMA 条件 / predicate 干跑全 ABSTAIN / deadline < outcome_end + UMA 窗 + 宽限窗 + 余量 + 2×adapter tick ⇒ 创建时拒(C2: 判定题无人工出口, 缺出口 = 下注即死胡同); 请求体带 relay 类字段 ⇒ 400; `ensureMarketPending` 同一条 INSERT 写全部判定题列。
8. **v0 不接 TypeSafe**(调用面空徒增外发面)。

## 我做的判断 / 需要 NWT / Bettor 知道的
1. **auto-promote 只支持 ESPN**(唯一有结构化字段 + judgeLine 确定性算术的源); coingecko 命中 findExtractor 但无 predicate 路 ⇒ 创建时拒。
2. **adapter 是独立 service**(自己的 interval + 单飞), 不塞进旧 `voterTick`——不碰旧 voter 的循环, 只复用 derive* 函数。
3. **R2"多源"= 机制独立**(ESPN 确定性抽取器 vs UMA 人投预言机), 不是多个 relay 委员——v0 是**单运营方裁决机**(设计 §6 M4), 文案 / 对外口径须如实。
4. **判定题受理门 C1 在库层 fail-closed**: `checkBetIntake` 对判定题不传 `betRequest` 也按"缺 side_label"拒(不留 `if (betRequest)` 绕过口, 将来第二个调用方漏传也不放行)。
5. **`judgedMarketAllowedHere` 大小写 / 空白不敏感识别主网**(`'Mainnet'` / `' mainnet '` 都算主网)——`configuredNetwork` 只产小写规范名, 但这道闸不该假设上游守规范。
6. **实质 ABSTAIN 而 pmt 无效**: 当 tick 门 wait(pmt_invalid), pmt 恢复后同一行让门冻结; 墙钟已过 cutoff 而 pmt 仍无效 ⇒ 门直接冻结(批 D 既有)。
7. **扫描时间闸取 max(墙钟, pmt) ≥ outcome_end**: 墙钟已过而 pmt 无效时仍扫, 为的是能写实质异议(B4); 只有赞成延后。
8. **顺手修的两处小缺陷**(测试暴露): `hasJudgedInput(null)` 返回 `null` 而非 `false`(类型泄漏, 已 `!!`); `validateJudgedMarketInput` 加可注入 `judge` 参数(默认 judgeLine, 生产不传)——否则"干跑全 ABSTAIN 拒建"这一道在生产里与结构校验同契约、无法被测试证明存在(变异 ms4 首轮存活即因此)。
9. 干跑 + 结构校验对 margin / score 缺 `subject` 的 predicate 会拒(judge-time 必 ABSTAIN)——测试里 `nosub` 用例。

## 测试
- 新增: `lib/proto-oracle-verdict.test.mjs` 10、`lib/proto-oracle-adapter-core.test.mjs` 19、`lib/proto-oracle-spec.test.mjs` 11、`lib/proto-oracle-policy.test.mjs` 5、`services/proto-oracle-adapter.test.mjs` 6、`api/proto-oracle-create-route.test.mjs`(路由接线全断言 ALL PASS)。
- 改动: `lib/proto-bet-intake.test.mjs` 6→8(+X7 C1 库层 / +X8 B5 站点②)、`api/proto-bet-intake-route.test.mjs`(需 KASPA_NETWORK + 合法 side_map + side_label)、`lib/proto-settlement-budget.test.mjs` 21(G10 / G12 / I2 按新语义 + 留尾 3 断言)。
- 全量回归 `regression-sweep.txt`: kasia-console 下所有 proto* 测试(lib / api / services)+ `src/db/*.test.mjs` + `scripts/test-v133-fresh-boot.mjs` = **55 文件 0 失败**。
- lint: `node scripts/lint-kanet.mjs <改动文件>` 0 errors(既有 R-NET-DEFAULT-DRIFT 命中的 proto.js 两行是既有代码, 不在本批 diff)。

## 变异(`mutations.mjs`, 一处精确替换 + 相关测试 + sha256 还原校验)
- 首轮(`mutations-round1-raw.txt`)41 个: **40 杀 1 存活(ms4: predicate 干跑全 ABSTAIN 仍可建)**; 另 mv5(冲突不写异议)只被 verdict 测试杀、adapter-core 层未杀。
- 补测(A19 冲突 + pmt 无效; S5 注入 judge 证干跑接线)后 round2(`mutations-round2-gap-closure.txt`)ms4 / mv5 均被杀; round3(`mutations-round3-batchD-leftover.txt`)mb3 被杀。**合计 42 变异 42 杀 0 存活**。
- 🟡 变异集是按设计 B/C 边界列的, 不是穷举; 未覆盖: 真 ESPN / Polymarket 网络路径(derive 全注入; 真引擎形状由 verdict 测试的 fetch stub 覆盖)、真 relay pmt 读取、simnet 端到端(合并后另做)。

## 记票(不在本笔)
- simnet 端到端: 创建判定题市场 → 下注 → seal → adapter(含注入分歧 / ABSTAIN 冻结)→ refund 收尾; 合并后另出。
- adapter 停摆告警(批 D 记票: promote 后 X 分钟未 close_commit landed / promote 窗内 pmt 连续读失败 > N tick)现在有调用方了, 待 runbook 定 X / Y / N。
- refund 执行(refund_flip 广播 + 逐票 reclaim)仍未接线 ⇒ N5b 限制持续有效。
- 若 Bettor / Owner 指定 TypeSafe 的建议性用法(非结算路径 / 仅合成或公开输入 / 置信度阈值 / 低置信升人), 另出小改。

---

# NWT 复核 delta(2026-09-20, J2)—— 2 MUST + 小项

## M1 误拒(活性): 批准票只在 `pmt 有效 ∧ pmt >= outcome_end` 才写
- 根因: 批准票盖当前 pmt 的 pmt_at; [outcome_end, +~2.3min) 窗内 pmt 仍 < outcome_end ⇒ 该票 pmt_at < oe 永久失格于赞成集(批 D N1 要 pmt_at >= oe)⇒ 市场必走 cutoff 冻结 → 退款(ESPN 赛果在 oe 前后已 final 时几乎必犯)。
- 修: `planVerdictWrites` 新增必填参数 `outcomeEndMs`(缺 / 非正安全整数 ⇒ 抛 TypeError, 不静默放宽); 批准票 pmt < oe ⇒ 本 tick 不写(skipped `approval_deferred_pmt_before_outcome_end`), 下 tick 再 derive / 写。**异议 / 实质 ABSTAIN / 冲突各方不受此限**(B4: 任何时候都写, pmt<oe 也带 pmt_at 写入)。
- 测: verdict M1 单元(pmt=oe−1 推迟 / =oe 写 / >oe 写 / 异议·ABSTAIN·冲突不受限 / outcomeEndMs 缺失抛); adapter-core A20(wall=oe+60s ∧ pmt=oe−80s ⇒ 不写; 下 tick pmt>=oe ⇒ 重 derive 写且 pmt_at>=oe; 宽限窗后 promote——修前必冻结; 边界 oe−1 / oe; 异议与实质 ABSTAIN 在 pmt<oe 照写)。变异 md1(放宽为只判 pmt 有效)⇒ V + C 红; md2(把 ABSTAIN 也限制)⇒ V + C 红。
- 已知代价(如实): 批准票被推迟的那几个 tick 内, LLM 类票会被重复询问(kanet 路已有 extractor / llm 行才停止 derive); 推迟窗至多 ~2.3min ≈ 1 个 adapter tick。

## M2 活性: 候选不被远期旧市场饿死
- 根因: 候选按 created_at 升序 LIMIT 20、无时间过滤 ⇒ 远期未到期的旧市场每 tick 占满名额, 饿死可判的新市场。
- 修: `CANDIDATE_SQL` 加 `AND m.outcome_end_ms <= ?`(绑当前墙钟; 墙钟 >= pmt ⇒ 是 pmt 可判集的超集)+ `ORDER BY m.outcome_end_ms ASC, m.created_at ASC`; **永久不可处理的(spec_invalid / source_not_registered)⇒ 直接 `freezeMarket(reason)`**(单向 fail-safe: 唯一出口 = refund)离开候选集。
- 测: A21(20 个未到期先创建 + 1 个已到期, limit=20 ⇒ 已到期者被处理; 多个已到期按 outcome_end 升序取)、A22(20 个 spec 坏的先冻结, 好市场下一 tick 被处理)、A13(坏 spec / 未登记源 ⇒ 冻结 + 不再候选)。变异 md3(去掉到期过滤)/ md4(去掉排序)/ md5、md6(不冻结)全红。
- **删死代码**: 到期判定下推 SQL 后, 循环内原有的"墙钟 / pmt >= outcome_end"检查恒真, 已删(round5 变异 mc3 因此存活——等价变异; 该条从变异集移除, 等价覆盖由 md3 承担)。同批删除随之无用的 `pmtOk`。
- 🟡 未处理(如实): 主网上"不被允许"(`not_allowed_here`)的判定题市场(只可能来自直接写库 / 旧数据, 创建入口已拒)仍不冻结、仍占候选名额——白名单会变, 不该永久冻结; 若成问题再单独出票。

## 小项
- **B1c**: 补测 `{ok:false, outcome:'YES'|'NO'}`(uma / extractor 两路)⇒ 暂态, 不是票。
- **SHOULD①**: `startProtoOracleAdapter` 对 `bettor-prediction-voter` 的导入包 try/catch(可注入 `deps.importVoter`), 失败 ⇒ LOUD `REFUSED to start` 并返回(不抛、不启动 = 默认关闭同态), 不拖垮 console 顶层启动。测 V3b; 变异 md7(重新抛出)红。
- **SHOULD②**: 创建路由对任何以 `resolution` / `outcome` 开头(不分大小写, 含蛇形)却不在已识别集 `{resolutionRuleSpec, outcomeEnd, outcomeConditionId, resolutionNote}` 的键 ⇒ 400 `unrecognized_judged_field`, 不静默丢弃后建成普通市场。`resolutionNote`(既有占位字段)照旧接受, 有断言。测 S9b + create-route; 变异 md8 / md9 / md10(误伤 resolutionNote)红。

## 记票(不做, 照派单)
UMA closedTime 晚到撞 cutoff(方向安全, 进 runbook); 带鉴权人工冻结入口(已在票)。

## delta 验证
- adapter-core 22(+A20/A21/A22)、verdict 12(+B1c/M1)、spec 12(+S9b)、service 7(+V3b)、create-route ALL PASS。
- 全量回归 `regression-sweep-after-delta.txt`: **55 文件 0 失败**。
- 变异: round4 delta 10/10 杀; round5 全集重跑(delta 后)52 中 51 杀 + mc3 存活(等价, 已删死代码并移除该条); round6(`--only=mc`)删死代码后 6/6 杀。**现行变异集 51 条, 全杀**(原始输出 round1–round6 全留存, 未覆盖)。
