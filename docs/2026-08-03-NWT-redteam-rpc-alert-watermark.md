# NWT 红队 — RPC 劣化告警水位线持久化(commit 7a2bb5e7)

> **Status**: CURRENT

**审的对象**: `kasia-console/src/lib/rpc-health-degradation-alert.mjs`(KANet-UI,commit `7a2bb5e7`),(126) 待认领项落地。非钱路,但照 r402/PB-S8-1 同款流程走 diff 复核。
**结论**: **GREEN,无阻塞 MUST-FIX**,但找到一个真实、目前不可达的潜伏缺陷,建议顺手修(一行改动)。

---

## 核实过的部分:三态覆盖如实,自己验证不采信自查

逐字读 `rpcHealthAlertTick()` 新逻辑,三个场景独立推演:

1. **同进程连续 tick、数据不变**:`_lastSeenMaxFailRowid` 内存里已有值,`maxFailRowid <= _lastSeenMaxFailRowid` 恒真 → 挡。与原 `_alerting` 布尔语义一致。
2. **进程重启、数据不变(实况 01:26/01:28)**:新进程 `_lastSeenMaxFailRowid=null` 且 `_dbWatermarkChecked=false` → 触发一次 DB 读(`_lastAlertedMaxFailRowid()`,按 `rowid DESC LIMIT 1` 取最近一次 `rpc_health_degraded_onset` 的 `payload_json.maxFailRowid`)→ 拿回崩溃前的水位线 → 本次 `maxFailRowid` 与之相等 → 挡。**推演与 KANet-UI 的描述一致。**
3. **进程重启后仍在恶化**:DB 读回旧水位线后,本次 `maxFailRowid` 更大 → 不挡,正常报警并推进水位线。**推演一致。**

**自己跑了两遍(不信自查报告)**:
- `node src/lib/rpc-health-degradation-alert.test.mjs` 直接跑测试文件本体 —— **全部 ✅,包括新增的两条 restart-dedup 用例**。
- `node scripts/lint-kanet.mjs`(两个改动文件)—— **0 errors**,与自查一致。

---

## 🟡 一个真实但目前不可达的潜伏缺陷:`stop()` 没有对称重置 `_dbWatermarkChecked`

`stopRpcHealthDegradationAlertCron()`:
```js
export function stopRpcHealthDegradationAlertCron() {
  if (timer) { clearInterval(timer); timer = null; }
  _lastSeenMaxFailRowid = null;   // 只清了这一个
}
```
对比测试专用的 `_resetAlertStateForTest()`,它同时清 `_lastSeenMaxFailRowid` **和** `_dbWatermarkChecked`,注释原文解释了为什么两个都要清:"清 `_dbWatermarkChecked` 是关键——它模拟'进程重启'"。

**推演一个 `stop()` 没做到这件事的后果**:若未来有代码在**同一个进程内**先调 `stop()` 再调 `start()`(比如加一个"维护窗口暂停监控"的功能,这类需求很自然会长出来),`_lastSeenMaxFailRowid` 被清成 `null`,但 `_dbWatermarkChecked` 仍然是 `true`(留着上次运行时的值)。下一次 tick 若 `count >= FAIL_THRESHOLD`:
```js
if (_lastSeenMaxFailRowid === null && !_dbWatermarkChecked) {  // null && !true → false
  _lastSeenMaxFailRowid = _lastAlertedMaxFailRowid();          // 这一步被跳过
}
```
DB 读取被跳过(因为 `_dbWatermarkChecked` 卡在 `true`),`_lastSeenMaxFailRowid` 保持 `null` → 后续比较 `_lastSeenMaxFailRowid != null` 恒假 → **不挡,直接报警**——对一批可能早就报过的旧数据重新报一次。**这正是这次 commit 要修的那个 bug 的缩小版,只是触发条件从"进程崩溃重启"换成了"同进程内 stop+start"。**

**核实这条路径当前是不是活的**:`grep -rn stopRpcHealthDegradationAlertCron kasia-console/src` **只命中函数自己的定义**——`index.js` 只调用了 `start`,全仓没有任何地方调用 `stop`;新增的两条 regression case 用的是 `_resetAlertStateForTest()` 不是 `stop()`,不会碰到这条路径。⇒ **当前 runtime 里这是死代码,不可达,不构成活风险。**

**判定**:不阻塞这次落码/部署(触发条件当前不存在)。但建议**顺手补一行**——`stop()` 也清 `_dbWatermarkChecked = false`,和 `_resetAlertStateForTest()` 保持同一语义,防止将来有人接了个"暂停/恢复监控"的功能时,在不知情的情况下把这次修复的问题复活一个缩小版。一行改动,不需要新写测试(现有测试若要覆盖这条,可以加一条"调用 stop() 后模拟同进程重启"的用例,但这不是本轮阻塞项)。

---

## 总裁定

**GREEN,可以进入 Bettor (127) 排的部署窗**,与 PB-S8-1 一起。上面那条 `stop()` 不对称重置的问题,不要求本轮修——记一笔,建议下次碰这个文件时顺手带上。

— NWT
