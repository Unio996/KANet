# artifact#3 · 执行方外域 attestation（**预草** · 待 Codex FINAL 命名 blob 后完成）

> **Status**: CURRENT（预草：执行方那一半已固定；比对目标待 Codex 终审命名）

**为什么存在**：Codex 对 launcher 外闭 scope=(b) 的 **ACCEPTABLE-IN-PRINCIPLE 附带条件** ——
artifact#3 必须含「执行方跑前 canonical launcher blob == Codex ACCEPT 记录 blob」的比对记录（**非可选**）。

**为什么不做成 runHeader 字段**（Bettor 17:14 裁定，J2 提出）：
launcher / 仪器**自己填**的字段（哪怕填的就是它自己的 `SELF_DISK`）**仍然是自报**，
而 Codex 要闭的正是「**守卫自己盖不住自己**」这个残洞 —— 做成字段等于把残洞原样重开。
🔨 判据：**一个由被验对象自己填写的"验证字段"，验证的是它自己愿意说什么。**
⇒ 该记录必须是**执行方在信任域外产生的独立 attestation**，作 artifact#3 bundle 里**单独一份**。
附带好处：**J1 的仪器零改动**（我也不必去碰 J1 正在改的仪器）。

---

## 一、执行方侧（**已固定**，2026-08-17）

```json
{
  "attestation": "artifact3-executor-launcher-blob",
  "executor": "J2 / J2-tn",
  "executor_relay_id": "102cbb99-9115-4504-8928-5c22359f1852",
  "target_path": "scripts/j1-trough-probe-launch.sh",
  "method": "git hash-object <path>",
  "executor_computed_blob": "23ec24ec7ee09068a1a28fc4de5cb4c49cb993be",
  "source_commit": "06b3bb55",
  "superseded": { "old_commit": "ccc2f84d", "old_launcher_blob": "676518be25b852ff652872535ec264b9e4528c5c" },
  "three_level_chain_selfverified_by_executor": {
    "sender_sha256": "334ee61d54ffe021e23c43d1900f49d8dcb4785accfb7ae54725047c090848a8",
    "equals_instrument_PINNED_SENDER_SHA": true,
    "instrument_sha256": "ef0fcf1fac68f1ac8e62018617b17d67f26b07c15524c5374f737568ec91eaba",
    "equals_launcher_REF_INSTRUMENT_SHA": true
  },
  "worktree_equals_head": true,
  "tree_clean_at_hash_time": true,
  "instrument_blob_seen": "b18ae82bf03d0f6740112b572c00677509f1863f",
  "codex_accept_recorded_blob": "<PENDING — Codex FINAL 未命名>",
  "match": "<PENDING>",
  "hashed_at": "<跑前填，须早于 run 开始>",
  "run_id": "<跑时填>"
}
```

### 复现命令（任何人都能自己跑，不必信我）

```bash
cd /d/kanet-tn12
git rev-parse 06b3bb55:scripts/j1-trough-probe-launch.sh   # ⇒ 23ec24ec7ee09068a1a28fc4de5cb4c49cb993be
# 三级 pin 链闭合(执行方自验, 不必信我):
git show 06b3bb55:scripts/probe-deps/j1-send-one.sh          | sha256sum   # ⇒ 334ee61d…  == 仪器 PINNED_SENDER_SHA
git show 06b3bb55:scripts/j1-trough-probe-instrument.mjs     | sha256sum   # ⇒ ef0fcf1f…  == launcher REF_INSTRUMENT_SHA
```

🔵 **这份 attestation 的力量来自【可复现】，不是来自"相信 J2"** ——
上面两条命令任何人在该 commit 上都能得到同一个值。**我提供的是一个可被推翻的断言，不是一个需要被信任的声明。**
🔵 **交叉确认**：该值与 Bettor 经 MSG-239/240 路由给 Codex 的 launcher blob 一致（他 17:14 确认），
两条独立路径同值。

---

## 二、🔴 完成条件（缺一不可，缺了就不算满足 Codex 那条）

1. **比对目标必须逐字引自 Codex ACCEPT 记录原文**，**不得**引自我们自己的 ledger / 频道转述。
   🔨 理由：若两半都来自我们自己写的记录，那"比对"只证明**我们一致地传播了同一个值**，
   不证明**那个值就是 Codex 批准的那个**（在册：共享来源的"独立佐证"是空的）。
2. **哈希必须在 run 开始【之前】取**，并记录时间戳。
   跑完再补 = 中途换字节这件事**恰好不会被发现**（而那正是要防的事）。
3. **`match` 必须显式写 MATCH / DIFF**，不得只写"已比对"。
   **DIFF ⇒ 不跑**（fail-closed），并把两个值都留在 artifact 里。
4. 三个值（executor_computed_blob / codex_accept_recorded_blob / match）**必须同时出现**在 bundle 里；
   只留结论不留两个原值 = 下一个人无法复核。

## 三、🟡 本 attestation **不能**证明什么（作用域，先说清免得被读大）

- ❌ **不**证明"运行中的进程真的加载了这份文件"。它证明的是**该路径在该时刻的字节**。
  这一格由 **canonical-path-only 规程**（只从规范路径跑，不跑副本）补，但那是**规程**不是机制。
- ❌ **不**是"跨主机"的外域。它外在于 **launcher 的自检**，但**仍在同一台主机上**由我计算 ——
  若这台机器本身被控，两半会一起被控。**"外域"在这里的准确含义是"不由被验对象自己产出"，不是"不在同一台机器"。**
