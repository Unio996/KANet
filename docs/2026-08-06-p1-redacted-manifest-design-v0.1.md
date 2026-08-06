# P1 固化复现 A · 加固② — committed redacted manifest 设计稿 v0.1【DESIGN-ONLY·未落码】

> **Status**: **PARKED**(2026-08-06 07:23 @Bettor 改派 · Owner 直令 D-012 提速, A 加固 4 处整批 park)
> **park 理由(照记, 非我自判)**: P1 本就 BLOCKED 等 Owner typed 重建 ⇒ **关闭 Codex "结果可复现" caveat 不抢 D-012 的道**;**Owner 重开 P1 时恢复。**
> **park 时的完成度**: 设计稿写完、**未过审、未落码**。恢复时从 §9 那三个待审问题接着走。
> 原 Status: DRAFT · 待 NWT 红队 + Bettor 审 · **零代码改动 · 零链上 · 零 DB 写 · 无 money-path 授权含义**
> **作者**: J2 · 2026-08-06
> **上游**: Codex `f5979c3d` review 第②条(见 `docs/iteration/COORD-LEDGER.md` (140)BAk)
> **P1 状态不受本稿影响**: **P1 OPEN · D4 BLOCKED · 无授权**,一字未松。本稿只造**证据**,不造**授权**。

---

## §0 先说这份稿【不做】什么(防它被读成别的东西)

本稿造的是一个**只读的、可公开的证据文件**。它**不**:

- ❌ 不构成任何 refund 授权,也不是"这些钱该退"的证明——**该不该退**正是那张还没建起来的能力(Codex 第十三轮③原话:读成"该退的钱被卡住"会自然导向"批准放行")
- ❌ 不证明 predicate 对、不证明 108/17 的**分类**对、不证明链上状态
- ❌ 不解除 Codex 的部署禁令,不改任何生产代码

它**只**回答一个很窄的问题:

> **"你手上那份 cohort,和 Owner 卡上 1208.46 KAS 背后的那份,是不是【同一批行】?"**
> 以及 **"这批行的金额加起来,是不是真的等于报出去的那个数?"**

---

## §1 为什么需要它(Codex 的原话与它咬住的缺口)

固化复现 A(`4af9b2de` 三脚本)拿到的是 **"方法可复现"** 这半:别人能跑同样的脚本。
🔴 **拿不到的是 "结果可复现"**:另一个 reviewer **无法从 committed 内容复现 108/17 或 125/1208.46**——因为**数据在 gitignored 的 `scratch/`,只活在一台机器上**。

而"那就把数据也入库"这条路被堵死:每行含 `bettor_pk` / `side_p2sh` / `txid`,**origin 是公开仓库,入库即永久发布**,而是否发布行级数据是 **Owner 决策**(`p1_cohort_export.cjs` 文件尾已写死这条边界)。

**Codex 给的出路(本稿实现的就是它)**: committed **redacted** manifest —— 每行 salted/stable 标识 + 金额 + 分类 + Merkle/SHA-256 digest ⇒ **允许独立守恒 + 集合身份检查,而不发 bettor keys。**

🔵 `ffea89e8` 已经关掉了**更窄的一格**(把两份输入文件按 sha256 钉住,让人能判"我手上这份是不是那份")。**它不够**,因为:
- 它要求你**先有那份文件**——而没有那份文件的人正是需要复现的人;
- `p1_cohort_export.cjs` 用 `Date.now()` 判成员资格(`pm.deadline <= nowSec`)⇒ **后跑一次合法地得到不同的行**,sha256 对不上不代表谁错了。

---

## §2 输出物:`p1-manifest-<evaluated_at>.json`(committed)

### §2.1 顶层结构

```
{
  "manifest_version": "1",
  "kind": "p1-backlog-cohort-redacted",
  "pin":      { ... §3 ... },
  "leaf_schema": ["rid","sompi","cls","arm","auth"],   // ← 显式有序字段表, 且它本身进哈希(§4.3)
  "rows":     [ {rid,sompi,cls,arm,auth}, ... ],        // 按 rid 字典序升序
  "totals":   { ... §5 ... },
  "digest":   { ... §4 ... }
}
```

### §2.2 每行只带这五个字段,逐个说明为什么是它

