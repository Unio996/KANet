# 合并四线主网 console 重启证据（2026-09-14 · KANet-UI · Bettor 1311 派工 · Owner 常设批准）

> 执行依据：执行页 v0.1（`docs/2026-09-14-kanetui-merged-lines-restart-exec-v0.1.md`，commit `60a7479e`）。四线：T-REF-OFFSETS-REFRESH(`a5e5514d`)/关市窄门(`e49ee43e`)/宽度断言(`03d8e403`)/RCE热修(`c0ed69fa`+`8d8670ab`，NWT双GREEN `06faf504`)。**本页不含任何密文/明文密钥材料**——原始日志已核实 zero 64-hex 序列。

## 时间

`date -u` 实取：重启完成验证时点（PID 29872 起后约15s内完成全部验证）。

## ① 四线祖先关系核实（阻断条件，全部通过）

```
git fetch origin && git log -1 origin/bshard-m3-deploy → 88dec0a7（已是最新，无需 pull）
git merge-base --is-ancestor a5e5514d HEAD → 真
git merge-base --is-ancestor e49ee43e HEAD → 真
git merge-base --is-ancestor 03d8e403 HEAD → 真
git merge-base --is-ancestor c0ed69fa HEAD → 真
```
全仓 `node scripts/lint-kanet.mjs`：**963 文件，0 error**。

## ② env 核实（零改动）

```
grep -c "^ZK_TOKEN_TMPL_HASH\|^ZK_CLAIM_TMPL_HASH\|^ZK_MARKET_SUFFIX_HASH" kanet.mainnet.env  → 0
grep -c "^ADMIN_SECRET_KEY_EXPORT\|^RELAY_KEY_EXPORT_ENABLED_UNTIL" kanet.mainnet.env          → 0
grep -c "^ADMIN_SECRET_SYSTEM_ACTIONS" kanet.mainnet.env                                       → 0
grep -c "^RELAY_HOTWALLET_PER_RELAY_MAX_KAS\|^RELAY_HOTWALLET_TOTAL_MAX_KAS\|^RELAY_HOTWALLET_COLD_ADDRESSES" kanet.mainnet.env  → 3（800/1000，未变）
grep -c "^SILVERC_V100_PATH" kanet.mainnet.env  → 1（既有值，未改动）
```
`kanet.mainnet.env` 本次**零改动**。

## ③ 重启前基线 + DB 备份

| 项 | 值 |
|---|---|
| 旧 PID | `18320` |
| kaspad 探针（重启前） | `daa=539550588` |
| relay 子进程数（`node.exe`） | `17` |
| `GET /relays` | `200`，`277325` bytes |
| `events.hotwallet_relay_killed`（重启前） | `0` |

**DB 备份**：WAL-aware `.backup()` 写到 `C:\KANet-backups\console.mainnet.db.pre-merged-4lines-restart-backup`——落盘前核实非 git 工作树（`fatal: not a git repository`）。
- SHA256：`7381B0D32623DE46F8424F3C6FE5993B5F2B026E7E23CBFF3D0A207714EBB8DD`
- 大小：2,289,664 bytes

## ④ 重启动作

1. `Stop-Process -Id 18320 -Force` → 确认 PID 不存在。
2. `scripts/start-console-mainnet.ps1` → 新 PID **29872**，`127.0.0.1:3202` 监听确认。

## ⑤ 重启后验证

| 检查项 | 结果 |
|---|---|
| 监听 | `127.0.0.1:3202` under PID 29872 ✅ |
| pin 自检 | `[silverc-pin] PASS sha256=4378ba65... golden=RootClaim ok`，PASS=**1**，FAIL=**0** |
| `WARMUP FAIL` | **0** 行 |
| 🔴 **委员 offset 参考值 WARN** | **0 行**（T-REF-OFFSETS-REFRESH 生效——上次偏移线重启那 4 行永久性 WARN 这次完全消失，符合预期，未出现即代表刷新真的生效，不是巧合性未触发） |
| T-LEGACY-NULL-COLS | **0** 行（主网 0 市场预期不变） |
| FATAL/UNMET | 全量 stdout+stderr **0** 命中 |
| `POST /api/system/run` | **503** |
| `POST /api/system/download` | **503** |
| `GET /relays/:id/mnemonic` | **503** `key export disabled` |
| `GET /api/relay/:id/wallets/:walletId/privkey` | **503** `key export disabled` |
| relay 子进程数（重启后） | **17**（`Get-CimInstance`，`ParentProcessId=29872 AND Name='node.exe'`） |
| `GET /relays`（重启后） | `200`，`277325` bytes——与重启前逐字节 `diff` **完全一致** |
| `relayHealthMonitorTick` | `eligible=17 deadCount=0` |
| `relayHotwalletMonitorTick` | `checked=17 killed=0` |
| `events.hotwallet_relay_killed`（重启后） | `0`，与重启前一致 |
| kaspad 探针（重启后） | `daa=539551098`（只增不减） |

## ⑥ 结论

四线合并重启完成，全部按执行页 v0.1 走完，验收全绿。委员 offset 参考值 WARN 从上次偏移线重启的 4 行降为本次 0 行，直接证实 T-REF-OFFSETS-REFRESH 已生效（checked-in 参考值已刷新到 pinned-compiler 实际派生值）；RCE 热修上线后两条 `/api/system` 路由与既有两条密钥导出路由一样默认 503；17 个 relay 子进程、`GET /relays`、`events` 计数、kaspad 节点均未受本次改动影响。本次重启未写入任何新 env（三个 `ZK_*`、两个 key-export、`ADMIN_SECRET_SYSTEM_ACTIONS` 均保持 UNSET）。

原始日志留档：`console-mainnet-stdout-PID29872.log` / `console-mainnet-stderr-PID29872.log`（本目录内独立副本，已核实 zero 64-hex 序列）。DB 备份文件留存于 `C:\KANet-backups\`（非 git 路径），sha256 已记于 §③。
