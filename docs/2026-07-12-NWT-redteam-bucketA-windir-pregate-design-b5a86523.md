# NWT 红队 — 桶A win_direction 回补 + 不可达 pre-gate 合卡设计(b5a86523)

> **Status**: CURRENT
> **对象**: docs/2026-07-12-bucketA-windir-backfill-and-unreachable-pregate-design.md(J2)
> **verdict**: **GREEN-with-notes——方向成立、全程 fail-closed 零资金动作;F1/F2 折入设计后落码 GO,F3/F4 scope 注明防过度 claim**

---

## 我试了哪些攻击(挣 PASS)

Fix-A 推断误判方向 / 双吻合漏网 / 匹配错源 / bettor 集漂移 / refund-root 混入;Fix-B 常量漂移误伤可达盘 / coverage 洞漏判 / gate 永锁。逐条如下。

## F1 🟡 MUST-FIX(verify-value-source,我域): Fix-A 匹配靶=evidence.payout_root(DB)非链上 closed-PS root

设计称"root 即链上 attest 终审值,authority 仍在链",但 §2 实际把重算 root 跟 **`evidence.payout_root`(DB 值)** 比对。这是 DB claim,不是链。若 evidence.payout_root 写错/写陈(老版本写入正是本卡背景),推断确认的是"重算==DB claim"而非"重算==链",= 规则56 同源 vacuous 的近亲。**缓解已有**:这些盘 close_txid 在(close 已落链)+ claim 时 covenant 终审,错推断→错叶→claim BUST(资金安全)。但**认账口径**:靶应是**链上 closed-PS redeem 烤的 root**(close_txid→closed PS output→redeem→root offset 现读),或至少推断前断言 `evidence.payout_root == 链上 redeem root`。否则"authority 在链"是名义,实际信 DB。**修法**:matchTarget 从 evidence.payout_root 改为(或补断言)链上 closed-PS root 现读——与 D-008 反 vacuous 铁律"值源独立链读禁透传"同一条。

## F2 🟡 MUST-FIX(手工配对常量非对称失效): driver MAX_WALK < rpc MAX_WALK → 误伤可达盘

driver 侧新增 MAX_WALK=250000 常量须 == rpc-listener.mjs:221(跨进程无法 import,规则55)。**失效方向非对称**:
- driver 常量 > rpc 真值 → gate 少触发 → 部分不可达盘仍撞重锤(**次优但安全**);
- driver 常量 < rpc 真值(rpc 来日调高没同步 driver)→ gap∈(driver, rpc) 的盘**实际可达却被 gate 跳过**=**liveness 误伤**(settleable 盘永久 skip)。

∴ 安全约束是 **driver_MAX_WALK ≥ rpc_MAX_WALK**,不是"相等"。设计只说"必须相等"未点出方向性——相等是边界,任一侧漂移到 driver<rpc 即误伤。**修法**:①gate 条件加安全余量 `gap > MAX_WALK`(已是)+ 注释钉死"driver 常量宁可偏大不可偏小,误伤方向=可达盘被跳";②regression case 双向断言值 + 显式测 gap==MAX_WALK 边界(off-by-one:`>` vs `>=`——gap 恰等于 MAX_WALK 时 rpc 是 walk 成功还是 throw?落码前查 rpc-listener:264 的边界,gate 判据须与之严格一致,否则边界盘一侧 gate 一侧 walk)。

## F3 🟢 note(防过度 claim "22 盘全救"): Fix-A 两类非救援盘

root-match 隐含要求 `getMarketBets` 返回的 bettor 集 == attest 时的集。两类会 fail-closed(安全但不救):
- **bettor 集漂移**:若 attest 后 phantom/shard exclude 逻辑演进,今日重算集 ≠ 当年集 → 两方向都不吻合 → fail-closed;
- **refund-root 盘**:原市场 degenerate(单边→退款)则 evidence.payout_root 是 refund root,两个 pari-mutuel 方向都不吻合 → fail-closed。

都正确 fail-closed 零风险,但意味着**22 盘里可能有若干救不回**,落 L628 另案。报数口径按设计 §4.3"不 claim 27 全清"守住,别宣"root-match 救全部 22"。

## F4 🟢 note(scope 精确): Fix-B floor 判据不覆盖 coverage 洞

gate 判据① `deadline_daa < floor` 用 MIN(start_daa) 当 proxy。coverage **洞**(deadline ≥ floor 但落在索引空段)不被 gate → 走 computeSettlePlan → 仍可能撞 MAX_WALK 线性 walk。安全(重锤是既有 fallback),但"消 ~44min/轮重锤"的收益 claim 应 scope 为"floor 以下不可达盘",洞内盘仍可能重锤(§2.5 coverage 洞是另一维,本 gate 不治)。

## 双吻合安全性(核毕=真 fail-closed)

零/双吻合 fail-closed 正确:不同 winner 集→不同叶集→不同 root,双吻合需 blake2b 碰撞(不可行);即便理论边界成立,fail-closed 兜底安全。设计"防御性保留"表述准确,无异议。

## 结论

设计方向成立:Fix-A root-match=链锚推断(非人工判方向,xzztw 合规版)、Fix-B 只 skip 零状态变、位置对(resume 成功盘零影响)、scope 收紧不改排序/容量。**GREEN-with-notes**。F1(靶换链上 root=我域 verify-value-source 核心)+ F2(常量非对称失效方向+边界 off-by-one)折入设计即落码 GO;F3/F4 报数 scope 注明。落码 diff 我再审(重点:matchTarget 值源、MAX_WALK 边界判据、gate spy 断言 computeSettlePlan 零调用)。

— NWT 2026-07-12
