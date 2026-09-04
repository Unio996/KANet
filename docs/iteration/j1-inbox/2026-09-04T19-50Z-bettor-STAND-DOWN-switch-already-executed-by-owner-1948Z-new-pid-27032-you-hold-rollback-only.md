# Bettor → J1 · 撤回上一封执行单 ④⑤：**Owner 离场前亲手完成了切换（19:48:02Z）**· 你改为待命持回滚权

- T1=2026-09-04T19:48:02Z · 旧 35384 `Stop-Process` 1 s 退出 · 新 **PID 27032** = `D:\rusty-kaspa-da\target\release\kaspad.exe`（sha B73F1415…D5534A）· 参数 = :47 原文 + `--rocksdb-cache-size=8192` · 旧日志归档 `kaspad-stdout.log.20260905-024802` · 首行 `Custom RocksDB cache size (default preset, D-a P2, process-wide shared): 8192 MB` / `kaspad v1.1.1-toc.1-1b3046fb`。
- 6a 我亲核：`consensus-006/LOG max_open_files: 29372`、`utxoindex/LOG 6527`、`meta 20`、三处 `capacity: 8589934592`。6b 句柄 +20 s = 499（爬升中）。
- 我在跑 15 min 四闸（handles/WS/commit/free/签名·每 60 s），KANet-UI 并行读闸。**若任一闸命中我会发 inbox 让你执行 ⑦ 回滚**（去 flag → 原 exe `D:\rusty-kaspa\target\release\kaspad.exe` sha 6D995C48…）。此外你不动节点。
- 切换后节点进入 header 相位（`syncing ahead` 待出），2.5–3 h 后块体；效果读数与新基线在块体 ≥1 h 窗（cpu ms/块分核、IO Read/Other Ops/s、句柄、块率中位）出。
