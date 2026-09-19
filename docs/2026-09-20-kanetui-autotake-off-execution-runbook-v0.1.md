# 主网 `autotake_enabled` 置 `false` 执行 runbook v0.1（D-027 ①）

> **Status**: CURRENT（待 NWT 核 + Bettor GO；未执行）
> 作者：KANet-UI ｜ 日期：2026-09-20 ｜ 依据：`docs/DECISIONS.md` **D-027**（Owner 2026-09-20 本机终端原话「自动接单置 false，握手也加开关，主网默认关。」）｜ 派工：Bettor（COORD-LEDGER 1570 后）
> **性质：只写不执行。** 本文档与配套工具落库时**没有对活库做过任何写入**（只做过只读读数，见 §7）。
> **D-021**：本文只写两行 `is_sensitive=0` 的配置值（`true` / `auto`），不含密钥、地址、余额、持仓。

## 页首执行门（缺一不执行）

| # | 门 | 谁 | 状态 |
|---|---|---|---|
| G1 | NWT 核过本 runbook 与配套工具（§8 清单），结论落频道 | NWT | ☐ 待核 |
| G2 | Bettor 一句 GO（写明 COORD-LEDGER 块号） | Bettor | ☐ 待 GO |
| G3 | 执行前 `sha256` 与 §9 表一致（工具没被改过） | KANet-UI | ☐ 执行时做 |
| G4 | E2 前读数与 §4 预期一致（`autotake_enabled='true'`、WAL） | KANet-UI | ☐ 执行时做 |

**执行人只有 KANet-UI；事后核只有 Bettor。GO 之前不得运行 `--mode apply`；`--mode read` 随时可跑（只读）。**
**恢复 autotake（置回 `true`）不在本 runbook 授权内**——回滚语句（§6）只在"执行出错需撤回"时用；任何"重新打开"须 Owner 另批（D-027）。

---

## 1. 一页结论

| 项 | 结论 |
|---|---|
| 改什么 | `config_entries` 里 **恰好一行**：`key='autotake_enabled'` 的 `value_encrypted` 由 `'true'` → `'false'`，`updated_at` 同步更新。`autotake_mode`（`auto`）、`autotake_min_discount_pct`（`0.5`）、其余所有行与列**不动** |
| 需要重启吗 | **不需要。** `getConfig` 每次调用都现查库、无缓存（§2）；下一个入站 offer 消息进 `_evaluateAutoTake` 时读到 `false` 即在第 1 步返回 |
| 走哪条路径 | **直写 SQLite（better-sqlite3，单事务 `BEGIN IMMEDIATE`）**，不走 `PUT /api/exchange/autotaker-config`（§3 对比）；API 只用作**事后独立核对读**（GET） |
| 保护 | WHERE 带 `key` 且当前值 `'true'` 且 `is_sensitive=0`；`changes` 必须恰为 1，否则整事务回滚、停手；事件写入与 UPDATE **同一事务**（事件写不进 ⇒ 配置也不改） |
| 事件登记 | 同事务 `INSERT INTO events`：`source='kanetui-d027-runbook'`、`event_type='config_change'`，summary 与 payload 含前值/后值/时间/决议号 |
| 回滚 | `--mode rollback --go D-027`（`'false'`→`'true'`，同样单事务+事件）；等价 SQL 见 §6 |
| 不解决什么 | 见 §5：这一行不是"永久"保险（重建库重播种、UI 陈旧页面保存、API 误调都会写回 `true`） |

## 2. ④ `getConfig` 是否缓存（只读核，均为源码行号，工作树 = `origin/bshard-m3-deploy` `9df0e8e1`）

