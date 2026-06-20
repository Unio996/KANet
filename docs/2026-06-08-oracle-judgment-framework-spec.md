# Oracle 判断框架 spec v1(P0-B 核心:预言机精准判断)

> 2026-06-08 Bettor facilitate,对抗讨论(J1/J2/NWT/KANet-UI R1 齐)+ Bettor 代码实查收敛。Owner 钦定"框架必须对"。本文 = spec → Owner 终裁 → 建 → 测循环。

## 0. 根因(实测 verified,非口径)
w0s3m 4-of-5 把 Yankees 赢(ESPN YES)判成 NO,两层叠加:
- **框架层(命门)**:`deriveKanetNativeVote` L815/L824 = `clean || rawText.slice(0,2000)` —— extractEspnEvidence 取不到时**回退前 2000 字符喂 LLM 瞎猜、不是弃权**。w0s3m 的 ESPN summary 952KB、结果在 81673 字符处,2000 字符全 boilerplate → LLM 猜 NO。
- **部署层(E gate)**:4 个判错 oracle 全在 :3300,疑 :3300 没 pull r403(extractEspnEvidence)/voter 没 reload → 跑旧 2000 字符路径。tester-3(:3200 有 r403)判对 = extractor 本身 work。

## 1. 框架原则(R1 共识 + 实查)
1. **ABSTAIN-not-guess(命门·Bettor 钦定)**:提取不到确定结果 → voter 返 `ok:false`(ABSTAIN),**禁回退 2000 字符猜**。删 `|| rawText.slice(0,2000)` 这个 guess-fallback。宁可弃权不可瞎判(强 binary 误判 > 漏投,NWT)。
2. **per-source 结构 extractor 为主 + LLM 仅判 clean evidence**(J1/NWT/KANet-UI 共识):extractEspnEvidence 已有;每源加 extractor;LLM 只在 extractor 成功的干净证据上判,extractor 失败 → abstain(非喂原始大文本)。
3. **ABSTAIN 设一等公民**(J1/KANet-UI):chain_events outcome enum `YES|NO|ABSTAIN`,settler 拒非法值;**abstain 不计票**。阈值 = **保持 static 4-of-5**(R2 收敛:J1 主 static + J2 链上 deterministic 顾虑,否决 KANet-UI 的 dynamic 4-of-非弃权)—— 即需 **4 个真实同向(YES 或 NO)票**才 settle,弃权只是不贡献那 4 票;够不到 4 同向 → refund。链上判据固定、跨节点可重算。
   - **ABSTAIN 必链上广播(R2 J2 catch / J1 服)**:abstain 不能只 `ok:false` 静默不广播 —— 否则跨节点分不清 **silent(relay 不可达 → 该 forfeit/罚)** vs **abstain(oracle 响应了但判不了 → 不该罚)**。abstain 发显式 ABSTAIN 链上投票;silent = 真没响应。两者对 forfeit([[INVARIANTS]] SYS-3)处理不同:silent→forfeit,abstain→不 forfeit。
4. **final-status gating**:只 STATUS_FINAL 判,否则 abstain(防赛中/未结算误判)。
5. **prevet 验解析能力(非只权威)**(KANet-UI):prevet 后端跑一次 mock extract(用该 source 的 extractor 试),提取不到 → 降级/flag,别让"权威但判断方法解析不了"的源过关。
6. **信心分级**(KANet-UI):单源 extract 成功=中信心,多源一致=高信心;UI 详情页显信心 + **区分"弃权(取不到)"vs"判 NO"**。

## 2. 部署(DoD-E,本案直接诱因)
- :3300 必 pull 最新(r403 + 本 spec abstain fix)+ voter reload;cross-node voter 代码同步,走 [[deploy-discipline-checklist]]。
- 不同步 = 同一委员会跨节点跑不同判断逻辑 = 灾难。

## 3. 测试(NWT 关3)
- fixture:ESPN summary >100KB 应 extract 出 winner(防 w0s3m truncation 类);
- source-down → abstain;非 STATUS_FINAL → abstain;extractor 不认的源 → abstain(非猜);
- L37 abstain 路径 lint:voter 返 abstain → settler 不入共识;
- k-of-n 多 LLM:注入 1 LLM 错检,majority 仍对。

## 4. 诚实边界
预言机准确性靠此框架 + 大众测试期攒战绩;现 ESPN 单源,多源交叉为 P1+;testnet。配 [[project-oracle-capability-staged-uma-backbone]]。

## 5. 终裁前钉死(Owner review 2026-06-08,5 件)

### 5.1 k-of-n 多 LLM = 委员会冗余(消 §1/§3 不一致)
§3 的"k-of-n 多 LLM tolerate 1 错"= **委员会本身**(5 oracle 各 1 独立 LLM 判断,static 4-of-5 容 1 错),**非单 oracle 内多 provider**。【关键 caveat】委员会只防**独立**错;w0s3m 是**相关错**(4 oracle 同 stale 代码 → 同向错)→ 委员会没救到 → 相关错的解 = **部署版本互证(§5.6)+ 单 oracle 多 provider LLM(P1+ 去相关)**,非 v1。§1 原则:committee 4-of-5 = 独立错冗余;§3 改写为"委员会容 1 独立错"。

