# D-012 格④ · §8-4「恒真墙」同族扫射 v0.1 —— 【DESIGN-ONLY·零生产码·零用例改动】

> **Status**: CURRENT
> **作者**: J2 · 2026-08-10 07:1xZ · 派工来源 @Bettor 07:07(排序第一项,时间表 `:17`「同族扫射(J2,半天)」)
> **本稿不改任何代码、任何用例、任何开关。** 全部读数为现读/现跑,逐条带 file:line。

---

## §0 扫的是什么族(先把判据钉死,否则扫成一锅粥)

§8-4 撞出的那堵墙(`docs/2026-08-07-pbs8-2-anchor-extraction-and-callsite-anchor-test-design-v0.1.md:41`):
> 「离线恒真: 唯一的『签名』动作离线根本调不通 ⇒ **闸正确与闸被删掉,读数都是『零签名』**」

🔨 **把它一般化成可机械套用的谓词**(这一步是本次扫射的主要产出,不是那两条个案):

> **一条「零/不存在」断言,若其量化的那个总体可以为空、或其判定可由环境单方面满足,
> 则它的绿【不携带关于被测闸的任何信息】。**
> 判据 = **问它旁边有没有一条「世界非空 / 机制确实存在」的伴随断言**;没有 ⇒ 同族。

🔵 **本仓已经有正面样板,不是没人想到过**: `predictions/dm-agent/dim6_race_05_taker_null_race.test.mjs`
三条零断言之后紧跟第四步 `row_assert: { c_min: 1 }`,注释逐字写着
「= the table is exercised, not just structurally tested」——**这正是 ⑤ 设计稿 §3.3 @Bettor 2026-08-06 硬要求的那条**。
⇒ **本族的解法在本仓已存在且已被用过一次;缺的是把它铺开,不是发明它。**

---

## §1 扫射范围与边界(coverage 是等号不是上界)

- **扫了**: `kasia-console/test-framework/cases/**` 全部 `db_row_count: 0` 断言 = **17 处 / 8 个文件**(现 grep)。
- **没扫**(如实列,别把本稿读成"用例里的恒真都清完了"):
  - `http_status_one_of` 这类**宽集合**断言的普查(§3 只顺手咬到一例,不是系统扫);
  - `should` 层未知断言键(在册: `should` 只 warn 不判失败 ⇒ 拼错的键等于没写);
  - 否定式 `row_assert`(`*_contains` 的反面)与"断言恒假"那一支;
  - `cases/m0c1-gate/` 那 10 个 **`--domain`/`--all` 根本扫不到**的文件(文件名不匹配 `*.test.mjs`)。
- 🔴 **⇒ 本稿覆盖的是【一个形状】,不是【一类问题】。**

---

## §2 扫射结果表(8 个文件 · 判据 = §0 那一条)

| 文件 | 零断言 | 伴随断言 | 判定 |
|---|---|---|---|
| `dim6_race_05_taker_null_race` | 3 | ✅ `c_min: 1` | 🔵 **正面样板** |
| `bettor_refund_bshard_guard` | 1 | ✅ 阳性臂(guard 对 bshard 必触发 / 对 v0.5 必不触发) | 🔵 干净(双向臂) |
| `p1_refund_authorization_gate` | 4 | ✅ 有 | 🔵 干净 |
| `dim5_fail_recovery_04_mempool_race` | 2 | ✅ 有 | 🔵 干净 |
| `dim6_race_02_chain_reorg` | 2 | ✅ 有 | 🔵 干净 |
| `dim6_race_04_protocol_version_migrate` | 2 | ✅ 有 | 🔵 干净 |
| `dim6_race_01_utxo_concurrent_spend` | 1 | 🟠 **只有机制存在证明,没有总体非空证明** | 🟠 见 §3.1 |
| `dim6_race_03_scout_outage_matched_to_completed` | 2 | ❌ 无 | 🔴 见 §3.2 |

---

## §3 两条个案

### 3.1 🟠 `dim6_race_01` —— 半防住,而防住的那半值得记

零断言 = `GROUP BY side_lock_tx HAVING c > 1` ⇒ 0 行。
✅ **它带了一条伴随断言,但方向是"机制存在"不是"总体非空"**:
`pragma_index_list('pool_bettor_sides')` 断言 `idx_pool_sides_side_lock_tx_unique` 存在且 `unique=1`。
⇒ **UNIQUE 索引被删掉会红** —— 这一半是实的,比纯零断言强。
🟠 **而没被覆盖的**: 若 `side_lock_tx` 全为空/表为空,零断言仍恒真。
🔵 **今日实测它不空**: `side_lock_tx` 非空行 = **36,012 / 36,012**(现查)。⇒ **今天不 vacuous,但那是数据给的,不是用例要的。**
🔨 **建议**(不落码,交 NWT 判): 补一条 `c_min: 1` 形态的总体非空断言,与 dim6_race_05 同款。**成本≈一步。**

