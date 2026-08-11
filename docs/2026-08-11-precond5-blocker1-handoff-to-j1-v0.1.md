# ⑤ blocker① 结构性遏制 · 落码交接单（J2 → J1）v0.1

> **Status**: CURRENT · 2026-08-11 · J2
> **派工**: @Bettor 17:3x 采 J2 提议 —— **⑤ blocker① 落码 = J1 主**（消除单人瓶颈）；J2 出交接材料并转为 ⑤ 的**独立复核臂**。
> **上游设计**: `docs/2026-08-10-precond5-blocker1-structural-containment-design-v0.1.md`
> （**v0.2 = `bd70357d`**，含 NWT 07:45 MUST-FIX 折入版。⚠ 派工里一度引 `500a246d` —— **那是另一份文档**（canary#2 第三层探针计划），已在频道更正。）
> **本文件零代码、零执行。** 它只回答一句话：**这件活还差什么，以及做坏了会长什么样。**

---

## §1 要闭的是什么（Codex ① 原文三个子要求，不转述）

> 「网络遏制**非结构性**：须**进程/套接字层拒绝出站**，或**全量重定向到带请求台账的本地假体**；**缺则 import 前即 fail**。」

路线已由 NWT 2026-08-10 07:07 裁定：走**后者**（重定向到本地假体），臂 (d) 的假 relay sink **算**合格假体。

---

## §2 现状盘点（J2 2026-08-11 现读，三格逐条）

| 子要求 | 状态 | 证据（file:line，现读） |
|---|---|---|
| **(A) 遏制是结构性的** | ✅ **已在库** | `cases/predictions/pool/p5_positive_via_fake_relay_sink.test.mjs:118` `process.env.RELAY_DIR = FIXTURE_DIR`。遏制点 = `src/services/relay-manager.js:19` 的**加载期 const** + `:91` `fork(..., {cwd: RELAY_DIR})` ⇒ **换掉的是出站进程的可执行文件本身**，不是"我记得把某个调用 mock 了" |
| **(B) 假体带请求台账** | ✅ **已在库** | `test-framework/fixtures/fake-relay-sink/src/relay.mjs:39` `appendFileSync(LOG_PATH, JSON.stringify(...) + '\n')` —— 逐条落盘，可回答"阴性臂零调用" |
| **(C) 缺遏制时 import 前 fail** | 🔴 **缺** | 全 `test-framework/` grep（`import 前` / `before import` / `fail.*RELAY_DIR` / `RELAY_DIR.*fail`）**零命中** |

⇒ **⑤ blocker① 的落码 ≈ 就是 (C) 一件。** (A)(B) 不需要重造，照抄现有落点即可。

---

## §3 两个陷阱（我踩明白了，写在这里省你重盘）

### 陷阱一 · 顺序 —— 库里已有活证据，不是理论
`p5_positive_via_fake_relay_sink.test.mjs:45-46` 自己标了 `skip_in_batch: true`，理由逐字：

> 「本用例在**模块加载期**改 `process.env`（`RELAY_DIR` 等），而 relay-manager 的 `RELAY_DIR` 是**加载期 const**：一旦本文件先加载，同一次 `--domain/--all` 运行里…」

🔴 **⇒ 遏制靠"谁先加载"这件事成立。顺序一变遏制就没了，而【没有任何东西会报错】** —— 出站会安安静静打到**真 relay**。
**(C) 要挡的正是这个。** `skip_in_batch: true` 是**症状不是解法**：它靠"别让它进批量"回避问题，而不是让问题变响。

### 陷阱二 · fallback 是**真目录**
`cases/m0c1-gate/g4-pilot-custodial-e2e.mjs:62-65` 记着：`RELAY_DIR` 没设 ⇒ relay-manager 落到**硬编码 fallback**。

🔴 **⇒ (C) 不能只判「env 设没设」，要判「当前生效的 `RELAY_DIR` 是不是假体」。**
判前者会被 fallback 骗过去 —— **env 未设时它不是"没有遏制"，是"遏制指向了真 relay"**，而这两者在"env 是否为空"这个检查下读数相同。

---

## §4 🔴 这件活特定的做坏方式（先知道为好）

**它是往测试框架的【加载期】加一道 fail-closed 闸。**

> **做错不表现为崩，表现为把 harness 变成假绿** —— 闸自己没生效，而所有用例照常绿。

⇒ **落码必须带一格自证：把闸摘掉，用例是否变红。**
拿不到"摘掉就红"，那道闸与不存在**在读数上同形**（在册：把被测缺陷重新注入一次，绿灯还变不变红）。

🔵 这与我刚落的 D2 用例里那格 `I0 仪器自检`同族：几条断言若都因同一个早退原因通过，它们会**一起绿而一条都没测到**。

---

## §5 我**没有**验的（如实列，别当我验过）

| # | 项 | 说明 |
|---|---|---|
| 1 | (C) 具体该落在哪个文件/哪个时机 | 我只确认它**不存在**，**没有**设计它的落点。runner 加载期 / case 加载期 / relay-manager 自身，三处各有取舍，归你判 |
| 2 | `fork` 之外是否还有别的出站族 | 设计稿 §1 量的是 **settler 侧**（`pool-market-settler.js` 11 处全是 `sendCommandAsync`，`fetch/RpcClient/https/axios` 计数 0）。**其它模块我没扫** |
| 3 | 假体台账的格式是否够 (C) 用 | 我只确认它**在写**，没核它写的字段够不够支撑"缺遏制"的判定 |
| 4 | `skip_in_batch: true` 拿掉之后会不会连锁 | (C) 到位后理论上可以拿掉它，**但我没试** |

---

## §6 交接判据（你我都按这个对，不各说各话）

**⑤ blocker① 算闭，当且仅当**：
1. **(C) 存在**且在**遏制缺失时 import 前就 fail**（不是运行到一半才发现）；
2. 该 fail **判的是"生效的 RELAY_DIR 是不是假体"**，不是"env 空不空"（陷阱二）；
3. 有一格**摘闸变红**的自证（§4）；
4. (A)(B) **不被削**（照 Codex 条件④ 同理：只加不减）。

📌 **我转为 ⑤ 的独立复核臂** —— 你落码后我**不看你的过程**，只按符号 grep origin 现读 + 跑一次摘闸自证。**谁落谁不审自己。**
