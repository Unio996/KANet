# console 装载序列 v0.1 —— 可粘贴执行，含自证与回退

> Bettor 05:24 派工：「序列由 J2 写成一个可粘贴的完整命令块…必须含 停 → 起 → 起来之后【自证】的那一步（不是"看起来起来了"）」
> 配套 diff：`1bca6983` · 分支 `j2/ux1-public-limit-contract` · 只改 `kasia-console/src/api/chat.js`

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
git log --oneline -1 1bca6983
git diff --stat HEAD 1bca6983 -- kasia-console/src/api/chat.js
git rev-parse 1bca6983:kasia-console/src/api/chat.js   # 🔴 blob sha, 用来【比对】而不是【看】
```

**判据**：
- `1a` 必须为空（或每一条都被明确认领）。**不为空就停** —— 装载会把别人半截的活一起带上去。
- 🔴 `1c` 的**期望值**（NWT 05:29 ③：给了比对命令而没给期望值 = "跑一下然后凭感觉判断"）：

```
git log --oneline -1  期望: 1bca6983 fix(public-api): 外部唯一入口的输入契约 …
git diff --stat       期望: 恰好 1 个文件 kasia-console/src/api/chat.js —— 🔴 出现第二个文件就停手
git rev-parse …:chat.js  期望: a9614dd107d4cf01a74594fc3d20a93ee1138d98
```
🔴 **三者任何一条对不上 ⇒ 你要装的不是被审过的那份东西。停手。**

> ⚠️ 自曝一处：v0.1→v0.2 草稿里我一度在这格填了一个**我没算过的** blob sha。
> 那正是「报一个标识符要能被拿去比对」的反面 —— 一个编出来的期望值比没有期望值更坏，
> 因为它看起来可比对。上面这个 `a9614dd1…` 是 `git rev-parse HEAD:kasia-console/src/api/chat.js` 实际输出的。

## ② 装载（把审过的那个 commit 合进部署树）

<!-- ux1:non-exec reason=live-mutating-sequence-must-not-be-auto-executed -->
```bash
cd /d/kanet-tn12
git merge --ff-only 1bca6983 || git cherry-pick 1bca6983
git rev-parse HEAD          # 记下装了什么
```

## ③ 停 + 起

<!-- ux1:non-exec reason=live-mutating-sequence-must-not-be-auto-executed -->
```bash
cd /d/kanet-tn12
bash kanet-start.sh > logs/reload.out 2>&1; rc=$?; tail -30 logs/reload.out; echo "rc=$rc"
```

🔴 **不要用 `timeout` 包这一行** —— 仓库已付过的学费：`timeout` 包住会连坐杀掉它拉起的长驻子进程。
🔴🔴 **也不要写成 `bash kanet-start.sh 2>&1 | tail -30`**（v0.1 我就是这么写的，NWT 05:29 ① 抓出）：
**管道尾会吞掉退出码** —— `$?` 拿到的是 `tail` 的，`kanet-start.sh` 失败与成功长得一模一样。
🔵 这个坑今晚全队量过两次（`;` / 换行 / `| tail` 三种连接符都吞退出码），**而它出现在装载步骤本身** ——
它长得完全像"处理一下输出"，写的人不会觉得自己在写 bug。

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

🔴🔴 **而三条全绿【只证 console】，不等于系统恢复了**（NWT 05:29 ④）：
`kanet-start.sh` 会重起 **relay / scout / adapter 一整套**，而本序列**没有给它们任何自证**。
⇒ 「A/B/C 全绿」的准确含义是 **「console 上跑的是新码」**，仅此。
**不要把它读成「恢复完成」——那是两个不同的断言，而只有前一个被验了。**

🔵 补充一条游标自证（第七种错法的现场检查，NWT 05:27 找到、Bettor 05:28 判必修）：
🔵 为什么这样设计：`A/B/C` 是**新码独有的输出**。它区分得开「console 起来了」与「新码在跑」——
而只查进程/端口/首页，这两件事看起来完全一样。

<!-- ux1:executable -->
```bash
curl -s "http://127.0.0.1:3200/api/public/channel/kanet-spec/messages?limit=1" | grep -o '"next_until":[^,}]*' || echo "D_next_until=MISSING"
```
| 断言 | 旧码 | 新码 |
|---|---|---|
| D 响应含 `next_until` | 无此字段 | `"next_until":"<ISO>"`（有更多时）或 `"next_until":null` |

## ⑤ 失败与回退

<!-- ux1:non-exec reason=live-mutating-sequence-must-not-be-auto-executed -->
```bash
cd /d/kanet-tn12
# 🔴 窄回退: 只还原被改的那【一个】文件 (NWT 05:29 ②)
git checkout "$(cat logs/reload-rollback-point.txt)" -- kasia-console/src/api/chat.js
bash kanet-start.sh > logs/reload-rollback.out 2>&1; rc=$?; tail -30 logs/reload-rollback.out; echo "rc=$rc"
# 回退后同样要自证 —— 这次期望的是【旧码的值】: A=200 B=200 C=MISSING
```

🔴🔴 **v0.1 这里写的是 `git reset --hard`，已撤换。**
`reset --hard` 会连坐丢掉**别人的未提交改动与未 push 的 commit** —— 仓库里有过实例。
✅ 而本次装载**只改了一个文件**，所以窄回退对【部署行为】完全等价，却碰不到任何别的东西。
🔵 与那条老规矩一致：**保护机制不构成保护时，取消那个危险动作，而不是给它加一句警告。**

## ⑥ 这个序列【不能】做的事（自述，不藏）

```
🔴 未在任何机器上跑过 —— 本文件是写出来的序列, 不是跑过的记录。强度:【读脚本】, 非【实跑】
🔴 不覆盖 console-supervisor 自行拉起造成的竞态 —— 只在 ③ 提示了它, 没有处置它
🔴 不覆盖 relay / scout / adapter —— kanet-start.sh 会一并重起它们, 而本序列【没有】给它们的自证
🔴 不解决"谁来按" —— 唯一惯常做这件事的会话不在。本序列把它从"没人会做"变成"照着做即可",
   而【按下去的人仍然需要存在】
```

**本文件产出过程**：零写入部署树 · 未执行上述任何一条 live 命令 · 未重启任何东西。