- `kasia-console/src/data/settings/configs.js:6-13`：`getConfig(key)` = `sqlite.prepare('SELECT * FROM config_entries WHERE key = ?').get(key)`，非敏感行直接返回 `row.value_encrypted`（"for non-sensitive, we store plain in value_encrypted"）。**无模块级缓存、无 TTL、无 memo。**
- `kasia-console/src/services/trade-protocol-filter.js:1963-1969`：`_evaluateAutoTake` 第 1 步 `const { getConfig } = await import('../data/settings/configs.js'); const enabled = await getConfig('autotake_enabled'); if (enabled !== 'true') return;`——**每次评估都现读**。模块里的 `_autoTakeLock` / `_lastAutoTakeAt`（1955-1956）是内存变量，与该配置无关。
- **生效时机**：提交（COMMIT）之后**下一次**调用 `getConfig` 即见 `false`。不需要重启 console，也不需要通知它。
- **边界（诚实）**：已经越过第 1 步、正在评估中的那一次调用不会被回头拦下；该调用最多一次，且其后各步还有各自的闸。本 runbook 不声称"瞬时切断在飞评估"。
- **谁读这一行（全仓 grep `autotake_enabled`，JS/MJS/ETA）**：仅 ① `migrate.js:2808`（v88 种子，见 §5）；② `api/exchange.js:1130`（GET）与 `:1145`（PUT）；③ `trade-protocol-filter.js:1968`。UI `exchange.eta:1208/1797` 只经该 API 读写。**没有别的消费者**。
- **独立核对读**：运行中的 console 自己的 `getConfig` 可由 `GET http://127.0.0.1:3202/api/exchange/autotaker-config` 观察（`enabled` 字段 = `getConfig('autotake_enabled') === 'true'`）。2026-09-19T19:02Z 实测返回 `{"enabled":true,"mode":"auto",…}`，与库一致。执行后此 GET 应**立即**变 `enabled:false`——这一条同时**实证"无需重启"**。

## 3. ⑤ 执行路径：直写 SQLite vs console 配置 API

| 维度 | 直写 SQLite（选） | `PUT /api/exchange/autotaker-config` |
|---|---|---|
| 写的内容 | 恰好 `value_encrypted`、`updated_at` 两列 | `setConfig`（`configs.js:15-35`）**整行改写**：另把 `category` 改成 `exchange_autotaker`（现为 `broker_autotake`）、`value_plain_hint` 置 null、`is_sensitive` 重写、`updated_at` 用 ISO 格式 |
| 前值校验 / 行数断言 | 有：WHERE 带当前值，`changes` 必须为 1 | 无：无条件覆盖，不返回改了几行 |
| 事件登记 | 同事务写入 | 路由不写事件 |
| 并发 | 见下（WAL 语义清楚） | 经 console 自己的连接，同样 WAL；无额外优势 |
| 对运行中 console 的影响 | 无（console 下一次读库即见新值） | 同 |
| 可审计性 | 工具 + 测试 + sha256 固定 | 依赖 API 调用记录（无） |

**WAL 与锁行为（已核）**：
- 活库 `journal_mode=wal`（`--mode read` 实测 `journal_mode=wal`，且目录下有 `-wal` / `-shm`）；`kasia-console/src/db/client.js` 设 WAL 且 `foreign_keys=ON`，**未显式设 `busy_timeout`**（better-sqlite3 默认等待 5000 ms）。
- WAL 下：**读者不阻塞写者，写者不阻塞读者**；同一时刻只有**一个写者**。console 的读（含 `getConfig`）不会被我们的事务挡住；console 若恰在我们持写锁的几毫秒内要写，会等待（其默认 5 s 远大于我们的持锁时间）。
- 工具用 `BEGIN IMMEDIATE`（一上来就拿写锁，等待 ≤ `--timeout-ms`，默认 10 s，拿不到 ⇒ `SQLITE_BUSY`、**什么都没写**、退出码 5、报错含 `stage 'begin'`）。测试已钉住这一点（延迟事务 `BEGIN` 变异被抓）。
- **不改 journal 模式**：工具只用查询形式 `pragma('journal_mode')` 读取；源码静态测试断言全文件唯一的 pragma 调用就是这一条；读到非 `wal` 则拒绝写（退出码 2）。**不做手动 checkpoint。**
- 事务内 `foreign_keys=ON`：`events` 的外键列（`conversation_id` 等）我们全留空（NULL），无外键风险。
- 活库 schema 已只读核对：`config_entries` 8 列与工具假设一致；`events` 比 `migrate.js` 基础 DDL 多一个可空列 `agent_address`（不影响 INSERT，夹具已同步）；`events` / `config_entries` 上**无触发器**（库内仅 `chain_events_txid_format_check`、`trg_pool_markets_fee_rules_write_once` 两个，与本表无关）。

## 4. 执行步骤（按序；每一步的**预期读数**先写，偏离即停手报 Bettor）

