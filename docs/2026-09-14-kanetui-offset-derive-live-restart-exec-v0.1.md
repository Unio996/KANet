> **Status: DRAFT · 只写不执行**

# 偏移派生线合主线主网 console 重启执行页 v0.1（2026-09-14 · KANet-UI · Bettor 1275 派工）

> 权威链：偏移派生线合主线 `d7d61fc0`（`coord/j2-offset-live-derive`，6 commits，head `a55ebdfb`；NWT 全线终审 GREEN `8144f071`；Codex HOLD 解除 `a55e19c7`）——用 D-019-pinned 派生替换 `bshard-close-enforce.mjs`/K-18 两处硬编码 offset。**本页任何一步都不执行**——执行门 = 本页 → Bettor 推 → 执行，同 D-019/T-KEY-EXPORT 两次部署执行页的执行门（`docs/2026-09-14-kanetui-d019-pin-deploy-exec-v0.1.md`、`docs/2026-09-14-kanetui-relay-key-export-route-lockdown-design-v0.1.md` 对应的部署执行页），本页按同一套模板产出，不重新设计机制。

## 0. 范围与背景

运行时生效需要重启一次主网 console（`warmupCommitteeOffsetCache` 在 `index.js` 启动期一次性调用，`deriveCommitteeCheckOffsets` 的派生缓存 module-level 常驻，代码合入本身不会让在跑进程自动切换到新逻辑）。当前主网 console PID `14884`（自 T-KEY-EXPORT 部署以来未漂移，本页执行前会重新核实）。

**本次重启窗口内，relay 子进程数预期基线是 16，不是 10**：主线测试基线/批1批2迁移（`docs/provenance/2026-09-14-kanetui-mainnet-migration-batch2-small/`，commit `f4f776b7`）已在本次重启之前完成——批1 10 行 + 批2 6 行 = 16 个 relay 子进程，这是 Bettor 1275 原话"10 个 relay.mjs 子进程"发出**之前**批2还没做时的数字，本页按 1277 的执行顺序（"先完成第 2 批并核实，再做偏移线重启"）改成 16，重启后 §5 验证项按 16 核对，不照抄 1275 原话的 10。

## 1. `git pull --ff-only`

拉到执行当天 `origin/bshard-m3-deploy` 的实际头（确认是 `d7d61fc0` 的后代——`git merge-base --is-ancestor d7d61fc0 HEAD` 应为真；执行当天该分支大概率已经比 `d7d61fc0` 更新，只要是它的后代就行，不锚定某个具体 commit，同 D-019 页当时"pull 到目标头"的写法）。`node scripts/lint-kanet.mjs`：0 errors。

## 2. env 核实（零改动）

同 D-019/T-KEY-EXPORT 两次部署一致的三条 `ZK_*` + 两条 key-export env，本次**继续保持 UNSET**，不因这次重启顺带打开：

```
grep -c "^ZK_TOKEN_TMPL_HASH\|^ZK_CLAIM_TMPL_HASH\|^ZK_MARKET_SUFFIX_HASH" kanet.mainnet.env   → 应为 0
grep -c "^ADMIN_SECRET_KEY_EXPORT\|^RELAY_KEY_EXPORT_ENABLED_UNTIL" kanet.mainnet.env           → 应为 0
grep -c "^RELAY_HOTWALLET_PER_RELAY_MAX_KAS\|^RELAY_HOTWALLET_TOTAL_MAX_KAS\|^RELAY_HOTWALLET_COLD_ADDRESSES" kanet.mainnet.env  → 应为 3（值核对：800/1000/两地址，不改）
grep -c "^SILVERC_V100_PATH" kanet.mainnet.env  → 应为 1（既有值，不改）
```

`kanet.mainnet.env` 本次预期**零改动**——这次重启只是让已合主线的代码生效，不是配置变更。

## 3. 重启前基线 + DB 备份

