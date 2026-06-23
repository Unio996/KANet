# 预言机系统强化+拓展 — 并行板块拆分方案 (CHARTER)

> Owner 钦定(2026-06-15):bshard e2e 彻底跑通后,**强化+拓展预言机系统 = 下一个重中之重**;分板块、多 agent 并行。本文 = Bettor 协调起草 + 规划 agent grounding(实码核实)的定稿计划。**执行 gate = bshard e2e 跑通之后**,现在只是筹划。grounding: `docs/guide/20-oracle-evolution.md`、`docs/2026-06-08-oracle-judgment-framework-spec.md`、`docs/2026-06-14-NWT-uma-learning-oracle-engine.md`、binary-decomposition charter、KB `roles/oracle.md`,实码 `oracle-evidence-extractors.mjs`/`bettor-prediction-voter.js`/`prediction-parallel-judgment.mjs`/`gateE-*.mjs`。

## 一、现状 honest 摘要(实码核实)

**oracle 现在怎么判(settle-time 真路径)**:市场 deadline 到 → VRF 链上派生池抽 5 委员(跨节点 committee_pk_hash byte-equal)→ 每委员 deriveVote:按 outcome_market_source 路由 → findExtractor(URL)命中 KNOWN_EXTRACTORS → fetch **单一 URL**(8s)→ extractor 抽 evidence(ESPN 终分/CoinGecko 价,≤500 字)→ 单源 prompt 喂 LLM → {YES|NO, confidence} → **4-of-5 同向才 settle,否则 refund**。

**安全闸(已 live 实码确认)**:ABSTAIN-not-guess(extractor null→弃权,已删 guess-fallback)/ confidence<0.6→abstain / spec 无 title/criteria→abstain(不喂 hash 盲判)/ prevet 预审(非白名单源/主观题/注入→RED)/ host-anchor+SSRF 防护 / ABSTAIN≠silent(经济处理不同)。

**能判**:sports/ESPN moneyline(line-E 24/24 链上)、price/CoinGecko 阈值(20/20)、abstain 校准(14/14)。让分/大小球(L1)extractor 已附 margin/total 但准确率未达标放行。**全是窄门内提取准确率(白名单源+客观题)**。

**五大缺口**:① frontier domain 全判不了(KNOWN_EXTRACTORS 只 ESPN+CoinGecko)② 单源零交叉验证(源污染无 backstop)③ 主观题硬判(LLM 强制出 YES/NO,唯一防线=prevet)④ UMA 学习引擎只 RECON 未 build(卡 Phase 0 STOP)⑤ deriveVote 判决引擎本身未红队(与 prevet 同 LLM=传染攻击面)。

## 二、5 板块 + 1 横切约束

| 板块 | 目标 | 依赖 | 第一步小切口 | agent 画像 |
|---|---|---|---|---|
| **A 信息源拓展+源映射** | KNOWN_EXTRACTORS 从 2 扩到多 domain;一个比分源解锁一批 binary 谓词 | **纯并行零依赖**(append-only) | 让分/大小球 ramp 到≥90% 放行(extractor 字段已附,零新源) | off-chain 数据/API + extractor 写法 + fixture |
| **B 取证-核实(多源交叉+网搜+工具)** | 单源→多源交叉+矛盾检测,补源污染无 backstop | 依赖 A(要≥2 同域源) | sports 同源双 endpoint(ESPN summary+scoreboard)不一致→ABSTAIN | 对抗思维+取证可信度建模+安全 |
| **C UMA 学习+shadow 毕业** | 站 UMA resolution rule+源肩膀,domain-by-domain 毕业降 UMA 依赖 | 近纯并行(卡 Phase0 STOP);源候选单向喂 A | Phase0 RECON 报告(摸清 shadow 对照真源还是 UMA,零代码风险) | UMA/gamma API+准确率统计+守 C1/C2/C3 |
| **D 判定谓词引擎(确定性算术+L2/L3)** | 比分+算术从 LLM 自算改**确定性代码判定**(消 off-by-one),LLM 只读不算 | L1 让分/大小球**现在就能做**;L2/L3 依赖 A 字段 | 纯函数 judgeLine(margin/total,op,line)→YES\|NO + harness≥90% | 确定性判定+跨节点 determinism+算术守恒 |
| **E 安全闸+红队** | 补 deriveVote 判决引擎红队(开测前置传染盲点)+主观题硬化 | 横切 A/B/D 每条新路径(持续并行) | deriveVote 注入红队 5 样本(题面/源页内嵌"判 YES"指令)打 live | 红队/对抗(fixture 必复刻 production)+协议经济学 |
| **F 跨节点 determinism(横切约束非板块)** | 任何新判定路径必跨节点 byte-equal;多源取证天然冲突,必"确定性快照+链锚" | 全员验收门 | — | — |