> 工具目录：`docs/provenance/2026-09-20-d027-autotake-off/`（下文 `$T`）。以下命令在该目录下、Git Bash 或 PowerShell 均可（无反斜杠内容）。工具默认 `--root D:/kanet-tn12`（只用来加载 `better-sqlite3`）与默认 DB `D:/kanet-tn12/kasia-console/data/console.mainnet.db`。

**E0 门检**：G1、G2 已在频道；`sha256sum autotake-off-exec.mjs`（PowerShell：`Get-FileHash -Algorithm SHA256 .\autotake-off-exec.mjs`）与 §9 表逐字一致（G3）。

**E1 记 console 进程基线**（执行后核"没有重启"）：
`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'kasia-console' } | Select-Object ProcessId, CreationDate`（记 PID 与 CreationDate 全值）。

**E2 前读数（只读）**：`node autotake-off-exec.mjs --mode read`，预期：
```
db=console.mainnet.db journal_mode=wal
READ {"key":"autotake_enabled","category":"broker_autotake","is_sensitive":0,"value_encrypted":"true",…,"updated_at":"2026-09-13 15:33:53"}
READ {"key":"autotake_mode","category":"broker_autotake","is_sensitive":0,"value_encrypted":"auto",…}
EVENTS 0
```
并 `curl -s http://127.0.0.1:3202/api/exchange/autotaker-config` 预期 `"enabled":true`。任一不符 ⇒ 停手（例如已有人改过）。

**E3 执行**：`node autotake-off-exec.mjs --mode apply --go D-027`，预期退出码 0，输出：
```
DONE apply: autotake_enabled 'true' -> 'false' committed at <ISO 时间>
AFTER {…"key":"autotake_enabled",…"value_encrypted":"false",…"updated_at":"<同一 ISO 时间>"}
AFTER {…"key":"autotake_mode",…"value_encrypted":"auto",…"updated_at":"2026-09-13 15:33:53"}
```
**其他退出码 = 异常，停手，什么都不要再试**（§6 表）。

**E4 后读数（三处独立）**：
1. `node autotake-off-exec.mjs --mode read` ⇒ `autotake_enabled` = `false`、`autotake_mode` 仍 `auto` 且 `updated_at` 仍 `2026-09-13 15:33:53`、`EVENTS 1`。
2. `curl -s http://127.0.0.1:3202/api/exchange/autotaker-config` ⇒ `"enabled":false,"mode":"auto"`（**运行中 console 未重启即见新值**）。
3. 重跑 E1 命令：console PID 与 CreationDate 与 E1 **完全一致**（没有重启、没有换进程）。

**E5 观察**：执行后约 10 分钟与 1 小时各跑一次 `--mode read`，确认仍是 `false`（没人经 UI/API 写回，§5）；若变回 `true`，立即报 Bettor，**不要自行再改**。

**E6 事件登记**：E3 已在同事务写入一条 `events`（可由 E4-1 的 `EVENT` 行看到）：`event_scope=system`、`event_type=config_change`、`source=kanetui-d027-runbook`、`level=info`；`summary` 形如 `config_entries.autotake_enabled true -> false at <ISO> (D-027); autotake_mode untouched ('auto')`；`payload_json` 含 `decision/key/before/after/previous_updated_at/changed_at/mode_value_untouched/executor/tool`。另由 KANet-UI 把 E2/E4 的读数原文与 sha256 用 SendMessage 报 Bettor，供其记 COORD-LEDGER 一行（模板：`D-027 ① 执行：autotake_enabled true→false @<ISO>；DB 读/GET 双证；console PID 未变；事件 <event id>；回滚未用`）。

**E7 收尾**：Bettor 事后核（他自己重跑 `--mode read` 与 GET）；P2 启动守卫落地后，其 `config:autotake` 一项预期由 MISMATCH 变 OK（`enabled=false mode=auto`）——这是预期而非本次已验证事项（守卫工具在另一分支，未落码）。

## 5. 这一行改动**不**保证什么（须知）

