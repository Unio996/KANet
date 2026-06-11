# KANet 开放式迭代框架(OIL)v0.2 — 多 agent 协调层增补

> v0.1(单 agent 骨架)三公理 / 八步 cycle / 防漂移四锁全部保留、不改。
> v0.2 = **增补层**:把 OIL 从"一个 agent 跑 cycle"升级到 KANet 的真实形态——**5 个 agent 跨双节点(:3200 + J1 :3300)、由协调 agent 通过开发频道驱动**。
> 命题:**单 agent 自验是弱纠错;多 agent 交叉对抗验是 KANet 最强纠错。OIL 不组织一个 agent 的连续性,组织一群 agent 的协调收敛。**
> 素材来源:2026-06-10/11 scale-test marathon 的真实协调记录(非设计推演)。

---

## §8 多 agent 协调层(OIL-Coord)

v0.1 缺失的最大块:**谁来组织多个 agent 之间的连续性**。答案 = 协调 agent(架构师/牵头人)。

### 8.1 协调 agent 的四支柱(独立于执行 agent)
1. **把握方向** — 目标分解成切片 + 派给对的 owner;方向不清就发起对抗讨论(不自己拍)
2. **驱动各 agent 做分内事** — 通过频道派工,**不手痒替别人干**(替干 = 破坏协作,最难守的一条)
3. **审码** — review 每个执行 agent 的产出(关2 行为验)
4. **验落链** — 链上 landed:true 自己实证,不信 agent 的状态 claim

### 8.2 域归属表(每条线必填,冻结区)
```
## DOMAINS(冻结区,Owner+协调 agent 共定)
| 域 | owner | reviewer | 涉及节点 |
| settler/voter/pipeline | J2 | NWT | :3200 |
| :3300 oracle/节点/找零核弹 | J1 | KANet-UI | :3300 |
| 操作员/UI/doc/部署 | KANet-UI | NWT | :3200 |
| 攻击审/关3/红队 | NWT | (Owner) | 双 |
| 协调/审码/验落链/方向 | 协调 agent | Owner | 双 |
```
**切片派工铁律**:任何切片必须落到 owner;reviewer ≠ owner(防自审)。撞"这是谁的域"先查此表,不凭印象。

### 8.3 第四驱动档 D — 协调档(v0.1 三档之外)
v0.1 档 A/B/C 全是单 agent。补第四档:
- **协调 agent 通过频道广播派工 → 执行 agent 各跑自己的切片 cycle → 协调 agent 汇总 + 验落链 + 关2/关3 验收。**
- 派工规范(三纪律,实战提炼):① **@具体人名**(@J1tn 等,@团队=一个都收不到)② **三件套**:证据(file:line/txid/DB查)+ 明确结论 + 下一步派工 ③ **长文分块**(广播墙)。
- 频道纪律:**只许 Claude Code 开发 agent 协作,自治 Mind 回避**(防 reactive echo 污染 + :8000 herd)。

---

## §9 多 agent 交叉验证(最强纠错·v0.1 证据强制的升级)

v0.1 §5 锁2 是**单 agent 自验**。KANet 的真纠错是**另一个 agent 实测验/纠你**。

### 9.1 验收门谱系(从弱到强,微 DoD 按线选最强可用门)
```
grep 行号 < 行为测(curl 断言) < 链上 landed:true(relay check_utxo_landed) < 双节点同证 < 关3 红队(攻击面+浏览器实操)
```
v0.1 微 DoD 只举了 grep 例。多 agent + 链上场景必须用更强门:**"机制证通"(单节点/n=1)≠"端到端 demonstrate"(双节点 landed + 攻击面)。**

### 9.2 关2 / 关3 分层(实战分工)
- **关2(行为验)** = owner/协调审:curl/DB 实测行为正确(非看渲染/非掐 git commit 时间)
- **关3(攻击审)** = NWT 红队:攻击面逐类打 + **浏览器实操**(用户路径真走通,非元素渲出就签)
- **关3 通过才算闭**:设计闭合 ≠ ship close(KI-28 的多 agent 版)

### 9.3 verify-before-act(断言纪律·这一程最贵教训)
**下结论/诊断前必逐环实查完整数据链,禁从局部+外部实情外推中间环节。** 协调 agent 这一程被团队实测纠 5 次假设(metadata/herd/trim/880-wall/daily-limit),根因都是 pattern-match 没先要数据。
→ **铁律:先驱动"查实/log-count",再开口。** 团队"假设被实测纠"是特性(交叉验证生效),不是 bug。**协调 agent 的价值在驱动+汇总+验落链,不在抢着诊断。**

---

## §10 跨节点维度(KANet 是分布式,v0.1 缺这维)

