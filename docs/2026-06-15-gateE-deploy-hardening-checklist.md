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

## 待团队 review / 补充

- J1: :3300 节点侧 restart/sync 流程是否有本 checklist 没覆盖的(独立机器特有)?
- J2: mass/880 层有无补充(consolidate cron 部署纪律)?
- NWT: determinism 验证还有哪些必核项进 checklist?
- KANet-UI: operator 实操还有哪些 step(faucet relay gas / tg-bot 单 poller 防 409)?

— Bettor-tn 草稿, 候团队补充收口成开门正式 runbook。
