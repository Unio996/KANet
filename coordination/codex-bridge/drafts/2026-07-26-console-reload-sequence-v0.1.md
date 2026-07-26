# console 装载序列 v0.4 —— 🔴 第一步【已执行完毕】，本文剩下的是回退与第二步

> 🔴🔴 **2026-07-26 08:14 更新：装载已经发生，而它走的路径与 §①②【不同】。**
> 实际路径：树先被切到功能分支（08:02 查出）→ 发现少 19 个 commit（08:07）→
> **不切分支、直接把 `origin/bshard-m3-deploy` 那 19 条 merge 进来** → 重启一次（08:14）。
>
> **⇒ §①② 描述的是一次【没有发生过的】装载。保留它们只作为下次的模板，不许照它们核当前状态。**
> ⚠️ 而这正是本文自己警告过的那件事：**期望值过期 ⇒ 照它比对会得到"装错了"的假结论 ⇒ 假停手。**
> 本次它落在了本文自己头上。

## 🔵 当前真实状态（J2 08:16 独立实跑，非转述）

```
分支  nwt/external-gateway   🔴 内容对了, 而分支名还是功能分支(NWT 08:16 指出的结构口, 未闭合)
HEAD  679049ff (merge: p1=b696544a 网关线 · p2=05cca190 deploy 线)
      落后 origin/bshard-m3-deploy = 0  ·  领先 14
网关三文件(= 我复审过的那组, 一个字节没动):
  ccc0027d…  chat.js      0ff88bc8…  index.js      617347ba…  external-gateway.mjs
曾消失的三个文件(已回来, 用 hash-object 对值而不是"checkout 没报错"):
  3e2423c9…  repo-root.mjs   a9cef25c…  runtime-scope-dirs.mjs   2dfe1f25…  load-bearing-digest.mjs
```

---

# 附：原 v0.3 正文（下次装载的模板 · 🔴 期望值已过期，重用前必须全部重算）

## v0.3 标题 —— 双口版（三文件 · revert 回退 · 两步装载）

> v0.1 派工 Bettor 05:24 · v0.2 收 NWT 四条 · **v0.3 改为双口版**（NWT `b696544a`，J2 三轮复审通过）
> 🔴 **v0.3 与前版的判据本身不同，不只是换数字** —— 见 §① 与 §⑤。

## 🔴🔴 这一版装载是【两步】，而风险全在第二步

```
第一步 装码:  HOST/PORT 未配 ⇒ 网关返回 null, 一个端口都不监听
              ⇒ 🔵 系统行为【零变化】。装载本身几乎无风险
第二步 配置:  设 KANET_EXTERNAL_GATEWAY_HOST / _PORT + 再重启一次
              ⇒ 🔴 那一刻才【开始对外监听】。风险全在这一步
```
🔴 **J1 的跨机验收必须在【第二步之后】跑。** 第一步之后跑会全红 —— 而那是**正常的**（端口根本没监听），照样会有人去查一个没被启用的东西。
🔴 **本序列只覆盖第一步。第二步是一次独立的、需要单独授权的动作。**

## 🔴 执行前必须知道的四件

```
🔴 ① 跑这个序列会杀掉 dev-coord-testnet 频道 —— 中途无法请示, 必须一次性预授权
🔴 ② console-supervisor 看门狗不归 kanet-start.sh 管、跨重启存活(kanet-start.sh:58-62)
     ⇒ 端口又被占时先怀疑是它, 别当成 EADDRINUSE 怪事
🔴 ③ kanet-start.sh 重起【一整套】(console/relay/scout/adapter), 不是只动 console
     🔴 而 kanet-stop.sh 更宽: taskkill /F 强杀 ⇒ WAL 来不及 flush。本序列【不用】它
     🔴 且它的 CONSOLE_PORT 默认 3400 ≠ 实际 3200(J1 07:52 查出) ⇒ 又一个不用它的理由
🔴 ④ 本次带的是【4 个 commit】, 不是 1 个 —— 直接影响回退写法, 见 §⑤
```

## ① 装载前置检查（任何一条不过就停手）

<!-- ux1:non-exec reason=live-mutating-sequence-must-not-be-auto-executed -->
```bash
cd /d/kanet-tn12
git status --porcelain                                    # 1a 别人的未提交改动
git rev-parse HEAD | tee /d/kanet-tn12/logs/reload-rollback-point.txt   # 1b 回退点
git merge-base --is-ancestor 98456904 b696544a && echo ANCESTOR_OK      # 1c 无搭便车
git diff --name-only 98456904 b696544a                    # 1d 改动文件全集
for f in $(git diff --name-only 98456904 b696544a); do echo "$(git rev-parse b696544a:$f)  $f"; done  # 1e
```

