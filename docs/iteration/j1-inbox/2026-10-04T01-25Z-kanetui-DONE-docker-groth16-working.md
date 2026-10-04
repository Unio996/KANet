# KANet-UI 交件：Docker 打通，WSL Ubuntu-24.04 内 canonical sample Groth16 出证成功（账本 1829）

作者自报；请 Bettor 独立核。未重启 WSL、未停数字人、未改主网 env/代码、未重启 console、未链上花费。

## 做法
- 基线（启动 Docker 前）：提交量 73.9 / 上限 125.6 GB（空闲提交约 51.9 GB）；物理空闲约 34 GB；vmmemWSL 私有 24.8 GB；avatarforcing / r2t2ws 均 active；:8449 health ok；kaspad 4752、console 3436、scout 35040 在；docker-desktop 发行版 Stopped。
- 启动 `Docker Desktop.exe`，约 90 s 后可用。Docker Desktop 设置 `settings-store.json` 的 `IntegratedWslDistros` 本来就含 `Ubuntu-24.04`，没改任何设置；Ubuntu-24.04 内 `docker version` 通：client/server 29.6.1，Docker Desktop 4.80.0。
- 出证：脚本 `docs/provenance/2026-10-04-kanetui-docker-groth16/_kanetui_wsl_groth16.sh`。把 J2 工作树 `zk-payout-guest`（含已编 target）只读拷到 WSL `/tmp` 自己的副本，输入用 J2 的 `3o6cs_input.json`，`nice 19`、jobs 2，带 MemAvailable<1200MB 即杀 r0vm 的看门狗。

## 结果
- `PROVE_EXIT=0`，**image_id = c9918501d90bf0aeaaf7970816078c81e8286c08293ccf388e87a7cab023ce30，与 canonical 一致**。journal_digest 50c26d35…2f86，receipt borsh 482 B。
- 耗时：墙钟 **1:43**（CPU 1166%，用户态 1192 s）。
- 峰值：host 最大 RSS 4.8 GB（r0vm 采样峰值 4.4 GB）；WSL MemAvailable 最低 **1315 MB**（看门狗阈值 1200 MB，余量只有约 115 MB，**很紧**）；显存采样恒 24.5 GB 不变（纯 CPU，没用显卡）。
- 对照 J2 彩排：J2 当时 panic "Please install docker first"，现在同一 guest 同一输入出证成功。

## 前后对比（出证后）
- 数字人：avatarforcing / r2t2ws 仍 active，:8449 health ok；主网 kaspad 4752 / console 3436 / scout 35040 都在，console :3202 `/api/oracle-pool/state` 200。
- 提交量 74.6 / 125.6 GB（空闲约 51 GB，≥20 GB）；物理空闲约 32 GB；vmmemWSL 私有 24.7 GB（没涨）。
- Docker 按派工留着开。

## 风险（如实）
- 出证期 MemAvailable 最低 1315 MB，贴着 1200 MB 杀线；J2 段3 若并发多次出证或叠别的 WSL 负载，可能触发看门狗，或让 WSL 内数字人被 OOM。建议串行出证，并保留看门狗。
- Docker Desktop `AutoStart=false`，宿主重启后需再手动起。
- 本次没走 console 的 `zk-prove-worker`（其 `wsl.exe` 无 `-d`，默认发行版是 docker-desktop，仍是未验风险）。
