# Gate E — 部署稳固化 Checklist / Runbook (公测开门前置)

**Status**: DRAFT by Bettor-tn 2026-06-15, 候团队 review。把本 session 反复 enforce 的跨节点部署纪律固化成开门 runbook。
**适用**: 任何 determinism-critical 码（settler / SS / committee / 投票）跨两节点（:3200 本机 + :3300 J1）部署。
**关联记忆**: `tn12-console-restart-procedure` · `cross-node-whole-repo-sync-not-cherry-pick` · `ship-triplet-commit-push-deploy` · `feedback-guan2-test-behavior-not-rendering`(committed≠live)。

---

## 0. 一句话铁律

**committed ≠ pushed ≠ deployed ≠ running ≠ 链上验证。** 5 态分清，每态独立证。报"已部署"必核**运行进程**拾的实际码，不是只看 git。

---

## 1. 部署前 (pre-deploy)

- [ ] **push 先行**: 部署的 commit 必 `git push origin <branch>` 先到 origin。`git rev-parse origin/<branch>` == 目标 sha。否则 peer 节点(:3300)拉不到 = 跨节点漂移根源。
- [ ] **lint 过**: `node scripts/lint-kanet.mjs <changed-files>` clean (pre-commit hook 强制)。
- [ ] **回归测过**: determinism-critical 改必有 regression 测且真路覆盖(非假绿)——读测断言是否真守命门(如 `relay_nodes WHERE id` 已消失断言)，非只看 PASS。
- [ ] **行为不变验**(改派生/查地址类): 新逻辑产出 == 旧逻辑产出 逐条核(如 pk-derive == 原 relay_nodes.address 403/403)。test/lint 抓不到 value 等价，必读真数据验。

## 2. 跨节点部署 (determinism-critical 码)

- [ ] **禁 cherry-pick**: 两节点必 `git fetch + FF/pull` 到**同一 commit sha**。独立 cherry-pick 产生不同 SHA、tree 不保证一致 = 漂移隐患。(实证: cherry-pick 把 1a670ad1→b5354587 改了 SHA。)
- [ ] **tree byte-equal**: 两节点 `git rev-parse HEAD^{tree}` 逐字节相同 = 真同源铁证。(非只比 HEAD sha——FF 后必比 tree。)
- [ ] **同时 live 才跨节点测**: determinism 修单节点部署无意义(一节点修一节点没修 = byte-equal 不成立)。两节点都 running 目标 sha 才能跑跨节点 e2e。

## 3. 重启 (restart)

- [ ] **tree-kill Console**: `taskkill //T //PID <console-pid>`——relay 是 Console 子进程，普通 kill 留 orphan/dup-sign 隐患。(记忆 `tn12-console-restart-procedure`。)
- [ ] **mainnet 隔离**: tn12 Console(D:/kanet-tn12) 与 mainnet Console(C:/kanet) 分开，别误杀。
- [ ] **kanet.env 持久**: 新 env key 必进 start.sh allowlist 否则丢。CONSOLE_ENCRYPTION_KEY 丢=所有加密数据不可恢复。
- [ ] **no dup-sign**: 重启后确认无重复 relay 进程(双签隐患)。pidfile ≠ ground truth——查实际进程。

## 4. 部署后验证 (committed≠deployed→验 running)

- [ ] **运行进程拾实际码**: 验 PID CreationDate 在 restart/FF 之后(`git FF ≠ restart`，running source = 进程内存非 working-tree)。两节点都核。
- [ ] **行为探针**: 实测打接口/查 DB 验新行为生效(非掐 git commit 时间戳)。如 settler bettor-addr 全 pk-derive 在 running tree。
- [ ] **链上验证**: 链上行为(settle/refund/claim)必 relay `check_utxo_landed` 走本地 kaspad——**用 tx 的 output 地址**(赢家 payout addr)非花掉的锁定地址(spine_p2sh)，否则假返 landed:false。别用挂掉的公链 API。

## 5. NO-TX-NO-STATE

- [ ] 广播/TX 没上链 = 什么都没发生，不推本地状态。try-catch 吞广播失败 = 乐观写入 = 致命 bug。
- [ ] settler 报 SETTLED ≠ 落链；初查 landed 常 false，等 ~18s 重查。

## 6. 880 广播墙 (大市场 settle 前置)

