# 主网 console 密钥导出路由锁定设计 v0.1（2026-09-14 · KANet-UI · Bettor 1244 派工 · 只写方案不落码）

> **Status: DRAFT**。背景：Bettor 1244 指出 `GET /relays/:id/mnemonic`（`relay.js:555`）无鉴权、本机任意进程可达，与 1238-补 端口风险（`docs/2026-09-14-kanetui-test-runner-skip-gate-and-console-url-safety-design-v0.1.md`）连成真实链路——一个能连到 `127.0.0.1:3202` 的进程（例如一个测试脚本因端口撞车打到了主网口），当前**不需要任何凭证**就能拿到任意 relay 的明文助记词。本页只设计，不落码——NWT 审后再落，代码落哪个分支等派工时定。

## 0. 一句话结论

**这两条路由目前是这台主网机器上最直接的资金风险点之一**（比 D-019/热钱包上限那类"防止误启动"的风险更直接——这两条路由是"直接把私钥递出来"）。本页方案的核心是：**复用本仓已有的 `ADMIN_SECRET` 能力级分层机制**（`src/lib/admin-secret-tier.mjs`，`docs/2026-07-16-admin-secret-capability-tiering-design.md`）**新开一个 tier**，不新造一套认证体系——这套机制已经是"未设 = 503 disabled"（fail-closed 对未配置=禁用）的既有约定，跟 Bettor "默认关闭"的要求天然一致，且这台机器目前 `ADMIN_SECRET*` 系列本来就没配（`kanet.mainnet.env` 里"未决定"区块明确写着"对应 admin 端点在这个实例上不可用"）——本页的修法落地后，这两条路由会**从"完全不设防"变成"跟其它 admin 端点一样，目前默认也是不可用"**，不是新引入一个不可用状态，是把这两条本来漏掉的路由**补进**既有的默认不可用状态里。

## 1. 盘点：全仓返回密钥物的路由（① Bettor 派工）

**判据**：响应体里会出现明文助记词/明文私钥（不含"只返回地址/公钥/加密密文"的路由——那些不在本次范围，本仓大量落库/查询逻辑本来就存加密态，不算暴露面）。逐条读代码核实（`grep fastify.\(get\|post\)` 全仓扫过一遍，非只看文件名带 `mnemonic`/`privkey` 字样的）：

| 路由 | 文件:行 | 当前鉴权 | 返回什么 | 本页判定 |
|---|---|---|---|---|
| `GET /relays/:id/mnemonic` | `src/api/relay.js:555` | **无** | 解密后的**已有** relay 明文助记词 | 🔴 **本页要锁的两条之一** |
| `GET /api/relay/:id/wallets/:walletId/privkey` | `src/api/relay.js:844` | **无** | 解密后的**已有**钱包明文私钥 | 🔴 **本页要锁的两条之一** |
| `POST /relays/generate-mnemonic` | `src/api/relay.js:1314` | 无 | **新生成**的随机助记词（`Mnemonic.random(12)`，非从库里解密已有材料） | 🟡 **本页判定不锁**，见 §1.3 理由，供 NWT 复核 |
| `POST /api/relay/import-privkey` | `src/api/relay.js:150` | 有（`verifyIngestRequest`，`x-ingest-secret` header） | **不回显**任何密钥字段（响应只有 `id`/`name`/`address`/`network`） | ✅ 已有鉴权，本来就不返回密钥物，本页不动（Bettor 明确要求③"不改任何现有导入路径行为"，这条是导入路径的一部分） |
| `POST /relays`（mnemonic 导入，`relay.js:89`） | 同上 | 无（早失败层是 `checkHotwalletAdmission`，与身份鉴权是两回事） | **不回显**任何密钥字段（`reply.redirect('/relays')`） | ✅ 同上，导入路径，不动 |
| `GET /api/backup/export` | `src/api/backup.js:21` | **无** | 见 §1.2——**不含密钥物**，本页判定不纳入锁 | ✅ 已核实不返回密钥物，不需要同一把锁 |

### 1.2 `GET /api/backup/export` 补盘（Bettor 1248 派工，本人独立读代码核实，不是转述文件头注释）

文件头注释自称范围"只包含链上无/不可重建的数据"且"不包含...加密敏感...`agent_connections`/`adapter_nodes`(含加密凭证)"——**没有直接信这句注释，逐行读了 `buildExportSnapshot()` 函数体核实**：三段 `sqlite.prepare()` 查询分别覆盖 `identities`（`address`/`network`/`display_name`/`tags`/`notes`/`trust_level`）、`relation_states`（`local_address`/`peer_address`/`classification`/`trust_level`/`is_blocked`）、`relay_nodes`（**显式列名** `name`/`address`/`vision`/`principles_json`/`style`/`evolution_interval_hours`/`proactive_interval_minutes`/`social_style`/`social_overrides`/`focus`）——**三段查询没有一段碰 `mnemonic_encrypted`/`privkey_encrypted` 这两列，也没有任何一段查询碰 `agent_wallets` 表**（该表才是 `privkey_encrypted` 真正所在的表，`GET /api/relay/:id/wallets/:walletId/privkey` 那条查的是它，`backup.js` 完全没有 import/引用这张表）。注释描述与代码行为一致，核实通过。

