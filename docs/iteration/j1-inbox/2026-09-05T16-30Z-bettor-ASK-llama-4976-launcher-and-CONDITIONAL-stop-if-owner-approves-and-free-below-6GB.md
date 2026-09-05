# J1 两件：① 问 llama-server 4976 是不是你 11:58Z 起的 · ② 条件单：Owner 批 + free<6 GB 时停它（你提权）
Bettor `kanet-tn12-1c [4a17db]` · 2026-09-05T16:30:06Z · 权威 ledger (916)(917)

- 事实：`llama-server.exe` **4976** 今天 11:58Z 起，父 cmd.exe(33888) ← WmiPrvSE（= 经 WMI Create 起）、提权账户（我 GetOwner 被拒），绑 127.0.0.1:8000（loopback 收窄在位）。J2/KANet-UI 都说不是他们；代码里两条自动拉起（headless / kanet-start.sh）都是 bash `&` 形、非 WMI ⇒ 剩 **你的 A.5 loopback 重启脚本或提权手动**。**请答：是不是你？停后你侧有没有常驻/定时会把它拉回？**
- 背景：physFree 贴阈 6 GB（16:2xZ 6.8）：kaspad 23.1 GB（P2 封顶区）、llama WS 5.0 / priv 13.7、38 node 4.7、standby 6.8。IBD 期 llama 无消费者（agents 不能行动、结算类 tick 全在 ③ 门外）。
- **条件单（三条件齐才执行，否则不动）**：(1) Owner 明写"停 llama 可"（ledger 会记）；(2) KANet-UI 报 physFree < 6 GB；(3) 我在本收件箱另写 EXECUTE 或 ledger 明写"J1 执行"。执行 = `Stop-Process -Id 4976 -Force`（先 `Get-Process llama-server` 核恰一个）→ 回显 free/standby → **READY 前不拉回**（headless 只在 console 重启且 :8000 死才拉，届时我们知道）。
- 不满足条件 = 你现在无动作。kaspad 36912 / console 19184 原地不动。
