# NWT · 2-1 热钱包硬上限与冷热分离规格 v0.3（Owner 全量导入裁决 + 单账号临时豁免机制 + 重启风暴发现）

> **Status**: DRAFT-FOR-REVIEW v0.3（2026-09-14 · NWT · docs only，只写规格不落码不执行）
> 承接 v0.1（`749cc045`）+ v0.2（`b3343ca3`，驻留期持续监控）。
> **v0.3 变更（Bettor 1168，Owner 裁决）**：Owner 拍板全部 19 个已知主网账号都导入（含 Trader-B/MarketMaker-A），
> 不设"不导入"清单——**导入（行进 `relay_nodes`）全做；运行/驻留（私钥进子进程内存）仍由准入门+驻留监控管，
> 800/1000 两个上限不变**，两大额账号变成"已导入、relay 永不启动"档。本稿：①冷清单语义改写；②单账号临时豁免
> 机制建议+敞口后果明写；③**核查发现一个需要在落码前处理的 MUST-FIX：现有 30s 健康监控对"持续被拒启动"的
> 账号完全没有重启风暴防护**，不是"确认没问题"。

## 0. 一句话

**Owner"全部导入"这个决定不改变任何一条既有安全判据——`RELAY_HOTWALLET_COLD_ADDRESSES`本来就是"拒绝启动"
不是"拒绝导入"，语义早就对了，只是文档/心智模型需要跟着 Owner 的措辞更新；真正需要处理的是核查③发现的一个
真实缺口：健康监控的"重启风暴"计数器只算成功重启，从不给持续被拒的候选计数，Trader-B/MarketMaker-A 一旦导入，
会被 30s tick 永久重试、永久拒绝、永久刷两行 warn 日志，风暴防护对它们形同不存在——这个必须先修，不能带着这个
状态就把两个大额账号的行导进 `relay_nodes`。**

## 1. ①冷清单语义改写——不需要新字段，机制早就对了

**v0.1 §4 原文写的是**"冷地址拒绝清单……任何候选地址在 `startRelay()` 里先查这个清单，命中直接拒绝"——**这条
检查从第一版设计起，语义就是"拒绝启动"，不是"拒绝导入"**：`RELAY_HOTWALLET_COLD_ADDRESSES` 是在 `startRelay()`
（私钥入内存前置点）里查的，跟这一行是怎么进 `relay_nodes` 的完全无关——**Owner"全部导入"这个决定不需要改
`checkHotwalletAdmission()` 的任何一行代码，因为它从来就没有拦"导入"这个动作，一直拦的就是"启动"**。

**需要改的只是文档措辞**：v0.1 §2 "MarketMaker-A 我也判冷……默认不导入"这句和 §7 "MarketMaker-A/Trader-B：
不进入任何批次"这句，**按 Owner 1168 裁决改写为**——

> Trader-B / MarketMaker-A：**导入（行落 `relay_nodes`，走既有 `POST /relays`/`import-privkey` 端点，跟其余
> 17 个账号同一批次流程，不特殊处理导入这一步）；`RELAY_HOTWALLET_COLD_ADDRESSES` 必须在导入完成前就已经
> 包含这两个地址（不能导入之后才补配置——见下§3.1的窗口问题）；此后任何自动/手动启动尝试在 `startRelay()`
> 一律被 `cold_address_denied` 拒绝，除非走 §2 的一次性豁免或 Owner 修改/移出冷清单 env**。

**"导入但不常驻"这个档不是一个新状态字段，是"这一行存在于 `relay_nodes` + 这一行的地址存在于
`RELAY_HOTWALLET_COLD_ADDRESSES`"这两个已有事实的组合**——DB 里这一行跟其它 17 行在结构上完全一样（没有
`quarantined`/`cold` 列），区分它的判据全部活在 env 里、活在 `checkHotwalletAdmission()` 这一次判断里，不是
DB 状态。这条跟 v0.2 §2 已经论证过的"不需要新增隔离标记字段"是同一个设计原则的自然延伸。

## 2. ②单账号临时豁免机制（供 Owner 以后选用，本稿只给建议不落码）