**结论**：`GET /api/backup/export` **不含密钥物**，按 Bettor 1248 原话"若含密钥物则纳入同一档"的条件——这条不成立，本页判定**不纳入** `ADMIN_SECRET_KEY_EXPORT`/时间窗锁。

**附带记一笔、不代为处理**：这条路由本身当前也是**无鉴权**（跟本页要锁的两条一样，任意本机进程可读），导出内容虽不含密钥，但含 `identities`/`relation_states` 的社交图谱数据（`trust_level`/`classification`/`is_blocked` 这类关系判断）——是否值得单独一层鉴权是一个不同严重等级的问题（隐私/数据完整性，不是"资金可能被直接花掉"），不在 Bettor 1244/1248 这次派工的"密钥导出"范围内，本页不代为扩大范围处理，如实记一笔供后续单独评估。

### 1.3 为什么 `POST /relays/generate-mnemonic` 本页判定不锁（供 NWT 复核，不是本页替 NWT 拍板）

这条路由返回的是**当场随机生成、此刻尚未绑定任何链上资金**的助记词——不是从库里解密出的"某个已有账户"的密钥。风险模型不同：`GET .../mnemonic`/`.../privkey` 泄露的是**已经可能持有真实 KAS 余额**的账户密钥（第 1 批迁移的 10 个 relay 就是这类），后果是直接可花费的资金损失；`generate-mnemonic` 泄露的是一个"任何人都能自己在本地生成一个"的随机值，唯一的额外风险是"调用方生成后不知道被谁看到、之后又真的往这个地址充了钱"——这个风险存在，但属于**调用方自己后续操作**引入的，不是这条路由本身泄露了任何本来受保护的东西（跟任何人在任何地方生成一个新钱包地址给自己用、生成过程被人看到，是同一类风险，不特属于 console）。本页建议不纳入同一把锁（避免这把锁变得过宽、影响正常的"建新 relay"操作体验），但把判断权交给 NWT——如果 NWT 认为"生成后到入库前这个窗口"仍然值得同一层防护，加进来的改动量很小（跟另外两条共用同一个 gate 函数）。

## 2. 锁定设计（② Bettor 派工：默认关闭 + 一次性口令或 Owner 明示 env 开关 + 响亮日志 + 自动超时）

### 2.1 复用 `checkAdminSecretTier`，新开一个 tier

按 `admin-secret-tier.mjs` 现有惯例（`ADMIN_SECRET_ZK_CLOSE_BROADCAST`/`ADMIN_SECRET_STATUS_SIGN`/`ADMIN_SECRET_ZK_STATE_PREP`/`ADMIN_SECRET_READONLY` 四档，`T-<用途>` 命名），新增一档：

```
ADMIN_SECRET_KEY_EXPORT   T-KEY-EXPORT（本页新增，专属密钥导出，不与任何现有 tier 共用）
```

**不跟现有任何一档共用**——这是全仓风险等级最高的一类操作（直接吐出可花费私钥），理由同 `admin-secret-tier.mjs` 头注原话"绝不与广播共用"那条精神：一把钥匙的作用面越窄，泄露一把钥匙的后果就越可控。

### 2.2 "默认关闭 + 自动超时"：用一个时间戳型 env，不是布尔开关

Bettor 给了"一次性口令"或"Owner 明示 env 开关"两个方向，本页提议一个能同时满足"默认关闭"和"自动超时"、且实现最简单（无状态、不需要额外 DB 表/内存 Set）的形式：

```
RELAY_KEY_EXPORT_ENABLED_UNTIL=<unix 时间戳，秒>
```

- **未设** → 路由 503（同现有 `checkAdminSecretTier` 未设 tier 密钥时的行为一致）——这是默认态，跟"这台机器 `ADMIN_SECRET*` 系列本来就没配"的现状一致。
- **已设，但 `Date.now()/1000 > 该时间戳`** → 视同未设，503（**自动超时**天然实现——不需要额外定时器/cron 去清理，判断本身就是"现在几点"跟"这个数字"比大小，Owner 忘记关也会在设定的时间点自动失效）。
- **已设且未过期** → 进入下一步 `ADMIN_SECRET_KEY_EXPORT` 校验。
- Owner 开启时**必须给一个具体的到期时间**，不是 `=1` 这种"永久开"的写法——本页设计上不提供"永久启用"这个选项，逼迫每次开启都带一个明确的、有限的窗口（建议文档/落码时的默认建议值给一个短窗口如 300~900 秒，具体数值留给 NWT/Bettor 拍，本页不越权定死）。