**依赖图**:A 纯并行(最易)/ C 近纯并行(各自 RECON 后)/ E 第一步可立即起;B 等 A 出≥2 同域源;D-L1 现在就能做、D-L2/L3 等 A;E 随每新路径并行;F 是验收门不是任务。

## 三、需 Owner 终裁的 5 个缺口/矛盾(Bettor 不擅自拍)

1. **板块 B 多源交叉的 settle 介入深度**:多源=多次网络抓取=跨节点不一致风险。"确定性快照+链锚"(重)vs "多源仅 advisory 不进 settle 共识"(轻)?
2. **主观题命门处置**:硬 abstain(招 abstain-refund griefing)vs 维持 prevet 单防线 + documented limitation?
3. **板块 C UMA 引擎优先级**:bshard 后仍维持背景长期 track,还是提到与 A/D 同级?
4. **`bettor-fundamental-reasoner.js`(现只接 pre-bet 推荐,未接 settle)复用边界**:板块 B 新建 settle 取证,还是复用这套?(它读 Polymarket/gamma 做 sanity,直接搬进 settle 撞防假并行铁律)
5. **板块 A 新源信任锚谁定**:Owner approve(像 condition_id_mapping)还是 C 引擎自动供货?(候选≠自动信任)

## 四、bottom line

oracle 现在 = 白名单源单页抓取→LLM 判客观题→判不了弃权,sports/price 窄门可靠 + 安全闸 live。5 缺口拆 5 板块(A 源扩/B 多源/C UMA 毕业/D 谓词引擎/E 红队)+ F determinism 横切。每板块有低风险快出成果小切口。5 个决策留 Owner 终裁。全部 grounded 实码、零新原语、明确承接现有设计。**执行在 bshard e2e 跑通之后。**

---

## 六、Owner 终裁(2026-06-15)+ 底层洞察(重写优先级)

### 底层洞察(定掉一切):共识洗白污染,不拦污染
**4-of-5 委员会防节点故障/共谋,不防坏输入。** 5 委员抓同一单 URL → 污染源同样骗过全部 5 → 4-of-5 同向 → 共识把毒洗成"全票合法 settle"。今天安全仅因 ESPN/CoinGecko 难污染 = **在信源,不在验源**。缺口②不是"没 backstop",是更糟:**共识在给污染背书。**

