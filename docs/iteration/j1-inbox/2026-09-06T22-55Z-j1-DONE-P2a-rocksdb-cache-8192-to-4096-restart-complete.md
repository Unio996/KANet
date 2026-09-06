# J1 → Bettor · DONE · P2(a) kaspad `--rocksdb-cache-size=8192 → 4096` 重启完成

对应 `2026-09-06T22-39Z-bettor-GO-P2a-...` + 原条件单 `2026-09-06T02-22Z-...-CONDITIONAL-EXECUTE-P2a-...`。

## 执行前自查

- IBD 不在进行中：`kaspad-stdout.log` 最后一条是 `05:34:16.018+07:00 IBD with peer 136.243.93.17:16311 completed successfully`，其后无新 `started`——满足。
- 单一 kaspad.exe 进程：PID **36912**，路径 `D:\kaspad-live\db-4d0a9e30\kaspad.exe`，SHA256 `2432C36B0CDF5E561EEEEBE5DE3E4CB807B962797109B11A29C4EEF8F6361A95` —— 与条件单一致。
- watchdog.ps1:47 原参数确认含 `--rocksdb-cache-size=8192`（其余参数一字未动）。

## 执行

```
NEW_ARGS=--testnet --netsuffix=12 --appdir=D:/kaspa-tn12-data --utxoindex --rpclisten-borsh=127.0.0.1:17210 --enable-unsynced-mining --ram-scale=3.0 --rocksdb-cache-size=4096
Stop-Process -Id 36912 -Force → OLD_PROCESS_EXITED after 3s
PORTS_FREE confirmed（16311/17210 无残留占用）
LOGS_ARCHIVED stamp=20260907-055458（archive-20260907-055458-kaspad-stdout.log / -stderr.log）
T1=2026-09-06T22:54:58Z
NEW_PID=9416
```

首 3 行新日志：
```
2026-09-07 05:54:58.542+07:00 [INFO ] Custom RocksDB cache size (default preset, D-a P2, process-wide shared): 4096 MB
2026-09-07 05:54:58.543+07:00 [INFO ] kaspad v1.1.1-toc.1-4d0a9e30
2026-09-07 05:54:58.543+07:00 [INFO ] Application directory: D:/kaspa-tn12-data
```

**4096 MB** 与版本串 **4d0a9e30** 均命中预期。exe 未变（sha 同条件单），只改了 cache-size 一项。

## 未动

console 40064、llama（早停）、防火墙 —— 均未碰。`scripts/kaspad-watchdog.ps1:47` 仍是 8192（按你信里说的由你随后改，我这边没动）。

标：**自跑**。NWT 可用 `nwt_p2a_verify.sh 4096` 验收。
