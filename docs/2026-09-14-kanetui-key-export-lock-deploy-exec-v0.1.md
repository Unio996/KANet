# T-KEY-EXPORT 密钥导出锁定部署执行页 v0.1（2026-09-14 · KANet-UI · Bettor 1255 派工 · 只写不执行）

> **Status: DRAFT**。权威链：`docs/2026-09-14-kanetui-relay-key-export-route-lockdown-design-v0.1.md`（设计，NWT GREEN `80d0d62a`）+ commit `cb59e320`（落码，`coord/kanetui-key-export-lock`，Bettor 核过 worktree 内 9/9 PASS + `checkHotwalletAdmission` 行未动，NWT 审中待回填 `review_ref`）。**本页只写方案，不执行**——执行门：本页 → NWT 审 → 侧分支合入主线 → Bettor 一声令下 → 执行。结构同 D-019 部署执行页（`docs/2026-09-14-kanetui-d019-pin-deploy-exec-v0.1.md`），沿用已验证过的步骤形状，不重新发明。

## 0. 前置条件

1. **`coord/kanetui-key-export-lock` 的 NWT diff 审通过**——特别是 `scripts/m0a-exception-manifest.json` 里 `M0C2-relay-js-checkhotwalletadmission` 的 `content_digest` 增量更新（本人已更新为新值 `c11b90f0...`，`review_ref` 目前是占位 `pending-nwt-review-bettor-1252-key-export-lock`，需要 NWT 确认后回填真实 review_ref）。
2. **该侧分支合入主线**（Bettor 执行，不是本页范围）。
3. 以上两条未满足前，本页描述的任何步骤都不能执行。

## 1. 执行前必读

- **本次部署刻意维持"默认关闭"posture**——两个新 env（`ADMIN_SECRET_KEY_EXPORT`/`RELAY_KEY_EXPORT_ENABLED_UNTIL`）**均不设**，这不是"忘了配置"，是设计本身的默认态：两条密钥导出路由部署后应该立刻从"无鉴权任意进程可读"变成"跟其它 admin 端点一样，默认不可用"，不是从"不可用"变成"可用但更安全"。
- **上一次主网重启是 D-019 部署**（provenance `docs/provenance/2026-09-14-kanetui-d019-pin-deploy/`，PID 25516，本页写作时仍是当前 PID），本次部署是在那之上再做一次重启，两次部署之间 `SILVERC_V100_PATH`/pin 自检等既有状态不受影响，本页只关注本次新增的两个 env。

## 2. 步骤

### ① `git pull --ff-only`
共享检出模型，同 D-019 页惯例——执行时按实际 `git fetch`+`git rev-parse` 核实，不假设一定需要真的 pull。

### ② env：零改动，且两个新 env 均不设

`kanet.mainnet.env` **本次不新增任何一行**。执行前后各跑一次核实：
```
grep -c "^ADMIN_SECRET_KEY_EXPORT\|^RELAY_KEY_EXPORT_ENABLED_UNTIL" kanet.mainnet.env
```
应恰为 `0`——这是本次部署"确实保持默认关闭"这条前提的可核实证据，写进 §7 证据清单（同 D-019 页 §2② 的处理方式：不是记录"值是什么"，是记录"确实没写"）。

其余既有 env（`SILVERC_V100_PATH`/三个热钱包上限/三个 `ZK_*_TMPL_HASH`）本次不动，执行前 `grep` 一次留档，确认与 D-019 部署后的既有状态一致，不是本次改动范围。

### ③ 重启前基线 + DB 备份

| 项 | 本页写作时的已知值（执行时必须重新核实） |
|---|---|
| 旧 PID | `25516`（D-019 部署后的当前 PID，本页写作时核实） |
| relay 子进程数 | `10` |
| kaspad daa | 执行时重新探针 |
| `relay_nodes` mainnet 计数 | `10`（若第 2 批迁移在此之前执行，按实际数字记录，不套用本页数字） |
| `events.hotwallet_relay_killed` 计数 | `0` |
| `migrate.js` 当前版本 | `v205`（D-019 那次已应用，本次预期不涉及新 schema 迁移——T-KEY-EXPORT 不碰任何表结构，只读两个 env） |

