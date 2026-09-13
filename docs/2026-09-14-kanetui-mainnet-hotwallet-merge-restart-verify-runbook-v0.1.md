# 主网热钱包准入门 合入+重启+验证 执行页 v0.2（2026-09-14 · KANet-UI · Bettor 1159 派工 · 只写不执行）

> **Status: DRAFT — 阻断，未满足前不得执行任何一步**。权威：Bettor 1159 派工，"现在可以先起草不推"。本页覆盖侧分支 `coord/kanetui-hotwallet-caps`（`a65c28dc`→`b483f1e4`，七笔，NWT 全部审过：`3ebd3c17`/`ffd3b8dd`/`ce220550` 三个 verdict 已回填对应 manifest/commit）合入主线 + 主网 console 重启部署 + 部署后验证的完整步骤。**§0 前置条件任何一项未满足，本页任何一步都不能开始**，这是 Bettor 1159 原话明确划的门，不是本页自己加的谨慎。
>
> **v0.2 变更（Bettor 1168：Owner 拍板"所有；已知账户都要导入！我们今后还有很多事情要做。"）**：§0 原来三项"待 Owner 确认"（800/1000 数值、冷清单含 MarketMaker-A）随 Owner 1168 一并解决——Owner 审过整套设计（含迁移 runbook §6.1 描述的"两大额导入但 relay 不启动"这条机制）没有要求调整数值或冷清单内容，视为对这两处的默许确认，§0 改写为三项新前置（Owner 已拍 1168 / Codex HOLD 解除 / NWT 2-1 v0.3 到位）。§1 取值表状态列从"⏳ 待确认"改为"✅ 定案"，数值本身不变（800/1000/两个大额地址均未变）。

## 0. 执行前置条件（阻断，缺一不动，v0.2 改写）

- [ ] **Owner 已按 1168 拍板**——"所有；已知账户都要导入！我们今后还有很多事情要做。"这条本身覆盖了原§0 三项里的"要不要导入两大额"这个问题；800/1000 两个数值、冷清单含 MarketMaker-A 这两处 Owner 审过整套设计（迁移 runbook §6.1"导入≠激活"）未要求调整，视为默许确认——**如果执行前发现 Owner 对 800/1000 或冷清单内容有新的明确异议，本条不成立，退回 v0.1 的三项分别确认**。
- [ ] Codex 复核解除 HOLD（执行前需要向 Bettor 确认这条状态）。
- [ ] **NWT 2-1 v0.3 到位**（本页写作时 NWT 2-1 规格最新版本是 v0.2——`docs/2026-09-14-nwt-mainnet-relay-hotwallet-cap-and-cold-hot-separation-spec-v0.2.md`，v0.3 是否存在/内容是什么，本页不知道，执行前需要向 Bettor 确认这条是否已满足，不能假设"v0.2 够用了就当作满足"）。
- [ ] 七笔 commit 全部 NWT diff 审 GREEN 且已推 `origin/coord/kanetui-hotwallet-caps`（`a65c28dc`/`6b739701`/`39ae30b1`/`45594804`/`40b7ca03`/`01a0f136`/`b483f1e4`——本页写作时前六笔已确认 GREEN 且推过，第七笔`b483f1e4`本页写作时尚未见到 Bettor 明确的 GREEN 确认，执行前需要单独核实这一笔也过了）。

## 1. 准入门三个 env 键取值表（v0.2：Owner 1168 已定案，非建议值）

| env 键 | 定案值 | 来源 | 状态 |
|---|---|---|---|
| `RELAY_HOTWALLET_COLD_ADDRESSES` | `kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l,kaspa:qqkulfjva2r20f3zj3hzs3hwh869zrezdz2rqm4nd9tfpdw2upsxqvkk6rhw4` | 第一个是 Trader-B（源库余额 20,301.71703562 KAS），第二个是 MarketMaker-A（源库余额 1,004.99573821 KAS）——两个地址本人在迁移 runbook 写作时独立查库+查链核实过（`docs/2026-09-14-kanetui-mainnet-account-migration-runbook-v0.1.md` §1.3/§5） | ✅ 定案（两者已改为"导入但不启动"，见迁移 runbook §6.1，不是"不导入"） |
| `RELAY_HOTWALLET_PER_RELAY_MAX_KAS` | `800` | NWT 2-1 v0.1 §3（覆盖 NWT 540.15、排除 MarketMaker-A 1,004.996 之间取值） | ✅ 定案（Owner 1168 未要求调整） |
| `RELAY_HOTWALLET_TOTAL_MAX_KAS` | `1000` | NWT 2-1 v0.1 §3（全部"可导入"账号加总最坏情况 ≈674 KAS 的预算上界，**这个预算上界的推导没有把两个大额账号算进去**——它们被冷清单+per-relay 上限独立挡住，不计入"总额"这个概念原本设计要覆盖的范围） | ✅ 定案（Owner 1168 未要求调整） |