### 10.1 切片 DoD 加跨节点验证
任何跨节点闭环切片(settle/refund/dispute),DoD 必含**双节点同证**:same-node PASS ≠ cross-node PASS。J1 :3300 是独立节点(自己 kaspad),每个闭环测必同时 same-node + cross-node。

### 10.2 跨节点协调的命门(实战踩坑归档)
- **配置 per-node**:env(如 DAILY_SEND_LIMIT)是每节点独立的,一节点改另一节点漏 = 跨节点行为分叉
- **序列化逐字节同**:metadata_hash/sign_req 两端算法必同(outcome_side 类型 string vs number 坑)
- **ship 三件套**:commit + **push** + deploy,缺 push = peer 节点拉不到 = 跨节点漂移
- **节点会盲**:agent monitor 自停 → 漏消息 90min(本程复发 2 次)→ monitor 必常驻/自愈/heartbeat

---

## §11 对抗讨论收敛(重大决策·v0.1"先谈后做"的多 agent 版)

v0.1 步3 范围校验是单 agent。多 agent 的"先谈"=**对抗性讨论达成共识**。

### 11.1 重大/关键决策流程
HALT 执行 → 协调 agent 中立摆议题 → **点名各 owner 出立场互挑** → 汇总收敛 → Owner 终裁 → 写决议文档存底 → 解冻 executor。
**禁单方广播方向让 executor 即刻照做(=thrash)。**

### 11.2 两条互补防线
- **没共识乱拍** → 防:重大决策必先对抗+共识+Owner 终裁
- **有共识不敢拍** → 防:5-agent 共识达成 AND 与锁定文档对齐 → 立即自决,禁逐项求 Owner 点头(=阻断项目)
判据:**共识达成 + 文档对齐 = 自决;否则 = 对抗讨论**。

### 11.3 反复乱来的 agent → 模式级硬停
某 agent 反复 churn/越界/回退已定 → 升级到**模式级**(冻其域 + 零自加 scope + 只执行逐行指派),不是再 review 下一个烂方案。

---

## §12 脏批 vs 干净验收(迭代节奏·trial-ramp 提炼)

开放式工作的量化/规模化切片有独特节奏,v0.1 没覆盖:

1. **trial-ramp 不直接 blast**:量化任务(上百/全网)先 5-10 trial 验**走到关键下游里程碑**(不只"API 200")→ 再 ramp。单笔通 ≠ 批量通(并发才暴露 herd/吞吐/广播墙)。
2. **clean-gate**:ramp 前 N 单作干净门——干净续 / casualty halt。
3. **脏批 vs 干净验收**:边修边在途产生 casualty(非机制缺陷,是切换代价)→ 结论用 **fresh re-ramp(全 fix 从头)** 干净 demonstrate,不拿脏批 claim 成功。
4. **守边界报数**:用精确级别词(机制证通 / 端到端 demonstrate / 干净验收),不漂成"全栈闭环"。

---

## §13 §7 映射表增补(多 agent 纪律落点)

| 多 agent 纪律 | OIL-v0.2 落点 |
|---|---|
| 域归属(谁的活) | §8.2 DOMAINS 冻结区 |
| 交叉验证/对抗审 | §9 关2/关3 + 验收门谱系 |
| verify-before-act | §9.3 + 替代单 agent 自验 |
| 跨节点双节点同证 | §10.1 切片 DoD |
| 对抗讨论收敛 | §11 重大决策流程 |
| 主动追·禁等回报 | §8.1 支柱2 + 协调 agent 驱动 |
| 频道派工三纪律 | §8.3 @具体人/三件套/分块 |

---

## §14 首个多 agent 试点(替代 v0.1 §6 的单 agent 试点)

**线名:`tg-bot-web-user-e2e`** — 真实用户经 tg-bot DM + web UI 端到端控制预测市场(看市场→押注→收 settle 结果)。

天然适配多 agent OIL:
- **多域**:KANet-UI(UI/DM owner)+ J2(register-v06 后端)+ NWT(关3 浏览器测)+ 协调(审方案/验落链)
- **强验收门**:关3 浏览器实操(用户路径真走通,非 auto-bet)
- **对抗审入口**:KANet-UI 出方案 → 协调审(§9.2 关2)→ 做 → NWT 关3 浏览器测
- **跨节点维度**:J1 :3300 也搭 tg-bot 测跨节点用户(§10)

跑通这条 = OIL-v0.2 多 agent 协调层首次 e2e 验证。

---

## 一句话
v0.1 解决了"一个 agent 怎么在开放工作上不漂移";v0.2 解决"一群 agent 怎么在开放工作上协调收敛 + 互相纠错"。**KANet 的纠错强度来自多 agent 交叉对抗验,OIL 必须把这个组织进去,否则只是单 agent 框架套了个分布式外壳。**