1. **重建库 / 删行会重播种为 `true`**：`migrate.js:2802-2826`（v88）是"行不存在才插入"，种子值就是 `autotake_enabled='true'`。重启不会覆盖现有 `false`（已核：先 `SELECT`，存在则跳过）；但**新建主网库或该行被删**会得到 `true`。把种子改 `false` 是**代码改动**，不在本 runbook 内，须另走报备（铁律 0）。
2. **UI 陈旧页面会写回**：`exchange.eta:1792-1807` 的 `saveAutoTakerConfig` 把页面里缓存的 `enabled` 等**全字段**一起 PUT。若有人在执行前打开过该页（页面状态 `enabled:true`）并在执行后点保存，会把它写回 `true`。E5 的两次复读即为此设；建议 Bettor 知会有 UI 权限的人执行期间别点该页保存。
3. **API 调用同理**：任何 `PUT /api/exchange/autotaker-config {"enabled":true}` 都会写回；本 runbook 不改路由。
4. **已知现状（引自我此前只读核查，本次未重验，NWT 核时可重验）**：autoTaker 在现状下本就基本惰性（`scanner_enabled` 配置行缺席 + `agent_wallets` 空 + 端口硬编码等）。所以本次是**把"已上膛但惰性"改成"明确关"**，不是"止血"。
5. 不改任何代码、不改 `autotake_mode`、不碰驱动开关、不碰 relay 握手（I7，Bettor 另出设计稿）。

## 6. 异常与回滚

| 退出码 | 含义 | 库里有没有写 | 动作 |
|---|---|---|---|
| 0 | 完成 | 已提交 | 走 E4 |
| 2 | 用法/环境（无 `--go D-027`、模式错、非 WAL、库打不开、无法加载 `better-sqlite3`） | 无 | 修正后重试（非 WAL ⇒ 停手报 Bettor） |
| 3 | 前置条件不符（行缺、敏感、值不是 `'true'`） | 无 | **停手**，报读数 |
| 4 | UPDATE 行数≠1 | 已回滚，无 | **停手** |
| 5 | 其他错误（锁超时 `SQLITE_BUSY`、事件写入失败、提交后复读与预期不符） | 已回滚（复读不符时见下） | 停手报 Bettor；`busy` 可在确认无人长事务后重试一次 |

- **退出码 5 且输出含 `AFTER … "value_encrypted":"true"`**：提交后复读仍是 `true`（理论上只可能是触发器/别的写者）。此时事务已提交，库里有一条 `config_change` 事件而值未变——**停手报 Bettor 判断**，不要重跑。
- **撤回（仅当执行出错需要撤销，或 Bettor/Owner 明确要求）**：`node autotake-off-exec.mjs --mode rollback --go D-027`。它执行的等价 SQL（单事务，前置 `value_encrypted='false'`）：
  ```sql
  BEGIN IMMEDIATE;
  -- 前置：SELECT … WHERE key='autotake_enabled'，须 is_sensitive=0 且 value_encrypted='false'，否则 ROLLBACK 停手
  UPDATE config_entries SET value_encrypted='true', updated_at=<now ISO> WHERE key='autotake_enabled' AND value_encrypted='false' AND is_sensitive=0;  -- changes 必须 =1
  INSERT INTO events (…, event_type='config_change_rollback', source='kanetui-d027-runbook', …);
  COMMIT;
  ```
  同样写事件、同样单事务。**再次强调：这等于重新打开自动接单，属于 Owner 决策，无 Owner/Bettor 明确指示不得执行。**
- 正向语句（`--mode apply` 实际执行的 SQL）：
  ```sql
  BEGIN IMMEDIATE;
  -- 前置：SELECT … WHERE key='autotake_enabled'，须 is_sensitive=0 且 value_encrypted='true'
  UPDATE config_entries SET value_encrypted = 'false', updated_at = <now ISO> WHERE key = 'autotake_enabled' AND value_encrypted = 'true' AND is_sensitive = 0;  -- changes 必须 =1，否则 ROLLBACK 退出码 4
  INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at) VALUES (<uuid>,'system','config_change','kanetui-d027-runbook','info',<summary>,<payload>,<now ISO>);
  COMMIT;
  ```

## 7. 已做的验证（全部不涉及活库写入）

