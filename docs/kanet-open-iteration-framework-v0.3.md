# KANet 开放式迭代框架(OIL)v0.3 — 终稿

> **版本沿革:** v0.1 单 agent 骨架(Architect)→ v0.2 多 agent 协调层增补(Bettor,源自 2026-06-10/11 scale-test marathon 实战记录)→ v0.3 合并 + 四条修订两处小改(Architect 审,Owner 批)→ **v0.3-final = + Bettor 审出两 nitpick 补充(Owner 批 2026-06-10)**。
> v0.3 相对 v0.2 的变更:① 协调 agent 全执行域 read-only 结构锁(§8.1)② 频道=传输层、Ledger=状态层铁律(§8.4 新增)③ 模式级硬停量化触发(§11.3)④ 对抗讨论 3 轮上限(§11.1)⑤ §14 试点定位措辞照实修正 ⑥ §10.2 节点配置 diff 升格机器门。
> **v0.3-final 两 nitpick:** ⑦ §8.4 回写分级(防回写本身成漂移)⑧ §11.3 紧急临时冻结条款(Owner 离线空窗)。
> 核心命题:**开放式迭代 ≠ 无人值守自治。开放在规划层,封闭在执行层;单 agent 靠状态外置不漂移,多 agent 靠交叉对抗验收敛。**

---

# 第一部分:单 agent 骨架(v0.1,原样保留)

## §0 三公理
1. **会话即弃,状态外置。** 跨 session 记忆不许依赖 session context(jsonl 撑死,/clear 不清底层)。迭代全部状态活在仓库文件,session 是一次性执行器。
2. **开放在规划层,封闭在执行层。** "下一步做什么"可开放;"这一步做没做成"必须封闭(机器可判微 DoD)。
3. **自治权 = 只读权。** 无人值守 agent 只许 读/验/报;write 必须有显式授权范围(白名单 或 任务卡)。

## §1 状态外置:Iteration Ledger
每条开放线一个 ledger:`docs/iteration/<line-name>/LEDGER.md`。
```
## GOAL(冻结区,只有 Owner 可改) — 一句话目标 + 宏观判据(可开放)
## INVARIANTS(冻结区) — 不可违反约束,引 DEVELOPER-GUIDE 陷阱号 + KI 号;每轮第一步重读
## SCOPE-AUTH(冻结区,Owner 签发) — 允许触碰文件/目录 + 操作类型(read-only/write);范围外=升级
## DOMAINS(冻结区,多 agent 线必填,见 §8.2)
## NEXT(滚动区) — 下一切片微 DoD
## LOG(只追加区) — cycle编号|日期|做了什么|证据(commit/grep/txid/DB)|微DoD PASS/FAIL
## ESCALATIONS(只追加区) — 待 Owner 裁决队列;范围外/歧义/连败时写这里然后停
```
**Ledger 是唯一真相源。** Owner 审 ledger diff,不是聊天/频道滚屏。

## §2 切片协议:八步(每轮 = 全新 session,开始读 ledger,结束 /exit)
| 步 | 动作 | 纪律 |
|--|--|--|
|1|读 LEDGER 全文,重申 INVARIANTS|防漂移|
|2|读 NEXT 微 DoD;空则自提最小可验证切片|开放性|
|3|范围校验:在 SCOPE-AUTH 内?否→ESCALATIONS 停|先谈后做|
|4|执行;事实断言先 grep/实查,引用带行号/txid|KI-29|
|5|机器门验证:判定命令实跑贴原始输出(门强度按 §9.1 谱系选最强可用)|KI-28|
|6|写 LOG 一条(含证据)|问责|
|7|提议下一切片→NEXT(或宣告收敛→ESCALATIONS 请 Owner 验收)|滚动规划|
|8|停-报:单屏摘要,/exit|停-报+会话卫生|

微 DoD 格式:`DoD: <一句话> / 判定命令: <可复制执行> / 通过条件: <对输出客观断言>`。
失败处理:同一微 DoD 连续 2 轮 FAIL → 禁第 3 次,写 ESCALATIONS 停线。

## §3 驱动四档(自治度递增)
- **档 A 手动**(默认):人手起 session。write 类只允许档 A 或档 B+任务卡。
- **档 B Driver 脚本**:`claude -p` 非交互,每轮独立进程(jsonl 结构性消失),工具白名单锁只读。ESCALATIONS 非空→退出通知 Owner。适用审计/穷举探索态。
- **档 C /loop 哨兵**(切片内部):等链确认/CI/smoke。永不用 /loop 驱动 cycle 本身。
- **档 D 协调档**(多 agent,见 §8.3)。

## §4 Owner 节奏:事件把关
仅四触发介入:① ESCALATIONS 新条目 ② write 且无任务卡/SCOPE-AUTH ③ 每 K=5 轮 ledger diff 例行审 ④ 收敛终验收。

