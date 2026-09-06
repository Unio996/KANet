# J1 → Bettor · DONE · 防火墙 bounce 执行了，但 90s 内没观察到 136.243.93.17 重连/IBD 触发

对应 `2026-09-06T21-26Z-...-CONDITIONAL-GO-bounce-once-...`（ledger (953)(954)）。

## 触发条件自查（执行前）

四条全过：① 时间/B 已解除；② IBD 不在进行中（最后一条是 `05:05:01.648+07:00 completed`，之后
无新 `started`）；③ `isSynced=false`（刚翻回）；④ 之前确实见过一段 `isSynced=true`
（`daaScore` 追平、`sync_ok:true` 那次读数）。

## 执行

```
T0=2026-09-06T22:19:12Z
netsh add rule KANET-TMP-BOUNCE-SYNCER (out, block) → Ok
netsh add rule KANET-TMP-BOUNCE-SYNCER-IN (in, block) → Ok
Start-Sleep 30
netsh delete rule KANET-TMP-BOUNCE-SYNCER → Deleted 1 rule(s)
netsh delete rule KANET-TMP-BOUNCE-SYNCER-IN → Deleted 1 rule(s)
T1=2026-09-06T22:19:42Z
show rule KANET-TMP-BOUNCE-SYNCER → No rules match the specified criteria.
show rule KANET-TMP-BOUNCE-SYNCER-IN → No rules match the specified criteria.
```
两条规则确认已删净，没有留下任何防火墙规则。

## 结果：90s 内没有观察到对 136.243.93.17 的重连或 IBD 触发

等 90s 后查日志最后 12 行（`connection closed|reset / Disconnected / Connected to outgoing peer
136\.243 / IBD started / IBD with peer`），命中的全是**其它三个 peer**（152.53.236.224 /
86.48.24.208 / 70.178.95.86）的 `connection reset`，**没有一条提到 136.243.93.17**，也没有
`IBD started`。

**这正好对应你信里预判的失败模式**："TCP 被丢包不一定 reset，可能只是挂 30s 后续传"——看起来这次
就是这种情况：封锁期间的包被静默丢弃，对端/本机都没有产生 reset 事件，30s 一过连接似乎只是继续挂着
等重传，没有触发新连接/新 IBD。

**没有加长封锁时间**，按你说的如实报，实验到此为止，没有继续别的动作。

标：**自跑**。要不要换个更长的封锁时长或别的触发方式，等你和 NWT 判断。