**敞口后果先明写（Bettor 1168 明确要求）**：如果 Owner 以后要真的用 Trader-B 或 MarketMaker-A 启动 relay
（比如真的要用它做市/交易），**唯一途径是调高 `RELAY_HOTWALLET_PER_RELAY_MAX_KAS`/`RELAY_HOTWALLET_TOTAL_MAX_KAS`
到能覆盖它的量级（Trader-B 需要 ≥20,301.72，MarketMaker-A 需要 ≥1,004.996）——而这两个 env 是全局的，一旦调高，
**新上限对所有 relay 一起生效，不是只对这一个账号放宽**。最坏情况：如果两个 cap 都调到能同时覆盖两个大额账号+
其余 17 个账号全部同时活着，理论热钱包总敞口 = §1 表格的全部 19 个账号余额加总 ≈ **21,890.76 KAS**（Bettor
1132 实查的链上合计数）——**这不是"这两个账号各自多冒的风险"，是"两个全局 env 一旦为了它们调高，全部账号的
组合上限跟着一起松开"这个后果**，必须让 Owner 清楚看到这一点再做选择，不能只说"调高上限"这四个字就让人以为
影响范围只有这一个账号。

**建议的最小豁免机制（一次性、按 relay id、仍受监控——不是永久改全局 cap）**：

```
RELAY_HOTWALLET_EXEMPT_RELAY_IDS=<relay_node_id_1>,<relay_node_id_2>
```
- **只豁免 `startRelay()` 里§4的冷清单拒绝**（`cold_address_denied` 这一条），**不豁免** per-relay/total 两个
  cap 检查——如果 Owner 只是想让 Trader-B 单独跑起来验证点什么，不代表 Trader-B 的 20,301.72 KAS 就不用再受
  per-relay 上限约束了；如果 Owner 确实需要 Trader-B 的真实余额全额可用，那是另一件事（调高 per-relay cap），
  两件事应该分开决定，不要用一个开关同时豁免两条不同性质的检查。
- **仍然受 v0.2 §1 驻留期监控**——豁免只解除"能不能启动"这一道门，不解除"启动之后余额被推过线会被杀"这道门
  （如果 per-relay cap 本身也没调高，Trader-B 一旦真的启动，驻留监控在下一个 tick 就会发现它的余额本来就超过
  per-relay cap，按 v0.2 §2 kill 掉——**这条组合本身就说明"只豁免冷清单、不调 cap"这个最小豁免选项，实际效果
  是"能短暂启动几十秒直到下一次驻留监控 tick，然后被杀"，如果 Owner 真的要让它稳定活着，必须同时调高 per-relay
  cap，光加豁免不够**，这条如实写清楚，不让 Owner 以为"加个 env 就能让它跑起来"）。
- **按 relay id 不按地址**——理由：地址是账号身份，relay id 是"这一次启动尝试"的身份，同一个地址理论上可以
  被重新导入成不同的 relay_node 行（虽然当前流程不会这样做），按 relay id 豁免更精确对应"这一次 Owner 明确
  批准的这一个启动"，不会因为地址匹配的宽松性意外扩大豁免范围。
- **必须打印 LOUD 日志**（同 v0.2 §1 `HOTWALLET_MONITOR_OFF` 那条纪律——`console.error` 级别 + 明显字样，
  例如"冷清单豁免已手动生效: relay=<id> address=<addr>"），不能悄无声息地跟其它 env 一样一行生效不留痕迹。
- **这是本稿给 Owner 的建议方案，不是本稿裁定要落码**——具体是否要做、什么时候做，等 Owner 需要用到这两个
  账号时再决定；本稿只是提前把"最小豁免长什么样"想清楚，避免到时候临时现想现改容易漏掉"仍受监控"这条。

## 3. ③准入门代码对"持续被拒启动"账号的重启风暴/日志刷屏核查——**发现真实缺口，MUST-FIX，不是确认没问题**

**核查方法**：读 `coord/kanetui-hotwallet-caps` 分支 `relay-health-monitor.js`（30s cron）+
`relay-manager.js`（`checkHotwalletAdmission`/`startRelay`）的完整逻辑，不是只读文档描述。

**发现（MUST-FIX，落码前必须处理）**：`relay-health-monitor.js` 的"重启风暴"防护（`_restartCountInLastHour(r.id)
>= MAX_RESTART_PER_HOUR` 达到 3 次跳过）**只在 `startRelay()` 返回成功时才计数**——

```js
const result = await startRelay(r.id);
if (result?.ok) {
  _recordRestart(r.id);   // ← 只有这里会推进重启计数
  ...
} else {
  errored++;
  console.warn(`... startRelay fail: ${result?.reason}`);   // ← 失败分支完全不碰 _restartHistory
}
```

