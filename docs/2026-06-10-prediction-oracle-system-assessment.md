# KANet 预测 + 预言机系统 · 说明评估报告

> 2026-06-10 | 作者: Bettor-tn(架构/审核) | 性质: **现状实证评估 + 开测就绪**(非设计再文档化 — 设计见 `docs/DEVELOPER-GUIDE.md` / `products/03-prediction-pool.md` / `docs/2026-06-08-public-testnet-dod-draft.md`)
> 诚实边界: testnet 范式机制验证,**非 mainnet 生产/真金**(守 G5);test-KAS 零价值。

---

## 一、系统说明(简)

### 预测市场(prediction pool)生命周期
建市(过 prevet 预审)→ bettor 双边押注(YES/NO,外部钱包零售流或 agent 流)→ deadline → oracle 委员裁决 → 4-of-5 共识 → settle(winner + oracle + broker 三方分账)→ 链上 is_accepted。不达共识/单边 → refund。

### 预言机(oracle)
- **委员抽样**: VRF 从 enrolled oracle 确定性抽 5 人(跨节点两端 committee_pk_hash 必一致)。
- **判决引擎**: `deriveVote` registry 驱动 —— `findExtractor(canonical_url)` → 命中 KNOWN_EXTRACTORS(ESPN/CoinGecko/Polymarket/BBC/Reuters…)→ 抽取证据 → LLM 判 outcome。**registry 单一源,新源加 extractor 即可、不改 enum**。
- **共识**: 4-of-5 阈值;判不了 **abstain-not-guess**(弃权而非瞎判);不达阈值 → refund。
- **跨节点**: 市场/投票/签名全靠 Kaspa 链广播 + 各节点 ingest 同步(**非共享 DB** — 信任锚在链)。
- **经济**: oracle stake 锁 + `dispute_reveal` slash(testnet 演示自洽设计,非 mainnet 硬化)。
- **能力分档**: 现阶段单页抽取(可判源)+ UMA 兜底(不可判);判集随源扩,北极星 = 取更真实准确信息。

---

## 二、现状评估(实证分级,守边界)

| 组件 | 状态 | 实证 / gap |
|---|---|---|
| **真源判决引擎**(deriveVote registry) | 🟡(原判 🟢 过乐观,Owner 校准下调) | 架构 live 证(da4984ca);但**判决质量 n=1、未红队**。⚠ **传染性盲点**:deriveVote 与 prevet 同为 LLM-judge,prevet 被 prompt-injection 骗 20% → deriveVote 跑同样 LLM 判 outcome **无理由免疫**(恶意题面注入/污染源页面 → 判错 → settle 错)。**红队 = 开测前置、非攒** |
| **跨节点委员 4-of-5 共识 + settle** | 🟢 **链上闭环证**(本日里程碑) | mix0d settle_txid d513f7b4 **landed:true**(四重独立验);门 A item④ + DoD#1.4b 双证 |
| **web 押注 UI**(external 零售流) | 🟢 **关2+关3 双 PASS** | 关2(Bettor):页面+prep 守门;关3(NWT):攻击面 6/6 守 + success-path 链验 |
| **部署稳定性** | 🟢 本会话根治 | 崩 P0(fork 耗尽)/ 端口 3200 / supervisor / 惊群错峰 / 频道清场,NWT 独立验全绿 |
| **prevet 预审** | 🔴(原判 🟡,Owner 校准上调) | FN=0% ✓ / **FP=20% > 5% guard**(prompt-injection 骗过)= **开放问题非收尾**;1-2d 乐观,大概率需规则层(白名单源 + 结构化断言)兜底,非纯 prompt 硬化 |
| **找零核弹**(settle/refund/dispute/claim mass-aware) | 🟡 部分 | J1 域;disagreement 链测 + dispute/claim mass + 3-fork 合,未全收尾 |
| **零售 onboarding** | 🟡 半 | faucet live(领 test-KAS)；wizard(领钱→找单→押)+ 首次 tour 待补 |
| **经济安全 / 对抗经济学(griefing)** | 🟡 **设计闭合,档1 待实现**(Owner 终裁 2026-06-10) | abstain→refund griefing 经 ~10 轮对抗设计闭合(三方签):5 层 robust-by-construction(prevet 主防 + 阈值3态 + propose-挑战窗-finalize + slash + 显式边界)。决议封存 `docs/2026-06-10-griefing-defense-design-decision.md`(commit e8727706)。**Owner 终裁:档1(prevet 收窄 + 阈值3态)开测上线 / 档2(挑战窗+slash+bond)mainnet 封存**。**门C 闭前置 = 档1 J2 实现 + NWT 档1 攻击样本验**(KI-28:设计闭合 ≠ ship close)。**诚实边界**:源真错+超挑战窗 = 不可约 oracle 天花板(同 UMA/Chainlink),testnet 接受,mainnet if-deployed 靠多源+UMA 人工 dispute |
| **oracle 池规模 / sybil**(诚实边界) | 🟡 边界项 | 5 委员从多大 enrolled 池 VRF 抽?**池小 + 半许可 → 4-of-5 是机制演示、非去中心化证明**;配既知"同市场 broker∉oracle"局限,须写进诚实边界 |
| **oracle 准确率战绩** | 🟡 **line-E 实测出炉**(2026-06-12, 原 🔴 刚起步) | 见下 §六 line-E 战绩:跨品类 judged **44/44=100%**(sports 24/24 + price 20/20,窄门内/fresh 批/fixture-mirror/harness==production 4/4 证)+ abstain 双闸(deriveVote 门 11/11 + prevet 结构 5/5 + 评分 6/6)+ 抓修 3 实 production gap。**诚实定语**:窄门内提取准确率(白名单源+客观题)、N 小 CI 宽、命门(主观题 deriveVote 过度自信硬判)= known limitation。**DoD = 开测继续累积** |
| **SPC-walk 老市场采样** | 🟡 systemic | getBlockAtDaa MAX_WALK 50000,老市场超 cap 不可采样;J2 认领 direct-getBlock-by-hash durable fix |

