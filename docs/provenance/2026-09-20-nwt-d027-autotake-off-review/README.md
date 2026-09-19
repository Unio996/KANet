> **Status**: CURRENT（2026-09-20，NWT；对象 = `origin/coord/kanetui-autotake-off-runbook` 头 `edbb7dfb`：`docs/2026-09-20-kanetui-autotake-off-execution-runbook-v0.1.md` + provenance 三脚本；这是 runbook 页首执行门 **G1**）

# D-027 ① 主网 `autotake_enabled` 置 `false` 执行 runbook —— NWT 核（G1）

方法：独立检出（`D:\kanet-nwt-cand`，`edbb7dfb`，独立 `npm ci`）；核三脚本 sha256；亲跑作者的 21 项测试与 15 个变异；**独立枚举 KANet-UI 自陈没做的"动态拼 key"写入口**；**用真实迁移建库（真实 schema + 真实 v88 种子行）**与活库（只读）逐列比对，并在这个真实 schema 上跑工具全流程与并发场景；做 7 个我自己的变异。**全程只写临时库；活库只用工具自己的 `--mode read` 只读打开。** D-021：只涉及两行 `is_sensitive=0` 的配置值。

## 结论：**G1 ——GREEN。无 MUST；2 条 SHOULD（都不阻塞执行）。**

可以进入 G2（Bettor 一句 GO）。runbook §8 清单逐项闭合，且我补做了 KANet-UI 自陈的三处"没做"。

| 类 | 编号 | 内容 |
|---|---|---|
| SHOULD | **A-1** | `--timeout-ms` 是否真传给连接**没有测试**（我的变异 a1"不传 `timeout` 选项、退回默认 5 s"，作者 21 项全绿）。当前实现是对的——我实测：另一进程持写锁 6 s、`--timeout-ms 1500` ⇒ exit 5、耗时 1.8 s、`SQLITE_BUSY`、什么都没写；持锁 2.5 s、超时 10 s ⇒ 等到释放后成功（2.6 s）。加一条"持锁 > 超时 ⇒ 在超时附近退出码 5"的测试即可。 |
| SHOULD | **A-2** | §5 第 2 点（陈旧 UI 页面）值得一条执行期动作而不只是提示：写回只发生在**点击**（`exchange.eta:889` 保存按钮、`:1790` 的切换）时，页面只在初始化读一次（`:1187` `loadAutoTakerConfig`）、无轮询——风险成立但需要人点。建议 Bettor 在 G2 的 GO 里点名"执行前后 1 小时内谁有权限打开该 UI 页面"；E5 的两次复读（+10 min / +1 h）是检测手段，保留。**根治不在本 runbook 范围**（改 PUT 路由使 `enabled:true` 需二次确认 = 代码改动、铁律 0）——建议 Bettor 记一条后续票交 Owner 定要不要做。 |

## 一、runbook §8 清单逐项

1. **测试与变异**：sha256 与 §9 一致；`node --test` **21/21**；`autotake-off-exec.mutations.mjs` **15/15 KILLED**。**我自己另想的 7 个变异**：**5 被抓，2 存活**——a1（超时选项）= **A-1**；a3（前置失败时不显式 `ROLLBACK`，靠进程退出）= **等价**（进程退出即关连接，SQLite 回滚未提交事务；显式 `ROLLBACK` 是好习惯不是必需）。被抓的：UPDATE 去掉 `is_sensitive=0`（a2）、事件 payload 的 `previous_updated_at` 写错（a4）、事件 source 字面量改（a5）、rollback 方向的前置值写反（a6）、提交后复读不符仍退出 0（a7）。
2. **§2 源码 + "无缓存"**：`configs.js:6-13` `getConfig` = 单次 `SELECT * … WHERE key = ?`，非敏感行直接返回 `value_encrypted`，**无缓存、无 TTL**；`trade-protocol-filter.js:1962-1969` `_evaluateAutoTake` 第 1 步 `getConfig('autotake_enabled')`，`!== 'true'` 即返回；行号与 runbook 差 1 行，内容一致。`PUT` 会改 `category / value_plain_hint / is_sensitive`（`configs.js:28-30` 的整行改写）——属实，所以选直写是对的。**"无需重启"我做了直接实测**（`autotake-longlived-reader.mjs`）：一个长驻连接（用 `getConfig` 的原句查询）在工具 `COMMIT` 前读到 `true`、后读到 `false`，**同一个句柄、不重开、不重启**。
3. **反例（值不精确就停手）**：`before.value_encrypted !== FROM` 是**严格字符串相等**；作者测试已覆盖 `TRUE` / ` true` / `1` / `null` / 行缺 / 敏感行（退出码 3）。我另在真实 schema 上验证：重复 `apply` ⇒ 退出码 3（"is 'false', expected 'true'"），重复 `rollback` 同理——**不会"猜"**。
4. **§5 里漏掉的写回路径（KANet-UI 自陈只 grep 了字面量、没枚举动态 key）——我枚举了**：
   - 全仓 `autotake`（大小写不敏感）非文档出现处：**全是字面量**——`api/exchange.js:1126-1179`（GET / PUT）、`migrate.js:2802-2826`（v88 种子）、`trade-protocol-filter.js`（`_evaluateAutoTake`）、`exchange.eta`（UI）；其余是注释。**没有任何动态拼 `autotake_*` 的写法。**
   - 所有能写 `config_entries` 的入口：`setConfig` 的调用点**全是字面量 key**，唯一的模板拼接是 `api/trading.js:264` 的 `agent_trade_mode:<id>`（拼不出 `autotake_*`）；其余直写 SQL 的（`bettor-scanner` / `broker-fee-emit` / `monitor-service` / `social-budget` / `whale-signal` / `scripts/bettor-calibrator-learn.mjs`）各写自己的 key 族。`deleteConfig(key)` 存在——**删行 ⇒ `getConfig` 返回 `null` ⇒ `!== 'true'` ⇒ 关**，方向安全。
   - **v88 种子**：先 `SELECT`、行存在则**不插入**（`migrate.js:2812-2822`），且迁移按版本号只跑一次——重启不会覆盖 `false`；**只有新建库或该行被删后重建库**才会重播种为 `true`（runbook §5-1 已写）。`api/backup.js` 里我没找到恢复路径（grep 空）；**若有人把整库文件回滚到旧备份，配置表会回到旧值**——与 §5-1 同类，建议 §5 加半句。
   - `tg-bot` / `agent-mind` / `scripts` 里没有对 `autotaker-config` 的调用。
