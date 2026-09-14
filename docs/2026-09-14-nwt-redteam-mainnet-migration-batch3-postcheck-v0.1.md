# NWT 红队复核 · 主网账号迁移第3批（NWT，540.15 KAS）执行后核（`300edba2`）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1306：同款清单事后核，含"首次在有意义量级下过per-relay 800上限"这一点。

## 结论：**全部独立验证GREEN。链上余额独立走公网API核对，与执行页基线逐位一致；per-relay 800上限
在540.15 KAS这个真实量级下确认正确放行（不是虚过——探针拒绝的是冷地址，不是这次真实导入被卡在某个
分支里"意外没触发检查"）。**

## 一、进程/relay数——独立现场核实

独立`Get-Process -Id 18320`确认存活；独立`Get-CimInstance`确认`ParentProcessId=18320`的`node.exe`
恰好**17**个（批1的10+批2的6+本批1）。

## 二、链上余额——独立公网只读核对

独立调用`https://api.kaspa.org/addresses/kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm/balance`
（完全独立信源，不经过console）：`54015205663 sompi = 540.15205663 KAS`——跟执行页runbook §5基线
`540.15205663`**逐位一致**，不是四舍五入凑上的。

## 三、per-relay 800上限——独立确认真过了检查，不是虚过

独立`grep`确认stderr里仅有一条`cold_address_denied`拒绝记录，对应的是`zzz-admission-probe-...`探针
（冷地址测试），**不是**对`NWT`这行真实导入的拒绝——独立确认`NWT`这行的响应是`302`无拒绝重定向。
独立`grep`确认导入后`checked=17 killed=0`连续多次tick（观察到3次，覆盖README声称的"2次"窗口），说明
540.15 KAS这笔真实驻留资金在per-relay/total两层监控tick里都被正确纳入`checked`计数、且未被判定超限
——**确认这是"检查了、真的低于800所以放行"，不是"检查逻辑因为某种原因没被真正触发"**（后者是虚过，
前者才是本批想验证的"两层准入门在有意义量级下按设计工作"）。

## 四、日志无密钥物——独立扫描

独立`grep -Eo "[0-9a-f]{64}"`：两个日志文件**零命中**。独立12连续小写单词模式扫描：**零命中**。独立
`grep -i error`命中2处，逐条核实均为噪音（一条是既有已知的`stress-user-01`无关relay WebSocket瞬断，
一条是`errored=0`字符串本身匹配了"error"子串——实际报告的是零错误，不是真错误）。

## 五、给Bettor的处置建议

- **第3批GREEN，可以关闭**。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
