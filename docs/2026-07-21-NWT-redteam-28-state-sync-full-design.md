# NWT 红队审 — #28 状态收敛全案(commit 649950ff)

> **Status**: CURRENT(2026-07-21 · NWT 独立红队,非自审)
> **审对象**: `docs/2026-07-21-28-state-sync-architecture-full-design.md`(commit `649950ff`,Bettor 主编)+ 继承的 `docs/2026-07-20-28-state-sync-convergence-design.md`(commit `05ff33ab`,J1 域分卡)
> **审查方式**: 逐条 file:line 现场核对(读活代码,非采信文档转述)+ git 史核(merge-base/reflog)+ 一次 P0 中途 live 抢修事故实证。
> **结论**: **GREEN-with-2-MUST-FIX**(②③)+ 1 项审查中触发并已当场闭环的事故(①,存档非阻塞)+ 1 项建议追加的回归场景。文档整体质量高(§2 五个漂移点绝大多数 file:line 精确到字节级)。

---

## 0. 审查中触发并已闭环的紧急事故(存档,非当前阻塞项)

审查过程中(20:1x-20:2x)核实漂移点①(`consolidated_pool` 持久化)时**当场发现**:commit `babdaed3` + `b5280c43`(两个 85fit money-path 修复)在 Bettor 为推 `649950ff` 做 `git reset --hard origin/bshard-m3-deploy` 时被静默丢弃——这两个 commit 从未 push 过 origin,reset 时连带清空,未被后续的 `974a24d5`(cherry-pick 找回的 tg-bot 那个)覆盖到。

**发现时的核实方法(非猜测,可复现)**: `git merge-base --is-ancestor babdaed3 HEAD` → 退出码1(NO);同 `b5280c43` → NO。直接读活文件坐实(发现当时的 HEAD=`8ac22287`):evidence 字面量无 `consolidated_pool` 字段、`settleMarketLive` 返回值无 `consolidatedPool`、两条 `pool_bettor_sides` SELECT 均无 `ORDER BY`——均为修复前原状态,比文档 §2.2 漂移点①"babdaed3 已加字段只是没改 merge 语义"的描述更差(当时是零修复)。

**闭环(本文档定稿前已完成,以下为最终核实状态)**: Bettor 自查坐实根因 + KANet-UI/J2 独立复核 + Bettor 从 reflog cherry-pick 找回,现 HEAD(`7abd5025`)已确认包含两处修复——`bshard-settle-daemon.mjs:756` `consolidated_pool: r.consolidatedPool ?? null,` 在场、`:768` `meta.settle_evidence = evidence;`(与文档原始引用行号 754-768 现在完全吻合)、`bshard-auto-settler.mjs:577` 返回值含 `consolidatedPool`、`pool-bettor-sides-query.mjs` 两条 SELECT 均带 `ORDER BY id ASC`。**本条不阻塞 P0,记录仅存档 + 提炼下方制度化教训。**

---

## 已闭环①(原 MUST-FIX,现已解决)— "已部分修复"表述曾短暂失真,教训需制度化

**问题**: 上述事故证明——**依赖"commit 消息/文档转述"判断某修复是否已落地,本身就是 verify-value-source 违反**(文档对代码状态的转述 = 一层可被污染的缓存,真相源是活文件 + git ancestry)。这次幸好被红队审查中的例行核实撞见,当场触发闭环,下次不一定有人凑巧在核实这一段。**代码现已恢复(见 §0),不再是 P0 阻塞项**,但制度化教训必须落地:

1. 类似"某修复是否已落地"的判断,**引用方(下一个接位 agent / 后续设计稿)不能只信 commit 消息或前一份文档的转述**,必须在使用那个判断的当下重新 `grep`/`git merge-base` 核实一遍——这次事故正是发生在文档撰写之后、落码之前的几小时窗口期。
2. **制度化建议**(不阻塞 P0,但应尽快排):push 前对将要影响的分支做 `git diff <push前预期HEAD>..HEAD --stat`,不能只凭"push 成功"当验证——Bettor 已在频道自述采纳此纪律,建议同时给 `bshard-settle-daemon.mjs`/`bshard-auto-settler.mjs`/`pool-bettor-sides-query.mjs` 这三个 money-path 核心文件加一条轻量 CI/lint 断言(比如 grep 特定字符串存在性的 smoke test),防同类"确认修复过的行为在活分支上消失"再次静默发生且没人发现。

---

## MUST-FIX ② — 漂移点③引用文件名错误(FILE 级,非仅行号)

**问题**: 表 2.2 行 3(`fresh-close 用 formula pool`)写"`bshard-auto-settler.mjs:200-226`(`consolidateAndBuildPsState`)"。**实测该函数根本不在这个文件里**:

```
grep -n "consolidateAndBuildPsState" 全仓库 →
  bshard-settle-daemon.mjs:163  async function consolidateAndBuildPsState(marketId, ps, ctx) {
  bshard-settle-daemon.mjs:997  export { ..., consolidateAndBuildPsState, ... }
```

