# NWT 红队 — PB-S8-1 myVoteRow 查询 try/catch 加固(commit f7b16894)

> **Status**: CURRENT

**审的对象**: `trade-protocol-filter.js` `handlePoolOracleTxSignReq` 的 `myVoteRow` 查询加 try/catch(KANet-UI/J2,commit `f7b16894`),Bettor `#cx7hlc①②` 两点要求落地。
**结论**: **GREEN,无 MUST-FIX。**

---

## 核实过的部分

1. **代码改动**:`.get()` 调用包进 `try { ... } catch (e) { console.error(...); continue; }`——查询本身出错(不是"查不到",是查询失败)与"查不到"同样处理:暂不签、待下次 sign_req 重试、`continue` 只影响当前 oracle 这次迭代。与既有的"找不到投票记录"分支语义一致,没有引入新的失败模式。

2. **J2"框架表达不了 expect-throw"这条声明,独立复核成立**:读了 `test-framework/lib/runner.mjs`——`query_db` action(L238-243)本身对 `.get()`/`.all()` 不做任何包裹;case runner 的 per-step 执行循环(L2139 起)在 L2195 用 `catch (err) { ...; result.pass = false; ... }` 兜底——**任何 step 抛异常,直接判该 case 整体失败,没有"预期抛异常"这个断言类型。** J2 的判断和处理(不硬塞、把证明放在设计稿+独立 spike、如实说框架局限)准确,不是偷懒的借口。

3. **regression 覆盖**(dirty-row-first 场景,Bettor `#cx7hlc②` 要求):自己跑了 `node scripts/test.mjs --case=.../pbs8_signreq_byzantine_check_regression.test.mjs` → **1 PASS / 0 FAIL**。检查了新增的两个断言:
   - 脏行(`observed_at` 排在所有合法行**之前**)存在时,**当前部署的 LIKE 版本**查询不受影响,仍正确返回目标行——锁定今天的真实行为。
   - 同样的脏行场景下,**卡① v2 提议的 json_valid 守卫版本**(尚未落码,直接在测试里现写 SQL 验证)依然正确返回——**在卡①真正落地之前,这条锁就已经在保护它**,卡①落地那一刻不需要再补测试。
   - 自己跑了 lint(2 个改动文件)——**0 errors**。

## 一件不属于代码复核范围、但必须记录的事:部署顺序约束

Bettor 已经指出且我认同并要求延续记录:**`f7b16894`(try/catch)与卡①(json_extract 迁移)分开落码,产生了一个部署顺序依赖——两者必须同窗部署,或 try/catch 严格先于迁移上线;绝不允许迁移先上、try/catch 落后。** 若颠倒,会在生产环境里精确重现 finding①(`290f69ae`)证伪过的那个场景:json_extract 已经在跑但查询本身还没有失败语义包裹。这不是这次 diff 复核该改的代码问题,是部署纪律问题——记录在此,供任何执行部署窗的人对照。

## 总裁定

**GREEN。** 可以进入部署序,但必须遵守上面那条顺序约束(与卡①同窗或先于卡①)。

— NWT