| 字段 | 值 | 为什么带 | 为什么不泄密 |
|---|---|---|---|
| `rid` | `HMAC-SHA256(salt, "<market_id>\|<side_id>")` 前 16 字节 hex | 集合身份的锚;跨 manifest 稳定 | 不含原文;无 salt 不可反推(边界见 §6) |
| `sompi` | `stake_amount` 的**十进制整数字符串** | 守恒检查的唯一被加数 | 金额本身 Owner 卡上已公开 |
| `cls` | `p1_classify_dryrun` 输出的分类 | 108/17 拆分要能独立数 | 是我们自己的分类标签 |
| `arm` | `A` / `C` / `A_and_C` | 让人能分开核每一支(§3.4) | 同上 |
| `auth` | 授权标签,或字面量 `null` | **125/125 为 NULL 是整个 P1 结论的承重行**,必须可独立数 | 标签是白名单枚举,非机密 |

🔴 **明确排除,不进 manifest**: `bettor_pk` · `side_p2sh` · `side_lock_tx` · `claim_txid` · `refund_txid` · 任何地址 · 任何 64-hex · `deadline`(可与公开市场关联)· `market_id` 原文。

### §2.3 `side_id` 用的是主键,不是裸 rowid(已实核)

`p1_cohort_export.cjs` 选的是 `pbs.rowid AS side_rowid`。**裸 rowid 一般不稳**(VACUUM 可重排),那会让集合身份在一次维护后静默失效。
✅ **实查 DDL**:`pool_bettor_sides` 的 `id INTEGER PRIMARY KEY AUTOINCREMENT` ⇒ **`rowid` 是 `id` 的别名,VACUUM 不改它**。⇒ 可用,但 manifest 生成器**必须显式选 `pbs.id`**,不靠 `rowid` 这个别名恰好成立。

---

## §3 `pin` 块:Codex ② 点名"不 pin"的那四样

```
pin: {
  evaluated_at_unix,        // §3.1
  head_commit,              // §3.2
  predicate_source_commit,  // §3.2
  predicate_sha256,         // §3.2
  schema_sha256,            // §3.3
  table_row_counts,         // §3.3
  arm_b_omitted,            // §3.4
  arm_b_measured_rows       // §3.4
}
```

### §3.1 `evaluated_at_unix` — 成员资格是时间的函数
就是脚本里那个 `nowSec`(`pm.deadline <= nowSec`)。**不写它,两次导出的差异永远解释不清**——这正是 Codex 点名的那一格。

### §3.2 predicate 漂移可检测
- `head_commit` = 导出时的 `git rev-parse HEAD`
- `predicate_source_commit` = `git log -1 --format=%H -- kasia-console/src/services/pool-market-settler.js`(predicate 是从它 **誊写** 来的)
- `predicate_sha256` = 誊写进脚本的那段 SQL 谓词字符串本身的 sha256
🔵 **三个一起才有意义**: 前两个证"当时对着哪一版",第三个证"誊写的那份没被后来改动"。**只记 commit 不记 predicate 哈希,誊写与来源分叉了也看不出来。**

### §3.3 schema 用 DDL 哈希,**不**用 migrate 版本号,更**不**哈希整个 DB
- 🔴 **实查:本库没有 migration 版本表**(`schema_migrations` 不存在;`PRAGMA user_version` = 0;`migrate.js` 靠每次 `PRAGMA table_info` 自检)⇒ **"pin 一下 schema 版本"这个想当然的做法在本仓根本没有那个东西可 pin。**
- ✅ 替代:`schema_sha256` = `sqlite_master.sql` 中 `pool_markets` + `pool_bettor_sides` 两条 DDL 的 sha256。**它恰好覆盖 predicate 读到的全部列。**
- 🔴 **明确不做整库 digest**:`console.db` 是**活的 WAL 库**,①边算边变,哈希不稳定;②在活 WAL 库上做重读会引发争用(在册教训)。⇒ 用 `table_row_counts`(两表 COUNT)作**廉价变更探测器**,并**如实标注它是探测器不是快照证明**。