### 3.2 🔴 `dim6_race_03` —— 断言与它自己写的目的**互相矛盾**,且默认打的是另一台机器

**(a) 它接受 404,而它自称验的是"这个杠杆存在"**
文件头逐字: 「validates the SCANNER CONTROL ENDPOINTS are **reachable** (= the lever to perform the test exists)」。
而两步 `http_post` 的断言是 `http_status_one_of: [200, 400, 404, 409]`。
🔴 **404 = 端点不存在。⇒ 「杠杆不存在」这个结果被写进了「通过」的集合里。**
⇒ 这是 §0 那个族的**纯粹形态**: 闸在与闸不在,读数相同。

**(b) 默认 URL 指向 `:3300`,而框架自己的默认是 `:3200`**
用例 `:6` `const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300'`;
而 `test-framework/lib/runner.mjs:18` 的默认是 `http://127.0.0.1:3200`。**两个默认不一致。**
🔴 **本机现测**(07:1xZ): `:3300` → **`000`(连不上,那是 J1 节点)** · `:3200` → **`200`**。
⇒ 在本机不设 `KANET_CONSOLE_URL` 跑它,**两步 http_post 打的是一台不存在的服务**,而 (a) 让它照样绿。

**(c) 两条零断言的总体今天不空,但很薄**
`pool_settle_consensual_dispatched` 事件今日 = **13 条**(现查 `console.db`)。
⇒ 孤儿检查今天有东西可查;但**总体薄到 13**,且结算已停摆多日 ⇒ **它随时会变成 0,而变成 0 那天读数不变。**

---

## §4 🔴 扫射顺带撞出的一件比上面两条都重的事(不在派工范围内,但不报不行)

`test-framework/lib/runner.mjs:19-20`:
```js
const DB_PATH = process.env.KANET_DB_PATH
  || path.join(..., '../../data/console.db');
```
⇒ **默认库 = `data/console.db` = 生产库本体(现 12.9 GB)**,不是某个 test 库。
(⑤ 设计稿 §7 里那句「`test-console.db` `pool_markets`=0 行」——**那个文件今天在 `kasia-console/data/` 下不存在**,现 `ls` 只有 `console.db` 与 `console-recovery.db`。)

🔴 **这把 §2 表里所有「🔵 干净」的判定都加了一个前提**: 这些不变式用例断言的是
**生产库此刻的历史数据**,不是被测代码的行为。
⇒ 在册: `reference-test-db-never-reset-measures-history-not-code` —— 而这次是更强的一档:**它就是生产库**。
🔵 **公道地说**: 部分用例(如 `bettor_refund_bshard_guard`)自带 fixture + 前清 + teardown,自控总体,不吃这个前提;
上面那句只对**读全表不变式**的那几个成立(dim6 系列)。
⚠ **我没有测**: 这些用例里的 `exec_sql` 是否曾对生产库写过什么。**没测就不说**,但这条值得单独派一次核。

---

## §5 我建议的下一步(不自决,交 @Bettor 排 / @NWT 判)

1. **§3.2 (a)** 从 `http_status_one_of` 里**去掉 404**(它与该用例自述目的直接冲突)。**一行,但是改用例 ⇒ 走审。**
2. **§3.2 (b)** 默认 URL 对齐 `runner.mjs:18`,或干脆删掉用例内默认、强制由框架注入。
3. **§3.1 / §3.2 (c)** 各补一条 `c_min` 形态的总体非空断言(dim6_race_05 同款)。
4. **§4** 单独立卡:测试默认库 = 生产库,值不值得改、以及有没有用例真写过它。**这条我建议不并进 ④,它比 ④ 大。**

## §6 证据层级自标

| 陈述 | 层级 |
|---|---|
| 17 处零断言 / 8 文件的分布 | ✅ `[CONFIRMED·现 grep]` |
| dim6_race_03 接受 404 且自述目的是"验杠杆存在" | ✅ `[CONFIRMED·现读]` |
| `:3300`→000 / `:3200`→200 | ✅ `[CONFIRMED·07:1xZ 现测]` |
| runner 默认库 = `data/console.db`(12.9GB) | ✅ `[CONFIRMED·现读 `:19-20` + `ls`]` |
| 36,012/36,012 `side_lock_tx` 非空 · 13 条 settle 事件 | ✅ `[CONFIRMED·现查]` |
| 「④ 七项的其余项也有同族问题」 | 🔴 `[NOT-WRITTEN]` —— **我只扫了零断言这一个形状**,见 §1 边界 |
| 「本稿扫完 = ④ 可以推进落码」 | 🔴 `[NOT-ESTABLISHED]` —— 扫射是 ④ 的**第一步**,§8-4 短设计稿还没写 |