函数**实际定义在 `bshard-settle-daemon.mjs:163-231`**,不在 `bshard-auto-settler.mjs`。有意思的是行号内容本身完全精确(`predictedPool` 公式在 line 205、live probe 在 210-224、`consolidatedPool = consolidatedPoolReal` 在 225,逐字符核对无误)——**误的只是文件名,大概率是撰写时笔误**(两个文件名相近、都跟 settle 相关)。

**为什么不能当无害笔误放过**: J1 明天要按这条 file:line 出 P0 实现方案(派工 §7 第2条),真去 `bshard-auto-settler.mjs` 找 `consolidateAndBuildPsState` 会扑空,浪费排查时间,且违反接位 SOP"设计前查资产"——这正是本文档自己在防的那类坑,不能自己先示范一个。

**修法**: 文档 §2.2 行3 file:line 列改为 `bshard-settle-daemon.mjs:163-231`(`consolidateAndBuildPsState`,内部 line 205/210-224/225 具体位置不变)。**一行文字修正,不阻塞 P0 技术方案本身**,但落码前必须订正,防以讹传讹。

---

## MUST-FIX ③ — 目标架构 GATE(§3)的 re-derive 值来源本身可被污染,需要在 P0 样板里明确堵住

这是本次审查被 Bettor 点名的核心项(派工①第②点:"校验闸读的'真值'来源是不是真的链上权威,不是又一层可被污染的缓存")。**结论:当前 `consolidateAndBuildPsState` 里已经实现的"real-pool live probe"分支(§2.2 漂移点③,line 214-224),其查询目标地址本身来自一个可漂移的 DB 字段,不是纯链上锚定。**

**具体链条**(`bshard-settle-daemon.mjs:214-224`):
```js
const realAddr = _p2shCache(ps.payout_redeem_hex);          // ← 地址从 DB 字段 payout_redeem_hex 反推
const liveEntries = await getUtxos(realAddr);                 // 查链(这一步本身是真链上数据,没问题)
const match = liveEntries.find(e => outpoint === psOutpointTxid && index === psIdx);  // psOutpointTxid/psIdx 也来自 DB(ps.payout_ps_outpoint)
```

`ps.payout_redeem_hex` / `ps.payout_ps_outpoint` 是 `payout_shards` 表的两列,**只在两个"机会性刷新"点被更新**(即表 2.2 漂移点⑤引用的 `bshard-close-transport.mjs:308` + `bshard-close-voter.js:667`,均已实测确认无强制对账触发器)。也就是说:**"re-derive-from-chain"这一步,查询目标(地址+期望 outpoint)仍然依赖一份可能滞后的 DB 缓存,只是最终读到的 UTXO 数据本身是链上实数**——链上数据是真的,但"该去哪查"这个决策权还在 DB 手里。

**具体风险场景**: 若consolidate/absorb 之后 `payout_redeem_hex` 因为某条不经过上述两个刷新点的路径未被更新(比如漂移点⑤已指出的"无强制对账触发器"),`realAddr` 会算出一个**过期地址**——过期地址上大概率查不到匹配的 `psOutpointTxid:psIdx`(因为资金已经在新地址),`match` 为 `undefined` → 静默走回 `predictedPool` fail-open 分支(漂移点③本体)。**这不是新洞,是漂移点③④⑤三者的耦合放大**:③的 fail-open 出口,靠⑤的"机会性刷新是否覆盖到位"决定触发概率——三者本是同一条因果链,文档把它们分成三行独立漂移点,容易让读者以为各自独立、各自小修就够,但目标架构 GATE 设计如果不把这条耦合链一起解掉,P0 只补了 consolidated_pool 一个字段的持久化,**GATE 的查询目标本身仍然不是"唯一权威真相源"**——跟 §1 收敛原则字面矛盾。

**MUST-FIX 内容**(P0 样板落码时必须处理,不能留到 P2):
- P0 的 re-derive 实现**不能继续以 `ps.payout_redeem_hex` 反推查询地址**。正确模式已经在代码库里有先例——`_inferWinDirectionFromChain`(`bshard-auto-settler.mjs:225-277`)是从 `psRow.pool_merkle_root` + `psRow.predicate_commit`(这两列是 genesis 时钉死、covenant 生命周期内不变的**真正不可变值**)+ **候选** `consolidatedPool` 现场 `compilePayoutShardRedeem` 编译出候选地址,再拿候选地址去核对链上实际落地地址——地址是**现算**的,不是读一份可能过期的完整 redeem hex。P0 的 re-derive 应该抄这个模式:从不可变的 `pool_merkle_root`/`predicate_commit` + 待验证的候选 `consolidatedPool` 现场编译,而不是信任 `payout_redeem_hex` 这个可漂移列。
- 若因改造量太大 P0 阶段做不到"完全不读 `payout_redeem_hex`",**最低限度**:probe 前先独立验证 `payout_redeem_hex` 自身的新鲜度(比如反推它编译出的地址是否等于当前 `payout_ps_outpoint` 指向的、且该 outpoint 在链上仍未花费),不新鲜就直接判定"缓存不可信",跳过依赖它的 probe,直接进入下一级更权威的重建路径(而不是静默 fail-open 到 formula)。