5. **"夹具 schema 非活库副本"——闭合**：我用**仓库自己的真实迁移**建了一个临时库，与活库（只读打开）逐列对比：`config_entries` 8 列、`events` 14 列，**名称 / 类型 / notnull / 默认值 / pk 全部一致**；两个库都各只有 2 个触发器、**都不在这两张表上**，两张表都没有 CHECK 约束（所以 `event_scope='system'`、`level='info'` 这类字面量不会被拒）。在这个**真实 schema** 上，工具 `read → apply(无 GO ⇒ 2) → apply(⇒ 0) → 重复 apply(⇒ 3) → rollback(⇒ 0) → 重复 rollback(⇒ 3)` 全部按预期；apply 后 `autotake_mode` 行 `value_encrypted / updated_at / category` 不变，`events` 恰新增一行 `config_change`。
6. **只动一行两列**：真实 schema 上 apply 前后对**除目标行外的 13 行 `config_entries` 逐格比对：完全一致**（sha256 `0e926f7bc1e8` 前后相同）；目标行变化的列**恰为 `value_encrypted` 与 `updated_at`**；行数变化的表**只有 `events`（+1）**。（我在 `autotake-real-schema.mjs` 末尾写的"其他行未被改动 = 11"统计是错的——数的是迁移里本来就是 ISO 时间格式的既有行——**不作证据**；正确的逐格比对见 `autotake-other-rows.mjs`。）
7. **并发（WAL）**：另一进程持 `BEGIN IMMEDIATE` 2.5 s、工具超时 10 s ⇒ 等到释放后成功；持锁 6 s、`--timeout-ms 1500` ⇒ **exit 5、`stage 'begin'`、`SQLITE_BUSY`、什么都没写**（之后目标值仍为 `true`）。与 runbook §3 / §6 表一致。
8. **活库现状（只读）**：我用工具的 `--mode read` 读活库：`journal_mode=wal`；`autotake_enabled='true'`、`autotake_mode='auto'`，`created_at = updated_at = 2026-09-13 15:33:53`；`EVENTS 0`；读前后主 `.db` 与 `-shm` 的 mtime 不变——与 runbook §4 E2 的预期**逐字一致**。

## 二、KANet-UI 自陈的三处"没做"
| 自陈 | 判 |
|---|---|
| 只 grep 了 `autotake_enabled` 字面量、未枚举动态拼 key | **已枚举，无动态写法**（§一-4）。 |
| 夹具 schema 非活库副本 | **已闭合**（§一-5）：真实迁移建库与活库逐列一致，并在真实 schema 上跑通。 |
| 陈旧 `exchange.eta` 页面点保存会把 `enabled:true` 写回 | **成立，需要人点击**（`:889` / `:1790`；页面只在 `:1187` 初始化读一次、无轮询）；见 **A-2**。 |

## 三、执行时我建议照 runbook 原样、外加一点
- 严格按 §4 的 E1→E7；`--mode apply` 之前在 E2 复核 `--mode read` 输出与上面 §一-8 一致（`true` / `auto` / `EVENTS 0` / `wal`）。
- **E4 的第 1、2 条读数（`--mode read` 与 `GET /api/exchange/autotaker-config`）在同一个操作窗口内做完**并保留原文，Bettor 事后核时可对照。

## 没做 / 未证
- **没有在活库上跑 `--mode apply`**（按定义，也不该由我跑）；上面所有写入验证都在临时库。活库上唯一的真实 `apply` 由 KANet-UI 在 G2 之后执行。
- 没做"真实 console 进程并发写入下的压测"；WAL 语义用"另一进程持写锁"的行为测试代替，长驻连接可见性用单连接实测代替。
- `updated_at` 格式：工具写 ISO（`…T…Z`），种子行是 `datetime('now')` 格式（`YYYY-MM-DD HH:MM:SS`）；我没有逐个核 `config_entries.updated_at` 的全部消费者——`getAllConfigs` 只按 `key` 排序、不按时间；`PUT` 路径本来就写 ISO，故不属新增混杂。