**判据 —— 🔴 v0.3 的 `1d` 判据本身变了**：

```
1a  必须为空(或每条被明确认领)
1c  必须打印 ANCESTOR_OK  ⇒ 已部署版是本版的祖先, 差异集里没有别的东西搭便车
🔴 1d  期望【恰好这 3 个路径, 一个不多一个不少】—— 上一版是「恰好 1 个文件」, 那条判据【已作废】:
      kasia-console/src/api/chat.js
      kasia-console/src/index.js
      kasia-console/src/services/external-gateway.mjs
1e  期望逐字(三个都是 git rev-parse 现算的, 不是从文档抄的):
      ccc0027d1b73dfa22c3fc51f2a419d4121596db5  …/api/chat.js
      0ff88bc880122d795fad717088b07df2fd5bb6ef  …/index.js
      617347ba5d3145db0ca30e2d3b7600131a9b0b0a  …/services/external-gateway.mjs
```
🔴 **任何一条对不上 ⇒ 停手。** 而**过期的期望值两个方向都伤**：太松 ⇒ 装错了不喊；过期 ⇒ 装对了却喊停（**假停手**，而"停下来"永远看起来像谨慎）。

## ② 装载

<!-- ux1:non-exec reason=live-mutating-sequence-must-not-be-auto-executed -->
```bash
cd /d/kanet-tn12
git merge --ff-only b696544a || git cherry-pick 98456904..b696544a
git rev-parse HEAD
```

## ③ 停 + 起

<!-- ux1:non-exec reason=live-mutating-sequence-must-not-be-auto-executed -->
```bash
cd /d/kanet-tn12
bash kanet-start.sh > logs/reload.out 2>&1; rc=$?; tail -30 logs/reload.out; echo "rc=$rc"
```
🔴 不许 `| tail`（吞退出码）· 不许 `timeout` 包（连坐杀子进程）。

## ④ 自证 —— 断言【只有新码才做得到】的事

**第一步之后应当看到的**（🔴 注意：这一版的"成功"包含**没有新端口**）：

<!-- ux1:executable -->
```bash
curl -s -o /dev/null -w 'A_expect_400=%{http_code}\n' "http://127.0.0.1:3200/api/public/channel/kanet-spec/messages?limit=abc"
curl -s -o /dev/null -w 'B_expect_404=%{http_code}\n' "http://127.0.0.1:3200/api/public/channel/no-such-channel-xyz/messages?limit=1"
curl -s "http://127.0.0.1:3200/api/public/channel/kanet-spec/messages?limit=1" | grep -o '"next_until_id":[^,}]*'
grep -c "external-gateway" /d/kanet-tn12/logs/console.log
```

| 断言 | 期望 | 说明 |
|---|---|---|
| A `limit=abc` | `400` | 上一版修法仍在（搬运没弄坏它） |
| B 未知频道 | `404` | 同上 |
| C 含 `next_until_id` | 有 | 同上 |
| D 日志含 `external-gateway` | ≥1 | 🔴 它必须**说话** —— 未配置也要打一行 info |

🔴 **D 那条是这一版新加的重点**：模块被调用了但没配 env ⇒ 它**应当**打一行"没有配置就没有对外口"。
**日志里一行都没有 ⇒ 说明它根本没被执行到**（接线丢了 / import 失败被吞），而那与"正常未启用"长得一样。

🔴🔴 **而必须再核一件：不许有新端口**
<!-- ux1:non-exec reason=windows-only-and-inspects-live-listeners -->
```
netstat -ano -p TCP | grep LISTENING | grep -v '127.0.0.1'
⇒ 期望: 与装载前【相同】。第一步不该产生任何新的非回环监听口。
```
🔵 依据 NWT 07:56 实测立的判据：**验"某个口没开"，只有【去看监听表/去连它】算数，不能只读日志** ——
她那次日志明写"已关掉它"，而端口开着。

## ⑤ 回退 —— 🔴🔴 v0.4 重写：现在树上是一个【合并】，`-m` 用错会撤错半边

**✅ 当前真实的回退命令（Bettor 08:21 裁定，比下面那个 `-m 2` 好，理由见后）：**

<!-- ux1:non-exec reason=live-mutating-sequence-must-not-be-auto-executed -->
```bash
cd /d/kanet-tn12
git revert --no-commit 98456904..b696544a    # ✅ 这一段【不含 merge】⇒ 没有方向可选
```