- [ ] 大 winner 市场 settle 拆 chunk(gate B #31)前，broadcaster relay UTXO 充足(consolidate cron 补)。
- [ ] 多 chunk sequential settle 中途失败 → resumable(读链上 change UTXO HWM 续，永不整笔重来)。
- [ ] 不 mid-broadcast merge relay UTXO(消费在飞 chunk UTXO 打断)。

---

## 7. 节点侧 (:3300 独立机器) — J1

- [ ] **跨节点 code-sync**: `git fresh-fetch origin`(别信本地 stale ref)→ **diff 目标 commit vs 当前**(确认只含预期改)→ `git merge --ff-only origin/<branch>` 到【与 :3200 EXACT 同一 commit】。**禁 :3300 独立 cherry-pick**(不同 sha=drift)。验 HEAD + **tree hash == :3200**(byte-equal)。
- [ ] **restart-safety = deadline age(zombie vs real)**: 仅【无真 settle 在飞】才 restart。deadline 数天前的 verifying = watchdog 重试的 zombie = 安全；近期 deadline 的 collecting_sigs = 真 settle = 等。
- [ ] **anti-split-brain restart SOP**: 先停 supervisor(⚠ Git-Bash kill 杀不动 Win 进程 → 必 PowerShell Stop-Process)+ 停 Console → 验两进程死 + port 空 → `nohup bash kanet-start-headless.sh` → 验 **单 Console**(count==1，防双 Console 抢 :3300/DB split-brain)+ supervisor==1 + monitor(生命线)alive + /health 200。
- [ ] **node_modules junction 坑**: 禁 `rm -Recurse` worktree/junction(删真 packages → boot crash)；用 `git worktree remove` / `cmd rmdir <link>`。

## 8. §880 / consolidate cron 部署 — J2

- [ ] **consolidate cron 活性验行为非 config**: design-v2 B maintainer(tick 180s/target 30)post-deploy 验 broadcaster `utxosBefore≥target`(行为探针)非看 index.js 配；cron 静默死 → 880 复发。
- [ ] **consolidate_utxo 命令 3-层注册全**: commands.mjs COMMAND_TYPES + SCHEMA + FIELD_TYPES 全注册(KANet-UI 撞过漏一层 → unknown reject)→ post-deploy 跑一次 consolidate 验真 work。
- [ ] **大 settle 前 broadcaster UTXO 预检**: gate B #31 chunk = N sequential sign_req → 验 broadcaster `utxosBefore≥N` 否则 broadcast-starvation(qr733 重演)；不够手动 /transfer 充。
- [ ] **kip9-mass/SOMPI_PER_MASS 单源 drift-guard 测 PASS**(防跨节点 fee fork → settle 漂)。
- [ ] **mid-broadcast merge 禁**(consolidate 不在大 sign_req 在飞时跑 → 消费在飞 chunk UTXO 打断)。

## 9. determinism 验证 — NWT

- [ ] **endpoint-liveness probe**: 验 NEW route/行为 live(probe → 非 404)非只看 PID restart(dee7bc9a 用 POST /withdraw→404 抓未部署)。
- [ ] **跨节点 OUTPUT byte-equal**: 两节点同 market 的 committee_pk_hash / settle TX 逐字节同 = **终极 determinism 验**(tree byte-equal 证同码；output byte-equal 证 deployed 码 PRODUCE 同果)。
- [ ] **value-equiv 声明必 empirical 验**(drift-guard 或 before/after，非凭信)。
- [ ] **禁 stale 码跑 post-deploy verify/test**(必 gate on confirmed-fresh running，否则 false-negative 误归给改动)。

## 10. operator 实操 — KANet-UI

- [ ] **tg-bot 单 poller 防 409**: 重启 bot 用 stop→(等旧 poller getUpdates 锁 ~30s 释放)→start；验 console.log `@<bot> up` + 0 个 409 + 单 `_launch_tg_bot` 进程(无 stray)。
- [ ] **faucet relay gas**: FaucetRelay-tn-2 余额监控；drain 大则 /transfer 补；per-IP/per-TG 限速防 drain。
- [ ] **log mtime 验真**: 报警/状态前核 log mtime 是不是当前进程写的(stale log 误导 → 本 session 2 天前 tg-bot.log 409 虚惊；Console-managed bot 走 console.log 非旧 standalone log)。
- [ ] **pidfile MSYS vs Windows pid**: supervisor pidfile 存 MSYS `$$` pid ≠ PowerShell Get-Process 的 Windows pid；验 supervisor 走 `kanet-console-supervisor.sh status` 非眼睛比对。

---

⚠ **真正"稳固"还差一次干净的两节点全栈部署演练**(开门前最后一关)。本 checklist = 4-agent 实战经验固化(Bettor 草稿 + J1/J2/NWT/KANet-UI 各域补)。