**DB 备份**（🔴 规则 83 铁律，`C:\KANet-backups\`，**不是** `C:\KANet\backups\`——那个路径本身在一棵挂着真实 GitHub remote 的 git 工作树内，已经在 D-019 部署那次的事后修正里定案，本次直接用对的位置，不重蹈两次搬迁）：
1. `better-sqlite3` 的 WAL-aware `.backup()` API（同 D-019 那次手法，不用裸文件复制）直接写到 `C:\KANet-backups\console.mainnet.db.pre-key-export-lock-backup`。
2. sha256 记录在 provenance 页。
3. 执行前用 `git rev-parse --is-inside-work-tree`（在 `C:\KANet-backups\` 里跑）确认这个目录不是任何 git 工作树——不是"记得规则83"就够，每次落盘前实测一次。

### ④ 停旧起新
同既有惯例。

### ⑤ 重启后验证

- 监听 `127.0.0.1:3202` under 新 PID。
- **pin 自检仍应是 PASS 1 行**（`grep -c '\[silverc-pin\] PASS'`=1、`FAIL`=0）——本次部署不改 `SILVERC_V100_PATH`，这条应该保持 D-019 部署时验证过的既有行为，重新核一次是确认这次改动没有意外影响到无关子系统，不是重新设计这条判据。
- 🔴 **两条密钥导出路由默认关闭验证（本次部署的核心验证项）**：
  ```
  curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3202/relays/<任意已知relay-id>/mnemonic
  ```
  应返回 **503**（`ADMIN_SECRET_KEY_EXPORT`/`RELAY_KEY_EXPORT_ENABLED_UNTIL` 均未设，`checkKeyExportWindow()` 在两个 env 检查的第一层就会拒绝，具体是哪一层先触发不重要，只要求最终码是 503）。`GET /api/relay/:id/wallets/:walletId/privkey` 同理（需要一个已知 wallet id，若当前没有任何 `agent_wallets` 行，测 relay 不存在的 404 分支也能间接确认 `checkKeyExportWindow` 排在 `getRelayNode`/wallet 查询之前生效——但优先用真实存在的 id 测出 503，更直接）。
  **响应体本身不含密钥**（两条路由的拒绝分支只回 `{error: '...'}` 文本，不碰 `getRelayMnemonic`/`decrypt` 任何一行——读代码已确认，`checkKeyExportWindow` 前置校验在两处都是函数最开头，未通过直接 `return`，不会执行到读取/解密逻辑）。
- **日志无密钥物**：`console-mainnet-stdout.log`/`-stderr.log` 全文 grep 不应出现任何形如 64 hex 字符或 12/24 词助记词形状的字符串（可用简单正则 `[0-9a-f]{64}` 扫一遍，确认零命中，或至少确认命中的都是已知的公开哈希如 pin 自检那行的 sha256 前 8 位，不是完整 64 位私钥）——本次重启不涉及任何真实的密钥导出调用（②确认两个 env 未设），这一项预期是"本来就不会有"的确认，不是指望测出什么。
- 10 个 relay 子进程原样健康在跑（`Get-CimInstance`，同 D-019 部署验证手法）。
- `relayHealthMonitorTick`/`relayHotwalletMonitorTick` 正常（`eligible=10 deadCount=0`/`checked=10 killed=0`）。
- 无 `FATAL`/`UNMET`/`MODULE_NOT_FOUND`（≥65s 观察窗口）。
- `relay_nodes`/`events` 计数不变（对照③基线）。
- kaspad 探针未受影响（daa 只增不减）。

### ⑥ 回滚
两层：
- **轻**（本次部署本身不写任何新 env，理论上没有"配错值"这种回滚场景——若发现两条路由的拒绝逻辑本身有问题，回滚只需要 `git revert` 这几笔提交，没有 env 层面要撤销的东西）。
- **重**：`git revert`（不强推），重启 console。

### ⑦ 证据清单
落 `docs/provenance/<执行日期>-kanetui-key-export-lock-deploy/`：
- 旧/新 PID、③/⑤ 基线对照表。
- `stdout`/`stderr` 独立副本。
- 两个新 env 保持未设的证据（执行前后各一次 `grep -c`，均应为 0）。
- 两条路由的 503 响应实测记录（状态码+响应体，确认不含密钥）。
- DB 备份路径（`C:\KANet-backups\...`）+ sha256 + `git rev-parse --is-inside-work-tree` 确认非 git 树的记录。
- pin 自检 PASS 1 行核实（延续 D-019 验证，确认这次改动零影响）。

## 3. 与其它待办的关系

Rule 82（测试跑批安全闸，`coord/kanetui-test-rot`）与本次密钥导出锁部署互不阻塞，两个侧分支独立推进——本次部署完成后回去补完 rule 82 最后一条负向测试（显式 URL 指向监听中端口且批含 real_chain 的最高级 LOUD 场景，之前测到一半因工具超时被中断，尚未拿到完整确认输出）。
