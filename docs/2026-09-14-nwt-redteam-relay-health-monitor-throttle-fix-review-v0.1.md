# NWT 红队复核 · relay-health-monitor.js节流MUST-FIX(`6befd67a`) + 联动文档(`a9ed03f0`)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1171：①连续3次被拒后本小时不再调startRelay(调用计数)；②成功候选不被误判进节流；③每小时摘要
> 不会把fail-closed kill类告警一起静默掉；④v0.6/v0.3前提措辞与我的v0.3一致。

## 结论：**GREEN，8笔热钱包线全部核完，只差Codex解除HOLD即可合入。**

## 一、①②被拒候选节流生效 + 成功候选不误判——独立运行7个新用例+28个既有用例全部复现

**独立环境**：detached worktree，`npm install --prefer-offline`独立装（不junction活体node_modules，
Rule 81纪律），跑通后按check-worktree-junctions确认无跨树链接、`git worktree remove`正常完成。

**读diff确认核心修复**：`_recordRestart()`调用点从"只在`result?.ok`为真时"挪到"只要真的调用了
`doStartRelay()`，无论成功/fail-closed拒绝/抛异常都记账"——这正是MUST-FIX要的"节流按尝试次数不是
成功次数"。

**独立运行`relay-health-monitor.test.mjs`新增7个用例**：7/7 PASS，逐条核对断言内容：
- ①"连续3次后本小时不再调用startRelay"用**调用计数**断言（`startRelayCalls.length`），不是只看
  `restart_stormed`标志——第4次tick确认`startRelayCalls.length`保持3不再增加，独立确认。
- attempt编号从"永远#1"改成跟着真实调用次数递增——独立确认修复前会失败的这条断言现在通过。
- ②成功路径+多候选互不干扰两个用例都独立跑通，且commit message如实记录了他们自己写测试时撞到的
  fixture设计坑（`checkAlive`恒判死会让"成功重启的r2"也被误判进节流，改用状态位模拟"成功后真的
  活着"）——**这条自曝的坑本身是好的工程纪律信号**，我读了修复后的fixture代码确认状态位逻辑正确
  （`r2Alive.value`只有在`doStartRelay`对r2返回`{ok:true}`之后才置true，`checkAlive`据此判断r2已经
  活着不再进入重启分支），不是简单信commit message的自述。

**独立运行既有两份回归套件**：`hotwallet-admission.test.mjs`+`relay-hotwallet-monitor.test.mjs`共
28/28 PASS，跟claim的"既有28/28绿"一致，独立复现不是读日志信。

**总计35个用例独立跑通**（7新+28回归），跟commit的"7个新用例+回归28/28"完全对应。

## 二、③每小时摘要不会误杀fail-closed kill类告警——结构性隔离，读代码确认

`_logStormSkipIfDue()`**只包裹了`relay-health-monitor.js`自己那一行"死了但节流跳过"的`console.warn`
调用**，没有对`console.warn`做任何全局monkey-patch，没有触碰任何其它文件的日志路径。具体检查了两类
可能被误伤的告警：

1. **`checkHotwalletAdmission()`自己的每次拒绝warn**（`relay-manager.js`内，"cold_address_denied"等）：
   这条warn只会在`doStartRelay()`（=`startRelay()`）真的被调用时才触发——而节流命中时代码路径是
   `continue`直接跳过，根本不调用`doStartRelay()`，所以这条warn本来就不会在节流期间产生，跟"被静默掉"
   不是同一件事（是"没发生"不是"发生了被吞掉"），且这是期望行为（节流本身就该让底层准入检查停止被
   反复调用，不是让它继续调用只是不打日志）。
2. **`relay-hotwallet-monitor.js`的kill告警**（驻留期监控，完全独立的文件/机制，监控的是"已经在跑"
   的relay余额漂移，不是"启动失败重试"）：两个文件的日志路径、状态Map、触发条件完全独立，读代码确认
   没有任何共享的节流/摘要状态或调用关系，`relay-health-monitor.js`的这次改动物理上碰不到那个文件的
   任何一行。

**结论：不会误杀，两类担忧的告警都不受这次改动的节流逻辑影响，是结构性隔离（不同文件/不同触发条件），
不是靠约定"记得别包裹它"这种脆弱保证。**

## 三、④v0.6/v0.3前提措辞核对——与我的v0.3一致

读了`a9ed03f0`完整diff：迁移runbook v0.6在§6.2第4批下追加的阻断前提（"第八笔`6befd67a`必须已落地
并过NWT审才能执行第4批"）+ 执行页v0.3的§0新增commit清单第八笔+"第4批专属前提"条目——跟我1167回复
里指出的gap（"当时12c5201d没有把第八笔列为第4批阻断前提"）**逐字对应**，两份文档现在互相引用同一条
前提（不是各写各的表述），跟我v0.3报告的判断没有冲突。

## 四、给Bettor的处置建议

- **`6befd67a`（第八笔）GREEN，可以定案**——热钱包线8笔全部NWT核完，剩下只差Codex解除01a0f136那笔
  监控HOLD即可合入主线。
- `a9ed03f0`联动文档GREEN，措辞与NWT 2-1 v0.3一致。
- 无新发现的安全问题。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
