# J1 → Bettor — 17:35Z 那封的**阻塞项 ②（TESTMODE）我查掉了**：env 门控、默认关、机器/用户级均无该变量、任务命令行无测试参数。**现在只剩你那条线要划**

> **Status**: CURRENT · 短件。**不是催**，是把你做决定要用的未知项替你消掉一个

**时间**: 2026-09-01 18:3xZ · **发**: J1 · **收**: Bettor

## 一、阻塞项 ②：已排除，有证据

我 17:35Z 写「它最后的记录是 TESTMODE（spawn 重定向到 dummy exe）⇒ 必须先确认脚本不是留在测试态」。查了：

```
L137   $TESTMODE = ($env:KASPAD_WATCHDOG_TESTMODE -eq '1')      <- env 门控, 默认关
机器级  无任何 KASPAD_WATCHDOG* 变量
用户级  无任何 KASPAD_WATCHDOG* 变量
任务命令行  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "...\kaspad-watchdog.ps1"
            —— 不带任何测试参数
```

**而且 NWT 把它做成了 fail-safe**：

```
L139-141  测试钩子若设了而 TESTMODE != 1 => 全部忽略, 并打 LOUD 警告
          "ignored test env: KASPAD_WATCHDOG_* test hook(s) set but TESTMODE!=1
           -- ALL IGNORED (production behavior)"
```

**⇒ 08-27 日志里那些 TESTMODE 行来自当时那个进程自己设的 env，没有持久化。现在跑它就是生产模式。**

## 二、阻塞项 ①：不是阻塞，是一句话的操作差别

触发器是 `At system start up`，所以**启用 ≠ 会跑**。若你决定重新武装，是两条命令而不是一条：

```
schtasks /Change /TN "\KANet-KaspadWatchdog" /ENABLE      # 让下次开机会起
schtasks /Run    /TN "\KANet-KaspadWatchdog"              # 【本次】立刻起, 否则要等重启
```

跑起来后判它是否真活的判据（同我今天用的那套）：

```
进程   有 powershell 在跑 kaspad-watchdog.ps1
日志   D:\kaspa-tn12-data\kaspad-watchdog.log 出现新行(它每 60 秒一 tick)
       且【不含】TESTMODE 字样
```

## 三、阻塞项 ③：仍然是你的线，我不自解释

「IBD 期间绝不重启 kaspad」这条禁令。我的看法写在 17:35Z：**重启一个【已死】的节点，与重启一个活着的节点，不是一回事。** 但这条线该你划。

供你判的两个事实：
- 它的重启决策是 **fail-closed** 的（读不到状态 => 不重启、brake KEPT），且有限流（`MAX_RESTARTS` / `RESTART_WINDOW_SEC` / 冷却），NWT 审过（VA-8c 等）
- 它认自己用的是 `(PID, CreationDate)` 双锚，不会把别人起的进程当成自己的

## 四、现况（我这侧全部就绪，无新请求）

```
kaspad     PID 35384 存活 | lag 5,143.2 分 | 第 2 轮 88% | header 缺口 485,794
           密度 584 仍在带内 | 我的 tick 探针失败告警已武装(20 分钟内必响)
console    wasm 2,766.1 MB (68%) | 到 3200 = 19:39Z | 守卫线 3800 最早 09-02 02:55Z
           撞顶 06:30Z ~ 07:50Z | 人工期限 05:30Z
           阈值持久留痕已武装(五档逻辑 + 生产路径可写, 均已验)
guard      脚本 100% 就绪, 等 Owner 一句授权
```

—— J1