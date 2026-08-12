# 🔴 J2 · `state_start` 没有"权威描述符制品"——而且「claim 支传了」这个共享前提要修正

> **Status**: CURRENT · 2026-08-12T08:3xZ · J2
> **上游**: Codex 四件套判据（J1 判据表 `3b395e6c` §4）——**A** 要求 `state_start` 取自**权威描述符制品**、不是测试字面量；**Fix** 要求 builder/command 从**确切的 covenant/模板描述符**带上权威值。
> **本文件只有现读与推论，零落码。** 它决定 Fix 的形状，所以先报再动手。

---

## §1 结论（两条，第二条是对共享前提的修正）

**① 今天【不存在】任何 `state_start` 的权威描述符制品。** 生产里它只以**三个写死的字面量**存在：

| 位置 | 形态 |
|---|---|
| `kasia-console/src/lib/bshard-close-transport.mjs:407` | `payoutshard: { …, state_start: 1 }` ← **字面量** |
| `kasia-console/src/lib/pool-shard-settle.mjs:484` | `payoutshard: { …, state_start: 1 }` ← **字面量** |
| `kasia-relay/src/lib/p2sh.mjs:1550` | `const _POOL_STATE_START = 1;` ← **常量** |

`kasia-console/src/lib/bshard-close-enforce.mjs:68` 自己写着「**三处一致**」——那是一句**人工核对过的事实**，不是被机制绑住的不变量。
⇒ **判据要的「取自权威描述符」在今天【无源可取】**：生产自己用的就是字面量。

**② 🔴 「claim 支传了 / 退款支没传」这个说法要修正——两支【实际上都吃默认】。**
`p2sh.mjs:2736` 确实**读** `cmd.inputs.root.state_start ?? _POOL_STATE_START`，
**但没有任何 builder 往 root/pool 输入里放过这个字段**（现读，逐个）：

```
pool-claim-builder.mjs:97    root: { outpointTxid, redeem_hex, current_state }          ← 无 state_start
pool-close-builder.mjs:65    root: { outpointTxid, redeem_hex }                          ← 无
pool-refund-builder.mjs:88   pool: { outpointTxid, redeem_hex, current_state }           ← 无
```
```bash
grep -rn "pool: *{[^}]*state_start\|root: *{[^}]*state_start" kasia-console/src   # ⇒ 零命中
```

⇒ **claim 支与退款支的差别，只在【读不读那个字段】，不在【拿到的值】** ——
两边最终用的都是 `_POOL_STATE_START`（因为字段恒 `undefined`）。
🔨 **这条重要在哪**：它把 MUST-FIX 从「退款支漏传一个已有的权威值」**改成**「**那个权威值从来没被生产出来过**」。
前者是一行改动；后者要先回答「谁是权威、它以什么形式存在」。

---

## §2 这对四件套各件意味着什么

- **A（实码对照）**：`state_start` 若「取自权威描述符制品」= 今天取不到 ⇒ **要么先造出那个制品，要么 A 只能标注「取自生产现用的那个常量/字面量」并把这条限制写进读数**。（后者仍可做到"不是测试字面量"——从生产符号 import，而不是在测试里写 `1`。）
- **Fix**：不是「把已有值传下去」，而是 **①定义权威源 ②让 builder 从它取 ③relay 侧消费 ④新命令缺字段 fail-closed**。**①是新东西**，需要拍板：权威源放哪（模板描述符 / 从 redeem 结构解析 / 建表）。
- **B-1 / B-2**：不受影响，照跑（它们测的是"传错会不会被发现"与"差分是否可辨"，与权威源在哪无关）。

---

## §3 我不自决的那一格（请 @Bettor / @NWT 拍）

**权威源应当是哪一种？**（我三条都能做，代价不同，但这是**口径**不是工作量）
1. **从 redeem 结构解析**（最"自证"：`state_start` 本来就是 redeem 布局的性质，能从字节推出来）——代价：要写解析器，且解析器自己需要被验；
2. **模板描述符制品**（建一份 covenant 模板 → `{state_start, state_len, …}` 的数据，builder 查它）——代价：新增制品与其同步问题；
3. **维持现状 + 显式绑定**（三处字面量收敛成**一个导出常量**，builder 与 relay 都 import 它，并加"三处一致"的实测用例）——代价：仍是约定，但**约定第一次被机制绑住**（改一处即全体改，且用例会红）。

🔵 **我的倾向（不自拍）**：**先 3 后 1** —— 3 立刻消除"三处各写各的"这个真实风险且零新制品；1 是终态但它的解析器需要自己的红队。
⚠ **2 的隐患**：新增一份"描述符数据"会立刻产生**它与 redeem 真实布局漂移**的可能，而漂移**没有任何东西会报**——那正是本仓反复吃过的形状。

---

## §4 作用域

本文**不改任何码**，也不动 B-1/B-2 的执行（那两件我照判据继续）。
它只把 **Fix 的前提**摆出来：**在有人拍板"权威源是什么"之前，Fix 落不了码**——落了也只是把一个字面量搬个地方。
