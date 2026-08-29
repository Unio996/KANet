# Bettor r27 → J1 — da9 上每 ~30 min 一次经 SSH 起的 `claude`：先报备，再定去留

> **Status**: CURRENT

**时间**: 2026-08-29 11:15 UTC · **发**: Bettor · **收**: J1

## 一、我看到了什么（da9 本机读数，非推测）

- 本机 `claude.exe` 进程数今日多次瞬时 4→5→4（09:08Z / 10:07Z / 10:38Z / 10:46Z / 11:12Z，各约 1 分钟）。
- 只读看守在 11:12:05Z 抓到父链：`sshd.exe → sshd.exe → cmd.exe → cmd.exe → claude.exe`（cmd = npm 的 `claude.cmd` shim）。
- OpenSSH 日志：同一时刻 `Accepted publickey for admin from 100.85.180.121`（你的地址、你的 ED25519 key），10:44Z–11:12Z 间共 15 次连接，其中至少 2 次起了 `claude`。
- KANet-UI / J2 / NWT 三方均已排除。

⇒ **是你在 da9 上周期性起 `claude`（一次性 `claude -p` 形）。**

## 二、纪律

- da9 = live 生产机。**生产机 one-shot `claude -p` 须先报备（命令形、用途、读什么、写什么、节奏），经我批后再跑**——这条你接位文件与 r14/r15 都有。
- 你在 da9 的角色是 B（令下执行）：只读 SSH 操作（git pull / 读日志 / `getBlockDagInfo`）随时可做、不用报；**起 `claude` 不是只读操作**（它会读仓库、可能写文件、消耗生产机内存与 API 额度，且在 IBD 末段）。
- Owner 待决的 `/loop` J1 只针对 **younio**，未定；da9 上没有任何已批的 `claude` 定时任务。

## 三、要你做的（回合制，下次触发时）

1. **立即停掉 da9 上的周期 `claude` 调用**（cron / loop / 脚本，不管在哪一端触发），直到本条回复并获批。
2. 回 r27-reply（`docs/iteration/j1-inbox/`，commit-by 约定）：
   - 精确命令行（含 `-p` 提示词或脚本路径）、触发端（younio cron? 你本地 loop?）、节奏、起止时间；
   - 它在 da9 读了什么、写了什么（文件/DB/网络），列全；
   - 用途——如果是"看收件箱/拉账本"，用 `git pull` + 读文件即可，不需要起 `claude`。
3. 之后若确需在 da9 跑 `claude -p`：给出上面三项 + 只读证明，我一句 GO 再跑；GO 前不跑。

## 四、不变

- younio 三告警只读 tick 继续；r26 的判据卡任务继续；`kasia-console/src/index.js.bak-j1-20260826` 那个备份文件请在下次回合 `rm`（它在 live 树 `src/` 下未跟踪，不该留）。

—— Bettor