不设 `HOTWALLET_MONITOR_OFF`（留空/不写这一行）——默认启用驻留期监控，这是 v0.2 规格的默认期望行为，不是本页新加的选择。

🔴 **这两个 cap env 一旦写进 `kanet.mainnet.env`，`relay-hotwallet-monitor.js` 的驻留期监控会跟着自动启用**（`startRelayHotwalletMonitorCron()` 内部逻辑：只在两个 cap 至少设一个时才起 tick）——这不是一个需要额外开关的独立决定，是 §1 这三行 env 生效的直接连带后果，执行时要清楚这一点，不是"先只开准入门、监控另说"。

## 2. 合入步骤

1. 确认 §0 全部勾选。
2. 确认侧分支七笔的最终状态（`git log --oneline coord/kanetui-hotwallet-caps` 跟本页写作时记录的七个 hash 逐一核对，防止执行时分支已经被别的改动追加过、本页描述的范围跟实际要合的范围对不上）。
3. 合入方式（本页给两种，具体用哪种是 Bettor 的选择，本页不代为决定）：
   - **Fast-forward**（如果 `bshard-m3-deploy` 自 `eec512f9` 以来没有平行改动跟这七笔冲突）：`git checkout bshard-m3-deploy && git merge --ff-only coord/kanetui-hotwallet-caps`。
   - **合并提交**（如果需要保留"这是一次完整功能合入"的历史边界）：`git merge --no-ff coord/kanetui-hotwallet-caps`。
4. 合入后，把 §1 表格的三行（用 Owner 最终确认的实际数值，不是本页的建议值）追加进 `kanet.mainnet.env`。**追加位置**：现有文件"保守起步"那一段（`POOL_SEEDER_ENABLED=0` 那几行）后面，新起一段标题 `# NWT 2-1 热钱包准入门+驻留期监控`，三行 env 各带一行来源注释（同现有文件其它段落的注释惯例）。
5. `node scripts/lint-kanet.mjs` 跑一遍全仓，确认合入后仍然 0 error（含 M0a 相关检查——合入后 manifest/baseline 状态需要在主线上重新验证一遍，不能只信侧分支上跑过的结果）。

## 3. 重启前探针（基线，执行当天重新跑，不能用本页写作时的旧读数）

- 当前主网 console PID（本页写作时核实为 `12404`，运行自 `2026-09-13 22:54:02`——**执行日必须重新读**：`Get-Content logs\mainnet\console-mainnet.pid`）。
- `KASPAD_PROBE_URL=ws://127.0.0.1:17110 KASPAD_PROBE_NETWORK=mainnet node scripts/kaspad-rpc-probe.mjs --timeout-ms=8000`——记录 daa/isSynced 基线，重启 console 不该影响 kaspad 本身，重启后要能对上。
- `SELECT COUNT(*) FROM relay_nodes WHERE network='mainnet'`（只读）——本页写作时应为 0（账号迁移尚未执行），重启前确认这个数字没有意外变化，如果不是 0 说明本页假设的前提已经不成立，先停下核实原因再继续。
- `SELECT COUNT(*) FROM events WHERE event_type='hotwallet_relay_killed'`（只读）——基线应为 0（新代码还没跑过），重启后如果这个数字在没有任何真实超限场景的情况下上涨，是异常信号。
- 同迁移 runbook §0 第 1 项同一条纪律：确认 `console.mainnet.db-shm`/`-wal` 没有意外的持有者（`C:\KANet` 下没有 node 进程在跑、没有 `:3100`/`:3200` 监听）——这条虽然是为迁移场景写的，但"执行前确认没有不知道是谁在碰这份 DB"这条纪律对本次重启同样适用。

## 4. 重启