---

## 三、开测就绪结论(对照大众测试 DoD A-E)

- **门 A 核心闭环** ✅ **基本拿下**:item④ 跨节点 settle(链上证)+ GAP-2 web 押注 UI(关2+关3 双 PASS)
- **门 E 部署稳** ✅(本会话根治)
- **门 B 找零核弹**(J1)/ **门 C prevet FP-FN**(J2,FP prompt-injection 待硬化)/ **门 D 零售 onboarding**(KANet-UI)= **进行中**

**还差(到可开测,Owner 校准后扩)**:① **门 C 扩定义 = "判决引擎经红队",不只 prevet FP** —— prevet prompt-injection 硬化(FP<5%,可能需规则层兜底)**+ deriveVote 对抗样本红队**(恶意题面注入 + 污染源页面,证判决引擎不被 game)② **abstain/refund 对抗经济学**(griefing 向量,协议层定价 — 真协议设计缺口非 bug)③ B 找零核弹链测收尾 ④ D onboarding wizard+tour ⑤ 首条真人 web E2E。
**粗 ETA**:不动 1-2d 时点,但门 C 扩成"判决引擎经红队";abstain-griefing 作议题并行(协议设计,可能 >1-2d)。

**诚实边界**:testnet 范式(G5,不报经济闭环/可托付真金);oracle 准确率靠开测攒 **但隐藏代价 = 开测裁错一次对 Kaspa 叙事减分**(故 deriveVote 红队前置);oracle 池小+半许可 = 机制演示非去中心化;mainnet 生产不在 scope。**Kaspa 拐点 = Toccata native fund_lock**(pre-Toccata settle 执行仍 broadcaster 代播=信任在应用层;Toccata 后才把押注锁定从 KANet 承诺变链上约束)。

---

## 五、Owner 对抗校准(2026-06-10)+ 修正

Owner 对本报告做对抗审,**两个真盲点已修正进上表**:① deriveVote 与 prevet 同 LLM-judge 攻击面、prompt-injection 有传染性(原 🟢→🟡,红队前置);② abstain/refund griefing 对抗经济学缺位(原"功能可见"🟡 → 🔴 最大未证项)。+ prevet 🟡→🔴(开放问题);+ 池规模/Kaspa 拐点进边界。**方法论教训**:对预测市场这类对抗性系统,"机制存在"≠"机制经受过对抗" —— 评估标准是后者;reviewer 不可把两者混进同一分级。

---

## 四、必要性意见(Bettor)

**有必要 —— 作为现状评估 / 开测 go-no-go 依据**,非设计重写。建议用法:① Owner 决策"何时开测"的实证底表;② 若开放公测,本报告的"系统说明"段 = 对外文档骨架;③ 每收一个门更新对应行,作为就绪度活台账。