### §3.4 arm B 缺失,写进文件本身,并且**当场量**
Predicate 三支里 B 支来自 `_p1BacklogIds`(**只活在 settler 进程内存**)⇒ 离线不可重建。
- `arm_b_omitted: true` 恒写。
- `arm_b_measured_rows`: **本次生成时现测**,不从记忆/旧账搬。
- 🔴 **纪律**: 在册判据「**谓词里一支取不到 ≠ 整体取不到,各支分开数一次**」。以前测过一次是 0 行 —— **那是一次测量结果,不是一条不变量**;数据变了它就变。**manifest 里必须是这次的数,不是那次的数。**

---

## §4 digest:集合身份

### §4.1 leaf
```
leaf_i = SHA256( "p1leaf\x00" || canonical_json(row_i) )
```
`canonical_json` = **严格按 `leaf_schema` 的顺序**取字段、无空格、`null` 写字面 `null`、数字一律**字符串形式的十进制整数**(§5.1)。

### §4.2 root
- 叶子**按 `rid` 字典序升序**排序后建二叉 Merkle;层内奇数个时**末节点上提(promote)**,不复制(复制末节点=经典 CVE-2012-2459 同族歧义)。
- **root 的原像里带上叶子数**:
```
root_commit = SHA256( "p1root\x00" || uint64_be(leaf_count) || merkle_root )
```
🔵 **为什么带 count**: 不带的话,不同规模的树在特定构造下可撞;而且 `leaf_count` 是读者第一眼要核的数(125)。

### §4.3 🔴 leaf_schema 自身进哈希 —— 这条是防一个具体的在册故障
```
schema_commit = SHA256( "p1schema\x00" || leaf_schema.join(",") )
并且 schema_commit 是 root 计算的前缀输入之一。
```
**理由不是洁癖**: 在册教训 `feerules-hash-commit-unknown-field-collision` —— **canonicalize 把不认识的字段【剥掉】,于是两个不同的对象哈希出同一个值**。
⇒ 若哪天有人给行加了第六个字段而没改 `leaf_schema`,**默默剥掉 = 新旧 manifest 撞同一个 root**,而那正是"集合身份"这件事唯一不许出错的地方。
⇒ **加了字段没登记 ⇒ 必须 root 变(或直接拒),绝不许"看起来一样"。** 负 fixture 见 §7-⑤。

---

## §5 totals:守恒

```
totals: {
  leaf_count,                    // 期望 125
  sum_sompi,                     // 十进制整数字符串
  sum_kas_display,               // 仅显示用, 由 sum_sompi 派生, 不参与任何校验
  by_cls: { <cls>: {n, sum_sompi} },
  by_auth: { "null": n, ... }    // 期望 {"null":125}
}
```

### §5.1 🔴 金额全程 BigInt(= Codex ③,并进本稿,因为它必须在 manifest **之前**修)
- `stake_amount` 是 **sompi 整数**(`p1_cohort_export.cjs` 打印时才 `/1e8`)。
- 现状 `p1_classify_dryrun.cjs:319/333` 用 `Number(...)` 求和。
- 🔵 **诚实定价**: 当前量级(~1.2e11 sompi)**远在 `Number.MAX_SAFE_INTEGER`(9e15)之下,今天没有产生过错数** —— 我不把它说成"修了一个正在出错的 bug"。它是**随数据集增长而失效的写法**,而 manifest 一旦发布,**数字就被一个 digest 钉死了**,事后发现精度问题要连 root 一起作废。
- ⇒ **执行顺序硬约束:③ BigInt 先修并验数不变(108/847.01 · 17/361.45 · 合计 1208.46 逐位不变),再生成 manifest。** 反过来做等于给一个还会变的数盖章。
- `sum_kas_display` 由 `sum_sompi` 用整数除法+补零派生,**不用浮点**;且**任何校验都不读它**。

---

## §6 salt:能做到什么、做不到什么(这一节不许含糊)

- salt = 32 字节随机,**生成一次**,存 `scratch/`(gitignored),**不入库**。
- manifest 里**只**放 `salt_commitment = SHA256(salt)`。
- reviewer(Codex / NWT / Owner)拿到 salt **走 out-of-band**(bridge / 频道),即可从自己那份 DB 重算 `rid` 做集合身份比对。

🔴 **它保护什么(如实)**:
- ✅ 挡住"公开仓库里躺着一份可直接读的下注人清单"——**没有 salt 的读者拿 `rid` 什么也做不了**。
- ✅ 允许**内部 reviewer**在不传行级数据的前提下做集合身份检查。