| 项 | 预期 |
|---|---|
| 旧 PID | `14884`（执行当天先重新核实这个 PID 没漂移，不能假设） |
| relay 子进程数（`Name='node.exe'`） | **16**（批1 10 + 批2 6，见 §0） |
| `GET /relays` | `200`，记录 bytes 数供重启后比对 |
| kaspad 探针 | `KASPAD_PROBE_URL=ws://127.0.0.1:17110 KASPAD_PROBE_NETWORK=mainnet node scripts/kaspad-rpc-probe.mjs --timeout-ms=8000`，记录 daa |
| `events.hotwallet_relay_killed` 计数 | 应为 `0`（批2验收基线，重启前后不应凭空增加） |

**DB 备份**：`better-sqlite3` WAL-aware `.backup()` 直接写到 `C:\KANet-backups\console.mainnet.db.pre-offset-derive-restart-backup`——落盘前用 `git rev-parse --is-inside-work-tree`（在 `C:\KANet-backups\` 内执行）核实该目录不是任何 git 工作树（应返回 `fatal: not a git repository`，非 `true`/`false`），同前两次部署方法。

## 4. 重启动作

1. `Stop-Process -Id <重新核实到的 PID>` → 确认 PID 不存在。
2. `scripts/start-console-mainnet.ps1` → 记录新 PID，确认 `127.0.0.1:3202` 监听。

## 5. 重启后验证

| 检查项 | 预期 |
|---|---|
| 监听 | `127.0.0.1:3202` under 新 PID |
| pin 自检 | `grep -c '\[silverc-pin\] PASS'`=**1**，`FAIL`=**0**（格式 `[silverc-pin] PASS sha256=<前8位hex>... golden=<contractName> ok`，见 `pool-bshard-artifacts.mjs`） |
| **committee-offset 预热** | 🔴 **纠正 Bettor 1275 原话的"4 键各 1 行成功"——查过 `committee-offset-derive.mjs` 源码，`warmupCommitteeOffsetCache()` 对成功的键完全不打日志（静默），只有失败才打**`[committee-offset-derive] WARMUP FAIL (label=..., isV2=...): <message>`**。真正该核的是：`grep -c 'WARMUP FAIL'` 应为 **0**（4 个键——2 个 label × {V1,V2} 各一次——全部静默 = 全部成功，日志零行反而是好消息，不是"没验到"）。 |
| 参考值不一致 WARN | `grep '\[committee-offset-derive\] WARN'`——**若出现，原文摘录进证据页**（`deriveCommitteeCheckOffsets` 内部：派生值与 checked-in 参考值不一致时打这条，不拒签只留痕，见源码注释；不应该无条件假设不出现，出现了要如实记而不是当噪音滤掉）。 |
| FATAL/UNMET | 全量 stdout+stderr **0** 命中 |
| 两条密钥导出路由 | 仍 **503**（`RELAY_KEY_EXPORT_ENABLED_UNTIL` 未设） |
| relay 子进程数 | **16**（不是 1275 原话的 10，见 §0） |
| `GET /relays` | `200`，bytes 与 §3 重启前一致，relay id 集合逐一比对一致 |
| `relayHealthMonitorTick` | `eligible=16 deadCount=0` |
| `relayHotwalletMonitorTick` | `checked=16 killed=0` |
| `events.hotwallet_relay_killed` | 与 §3 基线一致（不凭空增加） |
| kaspad 探针 | daa 只增不减，节点未受重启影响 |

## 6. 回滚

同 D-019/T-KEY-EXPORT 两次部署页：任一验证项异常 → 用 §3 的 DB 备份恢复 + 用旧 commit（`git checkout <重启前 HEAD>`）重启回滚，记录触发回滚的具体检查项与现象，不猜测原因就重启新版本再试一次。

## 7. 证据清单

- `docs/provenance/<日期>-kanetui-offset-derive-restart/README.md`：PID 变化、pin 自检、`WARMUP FAIL` 计数（应为 0）、`WARN` 原文（如有）、两条密钥路由 503、relay 子进程 16、`GET /relays` 前后一致、kaspad daa。
- 原始 `console-mainnet-stdout-PID<新PID>.log` / `console-mainnet-stderr-PID<新PID>.log` 独立副本（同批2起的证据惯例）。
- DB 备份路径 + sha256（不提交进 git，只记路径与哈希）。
- 证据以 new commit 提交，本地不推，交 Bettor 推；NWT 部署后核。