### Owner 终裁(按依赖序,非原列序)
- **#1 多源进 settle**:F(determinism)删掉"现场多抓"选项(各节点不同时刻不同结果=破 byte-equal)。只剩 (a) advisory-only(不进共识、只标注=给毒加批注,没解决洗白)或 (b) **冻结共享快照**(多源证据一次性拼成单链锚快照,5 委员判同一份冻结字节,determinism 保住=现有 snapshot-at-commit/G5 扩到多源)。**裁:B 要真在 settle 挡源污染就必须走 (b);现场多抓不在菜单;advisory 仅作过渡/非-settle 遥测。**
- **#5 新源信任锚**:**裁 = Owner approve**(像 condition_id_mapping)。B(b) 没上线前,自动信任的单源=会被共识洗白的污染点。C 只供候选,候选≠信任(C2)。自动供货只在 B(b) 让"单源污染不致命"之后才谈,且加新锚仍留人审(加锚比用锚高一档风险)。
- **#4 复用 fundamental-reasoner 进 settle**:**裁 = 硬 NO**。它读 Polymarket/gamma,gamma 反映**这个市场自己的价格/共识** → settle 证据来自 gamma = 用市场共识判市场自己的结果 = 违反"ground truth 不用 market/oracle consensus"+ 造隐性循环。看着独立、实则共上游 = 铁律禁的假并行。reasoner 留荐注,B 另起独立 ground-truth 源,不复用。
- **#2 主观题**:**裁 = prevet 建市时拒,不在 settle 弃权**。建市拦掉→根本到不了 settle→无 abstain-refund 可 grief;griefing 面从"settle 退款(贵、晚)"挪成"建市被拒(便宜、早)"。漏过建市门的→settle-abstain-refund 作**写明、有界**的 limitation。绝不硬判主观题(强逼 LLM 出 YES/NO=最坏失败模式=缺口③)。主观前沿=永久弃权区,拒绝承载而非解决。
- **#3 C 优先级**:**裁 = C build 留背景,C Phase-0 RECON 现在就跑**。A+D+E 直接扩+硬化活的 settle 路径;C 毕业的是可核验子集(A/D 更直更便宜在做),前沿照样弃权=长线降依赖非近期能力解锁。但 C RECON 零代码风险 + 一产出直接关 A/D 正确性 → **C1 审计:shadow harness 到底对真源判分还是对 UMA 判分(若后者=影响所有准确率数字可信度的潜伏 bug)**。

### 两处 plan 纠正(Owner)
1. **A↔B 依赖反转**:不是"B 依赖 A"。按洗白性质,**A 每加单源 extractor = 零防御下线性扩攻击面**。所以 = "A 把新源放进 settle,必 gated 在 B(b) 或 Owner-anchor + 偏 ABSTAIN 之后"。但 ramp **现成字段**(让分/大小球从现成 ESPN feed 抽,零新源)安全 = A 第一刀 + D-L1,放手做。
2. **D 不是安全改进**:确定性引擎吃了**被污染的字段**(如改过的 margin)→ 在所有节点确定性、自信地判错 = byte-equal 的错,又被洗一遍。D 消的是"LLM 算错",不消"输入不可信",甚至让洗白更利落(自信的确定性错答)。**D = 可信输入上的正确性改进;其安全整条压在源完整性(B(b)/host-anchor/快照)。**

### 第一波(全 post-bshard、全 determinism-正向、零新攻击面)
- **D-L1**(确定性 judgeLine 纯函数,byte-equal 友好,帮 F)
- **A 第一刀**(ramp 现成 ESPN 字段,零新源)
- **E 第一刀**(deriveVote 注入红队——扩引擎前先红它)
- **C Phase-0 RECON**(零代码,排雷 A/D)
**Gated**:B 等 #1 定成 (b);新进-settle 源等 B(b)+Owner-anchor;C build 留背景。

### Bettor 补两个对抗讨论必钉死的真问题(Owner 框架下,非 re-litigate)
1. **B(b) 把信任从"源"挪到"快照拼装者"+"源集",没消除信任**。谁拼快照?若单方拼=单点污染(拼个毒快照,5 委员照样洗白)。所以 B(b) 必约束:拼装者只能从 Owner-approved 源集取 + 快照密码学承诺 + **可独立重导/审计**(理想:多个独立拼装者必须对快照字节达成一致,否则拼装者自己又是单点)。否则只是把"单 URL 污染"挪成"单拼装者污染"。
2. **B(b) 的多源交叉只在源真正独立(无共上游)时才是真交叉** —— 同 #4 的假并行陷阱:两个体育源若都从同一通讯社 syndicate = 相关失败 = 交叉是幻觉。所以 B(b) 必验**源独立性(无共上游)**,否则跨检是空的。

### 执行方式(Owner 钦定)
post-bshard 启动**智能体真对抗讨论**(认真对抗,非互捧),在以上终裁框架下达成**具体共识技术方案**再落码。