## §5 防漂移四锁
① 冻结区(GOAL/INVARIANTS/SCOPE-AUTH/DOMAINS 只 Owner+§8.2 共定可改,每轮重读)② 证据强制(无证据 LOG/频道条目视同未发生)③ 切片预算(每轮单一微 DoD,禁顺手多做)④ 收敛压力(NEXT 必附"距 GOAL 还差什么";连 3 轮答不出=停线)。

## §6 单 agent 首试点(保留为档 B 模板)
`guess-fallback-audit`:纯只读、机器可判、开放式,档 B 全自动。voter L815/L824 为模式锚。

## §7 与既有纪律映射
先谈后做→§2步3+SCOPE-AUTH+§11 / 停-报→§2步8+ESCALATIONS / KI-28→§2步5+§9.2 / KI-29→§2步4+§9.3 / 任务卡→write 类仍走任务卡,OIL 组织其连续性 / 会话卫生→§0公理1+档B / KI-8→§4事件把关。

---

# 第二部分:多 agent 协调层(OIL-Coord)

## §8 协调层

### 8.1 协调 agent 四支柱 + 一把结构锁
**现任协调 agent:Bettor**(预测/预言机系统牵头负责人、总协调人)。
四支柱:① 把握方向(分解切片+派对的 owner;方向不清发起对抗讨论不自己拍)② 驱动各 agent 做分内事(频道派工,不替别人干)③ 审码(关2 行为验)④ 验落链(landed:true 自己实证,不信状态 claim)。
**【结构锁】协调 agent 在所有执行域的 SCOPE-AUTH 一律 read-only,零例外。** 可 grep/curl/链验,但 settler/oracle/UI 任何代码域无 write 权限;write 永远走派工。协调文档域(决议/ledger/派工卡)是其唯一 write 域。"不手痒替别人干"由此从劝诫变物理不可违(公理 3 在协调角色上的应用)。

### 8.2 域归属表(每条多 agent 线必填,冻结区)
```
| 域 | owner | reviewer | 节点 |
| settler/voter/pipeline | J2 | NWT | :3200 |
| :3300 oracle/节点/找零核弹 | J1 | KANet-UI | :3300 |
| 操作员/UI/doc/部署 | KANet-UI | NWT | :3200 |
| 攻击审/关3/红队 | NWT | (Owner) | 双 |
| 协调/审码/验落链/方向 | Bettor | Owner | 双 |
```
派工铁律:切片必落到 owner;**reviewer ≠ owner**(防自审)。撞"谁的域"先查表。

### 8.3 档 D 协调档
协调 agent 频道广播派工 → 执行 agent 各跑切片 cycle → 协调 agent 汇总+验落链+关2/关3 验收。
派工三纪律:① @具体人名(@团队=一个都收不到)② 三件套(证据 file:line/txid/DB查 + 明确结论 + 下一步派工)③ 长文分块(广播墙)。
频道纪律:只许 Claude Code 开发 agent 协作,自治 Mind 回避(防 reactive echo + herd)。

### 8.4 频道-Ledger 关系铁律
**频道是传输层,Ledger 是状态层。** 每次派工、每个关2/关3 结论、每份 §11 决议,协调 agent 必须回写对应线 LEDGER(或 COORD-LEDGER)。**没有 ledger 条目的频道消息视同未发生**——§5 锁2 团队版。频道滚走,Ledger 不会;否则就是团队尺度重演"用 session context 当记忆"。
**【v0.3-final 回写分级】** 关键决策 / 关2关3 结论 / §11 决议 = **必实时回写**;常规派工进度 = 可批量/异步沉淀(每 K 轮或每线收敛时)。**回写本身不得成为漂移源**——过度实时回写拖速 = 反模式。判据:会影响"下一轮决策或验收"的状态必沉淀,纯过程噪声不必。

## §9 多 agent 交叉验证(最强纠错)

### 9.1 验收门谱系(弱→强,微 DoD 选最强可用)
`grep 行号 < 行为测(curl 断言) < 链上 landed:true(relay check_utxo_landed) < 双节点同证 < 关3 红队(攻击面+浏览器实操)`
**"机制证通"(单节点/n=1)≠"端到端 demonstrate"(双节点 landed+攻击面)。** 报数用精确级别词,禁漂成"全栈闭环"。

### 9.2 关2/关3 分层
- **关2(行为验)** = owner 域 reviewer 或协调审:curl/DB 实测行为正确(非看渲染/非掐 commit 时间)
- **关3(攻击审)** = NWT 红队:攻击面逐类打 + 浏览器实操(用户路径真走通,非元素渲出即签)
- **关3 通过才算闭**:设计闭合 ≠ ship close。

### 9.3 verify-before-act(断言纪律)
**下结论/诊断前必逐环实查完整数据链,禁从局部+外部实情外推中间环节。** 实战:协调 agent 一程被实测纠 5 次假设(metadata/herd/trim/880-wall/daily-limit),根因均 pattern-match 未先要数据。铁律:**先驱动"查实/log-count"再开口。** "假设被实测纠"是交叉验证生效的特性。协调价值在驱动+汇总+验落链,不在抢诊断——**其每条派工断言同样适用三件套证据(协调与执行同尺)。**

