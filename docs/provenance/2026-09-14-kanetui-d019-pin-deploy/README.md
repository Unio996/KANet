# D-019 pin 修补主网部署证据（2026-09-14 · KANet-UI · Bettor 1236 派工 · 按执行页 v0.3 f451795b 执行）

> 执行范围：D-019 编译器钉线九笔合入主线（`31ec5f25`，Bettor `b4afbf90`），主网 console 重启验收。本次不涉及任何账号导入/市场创建/covenant 创世动作——三个 `ZK_*_TMPL_HASH` env 按 Bettor 1236 明确要求保持 UNSET。

## 时间

`date -u` 实取：`2026-09-14T03:41:21Z`（重启后验证完成时点）。

## ① `git pull --ff-only`

共享检出 `git fetch` 后 `git status` 显示 "up to date with origin/bshard-m3-deploy"——过程中一次 `git pull --ff-only` 报了瞬时 "Cannot fast-forward to multiple branches"（另一并发会话正在推送新提交），复核 `git reflog`/`git merge-base --is-ancestor b4afbf90 HEAD` 确认最终状态干净：当前 HEAD（`ff7e3688`）以 `b4afbf90`（Bettor 指定的合入点）为祖先，只是多了两笔无关的 docs-only 协调笔记提交（偏移派生方案复核，Bettor 1237 已注明"与部署无关"），没有分叉/冲突。

全仓 `node scripts/lint-kanet.mjs`：**956 文件，0 error**（对照 Bettor "lint 956/0" 原话一致）。

## ② env 核实（未改动，此前已就位）

```
SILVERC_V100_PATH=D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe   （已就位，provenance 66086cb6）
# ZK_TOKEN_TMPL_HASH / ZK_CLAIM_TMPL_HASH / ZK_MARKET_SUFFIX_HASH ——保持 UNSET（Bettor 1236 明确要求）
RELAY_HOTWALLET_COLD_ADDRESSES=...（原样，未改动）
RELAY_HOTWALLET_PER_RELAY_MAX_KAS=800（原样）
RELAY_HOTWALLET_TOTAL_MAX_KAS=1000（原样）
```
本次部署 `kanet.mainnet.env` **零改动**——重启前 `grep` 核实过状态与上表一致，重启后同样核实过（§⑤）。

## ③ 重启前基线 + DB 备份

| 项 | 值 |
|---|---|
| 旧 PID | `15396`（StartTime 14-Sep-26 03:21:16） |
| kaspad 探针 | `daa=539368721` |
| relay 子进程数 | `10`（`Get-CimInstance` 核实，第 1 批 stress 账号） |
| `relay_nodes` mainnet 计数 | `10` |
| `events.hotwallet_relay_killed` 计数 | `0` |
| `migrate.js` 版本基线 | v204 已应用，v205（D-019 第 5a 笔，`payout_shards`/`market_shards` 三/一个 ctor-only 常量列）待启动时应用 |

**DB 备份**（Bettor 1236 要求，路径+sha256 记证据）：用 `better-sqlite3` 的 WAL-aware `.backup()` API（不停进程、一致性快照，不是裸文件复制——原库当时有活跃 `-wal`，裸复制可能不一致）：
- 备份文件：`docs/provenance/2026-09-14-kanetui-d019-pin-deploy/console.mainnet.db.pre-d019-backup`（本地保留，**不进 git**——DB 含加密助记词密文，即便加密也不进版本历史，同项目一贯纪律）。
- SHA256：`5025a80dc3a6d090417da9267402bc74ba07bc779ecf32d14577ac46ce513108`
- 大小：2,097,152 bytes

## ④ 重启动作

1. `Stop-Process -Id 15396` → 立即回读确认 PID 15396 不存在。
2. `powershell -File scripts/start-console-mainnet.ps1` → 新 PID **25516**，`127.0.0.1:3202` 监听确认。

## ⑤ 重启后验证

| 检查项 | 结果 |
|---|---|
| 监听 | `127.0.0.1:3202` under PID 25516 ✅ |
| **pin 自检**（`grep -c '\[silverc-pin\] PASS'`） | **1**（`[silverc-pin] PASS sha256=4378ba65... golden=RootClaim ok`） |
| **pin 自检**（`grep -c '\[silverc-pin\] FAIL'`） | **0** |
| `migrate` v205 | 4 行确认应用：`payout_shards.token_tmpl_hash`/`claim_tmpl_hash`/`market_suffix_hash` + `market_shards.shard_token_tmpl_hash` 列已加 |
| FATAL（全量 stdout+stderr） | **0** 命中 |
| UNMET/MODULE_NOT_FOUND | **0** 命中 |
| stderr 全文（4 行，均为已知非错误提示） | v199 索引未建提示（既有已知项）/ ZK-prove-server 未配置 fail-closed / external-gateway 未配置 fail-closed / oracle-pool-scanner-cron 空池提示 |
| relay 子进程数（重启后） | **10**（`Get-CimInstance`，全部 `node.exe`，同一创建时刻 10:39:29） |
| `relay_nodes` mainnet 计数（重启后） | **10**（不变） |
| `events.hotwallet_relay_killed` 计数（重启后） | **0**（不变） |
| `GET /relays` 页面对照 | 重启前后 HTTP 200、响应体字节数完全一致（181222 bytes），relay id 集合逐一比对一致 |
| `relayHealthMonitorTick` | `eligible=10 deadCount=0`（10 个批 1 relay 全部健康在跑） |
| `relayHotwalletMonitorTick` | `checked=10 killed=0`（连续多个 tick 一致，驻留期监控正常运转） |
| kaspad 探针（重启后） | `daa=539370054`（比重启前只增不减，确认节点未受重启影响） |

## ⑥ 已知不相关的 RED（Bettor 1236 原话，不在本次部署处置范围）

`payoutshardv2-offset-tripwire.test.mjs` 目前已知 RED（ledger 1224/1236 已记，等待独立的"偏移派生"落码笔处理）——**与本次部署无关，本次未改任何委员签名校验 offset 常量**，写在这里是为了避免后续读这份证据页的人误以为部署引入了新问题。

## 结论

D-019 编译器钉线部署到主网 console 完成，六步全部按执行页 v0.3 走完，验收全绿：pin 自检 PASS 1 次 FAIL 0 次、v205 迁移正确应用、10 个批 1 relay 全部健康存活、驻留期监控/健康监控 tick 均正常、kaspad 未受影响、零 FATAL/UNMET。本次未改动任何 env 值（`SILVERC_V100_PATH` 沿用既有、三个 `ZK_*` 保持 UNSET），未导入任何新账号，未创建任何市场。

原始日志留档：`console-mainnet-stdout-PID25516.log` / `console-mainnet-stderr-PID25516.log`（本目录内独立副本，`logs/mainnet/` 下的活动日志会在下次重启时被覆盖）。DB 备份文件本地留存（不进 git），sha256 已记于 §③。
