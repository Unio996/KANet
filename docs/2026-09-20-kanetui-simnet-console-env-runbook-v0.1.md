# 9-4 隔离 simnet console 环境 runbook v0.1（脚本 `scripts/simnet-env.ps1`）
> **Status**: CURRENT ｜ 依据：批 9 设计 v0.2 §9-4（全新 DB + 全新 env 副本，不碰主网库/主网 env）。未起过任何进程；起 simnet 节点前先报 Bettor（内存门）。

**一条命令**（PowerShell，从任意目录）：
- 起：`powershell -File D:\kanet-tn12\scratch\_kanetui_wt_simnet\scripts\simnet-env.ps1 up -Tree <含 9-2b 代码且自带 node_modules 的 worktree>`（例：J2 的 `scratch\_j2_wt_batch9_*`）。节点没起会先起（内存门 ≥80% 拒起）。
- 停：`... down -WithNode`（只停 console 与其 relay 子进程；`-WithNode` 再停 simnet 节点）。另有 `status` / `restart`（同一库重读 env）/ `node-up` / `node-down`；`up -DryRun` 只打印计划不起任何东西。

**它建什么**：`D:\kanet-tn12\scratch\_simnet_console\run-<时间戳>\`——全新 `console.simnet.db`、`kanet.simnet.env`（一次性随机 `CONSOLE_ENCRYPTION_KEY`/`INGEST_SECRET`，`KASPA_NETWORK=simnet`，`KASPA_RPC_URL=ws://127.0.0.1:18510`，`PORT=3299`，`KASPA_RPC_LOCAL_ONLY=1`，驱动开关 `PROTO_DRIVER_ENABLED=1`/`PROTO_SETTLEMENT_DRIVER_ENABLED=1`）、console 日志与 pid。simnet 节点 = 官方 kaspad 2.0.1（起前核 sha256），`--simnet --utxoindex --enable-unsynced-mining`，只绑 127.0.0.1（16510/16610/18510/18511），appdir 在 `_simnet_console\node-data`。

**起后自查（脚本自动做，任一不符 ⇒ 停掉刚起的 console，退出码 3）**：① 节点 `getServerInfo().networkId === 'simnet'`（用 Tree 自己的 kaspa-wasm）；② console 端口 3299 在听；③ console 自己的 stdout 首行 `[db] path=` 是本次 run 目录里的库（证明在全新库上）。成功打 `SIMNET-ENV-OK run=… port=3299 env=…`。

**接 9-2b 跑四步结算**：`up` 后在 `http://127.0.0.1:3299` 建 `proto-` 前缀 relay 并转入 <5 KAS 测试币（simnet 挖矿币），把 `PROTO_RELAY_ID=<该 relay id>` 加进 run 目录的 `kanet.simnet.env`，`restart`；随后按批 9 设计 §12.8 走 genesis→…→claim_draw，证据入 `docs/provenance/<日期>-…`。

**硬护栏（脚本内强制）**：Tree 不能是主网检出；Root 必须是 `scratch\_simnet_console*`；端口不得为 3202/3100；不读 `kanet*.env`、不指向主网库；启动前清掉继承自父 shell 的 `PROTO_RELAY_ID`/`BROKER_ENABLED`/`UTXO_AUTOSPLIT_ON_START`/`TELEGRAM_BOT_TOKEN`/`ADMIN_SECRET_*` 等；停进程只按记录的 PID 且先核命令行，绝不按名字；`status` 末行回显主网 kaspad(17110)/console(3202) 监听 PID，用于证明未被碰。
**已知限制**：console 会写 Tree 里的 `logs/`、`data/`（所以必须用 worktree，不用主网检出）；PROTO_RELAY_ID 是 import 时读取，故加它后必须 `restart`；`up` 的真起路径尚未在真环境跑过（本批只跑了 DryRun 与各拒绝路径），首跑要 Bettor 的内存门 GO。
