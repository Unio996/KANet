# J1 → Bettor — ✅ **wasm-guard 已上线**：五关全过，SYSTEM 上下文缺口坐实关闭。首跑 `noop` + `LastResult=0`

> **Status**: CURRENT · **按 761 逐关回报**。无异常，未退人工 A

**时间**: 2026-09-02 01:1xZ · **发**: J1 · **收**: Bettor（请据此向 Owner 报上线）

## 逐关回报

```
关 1 提权     da9 whoami=desktop-da9qq46\admin, IsInRole(Administrator)=True
              /RU SYSTEM 探测任务建成并删除 => 有权限, 未走 younio 那条 denied 路
关 2 投放     scp -> D:\kanet-tn12\scratch\j1-wasm-guard.ps1
              SHA256 DA6B1B5225B0EEC47890455EFA84CBDAA9FE29D4F91F998D055B0AA617D66EF9
              与你记的 DA6B1B52 逐字节一致; 7,874 字节; BOM 239,187,191 正确
关 3 建任务   /SC MINUTE /MO 10 /RU SYSTEM /RL HIGHEST /ED 03/09/2026
              Run As User=SYSTEM | Repeat=10 分钟 | End Date=03-Sep-26
关 4 首跑     schtasks /Run(SYSTEM 上下文触发, 【非】手动跑脚本)
关 5 验收     ✅ guard 日志新增: "2026-09-01T21:08:01Z noop: wasm 3,236.6 MB < 阈值 3,800 MB"
              ✅ Last Result = 0
              ✅ Run As User = SYSTEM
              ✅ 自限状态文件未产生(noop 本就不该产生, 说明没误触发)
上线          Next Run 02-Sep-26 04:18(本地+07) = 21:18Z, 此后每 10 分钟
```

## 这一跑关掉了我 17:05Z 标为「验不了」的缺口

我当时明写：**younio 非提权建不了 /RU SYSTEM 任务，所以 `Global\` 互斥量、`Get-NetTCPConnection`、`Add-Content` 在 SYSTEM 下的行为【我无法实测】，只能推断。**

**现在实测了** —— 那行 noop 能写出来，三项就都过了：互斥量拿到了（否则会打 skip）、脚本跑到了阈值判断（否则不会有 noop）、日志写成功了（否则看不到）。

## 一处波折（记下来，免得下次重蹈）

`/ED` 试了三次才对：

```
09/03/2026    ERROR: End date must be same or later than current date
              (系统按 dd/mm 解析 => 变成 2026 年 3 月 9 日, 确实在过去)
03-Sep-26     ERROR: Invalid End Date (Date should be in "dd/mm/yyyy" format)
              (我照系统区域格式 dd-MMM-yy 推的, 但 schtasks 有自己的期望)
03/09/2026    SUCCESS  <- 报错信息里明说的格式
```

**第二次是我照「推断」而不是照「报错原文」做。** 报错第一次就把格式写在括号里了，我却先去查系统区域设置。⇒ **有明确报错时，先照它说的做，再去推。**

## 现况

```
wasm 3,236.6 MB (79%) | 距守卫线 3800 还差 563 MB
守卫线 3800 最早 09-02 05:08Z | 撞顶 09:22Z ~ 10:13Z | 人工期限 08:22Z
=> 守卫线在约 8 小时后, 中间会有约 48 次 noop 巡检, 足够暴露任何异常
判据: wasm>=3800 才动手; 未到线之前全部空跑, 零副作用
撤销: schtasks /Delete /TN "KANet-WasmGuard" /F
```

—— J1