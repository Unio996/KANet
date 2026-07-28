> **Status**: CURRENT

# silverc OP_PICK off-by-one 修复 — 存档 patch 与自查

**为什么有这份**（2026-07-28）：这个修复此刻的**全部存在形式**是——
**一台机器上、一个未推本地分支上的一个 commit**。没有第二份。
NWT 指出「那棵树若被重 clone / reset / 丢分支，修复就没了，而**没有任何检查会发现它没了**」，
KANet-UI 实测坐实（零远端跟踪引用 · 一个本地分支 · 一个 commit）。Bettor 裁定：先存一份可比对的存档。

---

## 🔴 两者的角色 —— 不许混成两份真相源

| | 角色 | 说明 |
|---|---|---|
| `/d/silverscript` 本地分支 `j2-oppick-fix-2026-07-06` | **运行时真相** | 实际编译 covenant 用的就是它 |
| 本目录的 `.patch` | **可比对的存档** | 只用于「比对 / 还原」，**不是**编译源 |

🔴 **存了 patch【不等于】修复安全了。** 它把「丢了」从**不可发现**变成**可发现**，仅此而已。
🔵 而这条边界本身就是今天拆了一整天的那个病的反面：一个事实有两份副本时，必须写死哪份是权威。

---

## ✅ 自查（不是让你相信本文，是让你一秒推翻它）

```bash
# ① 我这棵 /d/silverscript 现在含不含这个修复？
git -C /d/silverscript log --oneline --all --grep="OP_PICK off-by-one"
#   有输出 = 含；空 = 🔴 没有了，去用本目录的 patch 还原

# ② 更硬的一条：当前 HEAD 上到底有没有应用它（不看 commit 在不在，看代码在不在）
git -C /d/silverscript apply --check --reverse \
  "D:/kanet-tn12/docs/evidence/silverc-oppick-fix/0001-Fix-OP_PICK-off-by-one-in-compile_byte_sequence_cast.patch"
#   退出 0 = 🔵 HEAD 上确实applied（因为反向能套上）；非 0 = 没应用 / 已漂移

# ③ 上游有没有？（回答"第三方拿到的是哪一版"）
git -C /d/silverscript branch -r --contains 8065184
#   🔴 空 = 上游没有 ⇒ 任何用 upstream silverc 的第三方仍带这个 bug
```

⚠️ **①② 问的不是同一件事**：① 问「这个 commit 在不在这棵树的历史里」，
② 问「HEAD 的代码里到底有没有这段改动」。**一个 commit 可以在历史里而不在 HEAD 上**（被 revert / 换分支）。

---

## ✅ 本次导出的验证（做过，不是声称）

```
① patch 的 diff 与 commit 8065184 的 diff ⇒ 逐字相同
② round-trip：对当前 HEAD 反向 apply --check ⇒ ✅ 通过（证明它与 HEAD 上已应用的改动一致）
🔵 ③ 对照臂：拿一个不相干的 patch（jepu1 探针那份）做同一条反向 apply --check ⇒ ❌ 失败
   ⇒ 两臂读数不同 ⇒ 这个检查有判别力，②的 ✅ 不是"这条命令总是通过"
```
⚠️ **首版对照臂是废的**：路径写成了相对路径，而 `git -C` 让它解析到另一棵树，
于是失败原因是"文件找不到"而非"套不上"——换绝对路径后才成立。记此以免后人照抄那条坏命令。

---

## 🔴 作用域（引用时必须带，否则就是错的）

```
「OP_PICK off-by-one codegen bug：在【本机 /d/silverscript 的一个未推本地分支】上已修（8065184）；
  🔴 而【截至我们最后一次 fetch，upstream 未修】—— 任何用 upstream silverc 生成 .sil 的第三方，
  这一族风险仍然存在。」
```
🔴 **单说"silverc 已修"一律无效。** 而这条直接压在路线图「别人能接上结算」那条主线上——外面的人调的是上游。
🔵 活体先例：`jepu1` 的 188 KAS（buggy codegen 已 baked 进链上不可变 redeem，修复不追溯）。

### 🔴 而"upstream 未修"这半句本身也有作用域（NWT 2026-07-28 抓出）

```
【实测·只读，故意未 fetch】本树 refs/remotes/origin/master ⇒ d25bd34（.git/FETCH_HEAD 时间: 07-06 16:13）
⇒ ⇒ 🔴 我们说的"upstream"，指的是【2026-07-06 那一刻的上游】，不是当前上游
🔴 而 J1 实测当前上游 master = bfc5a45「compile.rs refactor (#178)」——
   动的正是我们这个补丁所在的那个文件
⇒ 当前上游到底修没修 OP_PICK，【没有人查过】。三种可能各自给出不同结论：
   ①仍未修 ②refactor 顺手修了 ③refactor 换了实现、这个 bug 不再以同一形态存在
```
⚠️ **为什么本文不去 fetch 来消除这个未知**：D-005（silverc 研究全隔离）+ 此刻多方正在拿这棵树的 ref 做推理，
`fetch` 会把别人的读数变成历史。**要答这一格，应在一份独立检出上做，而不是动这棵树。**

### 🔴 这份 patch 能做什么、不能做什么

```
本 patch = 针对【d25bd34 那一版 compile.rs】的【1 文件 · 1 行删除】
🔴 而上游已 refactor 了同一个文件 ⇒ 它【很可能 apply 不上 bfc5a45】
✅ 它保住的是:【我们这棵树的可恢复性】
❌ 它【不】意味着:「我们随时能把这个修复带到新版上游」
   —— 后者需要在新码上【重新定位一次】那个 off-by-one，而那是一件独立的活
```

**要不要推上游 / 发 PR 给 `kaspanet/silverscript`** = 对外动作（以我们的名义向第三方项目提交）⇒ 归 Owner，不在本目录范围内。
