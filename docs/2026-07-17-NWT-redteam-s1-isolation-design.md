# NWT 红队 — S1 实现设计稿(模拟流量隔离机制)(2026-07-17)

> **Status**: CURRENT
> **对象**: `docs/2026-07-17-s1-support-cases-simulated-traffic-isolation-design.md`(687333ae, KANet-UI)
> **verdict**: **🟠 GREEN-with-MUST-FIX(2 项), 重点验 Bettor 两承重点(fail-closed 分叉 / 权限最小化)**

## 真对抗: Bettor 两承重点逐条打

### 承重点①(fail-closed 校验行为分叉)——发现真实薄弱环节: 字符串比较非常量时间

`checkTestHarnessToken` 用 `provided !== secret` 做比较。**这跟本项目自己刚修过的同一类洞是同一个模式**: `54dd60d2`(NWT FINDING-1)把 faucet 的 `isTrustedProxy` 从普通比较改成 `timingSafeEqual`, 理由正是"堵公网绕 per-IP 洞"——字符串直接比较存在时序侧信道, 攻击者可以通过响应时间差异逐字节猜出正确值。

这里的风险不是空对空: **`TEST_HARNESS_TOKEN` 唯一效果虽然"不触及资金/权限", 但它能让一条真实的钱类升级工单的 `is_simulated` 被标记为 `true`, 从而在 `owner-bot.mjs` 的转发环节被 `continue` 跳过(§3, 选 (a) 完全不转发)**——这意味着**猜中这把 token = 能让真实资金投诉被静默吞掉, 不再出现在 Owner 可见的协调频道**, 这是"抑制升级"类攻击, 跟 `#7`(伪造内容混进升级)是**同一条链路上方向相反的姊妹攻击**, 不是"反正它权限最小所以不用管时序"能带过的。测试环境这把 token 是真实存在、真实被这套系统的 HTTP 端点接受校验的秘密, 不是纯假设性风险。

**MUST-FIX**: `checkTestHarnessToken` 的比较逻辑改用 `crypto.timingSafeEqual`(定长比较, 长度不等时先短路避免抛异常), 跟 `54dd60d2` 同款写法, 不是新发明一套。

### 承重点②(权限最小化边界)——逻辑本身干净, 无越权
读了完整函数体+§1 说明, `checkTestHarnessToken` 的唯一输出效果就是 `isSimulated` 布尔值, 不触碰 `verifiedBettorPk`/`classifyEscalation`/`anchored` 判定路径(§1 明确写"不做任何其他事"), 复核 `feedback.js` 现有 H2 身份重校验/`classifyEscalation` 调用顺序(我 7/12 卡B 审时读过的那条链)不受这个新分支影响。**这条承重点本身没打穿, 设计克制, 符合最小权限。**

## 自主新发现(Bettor 承重点之外)

**发现①(MUST-FIX, 关键regression本身有假阳性风险)**: §4 case 4(`support_no_broadcast_leak_negative.test.mjs`)断言"频道在此工单 `created_at` 之后没有新增包含该 `ticket_id` 前 8 位的消息"。这是**整个隔离机制里"证明没有泄漏"这一件事唯一的自证 regression**, 但设计稿没提**给 `owner-bot.mjs` 轮询器足够的时间窗口**去"本该转发却没转发"——如果测试断言执行得比 `pollFeedbackEscalations` 的下一次 tick 还早, 断言"没有消息"会**无论隔离逻辑对不对都通过**(因为压根没到轮询点, 不是因为过滤生效了)。这是经典的"证明不存在需要先证明有机会存在"的测试陷阱——**这条 regression 本身如果测错了, 会给一个从没生效过的隔离机制发绿灯**, 风险等级不低于它要防的那个洞。**MUST-FIX**: case 4 必须显式等待至少一个完整 `pollFeedbackEscalations` tick 周期(或触发一次手动 poll)后再断言, 且**同时用一条"正常(非 is_simulated)工单确实被转发"的正对照**跑一遍确认轮询机制本身在测试窗口内真的会动(排除"轮询器根本没在跑"这种更荒谬但同样会让本测试假阳性通过的情况)。

## 非阻塞建议

**建议①**: §4 case 5 描述的场景("环境变量为空时...header 缺失时...")没有显式提到**"环境变量已正确配置, 但 header 携带了错误的 token 值"**这个独立分支(`!secret` 短路 vs `provided !== secret` 真正不匹配, 是同一个 OR 表达式里两条不同的代码路径)。落码时建议顺手把这条也补成显式 case, 不要只测"没配置"这一种 403 成因, 否则将来若这段比较逻辑被不小心改坏(比如接了错的比较对象), 现有 case 5 描述的两个断言都可能测不出来。

## 未打穿的部分

- §2 数据落地(`action_details.is_simulated` + `events.payload_json` 镜像)设计干净, 不新建表(v187 spc_tip_heartbeat 那种才是真正的新表场景, 这里判断收窄准确), `DATABASE.md` 同步更新符合 CLAUDE.md 硬规矩。
- §3 转发隔离选 (a)(完全不转发)的理由(减攻击面优先于"给 adversarial 内容一个专门展示舞台", 隔离频道本身还要再维护一套信任边界)站得住, 跟我原始框架审建议的方向一致, 且明确把"#7 那条真实探针"路径排除在本设计影响范围外, 分工说明清楚不会互相踩。
- §4 素材来源口径**主动订正**了我此前指出的"4/7 而非 7/7"问题, 没有沿用旧措辞蒙混, #5/#7 各自归属也点清楚不在本卡重复造——这个诚实訂正本身是好样本。
- §6"不做什么"边界收得干净, 没有借机夹带无关改动。

## Verdict

**GREEN-with-MUST-FIX(2 项: token 比较改常量时间 / case 4 补时间窗口+正对照, 防自证 regression 假阳性)**。两承重点里承重点②本身没洞, 承重点①的洞不在"权限设计"而在"比较实现方式"这个更底层的地方, 但同样重要——一旦落地就是活的攻击面, 不是理论风险。修完回来我复核, GREEN 后落码。

— NWT 2026-07-17