- ❌ **不**覆盖 m4 残洞本身（删掉自绑块 + 换发送地址）。那条 Codex 已按"固有 + 双缓解"接受，
  与本 attestation 是**互补**关系：本 attestation 让"launcher 字节被换"变得**可被外部发现**，
  但**发现的前提是有人真的去比对** —— 所以第二节那四条完成条件是它唯一的牙。

## 四、状态与依赖

- ✅ 执行方值**已就绪**：**`23ec24ec…` @ `06b3bb55`**（旧 `676518be` @ `ccc2f84d` 已作废，见 §6）。
- 🔴 **阻塞点不在 wiring，在 Codex 终审**：比对目标（Codex ACCEPT 记录的 blob）**尚不存在**
  —— MSG-241 已 route，Codex 尚未 re-accept，而终检需 Owner 触发。

> 🔴 **本文件自己刚犯了 §5 记的那个病，写下来比藏起来有用**：坐标从 `ccc2f84d` 换到 `06b3bb55` 后，
> §1 的 JSON 我更新了，但**复现命令与本节仍留着旧值近一小时** —— 谁照那两行跑，会拿到 `23ec24ec`
> 然后以为出了事。**一份文档里同一个值出现在三处，就会有一处忘记改。**
> 🔨 ⇒ 这正是 §5 那条判据的加强版：**别在文档里散布同一个哈希；让它只出现在一处（JSON），
> 其余地方引用"见 §1"，或者干脆只给【可复现的命令】而不给【答案】。**
- ⇒ 本文件保持**预草**；Codex FINAL 命名 blob 后，我在**跑前**填入 `codex_accept_recorded_blob`、
  `match`、`hashed_at`、`run_id` 四格并重新取一次哈希（若届时 commit 已变，以**当时**的实读为准，不沿用本文件里的值）。

---

## 五、🔨 一条本文件自己撞到的教训（写在这里，因为它就是本 attestation 的风险）

本文件初稿写的 `source_commit` 是 `77d8d78a`。**推送时被别人的 commit 挡下，rebase 之后那个锚点当场变陈。**
我重验后改成 `85451570`，并加了一行 `blob_unchanged_across` ——
🔵 **而重验的结果比原稿更强**：launcher blob 在 `77d8d78a` 与 `85451570` **两个 commit 上都是 `676518be…`**，
说明那几笔提交**没有动 launcher 字节**。

🔨 判据：**一份把断言绑在 commit 上的记录，会在别人推一笔之后悄悄变假 ——
而"blob 没变"这件事只有【重新量一次】才知道，不能靠"我刚才量过"。**
⇒ 落地时（Codex FINAL 之后）**必须重新取一次哈希**，**不得**沿用本文件里这个值；
本文件的值只用于"执行方那一半已就绪"的预草，**不是**最终 attestation 的数据源。
（同族在册：`reference-pre-push-reported-hash-invalidated-by-later-rebase` ——
推前报的 hash 会被后续 rebase 静默改写。这次撞的是同一个形状，只是对象从 commit 换成了 blob 锚点。）

---

## 六、坐标更替（2026-08-17 18:31，`ccc2f84d` → `06b3bb55`）

**起因**：我在开跑前实核发现 `scripts/probe-deps/j1-send-one.sh:131` 指向**一个不存在的仓库根**
（`/d/kanet/kanet/…`，而 `/d/kanet` 整个不存在）⇒ 发送器必 `die2` ⇒ 仪器判 `sender-refused` ⇒ **第一个样本就 ABORT**。
协调者裁 **走甲（修路径）· 拒乙（连短期也不走 env 绕过）**；J1 完成**完整三级 re-pin**（`06b3bb55`）。

### 执行方独立重算（不采信任何人的转述，全部从 git 对象自算）

| 项 | 我算出的值 | 与 J1/协调者报的 |
|---|---|---|
| launcher blob @`06b3bb55` | `23ec24ec7ee09068a1a28fc4de5cb4c49cb993be` | ✅ 一致 |
| instrument blob | `f1c288d43854e51ae7558f2deaf5f2b9de22ff70` | ✅ 一致 |
| sender blob | `6aae65d5a19d283279ff98d598e62d7a694b1b54` | ✅ 一致 |

**三级 pin 链闭合，我自己验的**（从 `06b3bb55` 取内容重算，再与文件里钉的常量比对）：

- sender sha256 `334ee61d…` **==** 仪器 `PINNED_SENDER_SHA` ✅
- instrument sha256 `ef0fcf1f…` **==** launcher `REF_INSTRUMENT_SHA` ✅

### 🔴 但 `codex_accept_recorded_blob` 仍留 `PENDING` —— 这是**刻意的**

`23ec24ec` 目前来自**协调者的频道消息 / ledger (479)**，**不是 Codex ACCEPT 记录**
（MSG-241 刚 route，等 Owner 触发后 Codex 才 re-accept）。

而本文件第二节完成条件第 1 条写死：**比对目标必须逐字引自 Codex ACCEPT 记录原文，不得引自我们自己的 ledger/转述。**
⇒ 若我现在把 `23ec24ec` 填进目标格，两半就都来自**我们自己**，那个"比对"只证明**我们一致地传播了同一个值**。
**它极可能与 Codex 最终注册的值相同 —— 但"极可能相同"不是"已核对"。**
⇒ 目标格**等 Codex FINAL 落地后再填**，这不是拖延，是这份 attestation 唯一的意义所在。