---

## MUST-FIX 附带项 — P0 回归测试场景(§6 DoD 1)有一个真实时间窗口缺口

Bettor 派工①第③点问"P0 两个回归测试场景够不够"。**两个场景本身(孤儿盘 e2e / close 后-claim 中途重启穿越)是对的、且直接对应 85fit 当晚实际炸的两个坑,必须留**,但有一个时间窗口没被两个场景覆盖:

**缺口**: 两个场景都假设重启发生在 **close 之后**(claim 中途)。但 MUST-FIX③指出的"payout_redeem_hex 机会性刷新"风险窗口在**consolidate 之后、close 之前**——如果 daemon 在 `consolidateAndBuildPsState` 内的 consolidate 分支(line 169-199,`needConsolidate=true`)执行到一半(比如 `payout_ps_outpoint` 已 UPDATE 但下一次 tick 因为某种原因走了 `else` 分支去读“已 consolidate”的 `ps.payout_redeem_hex`)时进程重启,当前两个 DoD 场景都不会触发这条路径。

**建议补第三个回归场景**(不阻塞 P0 落码,但应该同批一起补,不要等出下一个 85fit 才想起来):**daemon 重启穿越 consolidate 中途(consolidate 已花费旧 shard UTXO、`payout_shards` 表尚未/刚部分 UPDATE 完成)**,验证 resume 后 `consolidateAndBuildPsState` 走 `needConsolidate` 判断分支正确、不会读到半更新的 `payout_redeem_hex`。

---

## 非阻塞项(核实无误,顺手记录)

- **§2.2 漂移点②④⑤⑥的其余 file:line 全部核实精确**(`migrate.js:4060`/`5108-5118` 字节级吻合、`pool-shard-register.mjs:114-123`、`bshard-close-transport.mjs:308`、`bshard-close-voter.js:667` 均逐行核对无误)。文档整体的代码实证质量在同类设计稿里是高水准的,这次唯一的文件名错误(MUST-FIX②)不影响对整体可信度的评价。
- **§2.3"已收敛的正面案例"核实属实**:`bshard-auto-settler.mjs:363-368` enforce 门(`realExpectedClosedAddr` 现算,不用 `plan.expectedClosedAddr`)+ `deriveResumePlanFromEvidence`(190-209)独立重算 `payoutRoot` 后 fail-closed 比对,均现场验证成立,是target GATE 该学的正确范式(也是 MUST-FIX③建议 P0 抄的模式来源)。
- **`verifyClaimLanded` 只查落地不查金额**(§2.3 残余风险,现场核实 `bshard-auto-settler.mjs:619` 确实只 `if (r?.landed) return true`,无金额比对)——文档已把这条纳入 §6 DoD 第5项,不是遗漏,不额外扣分。
- DATABASE.md:632 订正已由 KANet-UI 落码(`b070cf5f`),漂移点⑥闭卡。

---

## 审批结论

- **文档结构/收敛原则/目标架构方向(§0/§1/§3 三层划分)= GREEN**,方向正确,继承 J1 §1-§3 的判断成立。
- **P0(consolidated_pool re-derive)落码前必须先解决 MUST-FIX②③**:②是纯文档订正(1 分钟改完);③是**实质技术要求**——re-derive 的地址来源必须从可漂移 DB 列改成从不可变字段现场编译,否则 P0 上线后 GATE 名义上"链上优先"、实际查询路径仍可被 DB 缓存污染,**收敛原则(§1)字面上没做到**。审查中触发的①已闭环(代码已恢复),不再阻塞。
- **P1(evidence preserve-merge)不受本轮 MUST-FIX 阻塞**,J2 可继续按原计划走 diff 审。
- **建议追加第三个 P0 回归场景**(consolidate 中途重启),非阻塞但强烈建议同批补齐,不要等下一个孤儿盘事故才补。

**待 J1 P0 实现方案里把 MUST-FIX②③ 的修法折入,NWT 复核该实现方案(而非仅本文档)后再放行落码。**

---

**关联**: `docs/2026-07-21-28-state-sync-architecture-full-design.md`(649950ff)、`docs/2026-07-20-28-state-sync-convergence-design.md`(05ff33ab)、频道 dev-coord-testnet 2026-07-21 20:17-20:19 紧急事故记录(babdaed3/b5280c43 找回)、memory `feedback-verify-value-source-checker-must-access-binding-at-decision-time`、`feedback-ss-attack-review-verify-value-source`。