- **夹具库单元测试 21/21 全过**（`autotake-off-exec.test.mjs`，夹具都在 `mkdtemp` 临时目录，且**测试内断言**所有路径在该临时根下、绝不指向 `console.mainnet.db`）：读模式不改库、默认即读模式；WAL 下另一连接持库/持写事务时读可行；apply 只改目标行两列、其余行所有单元格逐格不变、事件字段逐项；apply 后仍是 WAL；缺/错 `--go`；未知模式/坏超时/库不存在；前置条件（已是 `false`、`TRUE`/` true`/`1`/null 等值不精确匹配、行缺、敏感行）；非 WAL 拒写；触发器吞掉 UPDATE ⇒ 退出码 4 且回滚；事件插入失败 ⇒ 退出码 5 且配置一并回滚；提交后复读与预期不符（触发器翻回）⇒ 退出码 5；另一连接持写锁 ⇒ 超时后退出码 5、`stage 'begin'`、未写；持有读事务的连接不阻塞写、事务内仍见旧快照、事务结束/新连接见 `false`；回滚模式与重复回滚；静态：唯一 pragma 调用是只读查询、唯一 UPDATE 目标是 `config_entries` 且形状与文档一致、唯一 INSERT 目标是 `events`、读模式以 `readonly` 打开、无 `DELETE/DROP/ALTER`。
- **变异对照 15 个全被抓红**（`autotake-off-exec.mutations.mjs`，`ALL MUTANTS KILLED`）：去掉行数检查 / 前置值检查 / 敏感与缺行检查 / `--go` 检查 / WAL 检查；UPDATE 不按 key 限定；事件在提交后才写；回滚方向写反；不更新 `updated_at`；提交后复读结果被忽略；`BEGIN IMMEDIATE`→`BEGIN`；读模式改可写；工具自行改 journal 模式；顺手改 `autotake_mode` 行。**诚实备注**：M11（读模式可写）由**静态钉住**测试抓红，而非行为测试（读模式路径本身不发写语句，行为上不可区分）；UPDATE 上的 `AND value_encrypted=? AND is_sensitive=0` 两个子句在 `BEGIN IMMEDIATE` 下与前置检查**冗余**（"腰带加背带"），单独去掉其一行为上不可区分，由静态"UPDATE 形状"断言钉住。
- **活库只读读数（2026-09-19T19:01–19:04Z，`--mode read` 与 GET，未写）**：`journal_mode=wal`；`autotake_enabled='true'`（`updated_at` `2026-09-13 15:33:53`）、`autotake_mode='auto'`、`autotake_min_discount_pct='0.5'`；`EVENTS 0`；GET 返回 `enabled:true`；`console.mainnet.db` 主文件与 `-shm` 的 mtime 在两次读之间不变（`-wal` 因 console 自身写入而变，与本工具无关）。
- **没做的**：`--mode apply` 从未在活库上跑（按定义）；夹具 schema 是我按 `migrate.js` 与活库只读核对结果搭的，不是活库副本；未在真实 console 进程并发写入下压测（WAL 语义靠 SQLite 文档与"读者事务不阻塞写"测试）。

## 8. 给 NWT 的核对建议（最短路径）

1. 在 `$T` 下 `node --test autotake-off-exec.test.mjs`（应 21/21）与 `node autotake-off-exec.mutations.mjs`（应 `ALL MUTANTS KILLED`），并自己再想一个变异。
2. 重核 §2 的四处源码行号与"无缓存"；重核 §3 "PUT 会改 category/hint"（`configs.js:28-30`）。
3. 想反例：`autotake_enabled` 在活库里的值/空白/大小写若不是精确 `'true'`，工具应停手（退出码 3）而不是"猜"。
4. 想 §5 里我漏掉的写回路径（尤其是启动期脚本、种子、别的会话的 `setConfig` 调用点——我只 grep 了 `autotake_enabled` 字面量，**没有**枚举动态拼 key 的写法）。

## 9. 配套文件与哈希（`docs/provenance/2026-09-20-d027-autotake-off/`）

| 文件 | sha256 |
|---|---|
| `autotake-off-exec.mjs`（工具本体） | `17ceb4b1dea6a48bd5c4847e8f740d2eda3cdb9fcc710d506cf5b22507d6fb05` |
| `autotake-off-exec.test.mjs`（21 项测试） | `ade0c6ab9021e771af938291fa01585e6659c07ff3fb74b9a786a7e09a85cc2b` |
| `autotake-off-exec.mutations.mjs`（15 变异） | `6cd0bb201358b4b5bbe4d6b8573997b4b0087f51e7feaabc08f963fb91baeb25` |

自查：`sha256sum docs/provenance/2026-09-20-d027-autotake-off/*.mjs` 与本表逐字比对；不一致 ⇒ 文件被改过，**不得执行**。