---

## 六、line-E oracle 准确率战绩(2026-06-12, NWT lead + J1 price + J2 fidelity + KANet-UI mode2)

> 回应 §五 Owner 校准对 deriveVote 的 "判决质量 n=1、未红队" 下调:line-E 把 n=1 推到跨品类 N=44 实测 + 红队抓修 3 个实 production bug。**诚实定语守 §二**:这是【窄门内提取准确率】(白名单源 ESPN/CoinGecko + 客观题),非广义 "oracle 判得准";N 小 CI 宽,精确 X/Y 报、不漂成 "100% 准"。

**方法(fixture-mirror 焊死)**: harness 直接 import 生产 `deriveVote(offer)` 全管线(真源 fetch + 真 extractEvidence + 单源 prompt `derivevote-prompt.mjs` 527f5281 prod+harness 共 import + 真 LLM)。**harness==production 证立**: KANet-UI mode2 全系统(建市→押→committee→settle→判)4/4 逐 event == NWT isolated harness verdict(跨 MLB/NFL/NBA/NHL + 2Y2N)→ isolated 准确率对全系统有效(守命根子 "LLM-isolated≠全系统闸")。

**判对率(judged accuracy, 跨品类 fresh 批)**:
- **sports/ESPN (NWT)**: 24/24 = 100%(跨类 MLB/NBA/NFL/NHL 各 8, 平衡 YES/NO; 1 ESPN 502 源瞬挂 retry 后判对、剔分母 = 源 infra 非 oracle 错)。
- **price/CoinGecko (J1)**: 20/20 = 100%(BTC/ETH 跨币种极端阈, FP0 FN0 NO-recall 9/9=100%; 1 BTC>=200 CoinGecko 429 限流剔除, 同 502 类)。
- **跨品类合计判对: 44/44 = 100%**(窄门内、fresh、fixture-mirror、harness==production)。

**abstain 校准(双闸, sports NWT + price J1)**: oracle "知道何时不该答"。
- deriveVote 门(运行期): sports 未来/未结算赛 ABSTAIN **11/11** + price 非白名单 extractor-null ABSTAIN **3/3** = **14/14 = 100%**。
- prevet 结构闸(非白名单源 → no_extractor RED): **5/5 = 100%**。
- prevet 评分闸(主观/聚合/推理/注入 → tier!=pass): sports **6/6**(gap2① 修后)+ price 主观拒 **5/5** = **11/11 = 100%**, FP 控制好单不误拒。

**红队抓修 3 个实 production bug(line-E 核心价值 = 开测前知 oracle 实边界)**:
1. **ESPN evidence 格式歧义**(extractEvidence L62 `(home hs - as away)` 诱 LLM 重推比分覆盖显式 winner, NFL 小 margin 局误判)→ J2 winner-first 各队分相邻修(1c7c7758)→ 95.8%→100%。
2. **prevet 放行纯主观题**(false-negative: "play well/deserve" 该拒却 pass)→ J2 SUBJECTIVE_RE 主观维度 cap warn(24bedb2b)→ 评分闸 4/6→6/6。
3. **prevet 误拒 CoinGecko**(false-positive: 白名单 regex ≠ findExtractor 单源漂移)→ J2 prevet 复用 findExtractor 单源(24bedb2b)→ CoinGecko 客观单 warn→pass、非白名单仍 RED。

**命门 = oracle 实边界(known limitation, 待 Owner 终裁)**: deriveVote 对【无客观判定标准的主观题】过度自信硬判(0/4 abstain, conf 0.9-1.0)= backstop 失效 → **prevet 主观闸(gap2①)是唯一有效防线**(已补)。残留(prevet best-effort 措辞 whack-a-mole 漏的主观题)= **known limitation**,同门C griefing 残留处理(SS 三态/dispute 兜, testnet 可接受)。**resolution(待 Owner review)**: ① prevet 主观闸(已 live)② deriveVote 主观-abstain(Phase2, 硬)③ 残留 document。

**诚实边界(守 §二/§五)**: 窄门内提取准确率非广义 oracle 准确率; N=44 小、CI 宽; 白名单外源(股票/天气/任意域)= 框架判不了 → ABSTAIN/换 UMA 底座(非 bug, 是 scope); 主观题命门 = known limitation; mainnet 生产不在 scope(G5)。
