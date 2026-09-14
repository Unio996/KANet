# T-KEY-EXPORT 密钥导出锁定主网部署证据（2026-09-14 · KANet-UI · Bettor 1262 派工 · 按执行页 592218a7 执行）

> 执行范围：`coord/kanetui-key-export-lock` 合入主线（`4a0683c0`，Bettor `251dd592`），主网 console 重启验收。两个新 env（`ADMIN_SECRET_KEY_EXPORT`/`RELAY_KEY_EXPORT_ENABLED_UNTIL`）本次部署保持 UNSET，两条密钥导出路由部署后应从"无鉴权任意进程可读"变成默认不可用。

## 时间

`date -u` 实取：`2026-09-14T04:27:11Z`（重启后验证完成时点）。

## ① `git pull --ff-only`

共享检出 `git fetch` 后本地 HEAD 已经是 `251dd5921de73b77f2db96f34b444cdf670cfdce`，与 Bettor 1262 给出的目标一致，无需额外 pull。全仓 `node scripts/lint-kanet.mjs`：**957 文件，0 error**。

## ② env 核实（零改动）

```
grep -c "^ADMIN_SECRET_KEY_EXPORT\|^RELAY_KEY_EXPORT_ENABLED_UNTIL" kanet.mainnet.env  → 0
grep -c "^ZK_TOKEN_TMPL_HASH\|^ZK_CLAIM_TMPL_HASH\|^ZK_MARKET_SUFFIX_HASH" kanet.mainnet.env  → 0（延续既有 D-019 posture，未受影响）
grep -c "^SILVERC_V100_PATH" kanet.mainnet.env  → 1（既有值，未改动）
```
`kanet.mainnet.env` 本次**零改动**。

## ③ 重启前基线 + DB 备份

| 项 | 值 |
|---|---|
| 旧 PID | `25516`（D-019 部署后的 PID） |
| kaspad 探针 | `daa=539396205` |
| relay 子进程数 | `10` |
| `GET /relays` | `200`，`181222` bytes |

**DB 备份**：`better-sqlite3` WAL-aware `.backup()` 直接写到 `C:\KANet-backups\console.mainnet.db.pre-key-export-lock-backup`——落盘前用 `git rev-parse --is-inside-work-tree`（在 `C:\KANet-backups\` 内执行）核实该目录确认不是任何 git 工作树（返回 `fatal: not a git repository`，非 `true`/`false`，即压根不在任何 `.git` 树的搜索路径里）。
- SHA256：`D172EDEF163B91AB2A34DD49E25C58BAB3BEE1C749FBE4943E967963303BD72B`
- 大小：2,142,208 bytes

## ④ 重启动作

1. `Stop-Process -Id 25516` → 确认 PID 不存在。
2. `scripts/start-console-mainnet.ps1` → 新 PID **14884**，`127.0.0.1:3202` 监听确认。

## ⑤ 重启后验证

| 检查项 | 结果 |
|---|---|
| 监听 | `127.0.0.1:3202` under PID 14884 ✅ |
| pin 自检 | `grep -c '\[silverc-pin\] PASS'`=**1**，`FAIL`=**0** |
| FATAL / UNMET | 全量 stdout+stderr **0** 命中 |
| **`GET /relays/:id/mnemonic`**（真实 relay id） | **503** `{"error":"key export disabled (RELAY_KEY_EXPORT_ENABLED_UNTIL env 未设)"}` |
| **`GET /api/relay/:id/wallets/:walletId/privkey`** | **503** `{"error":"key export disabled (RELAY_KEY_EXPORT_ENABLED_UNTIL env 未设)"}` |
| 响应体含密钥物？ | **否**——两条响应体逐字如上，只有拒绝原因文本 |
| 日志含密钥物？ | **否**——全量 stdout+stderr 执行 `grep -Eo "[0-9a-f]{64}"` 零命中（连一个 64-hex 串都没有，遑论真实私钥/助记词）；`key-export` 相关日志行仅 2 条，均为本人测试两条路由时触发的 refuse 记录（`relay=df5f15d7`/`wallet=allet-id` 只是 id 尾 8 位，不含密钥） |
| relay 子进程数（重启后） | **10**（`Get-CimInstance` 核实） |
| `GET /relays`（重启后） | `200`，`181222` bytes，与重启前字节数完全一致，relay id 集合逐一比对一致 |
| `relayHealthMonitorTick` | `eligible=10 deadCount=0` |
| `relayHotwalletMonitorTick` | `checked=10 killed=0` |
| `relay_nodes`/`events.hotwallet_relay_killed` 计数 | `10`/`0`，均不变 |
| kaspad 探针（重启后） | `daa=539397404`（只增不减，节点未受重启影响） |

## ⑥ 结论

T-KEY-EXPORT 密钥导出锁定部署完成，六步全部按执行页 592218a7 走完，验收全绿：两条密钥导出路由从"无鉴权任意进程可读"变成默认 503 不可用，响应体与日志均不含任何密钥物，D-019 既有的 pin 自检/10 relay 健康状态/kaspad 节点均未受本次改动影响。本次部署未写入任何新 env（两个新 key-export env 与三个 `ZK_*` env 均保持 UNSET）。

原始日志留档：`console-mainnet-stdout-PID14884.log` / `console-mainnet-stderr-PID14884.log`（本目录内独立副本）。DB 备份文件留存于 `C:\KANet-backups\`（非 git 路径），sha256 已记于 §③。
