' 以【隐藏窗口】跑一个 sh 脚本。给计划任务用。
'
' 🔴 存在理由(2026-08-11): 哨兵的计划任务 action 直接起 `bash.exe`(控制台程序),
'    而任务 LogonType 是 Interactive ⇒ **每 5 分钟在用户桌面闪一个命令框**。
'    Owner 当天报"这台机器频繁跳出命令框, 前几天没有过" —— 就是它, 而它是我当天装的。
'    🔨 判据: **我加的自动化, 它的噪音也是我加的**; 每 5 分钟打断人一次, 比它守的那个故障还频繁。
'
' 🔴 为什么不改成 S4U(非交互会话, 天然无窗口): **S4U 注册要管理员**, 本机会话没提权,
'    `Register-ScheduledTask` 直接 Access is denied。⇒ 走这条不需要提权的路。
'
' 🔴🔴 **只收一个参数, 而这是被上一版打出来的**: 上一版让调用方把整条 bash 命令(含 -lc 与内层引号)
'    当参数传进来 ⇒ 任务参数里出现**三层嵌套引号** ⇒ 命令被截断, 任务 0x800710E0 失败、
'    `.alive` 一直不写。**而它失败得很安静: 窗口确实不弹了, 哨兵也确实死了。**
'    ⇒ 现在只收【sh 脚本的 POSIX 路径】, 命令由本文件内部拼, 调用方那一行没有任何嵌套引号。
'    (日志路径不必传 —— cron 脚本自己有默认值。少传一个参数就少一层引号。)
Option Explicit
Dim args, sh, bash, script, cmd

Set args = WScript.Arguments
If args.Count <> 1 Then
  ' 🔴 参数个数不对就明确失败, 不猜、不静默退出 —— 静默成功是这套东西最怕的读数
  WScript.Quit 2
End If
script = args(0)

bash = "C:\Program Files\Git\bin\bash.exe"
cmd = """" & bash & """ -lc ""sh '" & script & "'"""

Set sh = CreateObject("WScript.Shell")
' 0 = 隐藏窗口; True = 等它跑完 ⇒ 计划任务的 LastTaskResult 才是真退码,
' 否则"起了就返回"会让 LastTaskResult 永远是 0, 又变成一个没有意义的绿灯。
WScript.Quit sh.Run(cmd, 0, True)