🔴 **它【不】保护什么(必须一起写在 manifest 里,否则就是过度声明)**:
- ❌ **拿到 salt 的人 = 拿到全部映射能力**。`market_id` 空间小,持 salt 者可穷举反查。⇒ **salt 是【reviewer 凭据】,不是【对 reviewer 的隐私保证】。**
- ❌ `rid` 跨 manifest **故意稳定** ⇒ 发两份就泄露集合差分结构(哪些行进了、哪些出了)。**这是设计目的,不是缺陷,但读者有权知道。**
- ❌ manifest 证明不了行**存在于链上**,只证明它**存在于我们导出的那批里**。

---

## §7 负 fixture(全队硬规矩:只用好输入测过的闸,什么都没证明)

每条都必须是**不修就红**的。⚠ 第 ④ 条是**唯一一条"必须不变"**的臂——它才证明排序在干活。

| # | 注入 | 必须的反应 |
|---|---|---|
| ① | 改一位 `sompi` | root 变 **且** 守恒失配 |
| ② | 删一行 | root 变 · `leaf_count` 变 · Σ 变 |
| ③ | 同一行重复一次 | 去重闸拒(exit≠0);**Σ 两边等量膨胀 ⇒ 守恒检查抓不到它**,必须靠去重闸 |
| ④ | 打乱行顺序 | **root 不变**(canonical 排序生效) |
| ⑤ | 行里加第六个字段、不改 `leaf_schema` | **拒或 root 变** —— 绝不许静默相同(§4.3) |
| ⑥ | 同 salt · 同数据 · 另一台机器 | root **逐字符相同**(确定性臂) |
| ⑦ | 换 salt | `rid` 全变,而 `leaf_count` / Σ / `by_cls` **逐位不变**(证守恒与 salt 无关) |
| ⑧ | 空 cohort | **exit≠0**,不许打印 "0 rows / 0.00 KAS" 然后 exit 0(`64b1f7a4` 已确立的 D 类行为) |

🔵 ⑥ 与 ⑦ 是一对:**⑥ 证"同输入同输出",⑦ 证"⑥ 不是因为所有输入都给同一个输出"**。在册判据:重跑一致只证确定性,不证正确。

---

## §8 落地形态与边界

- 新文件 `kasia-console/test-framework/standalone/p1_manifest_build.cjs`(与既有三脚本同目录同风格:`KANET_ROOT` 解析路径、`readonly:true`、无写、无链、无签名)。
- `--selftest` 走 §7 全部八条,**驱动真实解析/哈希路径**,不手搓对象。
- 产物 `docs/evidence/p1-manifest-<evaluated_at>.json` **入库**(只含 §2 允许的字段)。
- ⚠ **入库前必须过的一道机械扫描**(不靠人眼):64-hex / bech32 / IP 形状 / 已知敏感词 **全 0** 才提交 —— 与哈希锚三 commit 同一套。

### 🔴 我做不了的那半(如实标)
- **Owner 决策不在本稿范围**: 本稿刻意选了"不发行级数据"这条路,**正因为发不发是 Owner 的**。若 Owner 决定直接公开行级 CSV,本稿的 §6 整节作废、§4 简化——**那是更简单的世界,不是本稿在争的**。
- **它关不掉 Codex 的 caveat 全部**: 关的是「另一个 reviewer 能否独立核守恒与集合身份」。**「他能否从 committed 内容重跑出 108/17 这个分类结果」仍然关不掉**——那要求他有行级数据或有我们的 DB。**本稿把 caveat 缩小,不是删除。** 我不打算把这句写小。

---

## §9 待审问题(给 NWT / Bettor,不是给终端)

1. `salt` 走什么通道给 reviewer?(Codex 走 bridge = 入 git 的 coord 分支 ⇒ **那等于 salt 入库,§6 第一条保护失效**。这是本稿最实的一个未决点,我倾向:salt 只给 NWT/Owner,Codex 侧改为**由 NWT 复算后背书**。)
2. manifest 是否要 Bettor relay 签名(复用 `coord-status-sign.mjs` 那套 blake2b + schnorr)?签了就有"谁发布的"这一格;不签则任何人可造一份同形状的。
3. `docs/evidence/` 这个目录名与位置要不要先定,避免又一份"同路径多份"被 doc-lint 拦。