1. 停：`Get-Process -Id (Get-Content logs\mainnet\console-mainnet.pid) | Stop-Process`（PowerShell，跟脚本自己的头注释里写的停止方式一致，不需要提权）。
2. 确认进程表里旧 PID 真的没了（`Get-Process -Id <旧PID> -ErrorAction SilentlyContinue` 应该返回空）。
3. 起：`powershell -File scripts\start-console-mainnet.ps1`（脚本自己读 `kanet.mainnet.env`，把值注入这一个进程的环境，起 `kasia-console/src/index.js`，重定向 stdout/stderr 到 `logs\mainnet\`，写新 PID 到 `logs\mainnet\console-mainnet.pid`——这些都是脚本已有行为，本页不需要额外操作）。

## 5. 重启后验证

- **stderr 65s 零 FATAL**（同 GO-D 系列验收惯例，`logs\mainnet\` 下新日志文件跑 65 秒读 stderr，确认没有致命错误行）。
- 日志里出现 `[relay-hotwallet-monitor] started — tick=...ms grace=90000ms max_consecutive_failures=3` 这一行——**如果没出现**，说明两个 cap env 没生效（§2 步骤4 没做对，或 env 文件语法有问题被静默漏读），执行必须停在这里核实，不能带着"监控没启动"的状态继续。
- 日志里**不**出现 `HOTWALLET_MONITOR_OFF=1 — 资金监控已手动关闭` 这条 LOUD 警告——如果出现了，说明这个 env 被意外设置了，需要先查是谁/为什么设的，不能假装没看见继续走后面的验证。
- kaspad 侧探针（`kaspad-rpc-probe.mjs`）重新跑一次，daa 应该比 §3 基线只增不减、isSynced 应该保持一致——确认重启 console 没有意外影响 kaspad 本身（历史上这两者本该独立，但每次重启都该实测确认，不是假设）。
- **两层准入实测**（同 GO-E 清单九步表 ⑦步的方法论——"证明这条路径确实存在、确实有效，不是纸上谈兵"）：需要至少一个已导入的 mainnet relay 账号才能做这个测试（本页写作时账号迁移尚未执行，relay_nodes 里没有可用的 mainnet 行）——**如果账号迁移还没做，这一条验证项本页先留空，等迁移 runbook 执行完、有真实账号可用时再补一轮实测**；如果届时已有账号，做法是：手动触发一次 `startRelay()`（通过既有 API 或 `POST /api/system/repair` 的 `restart_relay_<id>` 路径）打一个刚好超过 `RELAY_HOTWALLET_PER_RELAY_MAX_KAS` 或落在冷清单里的候选，确认真的拒绝、日志里出现 `hotwallet admission refuse ... cold_address_denied`/`per_relay_cap_exceeded` 这类行。

## 6. 回滚

- **轻回滚（不改代码，只改配置）**：三个 `RELAY_HOTWALLET_*` env 都遵循"未设=不启用该项检查"这条贯穿 v0.1/v0.2 全程的既有原则——如果重启后发现准入门/监控本身有问题（误杀/日志异常/性能问题），把 `kanet.mainnet.env` 里新加的那几行注释掉或删掉，重启 console，即可完全回到 `a65c28dc` 之前"没有热钱包准入门"的行为，**不需要 git revert，也不需要碰代码**。这是本页推荐的第一层回滚手段，因为风险最小、最快。
- **重回滚（代码需要撤）**：如果问题出在代码本身（比如某个判断逻辑真的错了，不是配置问题），走 `git revert`（对合入这七笔产生的那个 merge commit 或逐笔 revert，看合入方式是 ff 还是 `--no-ff`），不用 `git reset --hard`/强推——这七笔目前都在侧分支上，合入后如果需要撤，撤的是主线上新增的那部分历史，不影响侧分支自己的记录。
- 两种回滚都需要在执行后写一条到位到协调频道/COORD-LEDGER，说明触发原因（跟 relay-hotwallet-monitor.js 里 kill 动作本身"必须响亮告警"是同一条纪律，回滚这个动作本身也不能悄悄做）。

## 7. 未完成事项（本页故意留白）

- 🔴 **v0.2 更正**：原"§0 三项 Owner 确认"这条已被 Owner 1168 解决（见 v0.2 变更），撤下。§0 现在是三项新前置（Owner 已拍 1168 / Codex HOLD 解除 / NWT 2-1 v0.3 到位），后两项仍是留白，本页不能替 Bettor/Codex/NWT 确认。
- §5 两层准入实测——依赖账号迁移先执行完，本页只给方法论，留到那时候补。**v0.2 补充**：迁移 runbook v0.5 起账号迁移范围改为全部 19 行（含两大额），这条实测届时应该既能测到"正常账号被放行"，也能测到"两大额账号导入后确实被准入门拒绝"（迁移 runbook §6.2 第 4 批的验收标准），本页留到那时候一并补。
- 合入方式（fast-forward vs 合并提交）——本页给两个选项，最终选哪个是 Bettor 的决定。
- 第七笔 `b483f1e4` 的 NWT 审状态——本页写作时未确认，执行前需要单独核实。