**为什么它优于对 merge 做 `-m` 回退（两条都实跑核过）**：
```
【实跑】git rev-list --merges 98456904..b696544a ⇒ 0 ⇒ 纯线性 ⇒ 【没有 -m 可写反】
【实跑】两侧改动文件零交集(用【合并基 5b804ed0】算, 见下方警告):
        网关侧 3 个 · deploy 侧 21 个 · 交集 0
        ⇒ 撤销网关那 4 条的补丁, 碰不到 origin 那 19 条的文件
```
🔵 **⇒ 又一次同一个原理：不要去【正确地使用】一个有方向的危险操作，去用一个【没有方向可选】的。**
⚠️ 而这条依赖"零交集"。**它若哪天不成立，失败形态是【冲突】—— 吵闹的，不是静默的。** 方向安全。

> 🔴 **我算这个交集时先用错了一次方法，记在这里**：
> 我先跑 `git diff --name-only 98456904 05cca190`，得到交集含 `chat.js` ⇒ 差点报一个假冲突。
> 那条命令列的是**两边不同的文件**，其中包含**我自己改的**那些 —— 不是"deploy 侧改了什么"。
> ✅ 正确做法是从**合并基**算：`git diff --name-only $(git merge-base A B) B`。
> **⇒ 判据：问"对方改了什么"，基准必须是分岔点，不是我这一侧的当前状态。**

**为什么是 `-m 2`（实跑核过父序，不是凭印象）**：
```
【实跑】git log -1 --format='%p' 679049ff ⇒ b696544a 05cca190
   p1 = b696544a  ← 网关那条线
   p2 = 05cca190  ← origin/bshard-m3-deploy(那 19 条)

git revert -m 1 ⇒ 以 p1(网关线) 为主干 ⇒ 撤掉 p2 的贡献 ⇒ 🔴🔴 把刚补回来的【19 条又撤一次】
git revert -m 2 ⇒ 以 p2(deploy 线) 为主干 ⇒ 撤掉 p1 的贡献 ⇒ ✅ 只移除网关那 4 条
```
🔴 **⇒ `-m` 写反 = 原样复现我们 08:02–08:14 刚花半小时修的那次事故，而且是【故意执行一条回退命令】时发生的。**
🔵 而它没有任何提示会告诉你选错了 —— 两个方向都"成功"。

**⚠️ 回退后必须核的（不是"命令没报错"）**：
```
✅ 三个曾消失的文件仍在, hash-object 逐字 = 3e2423c9… / a9cef25c… / 2dfe1f25…
   🔴 若它们不见了 ⇒ 你用了 -m 1, 立刻停手
✅ external-gateway.mjs 【不存在】· chat.js 与 index.js = origin 上那版
✅ 重启后自证期望【旧码值】, 且日志里【不该】再有 external-gateway
```

---

### 🔴 以下是 v0.3 的原回退段，已被上面替代，保留只为说明它为什么不再适用

<!-- ux1:non-exec reason=superseded-kept-for-the-record -->
```bash
# ❌ 不要用: 树上已不是线性链, 这条会在 merge 上失败或行为不符预期
git revert --no-commit 98456904..HEAD
bash kanet-start.sh > logs/reload-rollback.out 2>&1; rc=$?; tail -30 logs/reload-rollback.out; echo "rc=$rc"
```

🔴 **为什么不能用上一版那种窄回退**：`external-gateway.mjs` 在 `98456904` 上**不存在** ⇒ `git checkout <base> -- <它>` 会**失败**；它的回退不是"取回旧版"，是**删除**。
✅ `git revert --no-commit` 对**增 / 改 / 删一视同仁**，不需要有人先把变更类型列全 —— 而"列全"是证不了的。

🔴 **而必须写成范围 `98456904..HEAD`，不是单个 commit**：本次带的是 **4 个** commit
（`55e15831` → `4f0673f9` → `5cf65aa0` → `b696544a`）。
**`git revert --no-commit b696544a` 只会撤掉最后一个** ⇒ 留下一个"网关在、而它最后那道收尾没了"的中间态 —— **比不回退更坏**。

**回退后同样跑 §④，而期望的是【旧码的值】**：A=400 · B=404 · C 有（这三条是**上一个已部署版**就有的）· **D=0**（网关模块已不存在 ⇒ 日志里不该再有它）。

## ⑥ 这个序列不能做的事（自述）

```
🔴 从未在任何机器上跑过 —— 强度【读脚本】, 非【实跑】。执行者是第一个跑它的人
🔴 只覆盖【第一步】。第二步(配 env 对外监听)不在本序列内, 需单独授权
🔴 只给 console 的自证 —— relay/scout/adapter 会被一并重起, 而本序列不验它们
   ⇒ §④ 全绿的准确含义是「console 上跑的是新码, 且没有开出新端口」, 不是「系统恢复了」
🔴 不解决"谁来按"
```

**本文件产出**：零写入部署树 · 未执行其中任何一条 live 命令 · 未重启任何东西。
