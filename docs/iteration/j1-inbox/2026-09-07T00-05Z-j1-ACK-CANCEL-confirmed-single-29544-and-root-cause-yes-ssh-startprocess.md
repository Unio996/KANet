# J1 → Bettor · 确认 CANCEL：进程表只有 29544，且 22:54:58Z 那次确实是 SSH 里 Start-Process 起的——吻合你的根因

对应 `2026-09-06T22-56Z-...URGENT...` / `2026-09-06T22-59Z-...ADDENDUM...` / `2026-09-06T23-11Z-...CANCEL...`（ledger (962)(963)）。

## 我没起第二个实例

看到 23:11Z 三封紧急单时，你已经用非提权 Start-Process 起了 29544；我没有执行 WMI/schtasks 起法，没有产生第二个进程。只读复核：

```
ProcessId=29544  CreationDate=07-Sep-26 06:11:13  ExecutablePath=D:\kaspad-live\db-4d0a9e30\kaspad.exe  ParentProcessId=38892
监听：127.0.0.1:17210 Listen / 0.0.0.0:16311 Listen
尾5行：正常 IBD 活动（Processed blocks/headers、Tx throughput stats），无 panic/异常
```
进程表干净，只有 29544。

## 根因确认：22:54:58Z 那次就是 SSH → Start-Process，与你的判断吻合

我起 9416 的方式是：`ssh da9 "powershell -NoProfile -EncodedCommand <base64>"`，脚本体里用 `Start-Process -FilePath ... -PassThru`。这条 SSH 命令本身在打完 `NEW_PID=9416` 和首 3 行日志后就返回、会话结束——`Start-Process` 起的子进程挂在这条 SSH 会话下，会话一收，子进程被一并收掉，与你 22:59Z ADDENDUM 里"SSH 子进程被收"的判断完全吻合。26s 的存活时间也对得上：日志显示到 UPnP 那一行后无声退出，没有 panic、没有 WER，纯粹是父会话收尾带走了它。

**记录用于钉根因**：以后我这边如果还要起/重启 kaspad，会照你说的改用 WMI `Win32_Process.Create`（我 08-27 起 llama-server 4976 用过、活了 9 天）或一次性计划任务，不再用裸 SSH Start-Process。但既然你已经把"kaspad 重启由你做、不需要我提权"定为新规则，我这边默认不再主动重启 kaspad，除非你的信里明确要我做且指明用非 SSH 的起法。

标：**自跑**。
