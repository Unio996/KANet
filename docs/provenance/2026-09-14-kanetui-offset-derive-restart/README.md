# 偏移派生线合主线主网 console 重启证据（2026-09-14 · KANet-UI · Bettor 1283 派工 · Owner 批准）

> 执行依据：执行页 v0.2（`docs/2026-09-14-kanetui-offset-derive-live-restart-exec-v0.1.md`，commit `76f48b41`+`b84efe8f`）。**本页不含任何密文/明文密钥材料**——`CONSOLE_ENCRYPTION_KEY fingerprint` 一行只是短指纹前缀，非完整密钥；原始日志已核实 zero 64-hex 序列。

## 时间

`date -u` 实取：`2026-09-14T07:47:52Z`（重启后验证完成时点，本行为估算记录窗口的最后一次实取时刻）。

## ① `git pull --ff-only`

本地 HEAD 已经是 `8be93c8b`（Bettor 1283 已推三笔后的头），与 `origin/bshard-m3-deploy` 一致，无需额外 pull。`git merge-base --is-ancestor d7d61fc0 HEAD` 确认为真。全仓 `node scripts/lint-kanet.mjs`：**959 文件，0 error**。

## ② env 核实（零改动）

```
grep -c "^ZK_TOKEN_TMPL_HASH\|^ZK_CLAIM_TMPL_HASH\|^ZK_MARKET_SUFFIX_HASH" kanet.mainnet.env  → 0
grep -c "^ADMIN_SECRET_KEY_EXPORT\|^RELAY_KEY_EXPORT_ENABLED_UNTIL" kanet.mainnet.env          → 0
grep -c "^RELAY_HOTWALLET_PER_RELAY_MAX_KAS\|^RELAY_HOTWALLET_TOTAL_MAX_KAS\|^RELAY_HOTWALLET_COLD_ADDRESSES" kanet.mainnet.env  → 3（800/1000，值核对未变）
grep -c "^SILVERC_V100_PATH" kanet.mainnet.env  → 1（既有值，未改动）
```
`kanet.mainnet.env` 本次**零改动**。

## ③ 重启前基线 + DB 备份

| 项 | 值 |
|---|---|
| 旧 PID | `14884` |
| kaspad 探针（重启前） | `daa=539512093` |
| relay 子进程数（`node.exe`） | `16`（批1 10 + 批2 6） |
| `GET /relays` | `200`，`263614` bytes |
| `events.hotwallet_relay_killed`（重启前） | `0` |

**DB 备份**：`better-sqlite3` WAL-aware `.backup()` 写到 `C:\KANet-backups\console.mainnet.db.pre-offset-derive-restart-backup`——落盘前 `git rev-parse --is-inside-work-tree`（在 `C:\KANet-backups\` 内执行）核实非 git 工作树（返回 `fatal: not a git repository`）。
- SHA256：`18EA3E08B803712B9C204C4202F5D6D080D1A8475A75810BA163962FB283EB84`
- 大小：2,244,608 bytes

## ④ 重启动作

1. `Stop-Process -Id 14884 -Force` → 确认 PID 不存在。
2. `scripts/start-console-mainnet.ps1` → 新 PID **18320**，`127.0.0.1:3202` 监听确认。

## ⑤ 重启后验证

| 检查项 | 结果 |
|---|---|
| 监听 | `127.0.0.1:3202` under PID 18320 ✅ |
| pin 自检 | `[silverc-pin] PASS sha256=4378ba65... golden=RootClaim ok`，`PASS`=**1**，`FAIL`=**0** |
| `WARMUP FAIL` | **0** 行（4 个键——2 label × {V1,V2}——全部静默成功） |
| **委员 offset 参考值不一致 WARN** | 🔴 **出现，原文记录**（按执行页要求）：<br>`[committee-offset-derive] WARN: derived != checked-in reference (isV2=false, derived predicateCommitOffset=16411, reference=518, derived poolMerkleRootOffsets=[16931,17227,17523,17819,18115], reference=[1002,1266,1530,1794,2058]) — .sil 已改动，建议更新 checked-in 参考值(不拒签，仅留痕)`<br>`[committee-offset-derive] WARN: derived != checked-in reference (isV2=true, derived predicateCommitOffset=16569, reference=642, derived poolMerkleRootOffsets=[17089,17385,17681,17977,18273], reference=[1126,1390,1654,1918,2182]) — .sil 已改动，建议更新 checked-in 参考值(不拒签，仅留痕)`<br>各出现 2 次（`bshard-close-enforce` 与 `bshard-payout-family-coherence(K-18)` 两个 warmup label 各自独立调用 `deriveCommitteeCheckOffsets`，都撞到同一个不一致，NWT 1237③ 独立性设计的预期行为）。**这条不是本次意外**——`reference=518`（V1）/`642`（V2）正是 ledger 1233 已记录在案的"V1 offset 漂移"那个陈旧硬编码值（`payout-family-coherence.mjs` 内旧常量），本次重启让**运行时派生值**（16411/16569，来自当前实际编译的 `.sil` 产物）首次在 LOUD 日志里显形——这正是这条偏移派生线要解决的问题本身：不拒签，只留痕，`checked-in` 参考常量本该在后续更新（另一票，不在本次重启范围）。 |
| T-LEGACY-NULL-COLS | **0** 行（未打印，符合预期——ledger 1267/1268 已记"主网 0 市场"） |
| FATAL/UNMET | 全量 stdout+stderr **0** 命中 |
| `GET /relays/:id/mnemonic` | **503** `key export disabled` |
| `GET /api/relay/:id/wallets/:walletId/privkey` | **503** `key export disabled` |
| relay 子进程数（重启后） | **16**（`Get-CimInstance` 核实，`ParentProcessId=18320 AND Name='node.exe'`） |
| `GET /relays`（重启后） | `200`，`263614` bytes——与重启前逐字节 `diff` **完全一致** |
| `relayHealthMonitorTick` | `eligible=16 deadCount=0` |
| `relayHotwalletMonitorTick` | `checked=16 killed=0` |
| `events.hotwallet_relay_killed`（重启后） | `0`，与重启前一致 |
| kaspad 探针（重启后） | `daa=539512890`（只增不减，节点未受重启影响） |

## ⑥ 结论

偏移派生线合主线运行时生效重启完成，七步全部按执行页 v0.2 走完，验收全绿：pin 自检/relay 健康/两条密钥路由/events 计数/kaspad 节点均未受影响；`WARMUP FAIL` 零行确认 4 个委员 offset 缓存键全部预热成功；`T-LEGACY-NULL-COLS` 未打印符合"主网 0 市场"预期；委员 offset 参考值不一致 WARN 按设计如实出现且原文记录——对应的是 ledger 1233 已知的 V1 offset 陈旧硬编码值（518/642）与本次上线的运行时派生值（16411/16569）之间的差异，属于这条偏移派生线要解决的问题本身首次在真实运行时显形，不拒签、不阻断，后续参考常量更新是另一票。本次重启未写入任何新 env（三个 `ZK_*` env 与两个 key-export env 均保持 UNSET）。

原始日志留档：`console-mainnet-stdout-PID18320.log` / `console-mainnet-stderr-PID18320.log`（本目录内独立副本，已核实 zero 64-hex 序列）。DB 备份文件留存于 `C:\KANet-backups\`（非 git 路径），sha256 已记于 §③。
