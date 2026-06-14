# NWT 任务卡 — UMA-learning shadow-accuracy oracle 引擎（①→④）

> **来源**: Owner 钦定任务卡（2026-06-14）。Bettor 落 repo + 发 NWT。**背景长期 track，不得 derail demo**（NWT demo 源角色优先，源角色空出时并发推进）。

| 项 | 值 |
|----|----|
| 域 | NWT（shadow-harness + oracle-correctness） |
| Track | **B**（D:/kanet-tn12 · main · TN12）— 不碰 C:/KANet |
| 优先级 | **背景长期 track**。NWT demo 源角色优先;此卡在源角色空出时并发推进,**不得 derail demo** |
| 起点 | 已有 `scripts/gateE-shadow-accuracy.mjs`（第③步雏形）。**扩它,不重建（永不新建）** |
| 北极星 | "获取更真实准确信息" 的引擎。站 UMA 几千个市场的 resolution rule + cited source 肩膀上,读-学-验-毕业,逐 domain 降低 UMA 依赖,逼近 mainnet-independent oracle |

---

## 一、Owner 已拍板的硬约束（C1–C3,不可改,贯穿每个 phase 的 DoD）

**C1 — UMA 是教方法的老师,不是判分的答案。**
- 哪儿有真 ground truth（比分 / 选举 / 链上事实),**拿真相判分,不拿 UMA 裁决判分**。
- UMA 只用来学"这类问题去哪个权威源查"。grading key = 那个源本身,不是 UMA 的结论。
- 每条 shadow 结果必须打标:`graded_against: truth` 或 `graded_against: uma_proxy`。只有**确实没有可得真相**时才退到 `uma_proxy`。
- 验收准确率必须分两栏报:vs-truth / vs-uma-proxy。**不许把两者混成一个数字。**

**C2 — 学到的源喂进 prevet 白名单,引擎不接管 settle。**
- 知识库产出 = prevet source whitelist 的**候选供货**（host-anchored / 可恢复 / 可 snapshot）。
- 真正 settle 仍走现有"白名单内 + commit 时 snapshot-hash"判定路径。引擎对 settle 路径是**只读 advisory**（"这个 domain 现在可独立判 / 该弃权"),**绝不执行结算、绝不在 settle 时现场自由选源**。
- 源选择即攻击面:污染源 = 污染结算。所以候选≠自动信任,vetting / host-anchor / recoverability 是白名单的职责,引擎只供货。

**C3 — 毕业是滚动可撤销的资质,不是一次性证书。**
- 持续拿 live 真相重测;漂出阈值 → **降级回 learning / abstain**。
- 兜底永远是 **abstain-not-guess**:没把握就弃权,不硬猜。
- 主观/模糊长尾（UMA 自己都吵的那批）默认**永久留在弃权区**。引擎的真实渐近线 = "在可核验子集上独立、其余弃权",不是"完全独立 oracle"。这条要在毕业报告里**对外如实标注**(对应 source-self-error + timeout 不可约上限)。

---

## 二、禁止清单

- ❌ 重建 harness（扩 `gateE-shadow-accuracy.mjs`,不新建并行脚本）
- ❌ grade-against-UMA（违反 C1）
- ❌ 引擎接管 / 触发 settle、或在 settle 时现场选源（违反 C2）
- ❌ 一次性发毕业证、无滚动重测（违反 C3）
- ❌ 凭印象 claim 现状（KI-29:所有现状断言必须 4 维 grep 证据 = 目标实现 + 调用方 + imports/tests + body context;**先 recon 后写码**）
- ❌ 新建 domain 分类器（先查 predictions 现有 Crypto/Politics/Economy/Sports/Tech/Other 分类能否复用）
- ❌ 动 demo / settle 主路径的任何代码
- ❌ 碰 C:/KANet 或主网

---

## 三、Phase 0 — RECON（grep + 报告 + **STOP**）

**写任何引擎代码前,先把现状摊开,4 维 grep 证据,填下表,然后停,等 Architect/Owner 批 build plan。**

| # | 要查清 | 4 维 grep 证据落点 |
|---|--------|---------------------|
| R1 | `gateE-shadow-accuracy.mjs` 现在到底做什么:采样什么、"native 判定"来源、**当前对照的是 UMA resolved outcome 还是真源**、准确率怎么算、每 domain N、结果写哪 | 目标实现 + 调用方 + imports/tests + body |
| R2 | UMA resolution rule + cited source(ancillary data) 现在拿不拿得到、从哪拿(Gamma API? `ancillary_data` 字段?) | step① 可行性 |
| R3 | prevet source whitelist **存不存在**:表/registry schema、host-anchor 字段、recoverability、snapshot 字段。没有就要标"需加字段" | C2 的接入点 |
| R4 | 市场 domain 现在怎么判(有没有现成分类器可复用) | 复用判定 |
| R5 | **C1 审计**:现有 harness 给 sports 判分时,grading key 是真源还是 UMA?(若已是 grade-against-UMA = 这正是要修的第一处) | C1 落点 |
| R6 | 毕业状态(domain→learning/graduated/abstain)将存哪、settle/oracle 路径怎么**只读**它而不被它接管 | C2 边界 |

**STOP。** 报告以紧凑表呈现 + 一句话 build plan 建议。批了再进 Phase ①。

---

## 四、Build Phases（全部 gated 在 Phase 0 批准之后）

| Phase | 目标 | DoD |
|-------|------|-----|
| **①** UMA rule+source 解析器 | 从 ancillary data 解析出 `{domain, rule, authoritative_source[]}` | 真解析 N 个真实市场;结构化落库;字段可得性 grep 坐实 |
| **②** domain→源 知识库(accumulative) | 持久化 domain→可靠源 映射,随读 UMA 市场累积、去重、排序 | KB 随读增长;复用 R4 分类;产出标为 prevet 白名单**候选**(非自动信任,符合 C2) |
| **③-fix** 独立判 + C1 grading | harness 用 ②的源独立判,**有真相拿真相判分**(C1),无真相才退 uma_proxy;每结果打 `graded_against` 标 | sports 用**真结果源**判分(非 UMA);准确率 telemetry 分 domain、分 truth/proxy 两栏 |
| **④** 毕业引擎(滚动 + abstain) | 逐 domain 阈值 → `{learning/graduated/abstain}`;滚动重测;漂则降级;abstain 兜底 | 状态滚动可撤销;abstain 路径有测试;状态对 settle 路径**只读 advisory**(C2);毕业报告含 C3 的弃权区披露 |

毕业一个 domain 的"收口"标准(KI-28 精神,降级版):真 shadow 跑 + live 真相对照的准确率 telemetry + abstain 逻辑实测,缺一不算毕业。sports 起步(线E 现 N=35≈95.8%),一个 domain 一个 domain 来。

---

## 五、报告格式（每个 STOP 点）

```
[NWT · UMA-engine · Phase N]
- 做了什么(grep 证据贴 file:line)
- C1/C2/C3 各自当前是否守住(逐条 yes/no + 证据)
- 准确率(若涉及):domain | N | vs-truth% | vs-uma-proxy%
- 卡点 / 需 Owner 拍的决定
- 下一步建议 + 是否请求继续
```

## 六、停止点（不可跳过)

1. Phase 0 RECON 后 → STOP,等批 build plan
2. 每个 build phase 完 → STOP,按上格报告,等批下一 phase
3. 任一 C1/C2/C3 守不住 / 需要动 settle 路径 / 需要新建模块 → 立即 STOP 上报,不自行决定
