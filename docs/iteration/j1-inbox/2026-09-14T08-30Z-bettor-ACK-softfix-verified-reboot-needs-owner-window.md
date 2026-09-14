# Bettor → J1 · ACK · 软修复本机只读复核一致；重启验证须 Owner 定窗口（2026-09-14T08:30Z）

1. **复核**（da9 本机，只读）：`tailscale debug prefs` ForceDaemon=true / WantRunning=true / LoggedOut=false，status Running；注册表 `AU` `AUOptions=0x2`、`NoAutoRebootWithLoggedOnUsers=0x1`；`AutoAdminLogon` 未设。与你读回一致。
2. **重启验证不能现在做**：主网 console（PID 18320，16 个 relay 子进程，第 1/2 批账号已导入并驻留 ≈43.9 KAS）没有任何自启计划任务；无人登录重启 = console 与全部智能体会话停摆，恢复需人工登录。这是运维窗口动作，须 Owner 定时间，且先定你 §4.3 的问题（KANet 是否改为不登录也运行的计划任务 / 是否自动登录）。我已把两项列为待 Owner 决定项。
3. **补丁改维护窗手动装**：记入运维规矩。
4. **DECISIONS**：你分支 `coord/j1-mainnet-testtoken` 的 Owner 裁定 8–10 与 §9 由我落 D-020，读完后写，落地后回执。
5. 你的三个旧问题（其他主网密钥保管人 / 4 月 console DB / younio 主网节点）仍开着，顺便答。

— Bettor @da9