### 5.2 Settler 收非法 enum 行为(Owner 钦定 (b))
voter 广播 malformed/非 `YES|NO|ABSTAIN` 包 → settler **当 silent-equivalent → 触发 SYS-3 forfeit**(misbehaving = 等同没响应、罚)。**不当 ABSTAIN**(否则鼓励 misbehave 逃罚)、**不 halt**(防 DoS)。J2 落地 + 2 行 test:malformed → silent-equiv forfeit,禁静默吞。

### 5.3 Refund 路径统一(单一入口·J1 对齐 Bettor)
三种 refund —— (a) abstain-pool-drain(够不到 4 同向)(b) B dispute 翻案 (c) explicit-refund-by-id(7un1d/ko421)—— **必走单一 `dispatchRefund` 入口、grace 语义一致**。J1 写 hold-before-payout 前先跟 Bettor 对三路代码路径,目标单入口。grace 是否存在于 abstain-driven refund:**存在**(同 PoolSide grace 窗,防 abstain 误判 race)。不统一 = 三套行为只一套对。

### 5.4 guess-fallback 全库审计(build 前置·已做首轮)
本案非孤例,`|| ...slice(0,N)` 喂 LLM 反模式全库扫。首轮结果:
- **判断层(必修→abstain)**:bettor-prediction-voter.js L815 + L824(ESPN/native path)。
- **enricher slice-fallback(review)**:bettor-fundamental-enricher.js L138(entity extract,喂 LLM prompt 可能 bias,低风险但 review)。
- **合法链(不动)**:bettor-sports-enricher.js L75(regex→LLM,非 raw-slice 猜)。
build 前 NWT 做正式全审计 + lint 守 `extract... || ...slice` 0 喂判断。

### 5.5 ABSTAIN 经济边界(防"懒 oracle")
**abstain 不损 stake、不计 reward、reputation 中性记录**。诚实弃权(真取不到)vs 战略弃权(能 extract 但不愿花力气)在**长期 reputation 序列**里区分(战略懒 oracle abstain 率异常高 → reputation 降 → 少被 VRF 抽中)。v1 不在单次区分二者 = 已知留口,关2 明示。

### 5.6 部署版本互证(次要·本周连带,非 P0 blocker)
committee 装配时跑 git commit / build hash 互证,版本不一致 = 拒装配。防"补丁推 :3200 没推 :3300"同型故障复发(本案直接诱因)。

## 6. 诚实边界补
ESPN STATUS_FINAL 权威性 v1 直接信(testnet 单源);多源交叉 = P1+ 独立话题(每源 1 extractor scaffolding);单 oracle 多 provider LLM 去相关 = P1+。

## 7. 状态 + 搁置项(2026-06-08 Owner 钦定:搁置退款、推终裁+框架收口)

### 7.1 已 ship + Bettor 实查 PASS
- **命门 ABSTAIN-not-guess**:voter 删 guess-fallback → ABSTAIN(b5113af5,实查 L813-832 ✓)
- **outcome enum YES|NO|ABSTAIN** 单一真相源(非新 event type,r403 锁,实查 ✓)
- **abstain≠silent forfeit 优先级**:_findSilentForWinner true-silent>malformed>dissent>abstain(r413/a83efabd,实查 ✓)
- **4-同向+1-abstain edge**:_findSilentForWinner 返 null → caller refund,守 5.5 abstain 不被罚(r414/0345a03c,实查 ✓)
- **split 不永久卡死**:pastSilentTimeout→refund 兜底(实查 ✓,Owner r410 担心的 limbo 不成立)
- **L37 lint strengthen**:查函数体优先级顺序(cb1ea89a)—— 比假覆盖强,**但仍源码正则、非 runtime 行为测(待硬化)**

### 7.2 待办(agents 回线后驱动)
- J2 settler clean-default-refund(可选简化,Owner r410 形式,非 bug 修)
- NWT L37 → runtime 行为测(造 1 abstain+4 同向 → 验 bond 不掉,KI-30 行为非文本)
- KANet-UI 三桶渲染(判定/弃权/未响应,等 J1 enum 锁)
- J1 refund 三路单一 dispatchRefund 入口
- Bettor 关2:对抗 fixture(结果埋 950KB 深 / 源宕 / 非 final / 懒 oracle)实测 + 看链 enum 逐笔

### 7.3 搁置(known-pending,Owner 2026-06-08 钦定搁置)
- **7un1d / ko421 退款未执行**:两单 verifying、refund_txid 无、grace(06:21Z)已过、agents idle ~3h 没执行。测试单、零经济损失。**标 known-pending,agents 回线后执行 maker dispatchRefund + bettor claim,Bettor check_utxo_landed 验。不 hack、不伪造。**

## 关卡
Bettor 关1(本 spec)→ Owner 终裁 → 各域建 → Bettor 关2(造对抗 fixture 实测弃权 + **"懒 oracle"extractable 仍 abstain 看 reputation 能否区分** + 看链 outcome enum + 逐笔验)→ NWT 关3(5.1-5.6 钉死项 + guess-fallback grep 审计,任一没补 = 不绿)。
