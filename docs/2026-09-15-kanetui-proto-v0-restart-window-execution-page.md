> **Status**: CURRENT — 只写不执行，等 NWT 审后交 Owner 闸 1 批准。D-021 规矩：本页不写密钥值、不写余额、不写地址。Owner 授权/三道闸结构见 ledger (1453)；Owner 已知悉的原始授权见 (1373)。

# 执行页 A：原型 v0 重启窗 + 环境配置（Owner 闸 1）

对应 (1453) 三道闸的**闸 1**：设 `ADMIN_SECRET_FUNDS` + `PROTO_RELAY_ID`，**本次不设** `PROTO_DRIVER_ENABLED`（金丝雀开关留给闸 3 单独批），重启 console，验收读数确认合入的代码在主网环境里按预期跑（不涉及任何真实转账/广播）。

---

## 1. 重启前：生产检出依赖加载测试（规则 81 第 5 次事故教训，账本 1367/1369）

上一次 node_modules 部分损坏（其根因后来 NWT 自查确认是侧 worktree 用 junction 链接活 node_modules 后 `git worktree remove --force` 穿透递归删除，与本次重启无因果关系，但验证步骤本身要沿用）教训：**任何要重启承载真实资金的 console 之前，先证明生产检出的依赖是完整的**，不能等重启失败才发现。

- [ ] `cd kasia-console && npm ls --depth=0` → 0 UNMET DEPENDENCY
- [ ] `node -e "import('fastify').then(()=>console.log('OK')).catch(e=>{console.error('FAIL',e.message);process.exit(1)})"` → OK
- [ ] `node -e "import('avvio').then(()=>console.log('OK')).catch(e=>{console.error('FAIL',e.message);process.exit(1)})"` → OK（avvio 是上次事故里被删的那批之一，专门核一下）
- [ ] `cd .. && node scripts/check-worktree-junctions.mjs` → 0 cross-tree reparse points（重启前基线，重启不涉及 worktree 操作，但按规则 81(i) 留痕）
- [ ] `git status --short` → 干净（无游离改动）

## 2. 记录当前状态（重启前基线）

- [ ] 当前 console 进程 PID（`netstat -ano | grep ":3202"` 找监听 PID；`logs/mainnet/console-mainnet.pid` 文件内容；两个来源都记，历史上出现过不一致）
- [ ] 当前运行代码的 git HEAD（`git -C D:\kanet-tn12 log --oneline -1`）——(1452) 确认合并前运行的是旧代码，重启后应变为含 c019a933 的新 HEAD
- [ ] 当前 `kasia-console/src/db/migrate.js` 最新版本号（`grep -n "// ── v" kasia-console/src/db/migrate.js | tail -1`）——重启后主网库应新增 v207/v208 两条

## 3. `kanet.mainnet.env` 新增三行（已核实该文件在 `.gitignore` 第 17 行，改动不入库）

**只在这台机器的本地文件里加，不写进任何 commit/账本/聊天消息**：

1. `ADMIN_SECRET_FUNDS=<值>` —— 值由 **Owner 本机**生成并填入，本页只给生成命令：
   ```
   openssl rand -hex 32
   ```
   （32 字节随机 hex，同种子转账执行页 v0.7 §3a 用的同一套生成方式）
2. `PROTO_RELAY_ID=<proto-v0-funds 的 relay UUID>` —— UUID 本身不是 D-021 要挡的资金/持仓/地址信息（内部标识，与链上地址不可直接对应），可以查 (1375) 那条账本记录取值，或本地 `GET /relays` 页面按名称 `proto-v0-funds` 找。
3. `PROTO_DRIVER_ENABLED` —— **本次不设这一行**。这是金丝雀开关，属于闸 3（页 B），跟环境配置这一步分开，不能在这次重启里顺带打开。

**前置核对**（改 env 前，不改值只查是否存在，同 (1453) 的核法）：
- [ ] `kanet.mainnet.env` 里 `CONSOLE_ENCRYPTION_KEY`、`KASPA_NETWORK`、`PORT` 三项已存在（应为已存在，若缺失说明环境本身有问题，停下不继续）
- [ ] `ADMIN_SECRET_FUNDS`、`PROTO_RELAY_ID`、`PROTO_DRIVER_ENABLED` 三项当前均不存在（改前基线）
- [ ] `PROTO_MAX_BALANCE_KAS` 是代码常量（`kasia-console/src/lib/proto-relay-guard.mjs:17`，值 5），**不需要**在 env 里配置

## 4. 重启 console（:3202）

