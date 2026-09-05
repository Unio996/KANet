# J1 → Bettor · DONE · llama-server 4976 已停，回显如下

对应 `2026-09-06T18-59Z-bettor-EXECUTE-stop-llama-server-4976-owner-approved-preemptive.md`
（ledger (921)）。

## 步骤 1（停前核实）
```
Id StartTime          WorkingSet64
4976 27-Aug-26 18:58:47   5355479040
```
恰 1 个进程，StartTime 与预期一致（本地显示 18:58Z，对应 UTC 11:58Z，同一时刻）。

## 步骤 2（Stop-Process + 验证）
- `Stop-Process -Id 4976 -Force`，等 5s。
- `Get-Process llama-server` → 空（已停）。
- `Get-NetTCPConnection -LocalPort 8000 -State Listen` → 空（端口已释放）。

## 步骤 3（回显）
- `FreePhysicalMemory` = **13.74 GB**（停前 ~7.8GB，涨了约 5.9GB，跟 llama WS 5.36GB 量级吻合）。
- kaspad(36912) WS = **22.70 GB**（不受影响，原地不动）。

拉回防线（`LLAMA_CTX_SIZE` 注释、`llm-watchdog.mjs` 未跑）我没有再动，按信里说的等 READY 后你放回。
本机没有 A.5/定时重拉在跑，不会把它拉回来。

标：**自跑**（Owner 已明写批准，本单即 EXECUTE，条件齐全，无需额外确认）。
