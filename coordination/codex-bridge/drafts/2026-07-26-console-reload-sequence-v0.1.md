# console 装载序列 v0.1 —— 可粘贴执行，含自证与回退

> Bettor 05:24 派工：「序列由 J2 写成一个可粘贴的完整命令块…必须含 停 → 起 → 起来之后【自证】的那一步（不是"看起来起来了"）」
> 配套 diff：`6fca38b8` · 分支 `j2/ux1-public-limit-contract` · 只改 `kasia-console/src/api/chat.js`

## 🔴 执行前必须知道的三件（不是提醒，是会让序列失败的事）

```
🔴 ① 跑这个序列会【杀掉 dev-coord-testnet 频道】——频道由 console 承载。
     ⇒ 中途【无法】发消息请示。必须一次性预授权，让它自己跑完。
🔴 ② 仓库里有一个 console-supervisor 看门狗（kanet-start.sh:58-62 明写它不归 start 管、
     跨越多次 console 重启）。它可能在你停掉 console 之后【自己把它拉起来】。
     ⇒ 若第 4 步发现端口又被占，先查是不是它拉起来的，而不是当成 EADDRINUSE 怪事。
🔴 ③ kanet-start.sh 会顺带停掉 logs/pids/*.pid 里【所有】进程并重起一整套。
     ⇒ 这不是"只重启 console"。若只想动 console，见下面的【最小形态】。
     🔴 而 kanet-stop.sh 更宽：它用 taskkill /F 强杀 + 清残留 node ——
        强杀会让 WAL 来不及 flush（仓库已付过学费）。本序列【不用】它。
```

## ① 装载前置检查（任何一条不过就停手，不要"应该没事"）

<!-- ux1:non-exec reason=live-mutating-sequence-must-not-be-auto-executed -->
```bash
cd /d/kanet-tn12

# 1a 🔴 有没有别人未提交的改动 —— 重启会把它们一起装上去
git status --porcelain

# 1b 🔴 记下回退点。没有这一行，出事时你只能靠记忆
git rev-parse HEAD | tee /d/kanet-tn12/logs/reload-rollback-point.txt

# 1c 确认要装的那个 commit 真在树里、且内容就是审过的那份
git log --oneline -1 6fca38b8
git diff --stat HEAD 6fca38b8 -- kasia-console/src/api/chat.js
```

**判据**：`1a` 必须为空（或每一条都被明确认领）。**不为空就停** —— 装载会把别人半截的活一起带上去。

## ② 装载（把审过的那个 commit 合进部署树）

<!-- ux1:non-exec reason=live-mutating-sequence-must-not-be-auto-executed -->
```bash
cd /d/kanet-tn12
git merge --ff-only 6fca38b8 || git cherry-pick 6fca38b8
git rev-parse HEAD          # 记下装了什么
```

## ③ 停 + 起

<!-- ux1:non-exec reason=live-mutating-sequence-must-not-be-auto-executed -->
```bash
cd /d/kanet-tn12
bash kanet-start.sh 2>&1 | tail -30
```

🔴 **不要用 `timeout` 包这一行** —— 仓库已付过的学费：`timeout` 包住会连坐杀掉它拉起的长驻子进程。

## ④ 自证 —— 🔴 这一步是整个序列的重点

**「进程在」「端口通」「首页 200」三条全绿，仍然可能是【旧码在跑】**（stale pidfile 让你以为重启了；EADDRINUSE 时旧进程根本没退，新进程静默失败）。
⇒ **自证必须断言一件【只有新码才做得到】的事。**

<!-- ux1:executable -->
```bash
curl -s -o /dev/null -w 'A_invalid_limit_expect_400=%{http_code}\n' "http://127.0.0.1:3200/api/public/channel/kanet-spec/messages?limit=abc"
curl -s -o /dev/null -w 'B_unknown_channel_expect_404=%{http_code}\n' "http://127.0.0.1:3200/api/public/channel/no-such-channel-xyz/messages?limit=1"
curl -s "http://127.0.0.1:3200/api/public/channel/kanet-spec/messages?limit=1" | grep -o '"max_limit":[0-9]*' || echo "C_max_limit=MISSING"
```

| 断言 | 旧码 | 新码（装载成功） |
|---|---|---|
| A `limit=abc` | `200` | **`400`** |
| B 频道名不存在 | `200` | **`404`** |
| C 响应含 `max_limit` | 无此字段 | **`"max_limit":200`** |

🔴 **三条里任何一条仍是旧码的值 ⇒ 装载【没有生效】，不要报"已上线"。**
🔵 为什么这样设计：`A/B/C` 是**新码独有的输出**。它区分得开「console 起来了」与「新码在跑」——
而只查进程/端口/首页，这两件事看起来完全一样。

## ⑤ 失败与回退

<!-- ux1:non-exec reason=live-mutating-sequence-must-not-be-auto-executed -->
```bash
cd /d/kanet-tn12
git reset --hard "$(cat logs/reload-rollback-point.txt)"
bash kanet-start.sh 2>&1 | tail -30
# 回退后同样要自证 —— 这次期望的是【旧码的值】: A=200 B=200 C=MISSING
```

🔴 **`git reset --hard` 会连坐丢掉所有本地未 push 的 commit** —— 所以 ①a 那一步不是形式。
⇒ 若 ①a 当时不为空而你仍然继续了，**这一步会把那些改动删掉**。

## ⑥ 这个序列【不能】做的事（自述，不藏）

```
🔴 未在任何机器上跑过 —— 本文件是写出来的序列, 不是跑过的记录。强度:【读脚本】, 非【实跑】
🔴 不覆盖 console-supervisor 自行拉起造成的竞态 —— 只在 ③ 提示了它, 没有处置它
🔴 不覆盖 relay / scout / adapter —— kanet-start.sh 会一并重起它们, 而本序列【没有】给它们的自证
🔴 不解决"谁来按" —— 唯一惯常做这件事的会话不在。本序列把它从"没人会做"变成"照着做即可",
   而【按下去的人仍然需要存在】
```

**本文件产出过程**：零写入部署树 · 未执行上述任何一条 live 命令 · 未重启任何东西。