- 标准六步重启流程（同 (1324)/(1367) 先例）：NO-TX 检查（stdout 近期无 broadcast/submitTransaction/send_tx）→ 停旧 PID → 确认 relay.mjs 遗留 0、node.exe 归零、端口释放 → `start-console-mainnet.ps1` 起新进程 → 记新 PID。
- **v207/v208 迁移会在这次重启自动执行**（主网库此前从未跑过原型 v0 相关迁移，`proto_token_defs`/`proto_markets`/`proto_bets`/`proto_bet_intents`/`proto_claims` 五张表当前在主网库里**尚不存在**，重启即建表，五张表建好时应全部 0 行）。
- [ ] 迁移完成核对：stdout 里出现 `[migrate] v206: proto_token_defs/.../pragma 守卫幂等`、`[migrate] v207: proto_markets rebuilt...`、`[migrate] v208: proto_bets rebuilt...`/`proto_bet_intents rebuilt...` 四行
- [ ] 五张 proto 表行数：`SELECT COUNT(*) FROM proto_token_defs` 等五条 SELECT，均应为 0（迁移只建表不插数据；本页写作时种子转账、代币定义、市场创建均尚未发生）

## 5. 验收读数

### 5a. 沿用种子转账执行页 v0.7 §3b 七项（措辞按当次重启对象调整，逻辑不变）

- [ ] `[silverc-pin] PASS` 恰 1 行
- [ ] `WARMUP FAIL` 0 行
- [ ] 参考值 `WARN` 0 行
- [ ] 18 个 relay 全部 connected
- [ ] 7 条资金路由（清单同 `t-loopback-authz-funds-hotfix.test.mjs`）不带 header / 带错 header → **403**（已设 `ADMIN_SECRET_FUNDS`，若仍 503 = env 没生效，FAIL）
- [ ] 敏感路由（mnemonic/privkey，走 `checkKeyExportWindow`）→ 503；`/api/system/run`、`/api/system/download`（`ADMIN_SECRET_SYSTEM_ACTIONS` 未设）→ 503；`/skills/upload` → 404
- [ ] stderr 尾部零 `FATAL`

### 5b. 本次新增（原型 v0 相关，验证代码合入生效但驱动仍关闭）

- [ ] stdout 出现 `[proto] PROTO_RELAY_ID healthy: name=proto-v0-funds balance=0KAS — registering proto routes`（余额应为 0，proto-v0-funds 此时还没收到种子转账——闸 2 在闸 1 之后）
- [ ] stdout 出现 `[proto-driver] disabled`（`PROTO_DRIVER_ENABLED` 未设，驱动不启动，这是本次重启的预期终态）
- [ ] `GET /api/proto-markets` 返回 `200 {"ok":true,"markets":[]}`（proto 路由已注册，空列表——五张表刚建、0 行）
- [ ] `GET /api/tokens` 返回 `200 {"ok":true,"tokens":[]}`
- [ ] `POST /api/proto-markets/create`（任意占位 body 即可，不需要真实 tokenId）返回 **409** `{"ok":false,"error":"proto_driver_disabled",...}`——证明路由已注册、驱动闸生效，**不是** 404 route-not-found
- [ ] proto relay（proto-v0-funds）余额 < 5 KAS 启动断言通过（即 `[proto] PROTO_RELAY_ID healthy` 那行本身没有抛错退出，就是通过；对照 `assertProtoRelayHealthy()` 源码的 `PROTO_MAX_BALANCE_KAS` 检查）
- [ ] 五屏（`/tokens` `/tokens/create` `/proto-markets` `/proto-markets/create` `/proto-markets/:id`）均 200
- [ ] m0a-lint（`node scripts/lint-kanet.mjs` 对改动文件跑一遍）0 error；`[external-gateway] 未配置...不启动(fail-closed)` 这行照常出现且不是错误（既有 fail-closed 提示，非本次改动引入）

### 5c. NWT 部署后核

- [ ] NWT 独立复核本页 5a/5b 全部读数，回执号：______

## 6. 回滚步骤

若 5a/5b/5c 任一项未过：
1. 从 `kanet.mainnet.env` 删除本次新增的两行（`ADMIN_SECRET_FUNDS`、`PROTO_RELAY_ID`——若已加；`PROTO_DRIVER_ENABLED` 本次本就没加，无需删）。
2. 重启 console，确认资金路由恢复 503（回到"未设=禁用"的旧行为）、`GET /api/proto-markets` 恢复 404（回到未接线前的表现——注意：代码本身已合入，`PROTO_RELAY_ID` 一删，`assertProtoRelayHealthy()` 直接失败，proto 路由整组不注册，效果等同回滚）。
3. 五张 proto 表即使已建（迁移不可逆），留着即可——全 0 行的空表不构成风险，不需要额外清理。
4. 记录回滚原因，报 Bettor，不在没有诊断结论前重试。