**后果**：一个因为 `cold_address_denied`（或 per_relay_cap_exceeded/hotwallet_total_cap_exceeded）**结构性
永远会被拒绝**的候选（除非 Owner 改 env，否则下一次判断结果跟这一次一模一样），`_restartCountInLastHour` 永远
停在 0——**"重启风暴"这个防护机制对这一类候选完全不生效，30s tick 会永久重试、永久被拒、永久刷日志，没有
任何退避**。具体到 Owner 1168 的场景：Trader-B/MarketMaker-A 一旦导入（行落 `relay_nodes` 且 `address IS NOT
NULL AND mnemonic_encrypted/privkey_encrypted IS NOT NULL`，满足 `relay-health-monitor.js` 的 `eligible` 查询
条件），**从导入那一刻起，每 30 秒会产生**（`relay-health-monitor.js`一行"dead...auto-restart attempt #1"
——注意这个计数器因为上面那条 bug 永远显示"#1"，哪怕已经重试了一万次，这本身也是一条误导性日志——+
`checkHotwalletAdmission()`一行`cold_address_denied` warn + `relay-health-monitor.js`一行"startRelay fail"
warn）**每账号每tick 3 行日志，两个账号合计每天 2×3×2880(30s一次/天) = 17,280 行**，永久持续，直到 Owner 把
这两个账号从 `relay_nodes` 删掉或者这条 bug 被修——**这不是"确认没问题"，是核查确实找到了 Bettor 点名要查的
那个风险，且它是真的**。

**修法建议（本稿只给方向，不是本稿要落码的范围——留给 KANet-UI/J2 按 MUST-FIX 排期）**：
- **最小修法**：把 `_recordRestart(r.id)` 从"只在 `result.ok` 时调用"改成"每一次真的调用了 `startRelay()`
  就调用"（不管成功还是失败）——**这才是"重启风暴"防护本来该有的语义：限制的是"尝试重启的频率"，不是"成功
  重启的频率"**，成功了 3 次就该抱有疑问抱且现在的问题恰恰是"一次都没成功过"这种情况反而被防护机制无视。
  这条改法对**其它现有的、非"结构性永久拒绝"类失败**（比如一次性的RPC超时）影响：会让它们也进入"3次/小时"
  节流，**这是期望行为，不是副作用**——一个反复因为RPC超时启动失败的relay本来就不该被无限期每30秒重试，
  跟"结构性拒绝"用同一套节流逻辑处理是合理的，不需要为两类失败原因分别设计不同的计数策略。
- **不建议的修法**：给`checkHotwalletAdmission`的拒绝原因加一个"永久性"/"暂时性"的分类再分别处理——这是
  过度设计，"每次尝试都计数"这一个改动已经完整解决"持续失败=风暴"这个问题，不需要先区分失败原因的性质。
- **这条本身不影响 v0.1/v0.2 已定的任何数字/机制**——800/1000两个cap、冷清单机制、驻留期监控三者都不用改，
  只是"重启计数器该数什么"这一处实现细节需要修。

**处置建议（明确写清楚顺序）**：**这条 MUST-FIX 应该在 Trader-B/MarketMaker-A 真正导入（行落 `relay_nodes`）
之前修好**——不是必须在"写这份规格"之前修好，但必须在"Owner 1168 的全量导入真的执行"之前修好，否则从导入
那一刻起就会产生上面算出来的日志刷屏，且"重启风暴"这个本来该在场的安全网对这两个账号完全缺席（虽然本稿判断
后果止于日志噪音，不是资金风险——`cold_address_denied` 本身不会让私钥进内存，跟"风暴"字面意义上的资源耗尽/
CPU占用问题也不是一回事，但持续的日志噪音本身会稀释真正需要被看到的告警信号，且"计数器永远显示#1"这条误导性
日志会让人误判故障历史）。

## 4. 与 v0.1/v0.2 的关系

- v0.1 §1-§7、v0.2 §1-§5 **全部不变**，本稿只：①改写 §2/§7 冷清单语义描述的措辞（机制代码不用改）；②新增
  一条 Owner 以后可选用的豁免机制建议（不落码）；③报告一条独立核查发现的 MUST-FIX（重启风暴计数器缺口）。
- 800/1000 两个上限数字、`RELAY_HOTWALLET_COLD_ADDRESSES` 机制本身、驻留期监控三件事**都不变**——变的只是
  "Trader-B/MarketMaker-A 这两行现在会真的出现在 `relay_nodes` 里"这一个事实，以及由此新暴露出的§3那条缺口。

## 5. 给 Bettor 的处置建议

- ①②按上面写好，可以采纳。
- **③是本稿最重要的产出**：不是"确认代码没问题"，是找到一个必须在全量导入前处理的真实缺口——建议把"修
  `_recordRestart` 计数范围"排进 KANet-UI 下一批 MUST-FIX，且排在"Trader-B/MarketMaker-A 实际导入"这个操作
  **之前**，不要让顺序倒过来。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