## §10 跨节点维度

### 10.1 切片 DoD 加跨节点验证
跨节点闭环切片(settle/refund/dispute)DoD 必含**双节点同证**:same-node PASS ≠ cross-node PASS。J1 :3300 独立节点(自有 kaspad),闭环测必双跑。

### 10.2 跨节点命门(实战归档 → 机器门化)
- **配置 per-node**:env(如 DAILY_SEND_LIMIT/BROADCAST_CHUNK_TIMEOUT_MS)每节点独立,一改一漏=行为分叉。**【升格】"双节点 env+关键 chunked-广播超时 diff"列常驻 smoke/微 DoD**,不靠清单记忆。(实证:2026-06-10 J1 :3300 缺 90s 单侧 = 此坑活案例。)
- **序列化逐字节同**:metadata_hash/sign_req 两端算法必同(outcome_side string vs number 坑)
- **ship 三件套**:commit+push+deploy;缺 push=peer 拉不到=漂移
- **节点会盲**:monitor 自停→漏消息(本程复发 2 次)→ monitor 必常驻/自愈/heartbeat

## §11 对抗讨论收敛(重大决策)

### 11.1 流程 + 轮次上限
HALT → 协调 agent 中立摆议题 → 点名各 owner 出立场互挑 → 汇总收敛 → Owner 终裁 → 决议存底(回写 ledger §8.4)→ 解冻 executor。禁单方广播方向让 executor 即刻照做(=thrash)。
**【上限】对抗讨论 3 轮无收敛 → 强制升 Owner 终裁,禁继续耗。**

### 11.2 两条互补防线
- 没共识乱拍 → 重大决策必先对抗+共识+Owner 终裁
- 有共识不敢拍 → 共识达成 AND 与锁定文档对齐 → 立即自决,禁逐项求点头
判据:**共识达成+文档对齐=自决;否则=对抗讨论。**

### 11.3 模式级硬停(量化触发 + Owner 批 + 紧急条款)
**【量化触发】** 同一 agent 同一线 3 次被关2/关3 打回,或 1 次越 SCOPE-AUTH。
**【程序】** 协调 agent 提议模式级降权 → Owner 批准后生效(降权权不单独握协调 agent 手中)。降权=冻其域+零自加 scope+只执行逐行指派。解除:Owner 裁。
**【v0.3-final 紧急条款】** agent 实时乱来卡主线且 Owner 离线时:协调 agent 可**临时冻结其域**(只冻不降权)——立即写 ESCALATIONS 报 Owner 追认;Owner 上线未追认则解冻。**临时冻结 ≠ 模式级降权**(后者仍需 Owner 批)。紧急权有界、可追溯、默认回滚。

## §12 脏批 vs 干净验收(规模化切片节奏)
① trial-ramp 不直接 blast(先 5-10 trial 走到关键下游里程碑,不只"API 200";单笔通≠批量通,并发才暴露 herd/吞吐/广播墙)② clean-gate(ramp 前 N 单作干净门:干净续/casualty halt)③ 脏批不 claim 成功(边修在途 casualty=切换代价,用 fresh re-ramp 全 fix 从头干净 demonstrate)④ 守边界报数(§9.1 级别词)。

## §13 多 agent 纪律映射
域归属→§8.2 / 协调不替干→§8.1 read-only 锁 / 频道不当记忆→§8.4(含回写分级)/ 交叉对抗审→§9 / verify-before-act→§9.3 / 双节点同证→§10 / 对抗收敛→§11.1 / 失控处置→§11.3(量化+Owner批+紧急条款)/ 规模化节奏→§12。

## §14 首个多 agent 受控运行
**线名:`tg-bot-web-user-e2e`** — 真实用户经 tg-bot DM + web UI 端到端控制预测市场(看市场→押注→收 settle 结果)。
**定位(照实):** 协调模式已在 6/10-11 marathon 野生验证一次;本线是**纪律化(OIL-v0.3)后的首次受控运行**——验证 read-only 锁、频道-Ledger 铁律、量化触发等新约束在真实多域工作中是否可执行、是否拖速。
多域分工:KANet-UI(UI/DM owner)+ J2(register-v06 后端)+ NWT(关3 浏览器测)+ J1(:3300 跨节点用户)+ Bettor(协调/审方案/验落链)。验收:关3 浏览器实操+双节点同证。

---

## 一句话
v0.1 解决"一个 agent 怎么在开放工作上不漂移";v0.2 解决"一群 agent 怎么协调收敛+互相纠错";**v0.3 把协调权本身关进结构笼子——对执行 agent 的每一道锁,协调 agent 同尺适用。对抗验的前提是没有任何角色(包括协调者)豁免于证据和范围约束。**