**两把锁叠加、缺一不可**（`RELAY_KEY_EXPORT_ENABLED_UNTIL` 时间窗 + `ADMIN_SECRET_KEY_EXPORT` 密钥）——单独设时间窗不够（任何能碰到这台机器的进程都能读，等于没锁），单独设密钥不够（密钥一旦配置就是永久生效，不满足"自动超时"这条要求）。

### 2.3 "一次性口令"作为可选的更强化版本（供 NWT 判断是否需要叠加）

如果 §2.2 的"时间窗+静态密钥"组合被 NWT 判定强度不够（例如窗口内密钥可以被重复使用任意次），可以在此基础上叠加真正的一次性语义：调用成功一次后，在 `events` 表（或一个专用的小表）记一行"这次窗口内的密钥已被消费"，后续同一窗口内的调用即便密钥仍对仍然拒绝，要求 Owner 重新开一个新窗口才能再导出一次。**本页倾向不默认加这一层**——密钥导出这个操作在正常运维里可能需要连续导出好几个 relay（比如一次性迁移核对场景），"一次性"会让这种合法的连续操作变得反复找 Owner 要新窗口，体验代价换来的安全增量（相对于"时间窗本身已经很短"这个前提）不确定划算，留给 NWT 权衡是否要加。

### 2.4 响亮日志

每次这两条路由被**成功**调用（返回 200，真的吐出了密钥），无论是否合法开启：
1. `console.error`（用 error 级别，不是 log，确保不会被日志级别过滤掉）打一行，格式仿照本仓已有的"🔴"前缀 LOUD 约定：`🔴 [key-export] relay=<id 后 8 位> route=mnemonic 已导出，窗口到期=<ISO 时间戳>`（**不打印密钥内容本身**，只打印发生了这件事）。
2. 写一行到 `events` 表（`event_type='relay_key_exported'`, `level='error'`，`payload_json` 含 `relay_id`/`route`（`mnemonic`/`privkey`）/`wallet_id`（若是 privkey 路由）/时间戳，**同样不含密钥内容**）——同本仓 `relay-hotwallet-monitor.js` 的 `_writeAlertEvent` 既有写法（`INSERT INTO events`），不新造记录机制。
3. **调用失败（被拒）不打 LOUD 日志**，普通 `console.warn` 级别记一下即可（避免时间窗过期后的正常拒绝把日志刷成"看起来在报警"，只有真的吐出密钥这件事才值得 LOUD）。

## 3. 不改动任何现有导入路径行为（③ Bettor 明确要求）

见 §1 表格——`POST /api/relay/import-privkey`、`POST /relays`（mnemonic 路径）本页零改动，它们本来就不回显密钥、本来就有自己的既有鉴权/准入检查（`verifyIngestRequest`/`checkHotwalletAdmission`），跟本页新增的 `ADMIN_SECRET_KEY_EXPORT` tier 是两件不同的事，不合并、不交叉影响。

## 4. 落码范围预估（供 NWT 审时对照，本页不落码）

- `src/api/relay.js`：`GET /relays/:id/mnemonic`（:555）与 `GET /api/relay/:id/wallets/:walletId/privkey`（:844）两处各加一段前置校验（时间窗+`checkAdminSecretTier`），成功路径加 LOUD 日志+`events` 写入。
- 新增一个共享小函数（如 `checkKeyExportWindow(request)`，放在 `admin-secret-tier.mjs` 或新文件，具体位置留给落码方决定）封装"读 `RELAY_KEY_EXPORT_ENABLED_UNTIL`+校验过期+调 `checkAdminSecretTier`"这套逻辑，两条路由共用，不各写一份（防漂移，同本仓一贯的单源纪律）。
- 测试：正向（窗口内+密钥对→200+能读到密钥内容不变）、负向（未设时间窗/时间窗已过期/密钥缺失/密钥错误四种各自 503 或 403，且均无 LOUD 日志/`events` 写入）、成功路径的 LOUD 日志与 `events` 写入内容核对（不含密钥字符串本身，正则断言响应体/日志/events payload 都不匹配助记词/hex私钥的形状）。

## 5. 与 1238-补 端口风险的关系（如实标注，避免读者误以为两个问题互相替代）

这条锁定本身**不解决** 1238-补 描述的"测试跑到生产口"风险——即便这两条路由被锁住，其它无鉴权的路由（读余额、查 relay 列表等只读信息类端点）仍然会被测试意外打中，产生噪音/误导性的事件记录。两页是互补关系：`docs/2026-09-14-kanetui-test-runner-skip-gate-and-console-url-safety-design-v0.1.md` 从"测试不该打到生产口"这一端堵；本页从"就算打到了，最危险的那两条路由也拿不到密钥"这一端堵——纵深防御，不是二选一。
