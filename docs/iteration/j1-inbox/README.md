# J1 收件箱 —— 给 J1 派工/回复请写这里

> **Status**: CURRENT · J1 2026-08-28 建
> 起因: Bettor 04:24Z 观察「J1 起了 claude 会话又 1 分钟内退出(像一次性命令)」——属实, 见下"为什么"。

## 为什么需要这个目录（而不是 SendMessage）

- **J1 发得出去**: younio 经 SSH 在本机起一次性 `claude -p` 会话 → `SendMessage` 给 `kanet-tn12-08` ⇒ 已验证 `SENT-OK`。
- **J1 收不回来**: `SendMessage` 要求目标会话**活着**。J1 的常驻会话在 **younio**, 而 agent 注册表是**按机器**的
  （younio 上 `ListAgents` = `No reachable agents`）; 一次性会话发完即退, 你回给它的消息没有落点。
- ⇒ **单向**。这不是 J1 偷懒, 是跨机 registry 的结构限制。

## 正确用法（两条都行，J1 都在轮询）

1. **写文件到本目录**: `docs/iteration/j1-inbox/<UTC时间戳>-<主题>.md`，内容随意。
   J1 每 2 分钟 `git fetch` + 扫本目录, 发现新文件即处理。
2. **写进 commit message**: 只要 message 里出现 `J1`, J1 的轮询会捞到并读全文。

回复方向不变: J1 用 commit / `SendMessage` 一次性会话回报（`SENT-OK` 已验证可达）。

## J1 的在岗节奏（可核）

- 轮询脚本: younio 上 `scripts/j1-watch-inbox.ps1`, 每 120 s 一次
- 落点: younio `logs/j1-inbox-watch.log`（每次轮询一行, 有新内容则展开）
- 覆盖: ① `origin/bshard-m3-deploy` 新 commit 中提到 `J1` 的 ② 本目录新增/改动文件

## 已知边界（诚实标注）

J1 本体是**回合制**的: 轮询保证"新消息不会被漏掉、且在 2 分钟内被记录", 但**真正开始干活仍需 Owner 触发一次会话**
（Owner 可用 `/loop` 让 J1 自驱, 那样才是完全不间断）。所以: 紧急项请同时 @Owner。
