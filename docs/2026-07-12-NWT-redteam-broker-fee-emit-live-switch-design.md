# NWT 红队 — B线深化件1: broker-fee-emit live 切换设计(fab26a67)

> **Status**: CURRENT
> **对象**: docs/2026-07-12-broker-fee-emit-package-live-switch-design.md(J2)
> **verdict**: **GREEN-with-MUST-FIX——分族方案诚实且技术正确(discover-then-trust 断言必过是设计者主动坦白非隐瞒);H1 缺下游可辨识标记,'matched'状态在两族间语义强度不同却无区分,同规则56 vacuous 家族的轻量变体,必须补一个字段**

---

## 分族判据核实

`fee_rules IS NOT NULL` 作为分族判据结构性成立——`fee_rules` 是 B线落2(2026-07-12)新增列,老市场全 NULL,判据本身无歧义。查了 B线落2 的 `validateFeeRules`/`deriveMarketPredicateCommit`(今晚我审过的代码):对格式错误的 `fee_rules` 是 fail-loud throw,不静默降级——配合本设计 §4 的 try/catch 失败降级(package 异常→fallback 旧路径+warn log),"`fee_rules` 存在但畸形"这个边缘场景**结构上会被现有 fail-loud + 本设计的失败降级两层网接住**,不会漏判成静默错误。DoD 里这条边缘场景没有显式列出测试用例,建议补一句(轻量,非阻塞)。

## H1 🔴 MUST-FIX(诚实标记缺失,非功能 bug): "matched" 状态在两族间语义强度不同,下游无法区分

§2.2 discover-then-trust 分支,设计者自己讲得很清楚坦荡:**"amount 断言在这里数学上必然 pass,因为比对的是同一个数"**——这个坦白是好的(不是我抓出来的,是 J2 自己在设计文本里主动说明,今晚这种诚实口径已经是常态而非例外)。但**设计没有规定:下游(emit 出去的 payload / 写进 `chain_events` 的记录)有没有任何字段能让未来读这条记录的人分辨"这个 matched 来自 fee_rules 独立验证"还是"来自 discover-then-trust 的结构性必过"**。

**为什么这值得钉(非吹毛求疵)**:今晚 Bettor 注3(MUST-FIX)专门给 `matchLandedFeeOutputs` 加 amount 断言,理由正是"地址对金额不对=显式 mismatch,不能静默当 matched"——这条硬门存在的**意义**是让"matched"这个状态承载"经过独立验证"的信任重量。discover-then-trust 分支复用了同一个函数、产出同样的 `state:'matched'` 值,但这次的 matched **不携带**"经过独立验证"这层含义(比对双方是同一个数,不可能不过)。**如果不显式区分,"matched" 这个词在系统里就有两种不同强度的信任语义混在一起、外观不可分辨**——同今晚"报数用级别词,别把机制证通说成端到端验证"同一纪律,只是这次不是人话报数,是数据结构本身该不该携带这个区分。

**具体风险场景**:未来若有人(开发者/审计/甚至 Owner)查 `chain_events` 的 `broker_fee_landed`(或本设计新加的等价事件)记录,想知道"这笔钱的金额是不是真核对过",现有设计下**无法从记录本身回答这个问题**——两族记录形状完全一样。

**修法(轻量,一个字段)**:`emitLandedNotification` 的 payload 或调用方组装的 `chain_events.payload` 里加一个字段,如 `verification: 'independent'`(fee_rules 路径,真断言)vs `verification: 'discovered'`(legacy 路径,discover-then-trust,诚实标注"金额来自发现值非独立重算")。**不改变任何现有行为/不影响 byte-equal 护栏**(byte-equal 测试比对的是 `fee_sompi`/`broker_address`/`output_index`,新增字段是纯附加,新旧路径的这几个既有字段值不受影响,新加字段本身在"新路径"里才存在,旧路径产出的历史记录本就没有可比较对象)。

## 其余核点(过)

- **分族方案本身**:诚实、技术正确、不引入新失败模式——discover-then-trust 分支明确承认自己"不是独立验证"而非包装成"我们验证了",这是好的设计姿态。
- **消费端提前打通(§2.1)**:为件2 多角色实弹测试做了正确的准备工作,不是平行造轮子,复用 `deriveRoleFeeLeaves`(B线落1 已审过的组件)链路正确。
- **§3 byte-equal 护栏**:用真实历史数据(1dv70)做新旧路径对照,是本轮红队反复验证过的靠谱方法论(同今晚多次"独立重算 byte-equal"验证模式)。
- **§4 失败降级**:try/catch 包 package 调用+fallback 旧路径+warn log——不让"结构升级"的代码路径异常波及用户体感的到账通知,优先级判断对(broker DM 通知这类用户体感功能,新代码路径的异常不该是"整个功能挂了"而该是"降级到已知安全的旧路径")。

## 结论

方案本身诚实、正确、风险可控——J2 主动把"discover-then-trust 断言必过"这个张力说透,不是我抓出来的隐藏问题,是设计者自己先坦白的。**H1 是这个坦白之后本该跟着做但没做的下一步**:既然承认了两族"matched"含义不同,就该在数据结构里体现这个区分,不能让两种信任强度在系统记录里长得一模一样。轻量修法(加一个 `verification` 字段),不影响 byte-equal 护栏,折入后落码 GO。

— NWT 2026-07-12
