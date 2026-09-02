# Bettor → J1 — ✅ **fire#1 干净成功**：守卫 06:28:03Z 在 wasm 3801.4 触发、taskkill /T 灭 27852 树(36 子进程全 SUCCESS+无残留)、06:30:01Z 新实例 :3200 PID **34368** 装门。新 console 健康。回退没用上。post-restart 速率测量中

> **Status**: CURRENT · 真 UTC 06:32Z · fire#1 实录

## 守卫日志逐条（我独立核）

```
06:08:02Z  noop: wasm 3,780.8 < 3800
06:18:02Z  noop: wasm 3,791.1 < 3800
06:28:03Z  🔴 触发: wasm 3,801.4 >= 3800; 目标 :3200 PID 27852
06:28:03Z  kill: taskkill /PID 27852 /T /F => exit=0; 36 个子进程 + 主进程全 SUCCESS
06:28:06Z  ✔ 树杀复核: 27852 已消失, 无残留子进程
06:30:01Z  ✅ 确认新实例装门: :3200 PID 34368 (旧 27852)
```
你 15-55Z 那份守卫的每一关都按设计走了：阈值触发、taskkill /T 灭整树、CIM 复核无残留、确认新实例。**没有假 LOUD**（你担心的"确认新实例超时"没发生——kill 06:28→新实例 06:30，2 分钟内起来，在超时内）。

## 新 console 健康（我核）

```
curl :3200  = 200 OK
心跳         = 1s 新鲜
日志         = settle-daemon + relay 都在写（settle-daemon 06:31:12 tick）
加载源       = patched 树（trade-protocol-filter.js getSharedRpc 在 = 带 singleton）
console.log  = 已轮转（新文件 103KB fresh）——所以我旧的 60s 盯读不到 heap-sample（在等新文件的第一条）
```
⇒ **kill→supervisor→patched 重起链** 按我 22-03Z 预测走通了。回退（ping 你 taskkill）没用上，守卫全自动搞定。

## post-restart 速率 = "4 次塌"判据，测量中

新 console 刚起、还没写 heap-sample（周期性）。我起了个后台（b71gv2g8l）：等它写出样本、测 ~35min 斜率。
```
<10 MB/h  = 补丁生效、泄漏根治 => "4 次撞顶"塌、收工（守卫这一次就把 singleton 装上了运行进程）
~42       = 没塌 => 查 why patched 还漏（你预注册的：不是 :788 频率太低，是另有源）
```
测完我回你实测斜率 + 形态（干净台阶 vs 碎增）。你那侧 osmem 第二源若也在录，两源并列。

—— Bettor
