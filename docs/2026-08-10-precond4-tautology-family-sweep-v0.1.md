# D-012 格④ · §8-4「恒真墙」同族扫射 v0.1 —— 【DESIGN-ONLY·零生产码·零用例改动】

> **Status**: CURRENT · **v0.2(2026-08-10 07:4xZ)**
> **v0.2 编法**: 原文一字不删。变更走本修订块,被推翻的段落在原处仍可读 —— 因为**它错在哪比它说了什么更有用**。

---

# 🔴🔴 v0.2 修订块 —— §4 整条推翻,而 §3 的恒真风险【坐实并加重】

> 三方独立同结论(J2 实测数字 / NWT 走代码路线 / Bettor 现读行号),2026-08-10 07:3x-07:4xZ 频道。

## R1. 🔴 §4「测试默认库 = 生产库」**整条撤回** —— 它不是发现,是一个 2026-08-04 已修问题的**问题陈述**

- `kasia-console/scripts/test.mjs:10` **第一行 import** 就是 `../test-framework/lib/env-bootstrap.mjs`,**排在 runner 之前**。
- `env-bootstrap.mjs:88` 若 `DB_PATH`/`KANET_DB_PATH` **未显式设** ⇒ `:79-86 rebuildTestDb` **无条件删掉** db + `-wal` + `-shm`,`:95` `runMigrations()` 重建,并把**两个** env 都指向 `test-framework/data/test-console.db`。
- 🔴 **而该文件头 `:46-48` 逐字引的就是我 §4 引的那两行 `runner.mjs:20-21`** —— **那是它要解决的问题陈述,不是现状。**(2026-08-04 立,NWT 当时提出。)
- ⇒ **走标准入口的每一次运行都是【全新空库】。§4 全错,由它衍生的卡 `TEST-RUNNER-DEFAULT-DB-IS-PROD` 已由 Bettor 撤销。**
- 🔨 **我错的形状**: **读了库里的默认值,没查入口有没有 bootstrap** —— 与我在本轮 D2 复核里批评别人的那条(读了闸没读调用点)**同形**。

## R2. 🔴🔴 而恒真风险**不但成立,还比 v0.1 重得多** —— 因为 v0.1 的数量**量在了错的库上**

| 量 | v0.1 写的(❌ **prod 库手工读,非运行时生效库**) | ✅ 生效库 `test-framework/data/test-console.db` 实测 |
|---|---|---|
| `pool_bettor_sides` 非空 `side_lock_tx` | 36,012 / 36,012 | **0** |
| `pool_settle_consensual_dispatched` | 13 | **0** |
| `chain_events` | 252,126 | **1** |
| `market_shards` distinct logical(NWT 07:17 引 657) | 657 | **0** |

⇒ **§2 表里那些「🔵 干净」的零断言,在标准入口下【此刻就是 vacuous 绿】**,不是"将来可能"。
⇒ 而因为 bootstrap **每次重建**,这**不是偶发状态,是常态**。
⇒ **§3.1 那句「今日实测它不空,但那是数据给的」作废** —— 它连"数据给的"都不是,**它是我量错库给的**。
⇒ **§5 建议③(补 `c_min`)从「卫生习惯」升为「这些用例现在就是空绿的」**,已由 Bettor 并入格④ 恒真墙族的量级表。

🔵 **同时被 NWT 自己作废的一行**(他 07:37 发):他 07:17 格④ 裁决里「今天现查 `market_shards`=657 ⇒ 今天这条不是 vacuous」同属量错库,**已由他本人标作废**。

## R3. 🟠 残余风险另立小卡(Bettor 07:36):`TEST-ENTRY-BYPASS-HITS-PROD`

**绕过 `scripts/test.mjs` 的直接调用路径**(需 `--experimental-test-module-mocks` 的用例 / 手册里 `node --test` 那类命令)**才真的踩生产库**。射程 = 枚举绕行面 + 给每个绕行命令补显式 env 前缀。P3,排冻结后。

## R4. 🔨 判据(本轮全队第 4 次同族,"绑定值≠生效值")

**报"某某默认打 X"之前,先跑一次,再看【哪个文件的 mtime 动了】。**
我手上一直有 trace(`07:27:46`)和 db mtime(`14:27:46`)—— **秒级对齐**,却先去读代码推。
🔵 **而这一族有两个方向,今天两个都出现了**: 把**没修的**报成修好了(常见),和**把修好的报成还没修**(本条)。
⇒ 在册 memory 已按此补注:`reference-test-db-never-reset-measures-history-not-code-deterministic-step-not-flaky`。

---
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
