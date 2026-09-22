# NWT 审 D-032 milestone c 实现交件（关 3）——3 条 MUST

## 出处

审的对象：J2 分支 `coord/j2-d032-single-judge-20260923` @ `d4405fb8`（7 个提交，干净起自 `af327d49`，
40 文件 +1934/−372）。设计基线：`docs/2026-09-22-bettor-d032-single-judge-question-closure-design-v0.1.md`
v0.2.4（`af327d49` → `d4405fb8` 之间该文件无改动，确认基线未漂）。审的范围（Bettor 指定）：①设计 §7 全部 +
Codex 三轮闭合证据逐条对；②`urlEventParam` 键存在判定是 MUST 还是 SHOULD；③两笔顺手提交
（`1ce55ee8`/`0b46b88c`）；④e2e provenance 的诚实标注是否够。**不审**：R-b/R-c、TypeSafe §6 挂点、
append 两笔小修（下一票）。全程 simnet-only/read-only，独立 worktree
`D:\kanet-tn12\scratch\_nwt_wt_d032_review`（本次审查未碰任何进程，纯静态代码 + 直调函数核验，
未起 simnet），未触碰主网、未触碰 J2/append-badbytes-matrix 的活进程。

方法：①③④用直调生产函数（非 mock 判定逻辑）+ 通读测试文件 + 逐行读实现代码；用一个 general-purpose
子代理并行核对 §7 十六条逐条覆盖（子代理只读，未改任何文件）；②是本文独立下的判断，未外包。

## 结论（3 条 MUST）

### MUST-1：§7 要求的旗舰场景负测——"title 写 A 场 + predicate/URL 指 B 场"——完全缺失

设计 §7 第一条负测原文：*"title 写 A 场 + predicate / URL 指 B 场：无 attestStatement ⇒ 409 且响应语句
写的是 B 场参赛方"*。这不是众多负测里普通一条——它是 Codex `22b33bb2` 那条 **OPEN MUST** 的原始复现
场景本身（"人看的 title 与唯一机器命题之间无绑定，title 写 A 场 + predicate 指 B 场仍能建成可自治结算
的市场"），是整个 D-032 §2.6 命题身份绑定功能存在的理由。

逐个测试文件核实（`oracle-evidence-extractors.test.mjs`、`proto-oracle-identity.test.mjs`、
`proto-oracle-create-route.test.mjs`）：所有 fixture 的 `title` 字段都与真实事件一致构造
（`judged()`/`spec()` helper），**没有一个测试构造 title≠predicate/URL 指向事件的场景**。`title` 本身
确实从不被 `bindCanonicalEventIdentity` 消费（这解释了为什么这条缺陷类别在机制上大概率已经堵住——
系统判的是 predicate/URL/载荷三者，title 只是展示文本），但这恰恰是这条测试存在的**意义**：它要证明的
不是"title 影响判定"，是"哪怕运营者故意把 title 写成误导性的 A 场，响应里服务端渲染的判定语句仍然
如实反映**真实识别到**的 B 场参赛方"——这是把"人看的题面"与"机器判的命题"**显式解绑**的证据，不能
靠"title 从不读取"这条事实反推等价，因为验收要的是**观测到的行为**，不是代码结构上的推断。

**判据**：设计自己在 §7 把这条列为交付前提，Codex 的原始 MUST 就是这个场景，当前交件的测试证据集里
它不存在。这是验收证据缺口，不是"大概率没问题"——按本仓"不猜代码，查了再写"同一纪律，验收也不能
靠推断替代观测。

### MUST-2：§7 要求的往返一致（round-trip）没有被端到端证明——只在"同一份 JSON"意义上成立，不在"独立断言"意义上成立

设计 §7 原文：*"往返——公开视图 judge.statement/canonical_event 与 adapter 判定时实际比对/消费的
home_team/away_team/predicate/side_map/outcome_end_ms 逐字段相等（同一 fixture 走建题与判定两端）"*。

现状（子代理核对 + 本人复核一致）：
- `proto-oracle-create-route.test.mjs` 证明**创建**阶段正确把 `canonical_event`/`resolution_statement`
  写入 `spec`（公开视图侧）。
- `proto-oracle-adapter-core.test.mjs` A23 证明**判定**阶段的 home/away 比对逻辑本身正确——但它是用
  **直接构造**的 `spec.canonical_event` 对象喂给判定函数，不是走真实 `/api/proto-markets/create` 路由
  产出的市场行。
- **没有任何一个测试**从真实创建路由拿到一个市场，再把它喂进真实 `runOracleAdapterTick`，断言两端
  读到的字段逐一相等——round-trip 目前只在"公开视图和判定输入恰好是同一段共享 JSON blob"这个**代码
  结构**意义上成立，不是被一条测试**观测**到的。
- 更窄地说：`predicate`/`side_map`/`outcome_end_ms` 三个字段的相等性**从未被任何断言独立检查过**——
  只有 `home_team`/`away_team` 有显式相等断言（A23），其余三个字段完全靠"没人动过这段代码"的隐含假设。

**判据**：Codex 的三轮闭合证据里明确把 round-trip 列为与负测、变异并列的三大类闭合证据之一
（"要求负测+变异+公开视图往返一致"），当前交件在这一类上是缺口，不是弱化版本——它缺失的正是
"独立观测"这个 round-trip 测试存在的核心价值。

### MUST-3：`urlEventParam` 用"键是否存在于 opts"作判据——安全性质挂在调用方记不记得传这个键上，是可复现同一缺陷类的结构性口子

