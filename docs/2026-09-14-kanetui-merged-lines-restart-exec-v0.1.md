> **Status: DRAFT · 只写不执行**

# 合并四线主网 console 重启执行页 v0.1（2026-09-14 · KANet-UI · Bettor 1308 派工）

> 权威：本次重启一次性带四条已合主线的独立线（其中一条截至本页撰写时仍在 NWT 审核队列，**执行前必须重新核实全部四条确已是 `bshard-m3-deploy` 头的祖先**，见 §1）：
> 1. **T-REF-OFFSETS-REFRESH**（`a5e5514d`，NWT GREEN `7d4afe4b`）——刷新 committee-offset checked-in 参考值到 pinned-compiler 实际派生值，消除偏移派生线重启（`docs/provenance/2026-09-14-kanetui-offset-derive-restart/`）里记录的那 4 条永久性 `[committee-offset-derive] WARN` 噪音。
> 2. **关市窄门 assertZkHandoffTmplCoherent**（`e49ee43e`，NWT GREEN `db0eb7ba`）——genesis①/② ZK template env-drift 窄门。
> 3. **宽度断言 T-CLOSEZK-ATMS-WIDTH + T-ANCHOR-XCHECK**（`03d8e403`，NWT GREEN `1de9e34a`）——six-byte width assertion + 四段模板 instance-binding 永久回归。
> 4. **T-SYSTEM-RUN-RCE 热修**（`coord/kanetui-system-run-hotfix` 分支 `c0ed69fa`+`8d8670ab`）——🔴 **本页撰写时尚未合并进 `bshard-m3-deploy`，仍在 NWT 优先审队列**，见 §1 执行前置检查第一项。

**本页任何一步都不执行**——执行门 = 本页 → NWT 审 → 四线全部确认已合主线 → Bettor 推/执行。

## 0. 范围

跟之前两次主网 console 重启（D-019/T-KEY-EXPORT/偏移派生线）同一套方法——运行时代码合入不会让在跑进程自动切换，需要重启一次。当前主网 console PID `18320`（自偏移派生线重启以来未变，本页执行前重新核实）。relay 基线**从批1+2+3的17开始**（本次重启前若批4已执行，需相应调整——本页撰写时批4尚未执行，按17记录，执行当天以实测为准）。

## 1. `git pull --ff-only` + 四线祖先关系核实（阻断条件）

```
git fetch origin
git log --oneline -1 origin/bshard-m3-deploy
# 逐条核实四线都是这个头的祖先：
git merge-base --is-ancestor a5e5514d origin/bshard-m3-deploy   # T-REF-OFFSETS-REFRESH
git merge-base --is-ancestor e49ee43e origin/bshard-m3-deploy   # 关市窄门
git merge-base --is-ancestor 03d8e403 origin/bshard-m3-deploy   # 宽度断言
git merge-base --is-ancestor c0ed69fa origin/bshard-m3-deploy   # RCE 热修 —— 🔴 执行当天若这条仍返回"不是祖先"，
                                                                  #   停止执行，四线必须一起进，不能带着未合的 RCE 修复重启
                                                                  #   （那样等于重启了但洞还在，且此次重启窗口本身White暴露在洞里）
```
全部四条 `is-ancestor` 都为真才能进 §2。`node scripts/lint-kanet.mjs`：0 errors。

## 2. env 核实（零改动，新增一项）

同 D-019/T-KEY-EXPORT/偏移派生线三次一致的检查，本次新增 RCE 热修引入的 `ADMIN_SECRET_SYSTEM_ACTIONS`：

```
grep -c "^ZK_TOKEN_TMPL_HASH\|^ZK_CLAIM_TMPL_HASH\|^ZK_MARKET_SUFFIX_HASH" kanet.mainnet.env   → 应为 0
grep -c "^ADMIN_SECRET_KEY_EXPORT\|^RELAY_KEY_EXPORT_ENABLED_UNTIL" kanet.mainnet.env          → 应为 0
grep -c "^ADMIN_SECRET_SYSTEM_ACTIONS" kanet.mainnet.env    → 应为 0（🔴 新增，本次重启保持 UNSET——
                                                                RCE 热修锁的两条 system-actions 路由默认关闭状态，
                                                                本次重启不顺带打开）
grep -c "^RELAY_HOTWALLET_PER_RELAY_MAX_KAS\|^RELAY_HOTWALLET_TOTAL_MAX_KAS\|^RELAY_HOTWALLET_COLD_ADDRESSES" kanet.mainnet.env  → 应为 3（值核对：800/1000/含两个冷地址，未变）
grep -c "^SILVERC_V100_PATH" kanet.mainnet.env  → 应为 1（既有值，未改动）
```
`kanet.mainnet.env` 本次预期**零改动**。

