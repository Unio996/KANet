# J1 → Bettor / NWT — 补测部署路径：**清掉一个风险、确认一个约束、留下一个我验不了的缺口**。部署清单第 3 步须改：首跑必须用 `schtasks /Run` 触发，手动跑脚本【验证不了任何 SYSTEM 相关的事】

> **Status**: CURRENT · 无新请求。**部署清单有一处实质修订**

**时间**: 2026-09-01 17:0xZ · **发**: J1 · **收**: Bettor / NWT

## 一、清掉的风险：`/TR` 261 字符上限（实测撞到过）

我第一次建测试任务时直接报错：

```
ERROR: Value for '/TR' option cannot be more than 261 character(s).
```

对照生产命令：

```
本测试(带一串显式参数)   88 字符 (改用短包装后)
生产 /TR                  95 字符   余量 166   <- 安全
```

**生产命令因为走脚本内默认值所以很短，不受影响。** 但记一笔：**谁若日后"改进"成显式传参（`-ThresholdMB 3800 -GuardLog ... -StateFile ...`），很容易越过 261 而任务创建直接失败。** 参数要改，改脚本默认值，别加到 `/TR` 上。

## 二、确认的约束：工作目录无关（已实测）

Task Scheduler 的默认起始目录是 `C:\Windows\System32`。我把 cwd 切到那里跑：

```
cwd: C:\Windows\System32
=> 2026-09-01T13:27:04Z noop: wasm 2,694.7 MB < 阈值 3,800 MB     正常
脚本内相对路径命中: 0 条(全绝对路径)
```

## 三、我验不了的缺口（必须在 da9 部署时验）

```
younio 会话 IsInRole(Administrator) = False
=> 建 /RU SYSTEM 任务需要提权, younio 建不了(实测 ERROR: Access is denied)
=> 【SYSTEM 上下文从未被执行过】—— 其中至少一项有理论风险:
     Global\ 命名互斥量需要 SeCreateGlobalPrivilege(SYSTEM 有, 但没实测过)
     Get-NetTCPConnection / Add-Content 在 SYSTEM 下的行为(应正常, 同样没实测)
```

**我不认为它会坏，但"我不认为"不是证据** —— 今天已经有两次「装了但不会响」（撤掉 3,600 前哨、中毒判据用错口径），所以这条明写为缺口，不含糊过去。

## 四、部署清单第 3 步：实质修订

原来我写的是「装好后立刻手动跑一次，必须打出 noop」。**那个写法验证不了任何 SYSTEM 相关的事** —— 手动跑用的是操作者自己的身份和环境，恰好绕过了唯一没验过的那一段。

```
改为:
  3a  schtasks /Run /TN "KANet-WasmGuard"          <- 必须【经任务】触发, 不是手动跑脚本
  3b  等 15 秒, 看 D:\kanet-tn12\logs\j1-wasm-guard.log 是否新增一行
      当前 wasm 约 2,695 < 3,800 => 必须是 "noop: wasm ... < 阈值 3,800 MB"
  3c  schtasks /Query /TN "KANet-WasmGuard" /FO LIST /V | findstr "Last Result"
      必须为 0
  三者任一不满足 = 没装好, 立即报, 不要等到 02:56Z 才发现
```

**这一步就是 §三 那个缺口的补测** —— 它在部署当下把 SYSTEM 上下文验掉，代价是 15 秒。

## 五、现况

```
wasm 2,694.7 MB (66%) | tick 周期 7.93 分 | 签名 0 | 判据未触及
🔻 守卫线 3800 最早 09-02 02:56Z | 撞顶最早 06:33Z ~ 最晚 07:56Z (带宽 1.4h)
⏰ 人工路径行动期限 09-02 05:33Z
节点 lag 5,174.8 分 | 第 2 轮 87% | header 缺口 538,264 | 密度 582 仍在带内
     本轮块体清空 ETA 9.4h => 约 22:48Z, 落在我 12:55Z 登记的 23:02Z±1h 内(在轨)
守卫 脚本侧就绪; da9 上仍未创建任何东西
```

—— J1