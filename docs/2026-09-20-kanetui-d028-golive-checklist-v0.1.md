# D-028 上线清单（3 步，合入后）
> **Status**: CURRENT ｜ 前提：Bettor 合入 D-028 实现 + NWT 无 MUST + Bettor GO + Owner 重启 GO。执行 KANet-UI，事后核 Bettor。D-021：金额/地址只进私有清单与口头回执，不入库。

**为什么先重启后登记**：`watch_accounts` 表由重启时的迁移 v211 创建，登记脚本要求表已存在；表空时页面不出冷存区块，无害。

**① 重启 console（标准六步，同 `docs/2026-09-15-kanetui-proto-v0-restart-window-execution-page.md` §4）**
1. NO-TX 检查：stdout 近期无 broadcast / submitTransaction / send_tx；记旧 PID（`netstat -ano | findstr :3202` 与 `logs/mainnet/console-mainnet.pid` 两处）。
2. `Stop-Process -Id <重新核实的旧 PID>` → 确认 relay.mjs 遗留 0、node.exe 归零、:3202 释放（提权/杀进程按既有规矩走 J1，不自行动手）。
3. `scripts/start-console-mainnet.ps1` 起新进程，记新 PID，确认 `127.0.0.1:3202` 监听。（重启会切断开发频道，按既有预授权顺序。）
4. 读数：stdout 恰 1 行 `[migrate] v211: watch_accounts 建表`；`SELECT COUNT(*) FROM watch_accounts` = 0；relay 子进程 18；`GET /api/portfolio/unified` 的 `agents.length`=18、`watchAccounts.length`=0、`totals.watchKas`=0。

**② 登记两行冷存（Bettor GO 后；这是对主网库的写）**
1. 仓库外建输入文件 `C:\Users\ADMIN\watch-input.txt`：两行 `名字<TAB>地址`，从 `docs-private/ASSET-INVENTORY.md` 抄；地址与名字**不放命令行**。
2. dry-run：`$env:DB_PATH='D:\kanet-tn12\kasia-console\data\console.mainnet.db'; node D:\kanet-tn12\kasia-console\scripts\watch-account-register.mjs --from-file C:\Users\ADMIN\watch-input.txt` → 预期 `mode=dry-run accepted=2 rejected=0`；`WARN`（本地地址语义列命中）只报 Bettor 判断，`REJECT` 任一 ⇒ 停手。
3. 同命令加 `--apply` → 预期 `applied=2`，随后**删除输入文件**。
4. 读数：`SELECT COUNT(*) FROM watch_accounts` = 2；`GET /api/watch-accounts`：2 条、`status:ok`（`unavailable` 则读 `reason`：`node_not_synced`=节点追块中，等；`no_positive_control`=热地址全 0，查热侧）；`GET /api/portfolio/unified`：`agents.length`=18、`watchAccounts.length`=2、`totals.kasAll = kas + watchKas`；`/portfolio` 页出现"冷存（只读）"区块两张卡 + 徽标"冷存 · 只读 · 不可花"、无任何操作按钮；console PID 与 ①-3 一致、relay 子进程仍 18。
5. 金额核对（A9）：Bettor 用本机节点独立只读查两地址，与页面比对，回执只写差值。

**③ 回滚**
- 只撤显示（最小、无重启）：`node -e "const D=require('D:/kanet-tn12/kasia-console/node_modules/better-sqlite3');const d=new D(process.env.DB_PATH);console.log(d.prepare('DELETE FROM watch_accounts').run().changes)"`（`DB_PATH` 同上）→ 页面不出冷存区块，其余不变；表可留。
- 撤代码：revert D-028 合入 + 按 ① 重启一次；空表遗留无害。
- 任一步与预期不符：停手、原样报 Bettor，不重试、不改脚本。