## 3. 重启前基线 + DB 备份

| 项 | 预期 |
|---|---|
| 旧 PID | `18320`（执行当天先重新核实这个 PID 没漂移） |
| relay 子进程数（`Name='node.exe'`） | 批1+2+3=17（若批4已在此之前执行，按批4结论仍应是17——批4设计上不产生新的存活relay，见批4执行页§0结论） |
| `GET /relays` | `200`，记录 bytes 数供重启后比对 |
| kaspad 探针 | 记录 daa |
| `events.hotwallet_relay_killed` 计数 | 记录基线，重启前后不应凭空增加 |

**DB 备份**：`better-sqlite3` WAL-aware `.backup()` 写到 `C:\KANet-backups\console.mainnet.db.pre-merged-4lines-restart-backup`——落盘前用 `git rev-parse --is-inside-work-tree` 核实非 git 工作树，同前三次方法。

## 4. 重启动作

1. `Stop-Process -Id <重新核实到的 PID>` → 确认不存在。
2. `scripts/start-console-mainnet.ps1` → 记录新 PID，确认 `127.0.0.1:3202` 监听。

## 5. 重启后验证

| 检查项 | 预期 | 备注 |
|---|---|---|
| 监听 | `127.0.0.1:3202` under 新 PID | |
| pin 自检 | `PASS`=1，`FAIL`=0 | |
| `WARMUP FAIL` | 0 行 | 同偏移线重启既有验证项 |
| 🔴 **committee-offset 参考值 WARN**（本次新预期，跟偏移线那次不同） | **应为 0 行**（`grep -c '\[committee-offset-derive\] WARN'`） | T-REF-OFFSETS-REFRESH 已刷新参考值消除这条永久噪音——上次偏移线重启出现的 4 行 WARN 这次不该再出现；**若仍出现，说明参考值刷新没有生效或参考值本身又漂移了，需要停下核查，不能当"预期内"忽略**（跟上次"出现是预期"正好反过来，读证据时不要套用上次的判据） |
| T-LEGACY-NULL-COLS | 0 行（主网 0 市场预期不变） | |
| FATAL/UNMET | 全量 0 命中 | |
| 密钥导出两路由 | 仍 503 | |
| 🔴 **system-actions 两路由**（本次新增，仅当 RCE 热修确认已合入时才有意义） | `POST /api/system/run`、`POST /api/system/download` 均 **503**（`ADMIN_SECRET_SYSTEM_ACTIONS` 未设） | |
| relay 子进程数 | 与 §3 基线一致（批4执行状态决定具体数字，执行当天核实） | |
| `GET /relays` | `200`，bytes 与 §3 一致，relay id 集合逐一比对一致 | |
| `relayHealthMonitorTick`/`relayHotwalletMonitorTick` | `eligible`/`checked` 与基线一致，`deadCount`/`killed` 归零 | |
| `events.hotwallet_relay_killed` | 与 §3 基线一致 | |
| kaspad 探针 | daa 只增不减 | |

## 6. 回滚

同前三次：任一验证项异常 → §3 的 DB 备份恢复 + 用旧 commit 重启回滚，记录触发回滚的具体检查项，不猜测原因就重启新版本再试。

## 7. 证据清单

`docs/provenance/<日期>-kanetui-merged-4lines-restart/README.md`：PID 变化、四线祖先关系核实的四条命令真实输出、pin/WARMUP/**参考值WARN(本次应为0)**/T-LEGACY-NULL-COLS、密钥导出路由503、**system-actions两路由503**、relay基线对照、GET /relays前后一致、kaspad daa。原始stdout/stderr独立副本。证据new commit，本地不推，交Bettor推；NWT部署后核。
