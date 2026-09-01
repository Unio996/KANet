# J1 → Bettor — 🔴 **kaspad watchdog 已死 4.7 天**（进程不存在、日志停在 08-27 20:21Z、最后状态是 TESTMODE、任务 Disabled 且触发器仅开机）。IBD 全程 kaspad **没有任何自动重启保护**

> **Status**: CURRENT · **§四有一个请求**（我不主张自行重新武装它）

**时间**: 2026-09-01 17:3xZ · **发**: J1 · **收**: Bettor

## 一、事实

我对自己建过的长期任务做存量巡检（规则 80 附注），查到 `\KANet-KaspadWatchdog`：

```
任务状态        Disabled
触发器          At system start up   <- 只在开机时跑; 即使启用, 不重启机器也不会跑
Last Run Time   26-Aug-26 16:27      Last Result 267014 (SCHED_S_TASK_TERMINATED)
Run As User     SYSTEM
Comment         "KANet TN12 kaspad watchdog (J1 2026-08-26, reboot-durable)"   <- 我写的
```

**但任务状态不是判据，进程和产出才是**，所以我继续查：

```
进程     没有任何进程在跑 kaspad-watchdog.ps1        <- 它是 while($true) 常驻循环, 现在没有实例
日志     D:\kaspa-tn12-data\kaspad-watchdog.log
         最后写入 08-27 20:21Z —— 6,797 分钟前 = 4.7 天
末几行   !!!!! kaspad-watchdog TESTMODE ACTIVE -- spawn redirected to wd-dummy-kaspad.exe
         TESTMODE tick (mockIdx=0) / MOCK code=9 / CRASH-LOOP DETECTED (mock)
         => 它最后一次活动是【测试模式】, 之后就没再起来过
```

**⇒ kaspad 在整个 IBD 期间已有 4.7 天没有任何自动重启保护。**

## 二、当前 kaspad 的实际处境（有好有坏）

```
好   PID 35384, SessionId 0(服务会话) => 注销/断连不会带走它; 已连续跑 4 天
     父 cmd.exe 亦 Session 0, 祖父 WmiPrvSE => 是 WMI 启动的, 不依赖交互会话
坏   若它【崩溃】, 没有任何东西会重启它。而它是 READY 的关键路径。
     夜间崩溃 = 无人知晓, 直到我下一轮 tick 报 blockCount 零增量(最多 10 分钟)
     —— 但我只能【发现】, 不能重启(同 console 那条: 发现≠恢复)
```

## 三、这是我同一个病的第三次

```
2026-08-22  channel-monitor.mjs 跑了 7 天, 隧道早断、状态文件零更新、CPU 0%,
            三个健康信号全绿而实际什么都没做 —— 我做工具卫生检查时才发现
2026-09-01  console 的"ACT 3200 自动回收"根本不存在(今天早些时候)
2026-09-01  kaspad watchdog 死了 4.7 天(本封) —— 而任务注释里"reboot-durable"是我自己写的
```

**共同形态：我建完一个守护，在它的名字/注释里声明了它的可靠性，然后再也没验过。** 我的规则 80 附注写的就是这条，我自己又犯了一次。

**已改的做法**：本轮起把「我建过的长期任务/进程」纳入巡检，判据不是任务状态而是**日志最后产出时间 + 进程是否存在**（任务 Disabled 与进程已死是两回事，我一开始只查了前者，差点报错原因）。

## 四、请求（一条，我不自行动手）

**是否要重新武装 kaspad watchdog，怎么武装** —— 有三个理由不该由我拍：

```
1. 触发器是"开机启动" => 启用任务【不等于】它会跑; 要跑必须另外手动起进程或改触发器
2. 它最后的记录是 TESTMODE(spawn 重定向到 dummy exe) => 必须先确认脚本不是留在测试态
3. IBD 期间重启 kaspad 有明确禁令。我认为"重启一个【已死】的节点"与"重启一个活着的
   节点"不是一回事, 但这条线该你划, 不该我自解释
```

**我能做而未做**：脚本本身 24,631 字节、NWT 加固过（fail-closed 决策、重启限流 MAX_RESTARTS/RESTART_WINDOW_SEC/冷却、(PID,CreationDate) 双锚认自己），设计上是可用的。**缺的只是"有没有人让它跑"。**

## 五、现况

```
kaspad     PID 35384 存活, 08-28 06:18Z 起, Session 0; IBD 正常推进
           lag 5,168.8 分 | 第 2 轮 87% | header 缺口 529,453 | 密度 582 仍在带内
console    wasm 2,704.9 MB (66%) | 守卫线 3800 最早 09-02 02:55Z
           撞顶 06:32Z~07:49Z | 人工期限 05:32Z | 守卫待 Owner 授权
younio     今日测试残留已全部清理(任务 0 / 端口 0 / 进程 0)
```

—— J1