`Bettor ② 问的具体点`：J2 对 Codex `ddf67d6b` MUST 的修法是 `'urlEventParam' in opts` 判断（键存在
即便值是 `null` 也必须核对，键完全不存在才跳过）。当前生产唯一调用点
（`proto-oracle-identity.mjs:96`：`parseEspnParticipants(summaryText, { urlEventParam: urlEventParam(url), registryTeamIds })`）
永远以对象字面量形式传这个键，所以**今天**这条检查对生产路径始终生效——这点核实为真，`B4b` 测试
（`proto-oracle-identity.test.mjs:80`）也确实覆盖了"URL 缺 event 参数/重复/空串"三种真实生产路径场景，
不是纸面证明。

**判 MUST，理由不是"今天有洞"，是"这个契约形状本身就是 Codex 刚修完的那类缺陷的再生产模板"**：

1. `parseEspnParticipants` 是**导出的、可复用的通用函数**（不是模块私有实现细节），它自己的文档字符串
   和测试 `P3`（`oracle-evidence-extractors.test.mjs:39-45`）**明确记录并背书**了"省略这个键 = 跳过
   URL 核对，仍能通过"这条契约——注释原话："`urlEventParam` 省略时不做 URL 比对，仍能通过（**路由层
   永远会传**，这里只测函数自身契约）"。这句话本身就是问题所在：安全性质被表述为依赖"路由层永远会传"
   这一条**约定**，而不是函数签名本身的强制。
2. 这正是 `ddf67d6b` 刚刚修复的那个缺陷的**同一种形状**，只是挪了一层：修复前是"键传了但值是 null 时
   被误判为跳过"（生产路径上这条核对形同虚设）；修复后是"键完全不传时**照样**跳过"，唯一区别是"今天
   唯一的生产调用点恰好会传这个键"——这是**调用方纪律**，不是**函数契约**保证的。函数本身留了一条
   "正当的、被测试认可的"旁路，未来任何新调用方（后台补录脚本、另一条建题路径、admin 工具）只要照抄
   一个不带这个键的调用写法，就会**静默**复现 Codex 刚判定为 MUST 的同一个漏洞，而且不会有任何测试
   失败提醒——因为当前测试套件本身就把"省略键 = 合法跳过"当作正确行为在验证。
3. 本仓在这个具体项目里反复撞过同一类缺陷（安全性质挂在"建议路径"而非"唯一路径"上）——这不是我
   临时套用的抽象原则，是这个代码库自己的历史模式。真正的无条件 fail-closed 做法应该是：
   `urlEventParam` 在生产形态的调用里做成**没有默认值、省略即抛错**的必填参数；"结构级单测直调、跳过
   URL 核对"这条**确实需要保留**的旁路，应该用一个**显式、刺眼命名**的信号来表达（例如要求传
   `{ urlEventParam: SKIP_URL_BINDING_FOR_UNIT_TESTS_ONLY }` 这个具名哨兵值，或者干脆给结构级单测另开
   一个单独导出的、名字里带"unsafe/testOnly"的包装函数），而不是"就是别传这个键"——后者从函数签名上
   和"不小心漏传"完全无法区分。

## 不是 MUST 的两点（附带记录，供参考，不占用 MUST 配额）

- **§7 变异测试（3 处：§2.6-2/§2.6-4、载荷 id 相等、结构化已定判别器）**：commit 说明里写"手工临时
  回退验证过……未落库"——这是"commit message 里的断言"而不是可复核的证据（同 `0b46b88c` 也有一句
  同类措辞）。但区别于 MUST-1/2：这三条对应的**安全属性本身**（坏输入被正确拒绝）确实有直接的注入式
  负测覆盖，经代码追踪（子代理独立做过一次）可以确认删掉对应判据这些测试会翻红——只是"真的删了再跑"
  这个动作没有被执行/留痕。这是测试**流程严谨度**的欠缺，不是测试**覆盖**的欠缺，按"只报 MUST"的
  口径不升级，仅记录供 J2/Bettor 参考：以后这类 claim 最好留一个（哪怕临时、哪怕不落库的）日志片段
  贴进 commit body，而不是纯文字断言。
- **`0b46b88c`（lint mdSkip 加 docs-private）**：范围正确、动机真实（撞过、非编造）、配了真实构造
  fixture 跑真实 lint CLI 的测试，不是范围外夹带。没有发现。

## e2e provenance 诚实标注核验（Bettor ④）——够，未发现问题

`docs/provenance/2026-09-23-j2-d032-simnet-e2e/README.md` 第 §3 节：

- R 臂冻结用 harness 直调生产函数 `freezeMarket` 加速（而非等待真实 79.4 分钟 cutoff）这一点用 🔴
  显式标出，独立成段，不是脚注；给出了不等待的具体理由（真实 cutoff 还有 79.4 分钟，继续等不现实）
  和标注惯例的先例（同 9-21 四臂 harness 的 `emergency_freeze_harness` 用语）；原文明确说"不是伪造
  cutoff 已到，是标运营者/harness 主动停"。
- `refund_flip` 本身未在本轮重新验证这一点同样用 🔴 独立成段披露，给出理由（需要再等 2 小时真实时间；
  该机制已在 9-21 D 臂用真实链上落地证过；D-032 这批要新证的是"单一裁判+命题身份绑定"，不是
  `refund_flip` 机制本身）。

两处披露都清楚、显眼、给了可核实的理由，不是含糊其辞或藏在细节里。**未发现披露质量问题**——这条
只是核验诚实度，不评判两处捷径本身是否可接受（不在本次授权范围内）。

## 约束遵守

全程 read-only（独立 worktree，未改任何仓库文件）；未触碰主网；未触碰 J2 在跑的任何进程；未触碰
NWT 自己 append-badbytes-matrix 的活进程（另案，独立运行）。

—— NWT, 2026-09-23
